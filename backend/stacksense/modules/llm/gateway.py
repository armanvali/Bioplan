"""The LLM layer (section 10): five jobs, each with a strict input/output contract.

The LLM makes the product feel conversational; it never makes medical decisions. It
has no write path into rules or plans: every job takes data in and returns text or
IDs out, validated against a schema, checked by guardrails, and replaced by a
deterministic template whenever anything is off (no provider, timeout, refusal,
invalid JSON after one retry, a faithfulness mismatch, a forbidden claim).

| Job                  | Output                                  | Fallback                       |
|----------------------|-----------------------------------------|--------------------------------|
| free-text -> signals | [{signal_id, confidence, quote}]        | keyword lexicon -> confirm chips|
| rephrase             | {prompt, helper}                        | approved text                  |
| template follow-up   | {template_id, slots} | null             | skip follow-up                 |
| explanations         | [{item_id, why_you, what_it_does, ...}] | sentence from reason codes     |
| doctor-note summary  | structured sections                     | plain templated note           |
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from stacksense.core.templates import join_list
from stacksense.modules.llm import guardrails
from stacksense.modules.llm.providers import NullProvider, Provider, ProviderResult, digest

log = logging.getLogger("stacksense.llm")

EXPLAIN_SYSTEM = (
    "You write short, plain-language explanations for a supplement plan. "
    "Use ONLY the facts in <plan>, <answers> and <evidence>. Do not add supplements, change doses, "
    "or claim to diagnose, treat or cure. Quote the user's own answers when saying why an item was chosen. "
    "Grade 7 reading level. Return JSON matching the schema. If a fact you need is missing, return "
    '"insufficient_context" in that field.'
)
MAP_SYSTEM = (
    "You map what a person wrote about their health to a fixed list of signal IDs. "
    "Only use IDs from <allowed>. Never invent IDs or medical conditions. For each match give a confidence "
    "from 0 to 1 and the exact short quote it came from. If nothing matches, return an empty list."
)
REPHRASE_SYSTEM = (
    "Rewrite the approved question for the requested reading level and language without changing its meaning, "
    "options or medical content. Keep it short. Return JSON matching the schema."
)
FOLLOWUP_SYSTEM = (
    "Choose at most one follow-up template from <templates> that would help, and fill its slots only with "
    "values listed for that slot. If none helps, return template_id null. You cannot write new questions."
)
DOCTOR_SYSTEM = (
    "Summarise a self-reported supplement intake for a clinician in neutral, factual language. Use only the facts "
    "given. Do not diagnose. Return JSON matching the schema."
)


# --------------------------------------------------------------------------- schemas


class Mapping_(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signal_id: str
    confidence: float = Field(ge=0, le=1)
    quote: str


class MappingOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mappings: list[Mapping_]


class RephraseOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str
    helper: str


class Slot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    value: str


class FollowUpOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template_id: str | None
    slots: list[Slot]


class Explanation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str
    why_you: str
    what_it_does: str
    evidence_summary: str


class ExplanationsOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[Explanation]


class DoctorOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason_for_visit: str
    reported_symptoms: list[str]
    requested_tests: list[str]
    current_medications: list[str]
    planned_supplements: list[str]
    notes: str


_DROP_KEYS = {"title", "default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern"}


def _schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON schema in the shape structured outputs accept (no $defs, additionalProperties false)."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def inline(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return inline(defs[node["$ref"].split("/")[-1]])
            # Constraints structured outputs may not support are enforced client-side by pydantic instead.
            out = {k: inline(v) for k, v in node.items() if k not in _DROP_KEYS}
            if out.get("type") == "object":
                out.setdefault("additionalProperties", False)
                if "properties" in out:
                    out["required"] = list(out["properties"])
            return out
        if isinstance(node, list):
            return [inline(x) for x in node]
        return node

    return inline(schema)


# --------------------------------------------------------------------------- free-text fallback lexicon

LEXICON: list[tuple[str, str]] = [
    (r"can'?t (fall )?sleep|insomnia|trouble (falling )?asleep|lie awake", "sleep_onset"),
    (r"wak(e|ing) up (at night|a lot|often)|broken sleep|wake at \d", "sleep_maintenance"),
    (r"night owl|not tired at (night|bedtime)|body clock|jet ?lag", "circadian_delay"),
    (r"stress(ed|ful)?|overwhelm(ed)?|anxious|burn(ed|t)? ?out|on edge", "stress_load"),
    (r"tired|exhausted|fatigue|no energy|drained|wiped", "fatigue"),
    (r"crash(es)? after lunch|afternoon slump|2 ?pm (crash|slump)", "afternoon_crash"),
    (r"sore after|doms|achy after|muscle soreness", "exercise_soreness"),
    (r"stiff (joints?|knees?|in the morning)|joint stiffness", "joint_stiffness"),
    (r"hair (is )?(falling|thinning|shedding)|losing hair", "hair_shedding"),
    (r"(always|keep) (getting|catching) (sick|colds?)|lots of colds|sick (a lot|often)", "frequent_colds"),
]


def lexicon_map(text: str, allowed: list[str]) -> list[dict[str, Any]]:
    out = []
    low = text.lower()
    for pattern, sid in LEXICON:
        if sid not in allowed:
            continue
        m = re.search(pattern, low)
        if m:
            out.append({"signal_id": sid, "confidence": 0.6, "quote": text[m.start():m.end()]})
    return out


# --------------------------------------------------------------------------- gateway


@dataclass
class CallLog:
    job: str
    model: str
    outcome: str  # ok | fallback:<reason>
    prompt_hash: str
    response_hash: str | None
    latency_ms: int
    cost_usd: float
    at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


class LLMGateway:
    def __init__(
        self, kb: Any, provider: Provider | None = None, fast_model: str = "claude-haiku-4-5", strong_model: str = "claude-opus-5-5",
        monthly_budget_usd: float = 200.0, max_grade: float = 10.0, on_log: Callable[[CallLog], None] | None = None,
    ) -> None:
        self.kb = kb
        self.provider = provider or NullProvider()
        self.models = {"map": fast_model, "rephrase": fast_model, "follow_up": fast_model, "explain": strong_model, "doctor": strong_model}
        self.budget = monthly_budget_usd
        self.spent = 0.0
        self.max_grade = max_grade
        self.on_log = on_log
        self.logs: list[CallLog] = []
        self.vocab = guardrails.ingredient_vocabulary(kb)

    # ------------------------------------------------------------------ core
    def _call(self, job: str, system: str, user: str, out_model: type[BaseModel], max_tokens: int, effort: str | None = None) -> tuple[BaseModel | None, str]:
        """Structured call with one retry on invalid output. Returns (parsed, outcome)."""
        if isinstance(self.provider, NullProvider):
            return None, "fallback:no_provider"
        if self.spent >= self.budget:
            return None, "fallback:cost_cap"
        model = self.models[job]
        schema = _schema(out_model)
        outcome = "fallback:invalid"
        for attempt in range(2):
            res: ProviderResult = self.provider.complete_json(model=model, system=system, user=user, schema=schema, max_tokens=max_tokens, effort=effort)
            self.spent += res.cost_usd
            self._log(job, model, user, res, "pending")
            if res.refused:
                return None, "fallback:refusal"
            if res.text is None:
                return None, f"fallback:{res.error or 'empty'}"
            try:
                return out_model.model_validate(json.loads(res.text)), "ok"
            except (json.JSONDecodeError, ValidationError):
                outcome = "fallback:invalid" if attempt else "retry"
        return None, outcome

    def _log(self, job: str, model: str, prompt: str, res: ProviderResult, outcome: str) -> None:
        entry = CallLog(job, model, outcome, digest(prompt), digest(res.text) if res.text else None, res.latency_ms, round(res.cost_usd, 6))
        self.logs.append(entry)
        if self.on_log:
            self.on_log(entry)

    def _finish(self, job: str, outcome: str) -> None:
        if self.logs and self.logs[-1].job == job:
            self.logs[-1].outcome = outcome
        log.info("llm job=%s outcome=%s", job, outcome)

    # ------------------------------------------------------------------ 1. free text -> signals
    def map_free_text(self, text: str, allowed_signals: list[str]) -> dict[str, Any]:
        """Low-confidence mappings come back as confirm chips; only confirmed or >= 0.8 count."""
        text = (text or "").strip()[:500]
        if not text:
            return {"mappings": [], "source": "none"}
        allowed_desc = {s: self.kb.signals[s].label for s in allowed_signals if s in self.kb.signals}
        user = f"<allowed>{json.dumps(allowed_desc)}</allowed>\n<text>{text}</text>"
        parsed, outcome = self._call("map", MAP_SYSTEM, user, MappingOut, 1024)
        if parsed is not None:
            maps = [m.model_dump() for m in parsed.mappings if m.signal_id in allowed_desc and m.quote.lower() in text.lower()]  # type: ignore[attr-defined]
            self._finish("map", "ok")
            source = "llm"
        else:
            maps = lexicon_map(text, list(allowed_desc))
            self._finish("map", outcome)
            source = "lexicon"
        for m in maps:
            m["needs_confirmation"] = m["confidence"] < 0.8
            m["label"] = allowed_desc[m["signal_id"]]
        return {"mappings": maps, "source": source}

    # ------------------------------------------------------------------ 2. rephrase
    def rephrase(self, node_payload: dict[str, Any], reading_level: str = "grade 6", locale: str = "en") -> dict[str, Any]:
        approved = {"prompt": node_payload.get("prompt", ""), "helper": node_payload.get("helper") or ""}
        user = f"<approved>{json.dumps(approved)}</approved>\n<reading_level>{reading_level}</reading_level>\n<locale>{locale}</locale>"
        parsed, outcome = self._call("rephrase", REPHRASE_SYSTEM, user, RephraseOut, 512)
        if parsed is None:
            self._finish("rephrase", outcome)
            return {**approved, "source": "approved"}
        out = parsed.model_dump()
        # Meaning-drift check: numbers must be preserved, no claims, not wildly longer.
        drift = guardrails.numbers_in(out["prompt"]) != guardrails.numbers_in(approved["prompt"]) or guardrails.claim_violations(out["prompt"] + out["helper"]) or len(out["prompt"]) > 2 * max(20, len(approved["prompt"]))
        if drift:
            self._finish("rephrase", "fallback:drift")
            return {**approved, "source": "approved"}
        self._finish("rephrase", "ok")
        return {**out, "source": "llm"}

    # ------------------------------------------------------------------ 3. template follow-ups
    def follow_up(self, templates: list[dict[str, Any]], answer_summary: str) -> dict[str, Any] | None:
        if not templates:
            return None
        user = f"<templates>{json.dumps(templates)}</templates>\n<answer>{answer_summary}</answer>"
        parsed, outcome = self._call("follow_up", FOLLOWUP_SYSTEM, user, FollowUpOut, 512)
        if parsed is None or parsed.template_id is None:  # type: ignore[attr-defined]
            self._finish("follow_up", outcome if parsed is None else "ok")
            return None
        tpl = next((t for t in templates if t["id"] == parsed.template_id), None)  # type: ignore[attr-defined]
        slots = {sl.name: sl.value for sl in parsed.slots}  # type: ignore[attr-defined]
        if not tpl or any(v not in tpl.get("slots", {}).get(k, []) for k, v in slots.items()) or set(slots) != set(tpl.get("slots", {})):
            self._finish("follow_up", "fallback:template_violation")
            return None
        text = tpl["text"]
        for k, v in slots.items():
            text = text.replace("{" + k + "}", v)
        self._finish("follow_up", "ok")
        return {"template_id": tpl["id"], "text": text, "answer": tpl.get("answer", {})}

    # ------------------------------------------------------------------ 4. explanations
    def explain_plan(self, plan: dict[str, Any], answers_summary: dict[str, str]) -> dict[str, Any]:
        items = plan["items"]
        fallback = {it["ingredient_id"]: self._template_explanation(it) for it in items}
        plan_facts = [
            {"item_id": it["ingredient_id"], "name": it["name"], "dose": it["dose_label"], "frequency": it["frequency_text"],
             "why": it["why"], "notes": it.get("notes", [])}
            for it in items
        ]
        evidence = {it["ingredient_id"]: [{"area": e["area"], "grade": e["grade"], "summary": e["summary"]} for e in it.get("evidence", [])[:3]] for it in items}
        # Data minimisation: signal labels and short answer summaries only; no names, emails or raw labs.
        user = f"<plan>{json.dumps(plan_facts)}</plan>\n<answers>{json.dumps(answers_summary)}</answers>\n<evidence>{json.dumps(evidence)}</evidence>"
        parsed, outcome = self._call("explain", EXPLAIN_SYSTEM, user, ExplanationsOut, 4096, effort="medium")
        source = "template"
        result = dict(fallback)
        if parsed is not None:
            allowed_ids = {it["ingredient_id"] for it in items} | {lk["ingredient_id"] for lk in plan.get("locked", [])}
            rejected = []
            for ex in parsed.items:  # type: ignore[attr-defined]
                if ex.item_id not in fallback:
                    continue
                texts = [ex.why_you, ex.what_it_does, ex.evidence_summary]
                if any("insufficient_context" in t for t in texts):
                    rejected.append((ex.item_id, "insufficient_context"))
                    continue
                problems = guardrails.faithfulness_problems(texts, {"plan": plan_facts, "evidence": evidence, "answers": answers_summary}, self.vocab, {ex.item_id} | (allowed_ids & {ex.item_id}))
                claims = guardrails.claim_violations(" ".join(texts))
                grade = guardrails.reading_grade(" ".join(texts))
                if problems or claims or grade > self.max_grade:
                    rejected.append((ex.item_id, (problems + claims + ([f"grade {grade}"] if grade > self.max_grade else []))[:3]))
                    continue
                result[ex.item_id] = {"why_you": ex.why_you, "what_it_does": ex.what_it_does, "evidence_summary": ex.evidence_summary, "source": "llm"}
            source = "llm" if not rejected else "mixed"
            self._finish("explain", "ok" if not rejected else f"partial:{len(rejected)}_rejected")
        else:
            self._finish("explain", outcome)
        return {"items": result, "source": source, "disclaimer": guardrails.DISCLAIMER}

    def _template_explanation(self, it: dict[str, Any]) -> dict[str, Any]:
        why = it.get("why") or []
        why_you = f"Because you told us you're {join_list(why)}." if why else "It supports the goals you ranked."
        ev = it.get("evidence") or []
        evidence_summary = (f"{ev[0]['summary']} (evidence grade {ev[0]['grade']})." if ev else "")
        return {"why_you": why_you, "what_it_does": it.get("info", {}).get("does", ""), "evidence_summary": evidence_summary, "source": "template"}

    # ------------------------------------------------------------------ 5. doctor note
    def doctor_summary(self, facts: dict[str, Any]) -> dict[str, Any]:
        fallback = {
            "reason_for_visit": facts.get("reason", "Supplement plan review"),
            "reported_symptoms": facts.get("symptoms", []),
            "requested_tests": facts.get("tests", []),
            "current_medications": facts.get("medications", []) or ["None reported"],
            "planned_supplements": facts.get("supplements", []),
            "notes": "Prepared from a self-reported intake. Not a diagnosis.",
        }
        parsed, outcome = self._call("doctor", DOCTOR_SYSTEM, f"<facts>{json.dumps(facts)}</facts>", DoctorOut, 2048, effort="low")
        if parsed is None:
            self._finish("doctor", outcome)
            return {**fallback, "source": "template"}
        out = parsed.model_dump()
        texts = [out["reason_for_visit"], out["notes"], *out["reported_symptoms"], *out["planned_supplements"]]
        if guardrails.claim_violations(" ".join(texts)) or guardrails.faithfulness_problems(texts, facts, self.vocab, set(facts.get("ingredient_ids", []))):
            self._finish("doctor", "fallback:guardrail")
            return {**fallback, "source": "template"}
        self._finish("doctor", "ok")
        return {**out, "source": "llm"}


def build_gateway(kb: Any, settings: Any, on_log: Callable[[CallLog], None] | None = None) -> LLMGateway:
    provider: Provider = NullProvider()
    if settings.anthropic_api_key:
        try:
            from stacksense.modules.llm.providers import AnthropicProvider

            provider = AnthropicProvider(settings.anthropic_api_key, settings.llm_timeout_s)
        except ImportError:
            log.warning("ANTHROPIC key set but the 'anthropic' package isn't installed; using template fallbacks")
    return LLMGateway(kb, provider, settings.llm_fast_model, settings.llm_strong_model, settings.llm_monthly_budget_usd, on_log=on_log)

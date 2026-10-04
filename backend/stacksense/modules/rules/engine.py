"""Recommendation engine (section 4): signals -> stack in six deterministic stages.

    1. Candidates      ingredients linked to an active signal or a ranked goal
    2. Eligibility     diet, allergy, condition, medication, pregnancy, age, fit rules,
                       restricted-population allow-lists, personal side-effect history
    3. Lab locks       requires_lab ingredients are locked without a recent lab value
    4. Dose            dose band by population and signal strength; upper-limit summation
    5. Interactions    major removes, moderate warns + spaces, timing constrains the scheduler
    6. Optimise        exact search under budget, pill limit and item cap

Every stage writes audit records, so the "why" text and the strike-through list on the
analysis screen are generated from real decisions, not prose. This module is the
**only** source of doses, exclusions and interactions. It never reads payment status,
retailers or commissions.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from stacksense.core import expr
from stacksense.core.templates import render
from stacksense.modules.impact import model as impact
from stacksense.modules.intake.answers import time12, time24
from stacksense.modules.rules import personal
from stacksense.modules.rules.optimiser import OptItem, solve

PREGNANCY_STATES = ("pregnant", "trying", "breastfeeding")
DAY_INDEX = {"mo": 0, "tu": 1, "we": 2, "th": 3, "fr": 4, "sa": 5, "su": 6}
DAY_LABEL = {"mo": "Mon", "tu": "Tue", "we": "Wed", "th": "Thu", "fr": "Fri", "sa": "Sat", "su": "Sun"}
DROP_TEXT = {
    "over_budget": "Didn't fit your monthly budget",
    "pill_limit": "Would go over your daily pill limit",
    "max_items": "Your stack already has the maximum number of items",
    "alternative_chosen": "Another form of the same nutrient was chosen",
    "lower_value": "Lower value for your goals than what's already in your stack",
}


@dataclass
class PlanInput:
    facts: dict[str, Any]
    goals: list[str]
    signals: dict[str, float]
    signal_sources: dict[str, list[dict[str, Any]]]
    evidenced: set[str]
    labs: dict[str, dict[str, Any]]
    flags: list[str]
    answers: dict[str, Any]
    season: dict[str, Any]
    context_date: str
    unsure_count: int = 0
    features: dict[str, Any] | None = None  # user_features; only with personalisation consent
    cost_per_dose: dict[str, float] | None = None  # catalog snapshot prices (never commissions)
    graph_version: str = ""


@dataclass
class Candidate:
    id: str
    reasons: list[dict[str, Any]] = field(default_factory=list)
    strength: float = 0.0
    state: str = "candidate"  # candidate | excluded | locked | active | dropped
    dose: dict[str, Any] | None = None
    delivery: dict[str, Any] | None = None
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    lab_dose_level: str | None = None
    value_multiplier: float = 1.0
    cap_level: str | None = None
    deliveries: list[dict[str, Any]] = field(default_factory=list)


class RulesEngine:
    def __init__(self, kb: Any) -> None:
        self.kb = kb
        self.T = float(kb.param("signal_active_threshold", 0.6))

    # ------------------------------------------------------------------ public
    def build(self, inp: PlanInput) -> dict[str, Any]:
        self.audit: list[dict[str, Any]] = []
        self.inp = inp
        self.ctx = self._context(inp)
        self.active = {s for s, p in inp.signals.items() if p >= self.T and not self.kb.signals[s].tip_only}

        cands = self.stage_candidates(inp)
        excluded = self.stage_eligibility(inp, cands)
        locked = self.stage_lab_locks(inp, cands, excluded)
        self.stage_dose(inp, cands, excluded)
        warnings, spacing, drug_spacing, checked = self.stage_interactions(inp, cands, excluded)
        need = impact.needs(self.kb, inp.goals, inp.signals, inp.evidenced)
        result = self.stage_optimise(inp, cands, excluded, need)

        items = result["items"]
        active_ids = {it["ingredient_id"] for it in items}
        warnings = [w for w in warnings if w["ingredient_id"] in active_ids] + self.final_pair_warnings
        spacing = [sp for sp in spacing if sp["a"] in active_ids and sp["b"] in active_ids]
        drug_spacing = [sp for sp in drug_spacing if sp["ingredient_id"] in active_ids]
        im = impact.impact_map(self.kb, need, items, self.active, locked)
        return {
            "rules_version": self.kb.version,
            "graph_version": inp.graph_version,
            "impact_version": impact.IMPACT_VERSION,
            "items": items,
            "locked": locked,
            "excluded": excluded,
            "dropped": result["dropped"],
            "trimmed": result["trimmed"],
            "warnings": warnings,
            "banners": self.banners,
            "tips": self._tips(),
            "spacing": spacing,
            "drug_spacing": drug_spacing,
            "suggestions": result["suggestions"] + self.suggestions,
            "scheduler_hints": self.scheduler_hints,
            "totals": result["totals"],
            "low_confidence": result["low_confidence"],
            "need": need,
            "impact": im,
            "interactions_checked": checked,
            "optimiser": result["optimiser"],
            "audit": self.audit,
        }

    def preview_exclusions(self, inp: PlanInput) -> list[dict[str, Any]]:
        """Stages 1-2 only: what the answers so far rule out. Used to show exclusions live
        during the intake (e.g. collagen <- vegetarian) without building a plan."""
        self.audit = []
        self.inp = inp
        self.ctx = self._context(inp)
        self.active = {s for s, p in inp.signals.items() if p >= self.T and not self.kb.signals[s].tip_only}
        cands = self.stage_candidates(inp)
        return self.stage_eligibility(inp, cands)

    # ------------------------------------------------------------------ helpers
    def _context(self, inp: PlanInput) -> dict[str, Any]:
        routine = inp.facts.get("routine") or {}
        derived = {}
        if isinstance(routine, dict) and routine.get("bed") is not None:
            derived["caffeine_cutoff"] = routine["bed"] - 480
        return {
            "facts": inp.facts, "signals": inp.signals, "goals": inp.goals, "answers": inp.answers,
            "labs": {k: v.get("value") for k, v in inp.labs.items()}, "flags": inp.flags, "season": inp.season,
            "derived": derived, "features": inp.features or {},
        }

    def _log(self, stage: str, ingredient: str | None, decision: str, reason_code: str, rule_id: str | None = None, **detail: Any) -> None:
        self.audit.append({"stage": stage, "ingredient": ingredient, "decision": decision, "reason_code": reason_code, "rule_id": rule_id, **detail})

    def _exclude(self, excluded: list[dict[str, Any]], cand: Candidate, kind: str, rule_id: str, rule_code: str, reason: str, short: str, stage: str) -> None:
        cand.state = "excluded"
        ing = self.kb.ingredients[cand.id]
        entry = {
            "ingredient_id": cand.id, "name": ing.name, "kind": kind, "rule_id": rule_id, "rule_code": rule_code,
            "reason": reason, "short": short or reason.rstrip(".").lower(), "stage": stage,
            "considered_because": [r.get("signal") or r.get("goal") for r in cand.reasons],
        }
        entry["source_node"] = self._source_node(kind, rule_code)
        excluded.append(entry)
        self._log(stage, cand.id, "excluded", rule_code, rule_id, reason=reason)

    def _source_node(self, kind: str, code: str) -> str | None:
        return {"diet": "B3_diet", "allergy": "C3_allergies", "condition": "C2_conditions", "drug_class": "C1_medications", "pregnancy": "C0_pregnancy", "age": "A0_about", "lab": "B7_bloodwork"}.get(kind)

    def _pregnant(self) -> bool:
        return self.inp.facts.get("pregnancy") in PREGNANCY_STATES

    # ------------------------------------------------------------------ 1. candidates
    def stage_candidates(self, inp: PlanInput) -> dict[str, Candidate]:
        cands: dict[str, Candidate] = {}
        for sid in sorted(self.active):
            p = inp.signals[sid]
            for ing_id, w in self.kb.ingredients_by_signal.get(sid, []):
                c = cands.setdefault(ing_id, Candidate(ing_id))
                c.reasons.append({"type": "signal", "signal": sid, "p": round(p, 3), "weight": w})
                c.strength = max(c.strength, p * w)
        min_grade = self.kb.param("goal_candidate_min_grade", "C")
        order = "ABCD"
        for g in inp.goals:
            goal = self.kb.goals.get(g)
            if not goal:
                continue
            for ing in self.kb.data.ingredients:
                claim = self.kb.claim(ing.id, goal.area)
                if not claim or order.index(claim.effect_grade) > order.index(min_grade):
                    continue
                if not expr.truthy(ing.general_benefit, self.ctx):
                    continue
                c = cands.setdefault(ing.id, Candidate(ing.id))
                if not any(r.get("goal") == g for r in c.reasons):
                    c.reasons.append({"type": "goal", "goal": g, "area": goal.area})
                c.strength = max(c.strength, 0.5)
        for ing in self.kb.data.ingredients:
            if ing.essential_when and expr.truthy(ing.essential_when, self.ctx):
                c = cands.setdefault(ing.id, Candidate(ing.id))
                c.reasons.append({"type": "essential"})
                c.strength = max(c.strength, 0.95)
        for cid in sorted(cands):
            self._log("candidates", cid, "added", "+".join(sorted({r["type"] for r in cands[cid].reasons})), reasons=cands[cid].reasons)
        return dict(sorted(cands.items()))

    # ------------------------------------------------------------------ 2. eligibility
    def stage_eligibility(self, inp: PlanInput, cands: dict[str, Candidate]) -> list[dict[str, Any]]:
        excluded: list[dict[str, Any]] = []
        self.banners: list[dict[str, Any]] = []
        self.suggestions: list[dict[str, Any]] = []
        self.scheduler_hints: list[dict[str, Any]] = []
        facts = inp.facts
        diet = facts.get("diet")
        allergies = set(facts.get("allergies") or [])
        conditions = set(facts.get("conditions") or [])
        drug_classes = set(facts.get("drug_classes") or [])
        age = facts.get("age")

        # Restricted populations use a separate, smaller allow-list.
        allowed: set[str] | None = None
        for lib in self.kb.data.restricted_libraries:
            if expr.truthy(lib.when, self.ctx):
                allowed = set(lib.allowed) if allowed is None else allowed & set(lib.allowed)
                self.banners.append({"id": f"library_{lib.id}", "kind": "restricted_library", "text": lib.banner, "label": lib.label})
                self._log("eligibility", None, "restricted_library", lib.id, lib.id)

        for cid, cand in cands.items():
            if allowed is not None and cid not in allowed:
                lib = next(lb for lb in self.kb.data.restricted_libraries if expr.truthy(lb.when, self.ctx))
                self._exclude(excluded, cand, "restricted", lib.id, f"library.{lib.id}", f"Not on the {lib.label.lower()}.", "not on the restricted list", "eligibility")
                continue
            for ci in self.kb.contraindications_by_ingredient.get(cid, []):
                hit = False
                if ci.kind == "diet":
                    hit = diet == ci.code
                elif ci.kind == "allergy":
                    hit = ci.code in allergies
                elif ci.kind == "condition":
                    hit = ci.code in conditions
                elif ci.kind == "drug_class":
                    hit = ci.code in drug_classes
                elif ci.kind == "pregnancy":
                    hit = self._pregnant()
                elif ci.kind == "age":
                    hit = isinstance(age, (int, float)) and (
                        (ci.code == "under_18" and age < 18) or (ci.code == "over_65" and age >= 65)
                    )
                elif ci.kind == "fit":
                    hit = True  # decided by `when`
                if hit and ci.when:
                    hit = expr.truthy(ci.when, self.ctx)
                if not hit:
                    continue
                if ci.severity == "exclude":
                    self._exclude(excluded, cand, ci.kind, ci.id, f"{ci.kind}.{ci.code}", ci.rule_text, ci.short, "eligibility")
                    break
                cand.warnings.append(ci.rule_text)
                self._log("eligibility", cid, "warned", f"{ci.kind}.{ci.code}", ci.id)

        # Unknown medication: pharmacist-check banner; drop anything with a drug interaction row.
        unknown = facts.get("unknown_meds") or []
        if unknown:
            self.banners.append({
                "id": "pharmacist_check", "kind": "pharmacist_check",
                "text": f"We couldn't match {', '.join(unknown)} to our medicine list, so we left out anything that interacts with medicines. Ask a pharmacist before starting.",
            })
            drug_linked = {x.a for x in self.kb.interactions if x.b.startswith("drug:") and x.severity in ("major", "moderate", "timing")}
            drug_linked |= {c.ingredient_id for c in self.kb.data.contraindications if c.kind == "drug_class"}
            for cid, cand in cands.items():
                if cand.state == "candidate" and cid in drug_linked:
                    self._exclude(excluded, cand, "unknown_medication", "unknown_medication", "drug.unknown", "Could interact with a medicine we couldn't identify.", "pharmacist check needed", "eligibility")

        # Already taking it (from the medicines/supplements list).
        for supply in facts.get("current_supplies") or []:
            sid = supply.get("ingredient_id")
            if sid and sid in cands and cands[sid].state == "candidate":
                self._exclude(excluded, cands[sid], "already_taking", "already_taking", "supply.duplicate", "You already take this.", "you already take it", "eligibility")

        # Personal response rules (section 14.3) from user_features, consent-gated upstream.
        personal.apply_eligibility(self, inp, cands, excluded)

        # Substitutes: an excluded item whose sibling stays eligible becomes a note, not a loss.
        for e in excluded:
            group = self.kb.ingredients[e["ingredient_id"]].group
            if group:
                siblings = [m for m in self.kb.group_members.get(group, []) if m != e["ingredient_id"] and m in cands and cands[m].state == "candidate"]
                if siblings:
                    e["substituted_by"] = siblings[0]
                    cands[siblings[0]].notes.append(f"{self.kb.ingredients[siblings[0]].name}, not {_lower_first(self.kb.ingredients[e['ingredient_id']].name)}: {_lower_first(e['reason'])}")
        return excluded

    # ------------------------------------------------------------------ 3. lab locks
    def stage_lab_locks(self, inp: PlanInput, cands: dict[str, Candidate], excluded: list[dict[str, Any]]) -> list[dict[str, Any]]:
        locked: list[dict[str, Any]] = []
        ctx_date = date.fromisoformat(inp.context_date)
        for cid, cand in cands.items():
            if cand.state != "candidate":
                continue
            ing = self.kb.ingredients[cid]
            # Lab results for this ingredient (requires_lab or not).
            for analyte, lab in self.kb.labs.items():
                if lab.ingredient_id != cid or analyte not in inp.labs:
                    continue
                lv = inp.labs[analyte]
                max_age = ing.requires_lab.max_age_days if ing.requires_lab else 365
                drawn = lv.get("drawn_at")
                if drawn:
                    try:
                        if (ctx_date - date.fromisoformat(str(drawn)[:10])).days > max_age:
                            continue  # too old to count
                    except ValueError:
                        pass
                rng = lab.classify(float(lv["value"]))
                if rng.action == "exclude":
                    reason = (rng.reason or f"Your {lab.name} result means this wouldn't help.").format(value=f"{lv['value']:g}")
                    self._exclude(excluded, cand, "lab", f"lab.{analyte}.{rng.status}", f"lab.{analyte}", reason, f"{lab.name.lower()} is {rng.text}", "lab_locks")
                elif rng.action == "dose":
                    cand.lab_dose_level = rng.dose_level
                    cand.notes.append(f"Dose set from your {lab.name} result ({lv['value']:g} {lab.unit}, {rng.text}).")
                    self._log("lab_locks", cid, "lab_dosed", f"lab.{analyte}.{rng.status}", dose_level=rng.dose_level)
                cand.reasons.append({"type": "lab", "analyte": analyte, "status": rng.status})
            if cand.state != "candidate":
                continue
            if ing.requires_lab and not any(r.get("type") == "lab" for r in cand.reasons):
                cand.state = "locked"
                lab = self.kb.labs[ing.requires_lab.analyte]
                srcs = []
                for r in cand.reasons:
                    if r.get("signal"):
                        srcs.extend(inp.signal_sources.get(r["signal"], []))
                locked.append({
                    "ingredient_id": cid, "name": ing.name, "short": ing.short, "reason": ing.requires_lab.reason,
                    "unlock": {"analyte": lab.id, "name": lab.name, "unit": lab.unit},
                    "sources": srcs, "considered_because": [r.get("signal") or r.get("goal") for r in cand.reasons],
                })
                self._log("lab_locks", cid, "locked", f"requires_lab.{lab.id}")
        return locked

    # ------------------------------------------------------------------ 4. dose
    def _band(self, cid: str) -> Any:
        bands = {b.population: b for b in self.kb.dose_bands_by_ingredient.get(cid, [])}
        sex = self.inp.facts.get("sex")
        age = self.inp.facts.get("age") or 0
        order = []
        if self._pregnant():
            order.append("pregnant")
        if age >= 65:
            order.append("older_adult")
        if sex == "female":
            order.append("adult_female")
        elif sex == "male":
            order.append("adult_male")
        order.append("adult")
        for pop in order:
            if pop in bands:
                return bands[pop]
        return next(iter(bands.values()), None)

    def stage_dose(self, inp: PlanInput, cands: dict[str, Candidate], excluded: list[dict[str, Any]]) -> None:
        powders_ok = inp.facts.get("powders_ok", True) is not False
        for cid, cand in cands.items():
            if cand.state != "candidate":
                continue
            band = self._band(cid)
            if band is None:
                self._exclude(excluded, cand, "no_dose", "no_dose_band", "dose.missing", "No safe dose range for you on file.", "no dose on file", "dose")
                continue
            if cand.lab_dose_level:
                level = cand.lab_dose_level
            elif any(r["type"] == "essential" for r in cand.reasons):
                level = "typical"
            elif cand.strength >= 0.9 and not self.kb.ingredients[cid].requires_lab:
                level = "max"
            else:
                # The band minimum often sits below the studied range (zero dose fit), so it is
                # only ever reached through upper-limit capping, never chosen directly.
                level = "typical"
            if cand.cap_level == "typical" and level in ("max", "lab_max"):
                level = "typical"
            dose = {"min": band.min, "typical": band.typical, "max": band.max, "lab_max": band.lab_max or band.max}[level]
            # Delivery form: fewest pills, honouring "no powders".
            ing = self.kb.ingredients[cid]
            options = [d for d in ing.delivery if powders_ok or d.form != "powder"]
            options = personal.filter_delivery(inp, cid, options)
            if not options:
                self._exclude(excluded, cand, "form", "no_form", "form.powder_only", "Only comes as a powder, and you said no powders.", "powder only", "dose")
                continue
            # Canonical (first-listed) form by default; pill-free variants are offered to the
            # optimiser and only win when the pill limit binds.
            cand.deliveries = [d.model_dump() for d in options]
            cand.delivery = cand.deliveries[0]
            cand.dose = {
                "amount": dose, "unit": band.unit, "level": level, "band_id": band.id, "population": band.population,
                "min": band.min, "max": band.lab_max if level == "lab_max" else band.max, "typical": band.typical, "step": band.step,
                "frequency": band.frequency, "weekdays": list(band.weekdays), "with_food": band.with_food,
                "label": render(band.label, {"dose": _fmt_num(dose), "unit": band.unit}),
            }
            self._log("dose", cid, "dosed", f"band.{band.id}.{level}", band.id, amount=dose, unit=band.unit)

        # Upper-limit summation across everything that supplies the same nutrient.
        supplies: dict[str, float] = {}
        for s in inp.facts.get("current_supplies") or []:
            if s.get("nutrient") and s.get("amount"):
                supplies[s["nutrient"]] = supplies.get(s["nutrient"], 0.0) + float(s["amount"])
        dosed = sorted((c for c in cands.values() if c.state == "candidate" and c.dose), key=lambda c: (-c.strength, c.id))
        for cand in dosed:
            ing = self.kb.ingredients[cand.id]
            if not ing.nutrient:
                continue
            ul = self.kb.upper_limits.get(ing.nutrient)
            if not ul or ul.unit != cand.dose["unit"]:
                continue
            existing = supplies.get(ing.nutrient, 0.0)
            amount = cand.dose["amount"]
            if existing + amount > ul.ul_value:
                room = ul.ul_value - existing
                step = cand.dose["step"] or 1
                capped = math.floor(room / step) * step
                if capped < cand.dose["min"]:
                    self._exclude(
                        excluded, cand, "upper_limit", ul.id, f"ul.{ing.nutrient}",
                        f"You already get {_fmt_num(existing)} {ul.unit} of this from what you take; more would pass the upper limit of {_fmt_num(ul.ul_value)} {ul.unit}.",
                        "would pass the upper limit", "dose",
                    )
                    continue
                cand.dose["amount"] = capped
                cand.dose["label"] = render(self._band(cand.id).label, {"dose": _fmt_num(capped), "unit": cand.dose["unit"]})
                cand.notes.append(f"Dose lowered to stay under the upper limit ({_fmt_num(ul.ul_value)} {ul.unit}) with what you already take.")
                self._log("dose", cand.id, "capped_upper_limit", f"ul.{ing.nutrient}", ul.id, amount=capped)
            # Groups (e.g. vitamin D) are mutually exclusive in the optimiser, so only the
            # chosen sibling will count; reserve its amount for the remaining nutrients.
            if not ing.group:
                supplies[ing.nutrient] = existing + cand.dose["amount"]

    # ------------------------------------------------------------------ 5. interactions & timing
    def stage_interactions(self, inp: PlanInput, cands: dict[str, Candidate], excluded: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], int]:
        drug_classes = set(inp.facts.get("drug_classes") or [])
        self.pair_warnings: list[dict[str, Any]] = []
        live = {cid for cid, c in cands.items() if c.state == "candidate"}
        warnings: list[dict[str, Any]] = []
        spacing: list[dict[str, Any]] = []
        drug_spacing: list[dict[str, Any]] = []
        n_meds = len(inp.facts.get("medications") or [])
        checked = len(live) * (len(live) - 1) // 2 + len(live) * n_meds
        standalone = {cid: self._standalone_value(cands[cid]) for cid in live}
        for x in self.kb.interactions:
            a_live = x.a in live
            if x.b.startswith("drug:"):
                cls = x.b[5:]
                if not a_live or cls not in drug_classes:
                    continue
                cand = cands[x.a]
                if x.severity == "major":
                    self._exclude(excluded, cand, "drug_class", x.id, f"interaction.{cls}", x.warning or x.mechanism, "interacts with your medicine", "interactions")
                    live.discard(x.a)
                elif x.severity == "moderate":
                    text = x.warning or x.mechanism
                    cand.warnings.append(text)
                    warnings.append({"ingredient_id": x.a, "with": x.b, "severity": "moderate", "text": text, "rule_id": x.id})
                    if "standard dose" in text:
                        cand.cap_level = "typical"
                        if cand.dose and cand.dose["level"] in ("max", "lab_max"):
                            self._recap(cand)
                    self._log("interactions", x.a, "warned", f"interaction.{cls}", x.id)
                elif x.severity == "timing":
                    drug_spacing.append({"ingredient_id": x.a, "drug_class": cls, "hours": x.spacing_hours, "text": f"Keep {_fmt_num(x.spacing_hours or 0)} h away from your {cls.replace('_', ' ')} medicine. {x.mechanism}", "rule_id": x.id})
                    self._log("interactions", x.a, "spacing", f"timing.{cls}", x.id, hours=x.spacing_hours)
                elif x.severity == "info":
                    cand.notes.append(x.warning or x.mechanism)
                continue
            if not (a_live and x.b in live):
                continue
            if x.severity == "major":
                lose = min((x.a, x.b), key=lambda i: (standalone.get(i, 0), i))
                self._exclude(excluded, cands[lose], "interaction", x.id, f"interaction.{x.a}.{x.b}", x.warning or x.mechanism, "interacts with another item", "interactions")
                live.discard(lose)
            elif x.severity == "moderate":
                # Attached after optimisation, and only if both items make the final stack.
                self.pair_warnings.append({"ingredient_id": x.a, "with": x.b, "severity": "moderate", "text": x.warning or x.mechanism, "rule_id": x.id})
                self._log("interactions", x.a, "warned", f"interaction.{x.b}", x.id)
            elif x.severity == "timing":
                spacing.append({"a": x.a, "b": x.b, "hours": x.spacing_hours, "reason": x.mechanism, "rule_id": x.id})
                self._log("interactions", x.a, "spacing", f"timing.{x.b}", x.id, hours=x.spacing_hours)
        # Timing-rule avoid_with pairs feed the scheduler too.
        for cid in sorted(live):
            t = self.kb.timing.get(cid)
            if not t:
                continue
            for other in t.avoid_with:
                if other in live and not any({s["a"], s["b"]} == {cid, other} for s in spacing):
                    spacing.append({"a": cid, "b": other, "hours": t.min_gap_hours, "reason": "Spacing rule", "rule_id": f"timing.{cid}"})
        return warnings, spacing, drug_spacing, checked

    def _recap(self, cand: Candidate) -> None:
        band = self._band(cand.id)
        cand.dose["amount"] = band.typical
        cand.dose["level"] = "typical"
        cand.dose["label"] = render(band.label, {"dose": _fmt_num(band.typical), "unit": band.unit})

    # ------------------------------------------------------------------ 6. optimise
    def _doses_per_month(self, cid: str, dose: dict[str, Any]) -> float:
        freq = dose["frequency"]
        if freq == "alternate":
            return 15.2
        if freq == "weekdays":
            return len(dose["weekdays"]) * 52 / 12
        if freq == "cycle":
            t = self.kb.timing.get(cid)
            on, off = (t.cycle_on_weeks or 8, t.cycle_off_weeks or 0) if t else (8, 0)
            return 30.4 * on / (on + off)
        return 30.4

    def _monthly_cost(self, cand: Candidate) -> float:
        ing = self.kb.ingredients[cand.id]
        per_dose = (self.inp.cost_per_dose or {}).get(cand.id, ing.ref_cost_per_dose)
        typical = cand.dose["typical"] or cand.dose["amount"]
        scale = cand.dose["amount"] / typical if typical else 1.0
        return round(per_dose * scale * self._doses_per_month(cand.id, cand.dose), 2)

    def _pills_pattern(self, cand: Candidate, delivery: dict[str, Any] | None = None) -> tuple[int, ...]:
        delivery = delivery or cand.delivery
        pills = int(delivery["pills"]) if delivery else 0
        if cand.dose["frequency"] == "weekdays":
            days = {DAY_INDEX[d] for d in cand.dose["weekdays"]}
            return tuple(pills if d in days else 0 for d in range(7))
        return tuple([pills] * 7)

    def _contrib(self, cand: Candidate) -> dict[str, float]:
        cs = impact.contributions(self.kb, cand.id, cand.dose["amount"] if cand.dose else None, cand.dose["unit"] if cand.dose else None, self.active)
        return {a: c.c * cand.value_multiplier for a, c in cs.items()}

    def _standalone_value(self, cand: Candidate) -> float:
        need = impact.needs(self.kb, self.inp.goals, self.inp.signals, self.inp.evidenced)
        return sum(need[a] / 10 * c for a, c in self._contrib(cand).items())

    def stage_optimise(self, inp: PlanInput, cands: dict[str, Candidate], excluded: list[dict[str, Any]], need: dict[str, float]) -> dict[str, Any]:
        personal.apply_value_rules(self, inp, cands)
        live = [c for c in cands.values() if c.state == "candidate" and c.dose]
        budget = float(inp.facts.get("budget") or self.kb.param("default_budget", 120))
        pill_limit = int(inp.facts.get("pill_limit") or self.kb.param("default_pill_limit", 8))
        max_items = int(self.kb.param("max_items", 8))
        low_conf = inp.unsure_count >= int(self.kb.param("low_confidence_unsure_count", 4))
        if low_conf:
            max_items = min(max_items, int(self.kb.param("low_confidence_max_items", 3)))
        synergy = {}
        for x in self.kb.interactions:
            if x.severity == "synergy":
                synergy[frozenset((x.a, x.b))] = dict(x.synergy)
        opt_items = []
        variants: dict[str, tuple[Candidate, dict[str, Any]]] = {}
        for c in live:
            group = self.kb.ingredients[c.id].group
            groups = frozenset({f"ing:{c.id}"} | ({f"grp:{group}"} if group else set()))
            essential = 100.0 if any(r["type"] == "essential" for r in c.reasons) else 0.0
            contrib = self._contrib(c)
            cost = self._monthly_cost(c)
            for i, d in enumerate(c.deliveries or [c.delivery]):
                vid = f"{c.id}|{d['form']}"
                variants[vid] = (c, d)
                opt_items.append(OptItem(
                    id=vid, ingredient=c.id, groups=groups, cost=cost, pills=self._pills_pattern(c, d),
                    # Tiny tie-breakers only: canonical form first, then the cheaper of equal-value options.
                    contrib=contrib, bonus=essential + (1e-6 * (10 - i)) - cost * 1e-5,
                ))
        res = solve(opt_items, need, budget, pill_limit, max_items, synergy)
        self.final_pair_warnings: list[dict[str, Any]] = []
        by_id = {o.id: o for o in opt_items}
        chosen = {by_id[vid].ingredient for vid in res.selected}

        items: list[dict[str, Any]] = []
        dropped: list[dict[str, Any]] = []
        trimmed: list[dict[str, Any]] = []
        for pw in self.pair_warnings:
            if pw["ingredient_id"] in chosen and pw["with"] in chosen:
                for i in (pw["ingredient_id"], pw["with"]):
                    cands[i].warnings.append(pw["text"])
                self.final_pair_warnings.append(pw)
        for vid in res.selected:
            c, d = variants[vid]
            c.state = "active"
            if d != c.delivery:
                c.notes.append(f"As a {d['form']} to keep you within {pill_limit} pills a day.")
            c.delivery = d
            items.append(self._item_payload(c, by_id[vid]))
            self._log("optimise", c.id, "selected", "optimiser.selected", value=round(items[-1]["value"], 4), form=d["form"])
        first_variant = {}
        for o in opt_items:
            first_variant.setdefault(o.ingredient, o)
        for ing_id, o in first_variant.items():
            if ing_id in chosen:
                continue
            c = cands[ing_id]
            c.state = "dropped"
            reason = res.reasons.get(ing_id, "lower_value")
            if low_conf and reason in ("max_items", "lower_value"):
                trimmed.append({"ingredient_id": ing_id, "name": self.kb.ingredients[ing_id].name, "reason": "We kept your stack to 3 items because several answers were 'Not sure'."})
                self._log("optimise", ing_id, "trimmed", "low_confidence")
                continue
            if reason == "alternative_chosen":
                self._log("optimise", ing_id, "dropped", reason)
                continue  # a sibling form was picked; not a loss worth showing
            dropped.append({
                "ingredient_id": ing_id, "name": self.kb.ingredients[ing_id].name, "reason_code": reason,
                "reason": DROP_TEXT[reason], "monthly_cost": round(o.cost, 2),
            })
            self._log("optimise", ing_id, "dropped", f"optimiser.{reason}")

        items.sort(key=lambda it: (-it["value"], it["ingredient_id"]))
        for i, it in enumerate(self._ramp_order(items)):
            it["ramp_order"] = i
        total_cost = round(sum(it["monthly_cost"] for it in items), 2)
        pills_by_day = [sum(by_id[vid].pills[d] for vid in res.selected) for d in range(7)]
        scoops = sum(1 for it in items if it["delivery"]["scoops"])
        busiest = max(range(7), key=lambda d: (pills_by_day[d], -d)) if items else 0
        suggestions = []
        for d in dropped:
            if d["reason_code"] == "over_budget":
                extra = round(total_cost + d["monthly_cost"] - budget, 2)
                if extra > 0:
                    suggestions.append({"type": "raise_budget", "ingredient_id": d["ingredient_id"], "amount": math.ceil(extra), "text": f"Raise your budget by ${math.ceil(extra)} a month to add {d['name']}."})
            if d["reason_code"] == "pill_limit":
                suggestions.append({"type": "raise_pill_limit", "ingredient_id": d["ingredient_id"], "text": f"Allow one more pill a day to add {d['name']}."})
        return {
            "items": items, "dropped": dropped, "trimmed": trimmed, "low_confidence": low_conf, "suggestions": suggestions,
            "totals": {
                "monthly_cost": total_cost, "budget": budget, "pill_limit": pill_limit, "pills_by_weekday": pills_by_day,
                "max_pills_day": max(pills_by_day) if items else 0, "busiest_day": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][busiest],
                "scoops": scoops, "items": len(items), "currency": "CAD" if inp.facts.get("country") != "US" else "USD",
            },
            "optimiser": {"objective": res.objective, "exact": res.exact, "nodes": res.nodes},
        }

    def _ramp_order(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Lowest side-effect risk first, so a reaction can be traced to one new item."""
        return sorted(items, key=lambda it: (self.kb.ingredients[it["ingredient_id"]].side_effect_risk, -it["value"], it["ingredient_id"]))

    def _item_payload(self, c: Candidate, o: OptItem) -> dict[str, Any]:
        ing = self.kb.ingredients[c.id]
        timing = self.kb.timing.get(c.id)
        sig_reasons = [r for r in c.reasons if r.get("type") == "signal"]
        sig_reasons.sort(key=lambda r: (-r["p"] * r["weight"], r["signal"]))
        why_signals = [r["signal"] for r in sig_reasons]
        phrases, seen = [], set()
        for s in why_signals:
            ph = self.kb.signals[s].phrase or self.kb.signals[s].label.lower()
            if ph not in seen:
                seen.add(ph)
                phrases.append(ph)
        sources = []
        for s in why_signals[:3]:
            sources.extend({"signal": s, **src} for src in self.inp.signal_sources.get(s, []))
        need = impact.needs(self.kb, self.inp.goals, self.inp.signals, self.inp.evidenced)
        value = sum(need[a] / 10 * v for a, v in o.contrib.items())
        evidence = []
        for a, v in sorted(o.contrib.items(), key=lambda kv: -kv[1]):
            cl = self.kb.claim(c.id, a)
            evidence.append({"area": a, "grade": cl.effect_grade, "summary": cl.summary, "claim_id": cl.id, "c": round(v, 2), "citations": cl.citations})
        top_grade = min((e["grade"] for e in evidence), default="D")
        dose = c.dose
        freq_text = {"daily": "Daily", "alternate": "Every other day", "cycle": f"Daily; {timing.cycle_on_weeks} weeks on, {timing.cycle_off_weeks} off" if timing and timing.cycle_on_weeks else "Daily"}.get(dose["frequency"])
        if dose["frequency"] == "weekdays":
            freq_text = "/".join(DAY_LABEL[d] for d in dose["weekdays"]) + " only"
        units = c.delivery["pills"] or c.delivery["scoops"] or 1
        noun = {"powder": "scoop", "drops": "drop", "liquid": "teaspoon"}.get(c.delivery["form"], c.delivery["form"])
        amount_text = f"{units} {noun}{'s' if units != 1 else ''}"
        return {
            "ingredient_id": c.id, "name": ing.name, "short": ing.short, "sub": ing.sub, "color": ing.color,
            "state": "active", "group": ing.group,
            "dose": dose["amount"], "unit": dose["unit"], "dose_label": dose["label"], "dose_level": dose["level"],
            "range": {"min": dose["min"], "max": dose["max"], "unit": dose["unit"]},
            "frequency": dose["frequency"], "frequency_text": freq_text, "weekdays": dose["weekdays"], "with_food": dose["with_food"],
            "delivery": c.delivery, "amount_text": amount_text,
            "prefer_slots": timing.prefer_slots if timing else ["breakfast"],
            "cycle": {"on_weeks": timing.cycle_on_weeks, "off_weeks": timing.cycle_off_weeks} if timing and timing.cycle_on_weeks else None,
            "cue": timing.cue if timing else "", "training_cue": timing.training_cue if timing else None,
            "reason_codes": sorted({f"{r['type']}:{r.get('signal') or r.get('goal') or r.get('analyte') or ''}".rstrip(':') for r in c.reasons}),
            "why": phrases[:3], "why_sources": sources,
            "value": round(value, 4), "monthly_cost": round(o.cost, 2), "pills_per_dose": c.delivery["pills"],
            "warnings": c.warnings, "notes": c.notes, "evidence": evidence, "evidence_grade": top_grade,
            "info": ing.info.model_dump(), "side_effect_risk": ing.side_effect_risk,
        }

    def _tips(self) -> list[dict[str, Any]]:
        out = []
        filters = {"time12": time12, "time24": time24}
        for tip in self.kb.data.tips:
            if expr.truthy(tip.when, self.ctx):
                out.append({"id": tip.id, "area": tip.area, "title": render(tip.title, self.ctx, filters), "text": render(tip.text, self.ctx, filters)})
        return out


def _lower_first(text: str) -> str:
    """Lower-case the first letter unless the word is an acronym or code (D3, K2, EPA)."""
    if not text:
        return text
    first = text.split(" ", 1)[0]
    if len(first) > 1 and (first[1].isupper() or first[1].isdigit()):
        return text
    return text[0].lower() + text[1:]


def _fmt_num(x: float) -> str:
    if float(x).is_integer():
        return f"{int(x):,}"
    return f"{x:g}"

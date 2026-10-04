"use client";

import { useState } from "react";
import { adminApi } from "@/lib/api";
import { useAdmin } from "@/lib/hooks";
import type { PlanDiff, SimBrief } from "@/lib/types";
import { Badge, Button, Card, ErrorBox, Field, inputCls } from "./ui";

interface SimResult { persona: string; live: SimBrief; draft: SimBrief; diff: PlanDiff | null }

/** Run a golden persona (or custom answers) through live vs draft and diff the plans. */
export function SimulatorPanel({ releaseId }: { releaseId: string }) {
  const personas = useAdmin<{ personas: { id: string; name: string; description: string }[] }>("/engine/personas");
  const [persona, setPersona] = useState("maya");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [res, setRes] = useState<SimResult | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = custom.trim() ? { release_id: releaseId, answers: JSON.parse(custom) } : { release_id: releaseId, persona_id: persona };
      setRes(await adminApi<SimResult>("/engine/simulator", { body }));
    } catch (e) {
      setError(e instanceof SyntaxError ? new Error(`Answers JSON: ${e.message}`) : e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Simulator: live vs this draft">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="Golden persona">
          <select value={persona} onChange={(e) => setPersona(e.target.value)} className={`${inputCls} w-full min-w-0`} disabled={Boolean(custom.trim())}>
            {personas.data?.personas.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.description}</option>)}
          </select>
        </Field>
        <Button variant="primary" busy={busy} onClick={run}>Run</Button>
      </div>
      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer text-ink-3">Or paste custom answers (node id → answer)</summary>
        <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={5} spellCheck={false} className="mt-2 w-full rounded-lg border border-line-2 p-2 font-mono" placeholder='{"A0_about": {"age": 40, "sex": "male", "country": "CA"}, ...}' />
      </details>
      <ErrorBox error={error} />
      {res ? (
        <div className="mt-4 grid gap-4">
          {res.diff ? (
            <div className={`rounded-lg p-3 text-[13px] ${res.diff.changed ? "bg-amber-tint text-amber-ink" : "bg-sage-tint text-sage-ink"}`}>
              {res.diff.changed ? (
                <ul className="grid gap-1">
                  {res.diff.added.length ? <li>Added: {res.diff.added.join(", ")}</li> : null}
                  {res.diff.removed.length ? <li>Removed: {res.diff.removed.join(", ")}</li> : null}
                  {res.diff.dose_changes.map((d) => <li key={d.ingredient_id}>Dose {d.ingredient_id}: {d.from} → {d.to}</li>)}
                  {res.diff.exclusions_added.length ? <li>Newly excluded: {res.diff.exclusions_added.join(", ")}</li> : null}
                  {res.diff.exclusions_removed.length ? <li>No longer excluded: {res.diff.exclusions_removed.join(", ")}</li> : null}
                  {res.diff.locks_added.length || res.diff.locks_removed.length ? <li>Locks: +{res.diff.locks_added.join(", ") || "none"} / −{res.diff.locks_removed.join(", ") || "none"}</li> : null}
                  {res.diff.cost_change ? <li>Cost change: ${res.diff.cost_change.toFixed(2)}/month</li> : null}
                </ul>
              ) : "No change to this persona's plan."}
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            {(["live", "draft"] as const).map((k) => <Brief key={k} label={k === "live" ? "Live" : "Draft"} b={res[k]} />)}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function Brief({ label, b }: { label: string; b: SimBrief }) {
  return (
    <div className="rounded-lg border border-line p-3 text-[13px]">
      <p className="mb-2 font-semibold">{label} <span className="font-normal text-ink-3">· {b.asked.length} cards{b.monthly_cost !== null ? ` · $${b.monthly_cost}/mo` : ""}</span></p>
      {b.terminal_stop ? <Badge tone="red">stopped: {b.terminal_stop}</Badge> : null}
      {b.stops.length && !b.terminal_stop ? <p className="mb-1 text-amber-ink">Stop cards: {b.stops.join(", ")}</p> : null}
      <ul className="grid gap-0.5">
        {b.stack.map((s) => <li key={s.ingredient_id}><b className="font-medium">{s.ingredient_id}</b> <span className="text-ink-3">{s.dose} · {s.frequency}</span></li>)}
      </ul>
      {b.locked.length ? <p className="mt-2 text-ink-2">Locked: {b.locked.join(", ")}</p> : null}
      {b.excluded.length ? <p className="mt-1 text-ink-3">Excluded: {b.excluded.map((e) => e.ingredient_id).join(", ")}</p> : null}
    </div>
  );
}

"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { SimulatorPanel } from "@/components/Simulator";
import { Badge, Button, Card, ErrorBox, Field, Json, Loading, Modal, ReasonButton, Table, fmtDate, inputCls, statusTone } from "@/components/ui";
import { adminApi, can, useAuth } from "@/lib/api";
import { useAdmin, useAdminWrite } from "@/lib/hooks";
import type { CheckReport, Release } from "@/lib/types";

const RULES_TABLES = ["ingredients", "evidence_claims", "dose_bands", "upper_limits", "contraindications", "interactions", "timing_rules", "signal_ingredient", "drugs", "lab_analytes", "restricted_libraries", "tips", "signals", "goals", "areas"];
const STEPS: Release["status"][] = ["draft", "checks_passed", "in_review", "approved", "published"];

export default function ReleasePage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAuth((s) => s.admin);
  const rel = useAdmin<Release>(`/engine/releases/${id}`);
  const impact = useAdmin<{ plans_checked: number; plans_changed?: number; safety_changes?: number; examples?: unknown[]; note?: string; policy?: string }>(`/engine/releases/${id}/impact`, {
    enabled: can(admin, "engine.simulate") && Boolean(rel.data && ["checks_passed", "in_review", "approved"].includes(rel.data.status)),
  });
  const act = useAdminWrite(({ path, body }: { path: string; body?: unknown }) => adminApi<Release>(`/engine/releases/${id}${path}`, { method: body === undefined ? "POST" : undefined, body }));
  const [editOpen, setEditOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [rollout, setRollout] = useState(100);

  if (rel.isLoading) return <Shell title="Release"><Loading /></Shell>;
  if (rel.error || !rel.data) return <Shell title="Release"><ErrorBox error={rel.error} /></Shell>;
  const r = rel.data;
  const report = r.check_report as CheckReport;
  const mine = r.author === admin?.id;
  const editable = ["draft", "checks_failed", "checks_passed", "rejected"].includes(r.status);

  return (
    <Shell title={`${r.version}`} scope="engine.read">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4">
          <Card title="Status">
            <ol className="flex flex-wrap items-center gap-2 text-[12px]" aria-label="Release workflow">
              {STEPS.map((s, i) => {
                const reached = STEPS.indexOf(r.status as Release["status"]) >= i;
                return (
                  <li key={s} className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-1 ${reached ? "bg-sage-tint font-semibold text-sage-ink" : "bg-sunken text-ink-3"}`}>{s.replace("_", " ")}</span>
                    {i < STEPS.length - 1 ? <span className="text-ink-3">→</span> : null}
                  </li>
                );
              })}
            </ol>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
              <div><dt className="text-ink-3">Status</dt><dd><Badge tone={statusTone(r.status)}>{r.status}</Badge></dd></div>
              <div><dt className="text-ink-3">Kind</dt><dd>{r.kind}</dd></div>
              <div><dt className="text-ink-3">Based on</dt><dd>{r.base_version}</dd></div>
              <div><dt className="text-ink-3">Rollout</dt><dd>{r.status === "published" ? `${r.rollout_pct}%` : "–"}</dd></div>
              <div><dt className="text-ink-3">Author</dt><dd className="truncate">{mine ? "You" : r.author}</dd></div>
              <div><dt className="text-ink-3">Reviewer</dt><dd className="truncate">{r.reviewer ?? "–"}</dd></div>
              <div><dt className="text-ink-3">Created</dt><dd>{fmtDate(r.created_at)}</dd></div>
              <div><dt className="text-ink-3">Published</dt><dd>{fmtDate(r.published_at)}</dd></div>
            </dl>
            {r.notes ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-sunken p-3 text-[13px]">{r.notes}</p> : null}
          </Card>

          {"ran_at" in report ? (
            <Card title={`Automated checks · ${report.passed ? "passed" : "failed"}`} actions={<span className="text-[12px] text-ink-3">{fmtDate(report.ran_at)}</span>}>
              {report.schema ? <Json value={report.schema} /> : null}
              {report.knowledge?.length ? <ul className="mb-3 list-disc pl-5 text-caution-ink">{report.knowledge.map((k) => <li key={k}>{k}</li>)}</ul> : null}
              {report.graph?.errors.length ? <ul className="mb-3 list-disc pl-5 text-caution-ink">{report.graph.errors.map((k) => <li key={k}>{k}</li>)}</ul> : null}
              {report.graph?.warnings.length ? <ul className="mb-3 list-disc pl-5 text-amber-ink">{report.graph.warnings.map((k) => <li key={k}>{k}</li>)}</ul> : null}
              {report.unreviewed_rows ? <p className="mb-3 text-amber-ink">{report.unreviewed_rows} rows are waiting for clinical sign-off (stamped on approval).</p> : null}
              {report.personas ? (
                <Table
                  rows={report.personas.results}
                  rowKey={(p) => p.persona}
                  cols={[
                    { key: "p", label: "Golden persona", render: (p) => p.persona },
                    { key: "r", label: "Result", render: (p) => <Badge tone={p.passed ? "green" : "red"}>{p.passed ? "pass" : "fail"}</Badge> },
                    { key: "c", label: "Cards", render: (p) => p.cards },
                    { key: "s", label: "Stack / problems", render: (p) => (p.problems.length ? <span className="text-caution-ink">{p.problems.join("; ")}</span> : <span className="text-ink-2">{p.stack.join(", ") || "(stopped)"}</span>) },
                  ]}
                />
              ) : null}
            </Card>
          ) : null}

          {impact.data ? (
            <Card title="Impact on existing plans">
              {impact.data.note ? <p>{impact.data.note}</p> : (
                <>
                  <p className="text-[13px]">
                    {impact.data.plans_changed} of {impact.data.plans_checked} active plans would change; {impact.data.safety_changes} touch a safety rule.
                  </p>
                  <p className="mt-1 text-[12px] text-ink-3">{impact.data.policy}</p>
                  {impact.data.examples?.length ? <div className="mt-3"><Json value={impact.data.examples} /></div> : null}
                </>
              )}
            </Card>
          ) : null}

          {can(admin, "engine.simulate") ? <SimulatorPanel releaseId={r.id} /> : null}
        </div>

        <aside className="grid min-w-0 content-start gap-4">
          <Card title="Actions">
            <div className="grid gap-2">
              {act.error ? <ErrorBox error={act.error} /> : null}
              {editable && can(admin, "engine.draft") ? <Button icon="doc" onClick={() => setEditOpen(true)}>Edit rows</Button> : null}
              {editable && can(admin, "engine.simulate") ? <Button icon="check" busy={act.isPending} onClick={() => act.mutate({ path: "/check" })}>Run automated checks</Button> : null}
              {r.status === "checks_passed" && can(admin, "engine.draft") ? <Button variant="primary" onClick={() => act.mutate({ path: "/submit" })}>Submit for clinical review</Button> : null}
              {r.status === "in_review" && can(admin, "engine.approve") ? (
                mine ? <p className="text-[12px] text-amber-ink">You wrote this release, so someone else has to review it.</p> : (
                  <div className="grid gap-2 rounded-lg bg-sunken p-3">
                    <Field label="Review notes"><textarea aria-label="Review notes" rows={2} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} className="rounded-lg border border-line-2 p-2" /></Field>
                    <div className="flex gap-2">
                      <Button variant="primary" onClick={() => act.mutate({ path: "/review", body: { approve: true, notes: reviewNotes || null } })}>Approve</Button>
                      <Button variant="danger" onClick={() => act.mutate({ path: "/review", body: { approve: false, notes: reviewNotes || null } })}>Reject</Button>
                    </div>
                  </div>
                )
              ) : null}
              {["approved", "published"].includes(r.status) && can(admin, "engine.publish") ? (
                <div className="grid gap-2 rounded-lg bg-sunken p-3">
                  <Field label={`Rollout: ${rollout}% of users`} hint="Bucketed by subject, so each person stays on one version.">
                    <input type="range" min={1} max={100} value={rollout} onChange={(e) => setRollout(Number(e.target.value))} />
                  </Field>
                  <Button variant="primary" onClick={() => act.mutate({ path: "/publish", body: { rollout_pct: rollout } })}>{r.status === "published" ? "Change rollout" : "Publish"}</Button>
                </div>
              ) : null}
              {r.status === "published" && can(admin, "engine.publish") ? (
                <ReasonButton label="Roll back" title={`Roll back ${r.version}`} variant="danger" icon="undo" onConfirm={(reason) => act.mutateAsync({ path: "/rollback", body: { reason } })} />
              ) : null}
              {!editable && !["in_review", "approved", "published"].includes(r.status) ? <p className="text-[12px] text-ink-3">No actions available.</p> : null}
            </div>
          </Card>
          <Card title="Data">
            <DataSummary data={r.data ?? {}} />
          </Card>
        </aside>
      </div>
      {r.kind === "rules" ? <EditRows open={editOpen} onClose={() => setEditOpen(false)} release={r} /> : <EditRows open={editOpen} onClose={() => setEditOpen(false)} release={r} tables={["nodes"]} />}
    </Shell>
  );
}

function DataSummary({ data }: { data: Record<string, unknown> }) {
  const tables = Object.entries(data).filter(([, v]) => Array.isArray(v)) as [string, unknown[]][];
  return (
    <ul className="grid gap-1 text-[13px]">
      {tables.map(([k, v]) => (
        <li key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums text-ink-3">{v.length}</span></li>
      ))}
    </ul>
  );
}

const KEY: Record<string, string> = { timing_rules: "ingredient_id" };

/** Row-level edits: pick a table and a row, change the JSON, save as an upsert (or delete).
 *  Every knowledge row needs a source; the server rejects rows without one. */
function EditRows({ open, onClose, release, tables = RULES_TABLES }: { open: boolean; onClose: () => void; release: Release; tables?: string[] }) {
  const [table, setTable] = useState(tables[0]);
  const rows = useMemo(() => ((release.data?.[table] as Record<string, unknown>[]) ?? []), [release, table]);
  const key = KEY[table] ?? "id";
  const [rowId, setRowId] = useState<string>("");
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const save = useAdminWrite((ops: unknown[]) => adminApi<Release>(`/engine/releases/${release.id}`, { method: "PATCH", body: { ops, reason: reason || null } }));

  const pick = (id: string) => {
    setRowId(id);
    const row = rows.find((r) => String(r[key]) === id);
    setText(JSON.stringify(row ?? { [key]: "", source: "" }, null, 2));
  };
  const upsert = async () => {
    try {
      const row = JSON.parse(text);
      setParseError(null);
      await save.mutateAsync([{ op: "upsert", table, row }]);
      onClose();
    } catch (e) {
      if (e instanceof SyntaxError) setParseError(e.message);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit rows">
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Table">
            <select aria-label="Table" value={table} onChange={(e) => { setTable(e.target.value); setRowId(""); setText(""); }} className={inputCls}>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Row">
            <select aria-label="Row" value={rowId} onChange={(e) => pick(e.target.value)} className={inputCls}>
              <option value="">Choose… or new</option>
              <option value="__new__">+ New row</option>
              {rows.map((r) => <option key={String(r[key])} value={String(r[key])}>{String(r[key])}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Row JSON" hint="Keep `source` (a citation). Reviewers see the before/after in the audit log.">
          <textarea aria-label="Row JSON" value={text} onChange={(e) => setText(e.target.value)} rows={14} spellCheck={false} className="rounded-lg border border-line-2 p-3 font-mono text-[12px]" />
        </Field>
        <Field label="Why"><input aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Updated per Health Canada monograph 2026" /></Field>
        {parseError ? <p className="text-caution-ink">Invalid JSON: {parseError}</p> : null}
        <ErrorBox error={save.error} />
        <div className="flex justify-between">
          <Button variant="danger" disabled={!rowId || rowId === "__new__"} onClick={async () => { await save.mutateAsync([{ op: "delete", table, id: rowId }]); onClose(); }}>Delete row</Button>
          <Button variant="primary" busy={save.isPending} disabled={!text} onClick={upsert}>Save row</Button>
        </div>
      </div>
    </Modal>
  );
}

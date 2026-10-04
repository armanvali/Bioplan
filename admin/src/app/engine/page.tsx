"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, Table, fmtDate, inputCls, statusTone } from "@/components/ui";
import { adminApi, can, useAuth } from "@/lib/api";
import { useAdmin, useAdminWrite } from "@/lib/hooks";
import type { Release } from "@/lib/types";

export default function EnginePage() {
  const admin = useAuth((s) => s.admin);
  const router = useRouter();
  const [kind, setKind] = useState<string>("");
  const releases = useAdmin<{ releases: Release[] }>("/engine/releases", { query: { kind: kind || undefined } });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ kind: "rules" | "graph"; notes: string }>({ kind: "rules", notes: "" });
  const create = useAdminWrite((d: typeof draft) => adminApi<Release>("/engine/releases", { body: d }));

  return (
    <Shell
      title="Engine releases"
      scope="engine.read"
      actions={can(admin, "engine.draft") ? <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>New draft</Button> : null}
    >
      <Card
        title="Releases"
        actions={
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls} aria-label="Filter by kind">
            <option value="">All kinds</option>
            <option value="rules">Rules (knowledge)</option>
            <option value="graph">Question graph</option>
          </select>
        }
      >
        {releases.isLoading ? <Loading /> : releases.error ? <ErrorBox error={releases.error} /> : (
          <Table
            rows={releases.data!.releases}
            rowKey={(r) => r.id}
            empty="No releases yet. The seed knowledge and graph are live."
            cols={[
              { key: "v", label: "Version", render: (r) => <Link href={`/engine/${r.id}`} className="font-medium underline">{r.version}</Link> },
              { key: "k", label: "Kind", render: (r) => r.kind },
              { key: "b", label: "Based on", render: (r) => <span className="text-ink-3">{r.base_version}</span> },
              { key: "s", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
              { key: "r", label: "Rollout", render: (r) => (r.status === "published" ? `${r.rollout_pct}%` : "–") },
              { key: "n", label: "Notes", render: (r) => <span className="line-clamp-2 max-w-sm text-ink-2">{r.notes}</span> },
              { key: "c", label: "Created", render: (r) => fmtDate(r.created_at) },
            ]}
          />
        )}
      </Card>
      <p className="mt-4 text-[12px] text-ink-3">
        Workflow: draft → automated checks (schema, knowledge validation, graph reachability, golden personas) → clinical review by someone other
        than the author → publish with a rollout % → roll back in one click. Every step is audited.
      </p>
      <Modal open={open} onClose={() => setOpen(false)} title="New draft release">
        <div className="grid gap-3">
          <Field label="Kind">
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "rules" | "graph" })} className={inputCls}>
              <option value="rules">Rules: ingredients, evidence, dose bands, contraindications, interactions…</option>
              <option value="graph">Question graph: nodes, effects, red flags</option>
            </select>
          </Field>
          <Field label="What and why"><textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="rounded-lg border border-line-2 p-3" /></Field>
          <ErrorBox error={create.error} />
          <div className="flex justify-end">
            <Button variant="primary" busy={create.isPending} onClick={async () => { const r = await create.mutateAsync(draft); router.push(`/engine/${r.id}`); }}>Create from live</Button>
          </div>
        </div>
      </Modal>
    </Shell>
  );
}

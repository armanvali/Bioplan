"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Button, Card, ErrorBox, Json, Loading, Table, fmtDate, inputCls } from "@/components/ui";
import { adminApi, can, useAuth } from "@/lib/api";
import { useAdmin } from "@/lib/hooks";
import type { AuditRecord } from "@/lib/types";

export default function AuditPage() {
  const admin = useAuth((s) => s.admin);
  const [f, setF] = useState({ actor: "", action: "", target_id: "" });
  const [applied, setApplied] = useState(f);
  const log = useAdmin<{ records: AuditRecord[] }>("/audit", { query: { ...applied, limit: 300 } });
  const [open, setOpen] = useState<number | null>(null);
  const exportCsv = async () => {
    const text = await adminApi<string>("/audit/export", { text: true });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `stacksense-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  return (
    <Shell title="Audit log" scope="audit.read" actions={can(admin, "audit.export") ? <Button icon="download" onClick={exportCsv}>Export CSV</Button> : null}>
      <Card>
        <form className="grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
          <input className={inputCls} placeholder="Actor id" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} aria-label="Actor" />
          <input className={inputCls} placeholder="Action prefix (e.g. release.)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} aria-label="Action" />
          <input className={inputCls} placeholder="Target id" value={f.target_id} onChange={(e) => setF({ ...f, target_id: e.target.value })} aria-label="Target" />
          <Button variant="primary" type="submit">Filter</Button>
        </form>
        <p className="mt-2 text-[12px] text-ink-3">Append-only: the database rejects updates and deletes on this table.</p>
      </Card>
      <div className="mt-4">
        {log.isLoading ? <Loading /> : log.error ? <ErrorBox error={log.error} /> : (
          <Card title={`${log.data!.records.length} entries`}>
            <Table
              rows={log.data!.records}
              rowKey={(r) => r.id}
              cols={[
                { key: "t", label: "When", render: (r) => fmtDate(r.ts) },
                { key: "a", label: "Action", render: (r) => <span className="font-mono text-[12px]">{r.action}</span> },
                { key: "w", label: "Who", render: (r) => <span>{r.role}<br /><span className="text-[11px] text-ink-3">{r.actor}</span></span> },
                { key: "o", label: "Target", render: (r) => <span className="text-[12px]">{r.target_type} {r.target_id}</span> },
                { key: "r", label: "Reason", render: (r) => r.reason ?? "" },
                { key: "d", label: "", render: (r) => (r.before || r.after ? <button className="underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Diff"}</button> : null) },
              ]}
            />
            {open !== null ? (() => {
              const r = log.data!.records.find((x) => x.id === open)!;
              return <div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="eyebrow mb-1">Before</p><Json value={r.before} /></div><div><p className="eyebrow mb-1">After</p><Json value={r.after} /></div></div>;
            })() : null}
          </Card>
        )}
      </div>
    </Shell>
  );
}

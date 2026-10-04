"use client";

import { useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge, Card, ErrorBox, Field, Json, Loading, Table, inputCls } from "@/components/ui";
import { useAdmin } from "@/lib/hooks";

type Row = Record<string, unknown>;

export default function KnowledgePage() {
  const kb = useAdmin<{ version: string; data: Record<string, unknown>; problems: string[] }>("/engine/knowledge");
  const graph = useAdmin<{ version: string; data: { nodes: Row[]; stop_cards: Row[] }; check: { errors: string[]; warnings: string[] } }>("/engine/graph");
  const llm = useAdmin<{ fallback_rate: number; calls: { job: string; model: string; outcome: string; latency_ms: number; cost_usd: number; ts: string }[] }>("/engine/llm");
  const [table, setTable] = useState("ingredients");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Row | null>(null);

  const tables = useMemo(() => {
    const t: Record<string, Row[]> = {};
    for (const [k, v] of Object.entries(kb.data?.data ?? {})) if (Array.isArray(v)) t[k] = v as Row[];
    if (graph.data) {
      t["graph: nodes"] = graph.data.data.nodes;
      t["graph: stop_cards"] = graph.data.data.stop_cards;
    }
    return t;
  }, [kb.data, graph.data]);
  const rows = (tables[table] ?? []).filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  const keyOf = (r: Row) => String(r.id ?? r.ingredient_id ?? JSON.stringify(r).slice(0, 40));

  return (
    <Shell title="Knowledge & question graph" scope="engine.read">
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card title="Rules (live)"><p className="font-semibold">{kb.data?.version ?? "…"}</p>{kb.data?.problems.length ? <p className="text-caution-ink">{kb.data.problems.length} validation problems</p> : <Badge tone="green">valid</Badge>}</Card>
          <Card title="Graph (live)"><p className="font-semibold">{graph.data?.version ?? "…"}</p>{graph.data ? <p className="text-[12px] text-ink-3">{graph.data.check.errors.length} errors · {graph.data.check.warnings.length} warnings</p> : null}</Card>
          <Card title="LLM layer"><p className="font-semibold">{llm.data ? `${(llm.data.fallback_rate * 100).toFixed(1)}% fallbacks` : "…"}</p><p className="text-[12px] text-ink-3">{llm.data?.calls.length ?? 0} recent calls. The LLM only writes words; rules decide.</p></Card>
        </div>
        <Card
          title="Browse"
          actions={
            <>
              <select value={table} onChange={(e) => setTable(e.target.value)} className={inputCls} aria-label="Table">
                {Object.keys(tables).map((t) => <option key={t} value={t}>{t} ({tables[t].length})</option>)}
              </select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={inputCls} aria-label="Filter rows" />
            </>
          }
        >
          {kb.isLoading ? <Loading /> : kb.error ? <ErrorBox error={kb.error} /> : (
            <Table
              rows={rows}
              rowKey={keyOf}
              cols={[
                { key: "id", label: "Key", render: (r) => <button className="font-medium underline" onClick={() => setOpen(r)}>{keyOf(r)}</button> },
                { key: "sum", label: "Summary", render: (r) => <span className="line-clamp-2 text-ink-2">{String(r.name ?? r.prompt ?? r.summary ?? r.reason ?? r.title ?? r.label ?? "")}</span> },
                { key: "src", label: "Source", render: (r) => <span className="line-clamp-1 text-ink-3">{String(r.source ?? "")}</span> },
                { key: "rev", label: "Reviewed", render: (r) => (r.reviewed_by ? <Badge tone={r.reviewed_by === "pending-clinical-review" ? "amber" : "green"}>{String(r.reviewed_by)}</Badge> : <span className="text-ink-3">–</span>) },
              ]}
            />
          )}
        </Card>
        {open ? (
          <Card title={keyOf(open)} actions={<button className="text-[12px] underline" onClick={() => setOpen(null)}>Close</button>}>
            <Field label="Row (read-only here; change it in a draft release)"><Json value={open} max={600} /></Field>
          </Card>
        ) : null}
      </div>
    </Shell>
  );
}

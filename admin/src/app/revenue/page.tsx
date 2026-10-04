"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Field, Json, Loading, Modal, ReasonButton, Table, fmtDate, fmtMoney, statusTone } from "@/components/ui";
import { adminApi, can, useAuth } from "@/lib/api";
import { useAdmin, useAdminWrite } from "@/lib/hooks";

interface Plan { key: string; name: string; kind: string; features: string[]; limits: Record<string, number>; trial_days: number; active: boolean; prices: { id: string; currency: string; region: string; amount: number; interval: string | null; stripe_price_id: string | null }[] }
interface PaywallVersion { id: number; version: number; status: string; gates: Record<string, unknown>; triggers: unknown[]; copy: Record<string, unknown>; created_by: string; published_at: string | null }
interface Experiment { key: string; name: string; surface: string; region: string | null; variants: { key: string; weight: number; config: unknown }[]; metrics: string[]; guardrails: Record<string, number>; status: string; stop_reason: string | null; assignments: Record<string, number> }

const FEATURES = ["impact_full", "impact_history", "exact_doses", "product_alternatives", "price_alerts", "calendar_90d", "calendar_ongoing", "reminders", "doctor_note", "checkins", "lab_replan", "rerun_intake"];
type Tab = "plans" | "paywall" | "promos" | "experiments";

export default function RevenuePage() {
  const admin = useAuth((s) => s.admin);
  const w = can(admin, "revenue.write");
  const [tab, setTab] = useState<Tab>("plans");
  const plans = useAdmin<{ plans: Plan[] }>("/revenue/plans");
  const paywall = useAdmin<{ live: Record<string, unknown>; versions: PaywallVersion[] }>("/revenue/paywall", { enabled: tab === "paywall" });
  const promos = useAdmin<{ promos: Record<string, unknown>[] }>("/revenue/promos", { enabled: tab === "promos" });
  const exps = useAdmin<{ experiments: Experiment[] }>("/revenue/experiments", { enabled: tab === "experiments" });
  const write = useAdminWrite(({ path, method, body }: { path: string; method?: string; body?: unknown }) => adminApi(path, { method, body }));
  const [json, setJson] = useState<{ title: string; text: string; submit: (v: unknown) => Promise<unknown> } | null>(null);
  const [jsonErr, setJsonErr] = useState<unknown>(null);

  const toggleFeature = (p: Plan, f: string) => {
    const features = p.features.includes(f) ? p.features.filter((x) => x !== f) : [...p.features, f];
    write.mutate({ path: `/revenue/plans/${p.key}`, method: "PUT", body: { features, _reason: `Toggle ${f} on ${p.key}` } });
  };

  return (
    <Shell title="Revenue & paywall" scope="revenue.read">
      <div role="tablist" className="mb-4 flex gap-1">
        {(["plans", "paywall", "promos", "experiments"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-[13px] ${tab === t ? "bg-ink text-white" : "bg-surface text-ink-2 hover:bg-sunken"}`}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {write.error ? <div className="mb-3"><ErrorBox error={write.error} /></div> : null}

      {tab === "plans" ? (
        plans.isLoading ? <Loading /> : (
          <div className="grid gap-4">
            <Card title="Feature matrix">
              <p className="mb-3 text-[12px] text-ink-3">Gate by feature key. Safety information (exclusions, interactions, locked items, stop cards) isn&apos;t a feature key, so it can&apos;t be gated.</p>
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase text-ink-3"><th className="px-4 py-2">Feature</th>{plans.data!.plans.map((p) => <th key={p.key} className="px-4 py-2">{p.name}</th>)}</tr></thead>
                  <tbody>
                    {FEATURES.map((f) => (
                      <tr key={f} className="border-b border-line/60">
                        <td className="px-4 py-1.5 font-mono text-[12px]">{f}</td>
                        {plans.data!.plans.map((p) => (
                          <td key={p.key} className="px-4 py-1.5">
                            <input type="checkbox" aria-label={`${f} in ${p.name}`} checked={p.features.includes(f)} disabled={!w || p.kind === "free"} onChange={() => toggleFeature(p, f)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Prices">
              <Table
                rows={plans.data!.plans.flatMap((p) => p.prices.map((pr) => ({ ...pr, plan: p })))}
                rowKey={(r) => r.id}
                cols={[
                  { key: "p", label: "Plan", render: (r) => r.plan.name },
                  { key: "i", label: "Price id", render: (r) => <span className="font-mono text-[12px]">{r.id}</span> },
                  { key: "r", label: "Region", render: (r) => r.region },
                  { key: "a", label: "Amount", render: (r) => `${fmtMoney(r.amount, r.currency)}${r.interval ? `/${r.interval}` : ""}` },
                  { key: "s", label: "Stripe", render: (r) => r.stripe_price_id ?? <span className="text-amber-ink">not linked</span> },
                  {
                    key: "x", label: "", render: (r) => w ? (
                      <Button onClick={() => setJson({ title: `Edit ${r.id}`, text: JSON.stringify({ plan_key: r.plan.key, currency: r.currency, region: r.region, amount: r.amount, interval: r.interval, stripe_price_id: r.stripe_price_id }, null, 2), submit: (v) => write.mutateAsync({ path: `/revenue/prices/${r.id}`, method: "PUT", body: { ...(v as object), _reason: "Price change from admin" } }) })}>Edit</Button>
                    ) : null,
                  },
                ]}
              />
            </Card>
            <Card title="Trials and limits">
              <Table rows={plans.data!.plans} rowKey={(p) => p.key}
                cols={[
                  { key: "n", label: "Plan", render: (p) => p.name },
                  { key: "t", label: "Trial days", render: (p) => p.trial_days },
                  { key: "l", label: "Limits", render: (p) => Object.entries(p.limits).map(([k, v]) => `${k}=${v}`).join(", ") },
                  { key: "x", label: "", render: (p) => w ? <Button onClick={() => setJson({ title: `Edit ${p.name}`, text: JSON.stringify({ name: p.name, trial_days: p.trial_days, limits: p.limits, active: p.active }, null, 2), submit: (v) => write.mutateAsync({ path: `/revenue/plans/${p.key}`, method: "PUT", body: { ...(v as object), _reason: "Plan settings from admin" } }) })}>Edit</Button> : null },
                ]} />
            </Card>
          </div>
        )
      ) : null}

      {tab === "paywall" ? (
        paywall.isLoading ? <Loading /> : (
          <div className="grid gap-4">
            <Card title="Live paywall" actions={w ? <Button variant="primary" onClick={() => setJson({ title: "New paywall draft", text: JSON.stringify({ gates: paywall.data!.live.gates, triggers: paywall.data!.live.triggers, copy: paywall.data!.live.copy }, null, 2), submit: (v) => write.mutateAsync({ path: "/revenue/paywall", body: v }) })}>New draft from live</Button> : null}>
              <Json value={paywall.data!.live} max={360} />
            </Card>
            <Card title="Versions">
              <Table rows={paywall.data!.versions} rowKey={(v) => v.id} empty="Only the seed config so far."
                cols={[
                  { key: "v", label: "Version", render: (v) => v.version },
                  { key: "s", label: "Status", render: (v) => <Badge tone={statusTone(v.status)}>{v.status}</Badge> },
                  { key: "h", label: "Headline", render: (v) => String(v.copy.headline ?? "") },
                  { key: "p", label: "Published", render: (v) => fmtDate(v.published_at) },
                  { key: "x", label: "", render: (v) => w && v.status === "draft" ? <Button variant="primary" onClick={() => write.mutate({ path: `/revenue/paywall/${v.id}/publish`, body: {} })}>Publish</Button> : null },
                ]} />
            </Card>
          </div>
        )
      ) : null}

      {tab === "promos" ? (
        <Card title="Promo codes" actions={w ? <Button variant="primary" onClick={() => setJson({ title: "New promo", text: JSON.stringify({ code: "WELCOME20", kind: "coupon", percent_off: 20, plan_keys: ["full_report"], max_uses: 500, active: true }, null, 2), submit: (v) => write.mutateAsync({ path: "/revenue/promos", body: v }) })}>New promo</Button> : null}>
          {promos.isLoading ? <Loading /> : <Table rows={promos.data?.promos ?? []} rowKey={(p) => String(p.code)} empty="No promos."
            cols={[
              { key: "c", label: "Code", render: (p) => <span className="font-mono">{String(p.code)}</span> },
              { key: "k", label: "Kind", render: (p) => String(p.kind) },
              { key: "o", label: "Offer", render: (p) => (p.percent_off ? `${p.percent_off}% off` : p.trial_days ? `${p.trial_days}-day trial` : "") },
              { key: "u", label: "Uses", render: (p) => `${p.uses ?? 0}${p.max_uses ? ` / ${p.max_uses}` : ""}` },
              { key: "a", label: "Active", render: (p) => <Badge tone={p.active ? "green" : "grey"}>{p.active ? "active" : "off"}</Badge> },
            ]} />}
        </Card>
      ) : null}

      {tab === "experiments" ? (
        <Card title="Experiments" actions={w ? <Button variant="primary" onClick={() => setJson({
          title: "New experiment", text: JSON.stringify({ key: "full_report_price_ca", name: "Full Report price (CA)", surface: "price", region: "CA",
            variants: [{ key: "control", weight: 1, config: {} }, { key: "low", weight: 1, config: { amounts: { price_full_report_cad: 799 } } }], metrics: ["conversion", "revenue_per_intake"], guardrails: { refund_rate: 0.08 } }, null, 2),
          submit: (v) => write.mutateAsync({ path: "/revenue/experiments", body: v }),
        })}>New experiment</Button> : null}>
          {exps.isLoading ? <Loading /> : <Table rows={exps.data?.experiments ?? []} rowKey={(e) => e.key} empty="No experiments."
            cols={[
              { key: "k", label: "Experiment", render: (e) => <span><b className="font-medium">{e.name}</b><br /><span className="text-[11px] text-ink-3">{e.key} · {e.surface}{e.region ? ` · ${e.region}` : ""}</span></span> },
              { key: "v", label: "Variants (assigned)", render: (e) => e.variants.map((v) => `${v.key} (${e.assignments[v.key] ?? 0})`).join(" · ") },
              { key: "g", label: "Guardrails", render: (e) => Object.entries(e.guardrails).map(([k, v]) => `${k} ≤ ${v}`).join(", ") },
              { key: "s", label: "Status", render: (e) => <span><Badge tone={statusTone(e.status)}>{e.status}</Badge>{e.stop_reason ? <span className="block text-[11px] text-ink-3">{e.stop_reason}</span> : null}</span> },
              {
                key: "x", label: "", render: (e) => !w ? null : e.status === "running"
                  ? <ReasonButton label="Stop" title={`Stop ${e.name}`} onConfirm={(reason) => write.mutateAsync({ path: `/revenue/experiments/${e.key}/status`, body: { status: "stopped", reason } })} />
                  : <Button variant="primary" onClick={() => write.mutate({ path: `/revenue/experiments/${e.key}/status`, body: { status: "running" } })}>Start</Button>,
              },
            ]} />}
          <p className="mt-3 text-[12px] text-ink-3">Assignment is sticky per person. A guardrail breach (e.g. refund rate) stops the experiment automatically.</p>
        </Card>
      ) : null}

      <Modal open={Boolean(json)} onClose={() => { setJson(null); setJsonErr(null); }} title={json?.title ?? ""}>
        {json ? (
          <div className="grid gap-3">
            <Field label="JSON"><textarea value={json.text} onChange={(e) => setJson({ ...json, text: e.target.value })} rows={16} spellCheck={false} className="rounded-lg border border-line-2 p-3 font-mono text-[12px]" /></Field>
            <ErrorBox error={jsonErr} />
            <div className="flex justify-end">
              <Button variant="primary" onClick={async () => {
                try { await json.submit(JSON.parse(json.text)); setJson(null); setJsonErr(null); } catch (e) { setJsonErr(e instanceof SyntaxError ? new Error(`Invalid JSON: ${e.message}`) : e); }
              }}>Save</Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <p className="mt-4 text-[12px] text-ink-3">Changes need <code>revenue.write</code>. Every change is audited with before and after values.</p>
    </Shell>
  );
}

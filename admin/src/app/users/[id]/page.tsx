"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Field, Json, Loading, ReasonButton, Table, fmtDate, fmtMoney, inputCls, statusTone } from "@/components/ui";
import { adminApi, can, useAuth } from "@/lib/api";
import { useAdmin, useAdminWrite } from "@/lib/hooks";
import type { PlanDiff, UserRecord } from "@/lib/types";

const FEATURES = ["impact_full", "impact_history", "exact_doses", "product_alternatives", "price_alerts", "calendar_90d", "calendar_ongoing", "reminders", "doctor_note", "checkins", "lab_replan", "rerun_intake"];
const PURPOSES = ["profile_storage", "personalisation", "reminders", "research", "marketing"];

export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAuth((s) => s.admin);
  const rec = useAdmin<UserRecord>(`/users/${id}`);
  const consents = useAdmin<{ history: { purpose: string; granted: boolean; method: string; actor: string; policy_version: string; ts: string }[] }>(`/users/${id}/consents`);
  const [revealed, setRevealed] = useState<Record<string, unknown> | null>(null);
  const [grant, setGrant] = useState<{ plan_key: string; feature: string; days: string }>({ plan_key: "", feature: "", days: "30" });
  const [consent, setConsent] = useState<{ purpose: string; granted: boolean }>({ purpose: "marketing", granted: false });
  const [preview, setPreview] = useState<Record<string, PlanDiff>>({});
  const write = useAdminWrite(({ path, method, body }: { path: string; method?: string; body?: unknown }) => adminApi<unknown>(path, { method, body }));

  if (rec.isLoading) return <Shell title="User"><Loading /></Shell>;
  if (rec.error || !rec.data) return <Shell title="User"><ErrorBox error={rec.error} /></Shell>;
  const u = rec.data;

  return (
    <Shell title={u.email_masked} scope="users.read">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-4">
          <Card title="Account">
            <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
              <div><dt className="text-ink-3">Status</dt><dd><Badge tone={statusTone(u.status)}>{u.status}</Badge></dd></div>
              <div><dt className="text-ink-3">Tier</dt><dd>{u.tier}</dd></div>
              <div><dt className="text-ink-3">Created</dt><dd>{fmtDate(u.created_at)}</dd></div>
              <div><dt className="text-ink-3">Last active</dt><dd>{fmtDate(u.last_active_at)}</dd></div>
            </dl>
            <p className="mt-3 text-[12px] text-ink-3">User id {u.id}</p>
          </Card>

          <Card
            title="Health profile"
            actions={u.health_profile && can(admin, "users.reveal") && !revealed ? (
              <ReasonButton label="Reveal" icon="unlock" title="Reveal health data" placeholder="Support ticket number and why you need to see it"
                extra={<p className="text-[13px] text-ink-2">This is logged with your name and reason, and the user can see it in their privacy history.</p>}
                onConfirm={async (reason) => setRevealed((await adminApi<{ health_profile: Record<string, unknown> }>(`/users/${id}/reveal`, { body: { reason } })).health_profile)} />
            ) : null}
          >
            {!u.health_profile ? <p className="text-ink-3">No saved health profile (the user hasn&apos;t consented to storage).</p> : revealed ? (
              <Json value={revealed} max={500} />
            ) : (
              <dl className="grid gap-1 text-[13px]">
                {Object.entries(u.health_profile.stable_facts).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-ink-3">{k}</dt><dd>{v}</dd></div>)}
              </dl>
            )}
          </Card>

          <Card title="Plans">
            <Table
              rows={u.plans}
              rowKey={(p) => p.id}
              empty="No plans."
              cols={[
                { key: "i", label: "Plan", render: (p) => <span className="font-mono text-[12px]">{p.id}</span> },
                { key: "s", label: "Status", render: (p) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
                { key: "v", label: "Rules", render: (p) => p.rules_version },
                { key: "c", label: "Created", render: (p) => fmtDate(p.created_at) },
                {
                  key: "r", label: "Re-run on live rules", render: (p) => preview[p.id] ? (
                    preview[p.id].changed ? <span className="text-amber-ink">{[...preview[p.id].added.map((a) => `+${a}`), ...preview[p.id].removed.map((a) => `−${a}`), ...preview[p.id].dose_changes.map((d) => `${d.ingredient_id}: ${d.from}→${d.to}`)].join(", ") || "changed"}</span> : <span className="text-sage-ink">no change</span>
                  ) : <Button onClick={async () => setPreview({ ...preview, [p.id]: await adminApi<PlanDiff>(`/plans/${p.id}/rerun-preview`) })}>Preview</Button>,
                },
              ]}
            />
          </Card>

          <Card title="Entitlements">
            <Table
              rows={u.entitlements}
              rowKey={(e) => e.id}
              empty="Free tier."
              cols={[
                { key: "f", label: "Feature", render: (e) => e.feature },
                { key: "s", label: "Source", render: (e) => `${e.source}${e.source_id ? ` · ${e.source_id.slice(0, 18)}` : ""}` },
                { key: "x", label: "Expires", render: (e) => (e.revoked_at ? <Badge tone="red">revoked</Badge> : e.expires_at ? fmtDate(e.expires_at) : "never") },
                { key: "a", label: "", render: (e) => !e.revoked_at && can(admin, "users.entitlements") ? <ReasonButton label="Revoke" title={`Revoke ${e.feature}`} onConfirm={(reason) => write.mutateAsync({ path: `/users/${id}/entitlements/${e.id}`, method: "DELETE", body: { reason } })} /> : null },
              ]}
            />
            {can(admin, "users.entitlements") ? (
              <div className="mt-4 grid gap-2 rounded-lg bg-sunken p-3 sm:grid-cols-4 sm:items-end">
                <Field label="Plan"><select className={inputCls} value={grant.plan_key} onChange={(e) => setGrant({ ...grant, plan_key: e.target.value, feature: "" })}><option value="">—</option><option value="full_report">Full Report</option><option value="plus">Plus</option></select></Field>
                <Field label="or feature"><select className={inputCls} value={grant.feature} onChange={(e) => setGrant({ ...grant, feature: e.target.value, plan_key: "" })}><option value="">—</option>{FEATURES.map((f) => <option key={f}>{f}</option>)}</select></Field>
                <Field label="Days (blank = no expiry)"><input className={inputCls} value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} /></Field>
                <ReasonButton label="Grant" title="Grant access" onConfirm={(reason) => write.mutateAsync({ path: `/users/${id}/entitlements`, body: { plan_key: grant.plan_key || null, feature: grant.feature || null, days: grant.days ? Number(grant.days) : null, reason } })} />
              </div>
            ) : null}
          </Card>
        </div>

        <aside className="grid min-w-0 content-start gap-4">
          <Card title="Purchases">
            <Table
              rows={u.purchases}
              rowKey={(p) => p.id}
              empty="No purchases."
              cols={[
                { key: "p", label: "Plan", render: (p) => p.plan_key },
                { key: "a", label: "Amount", render: (p) => fmtMoney(p.amount, p.currency) },
                { key: "s", label: "", render: (p) => p.status === "refunded" ? <Badge tone="red">refunded</Badge> : can(admin, "users.refund") ? <ReasonButton label="Refund" variant="danger" title="Refund purchase" onConfirm={(reason) => write.mutateAsync({ path: `/purchases/${p.id}/refund`, body: { reason } })} /> : <Badge tone="green">{p.status}</Badge> },
              ]}
            />
          </Card>
          <Card title="Consents">
            <ul className="grid gap-1 text-[13px]">
              {Object.entries(u.consents).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><Badge tone={v ? "green" : "grey"}>{v ? "on" : "off"}</Badge></li>)}
            </ul>
            {can(admin, "users.consent_record") ? (
              <div className="mt-3 grid gap-2 rounded-lg bg-sunken p-3">
                <p className="text-[12px] text-ink-3">Record a change the user asked for (e.g. by email). Quote their request.</p>
                <div className="grid grid-cols-2 gap-2">
                  <select className={inputCls} value={consent.purpose} onChange={(e) => setConsent({ ...consent, purpose: e.target.value })}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select>
                  <select className={inputCls} value={String(consent.granted)} onChange={(e) => setConsent({ ...consent, granted: e.target.value === "true" })}><option value="false">withdraw</option><option value="true">grant</option></select>
                </div>
                <ReasonButton label="Record change" title="Record consent change" onConfirm={(reason) => write.mutateAsync({ path: `/users/${id}/consents`, body: { ...consent, reason } })} />
              </div>
            ) : null}
            <details className="mt-3 text-[12px]">
              <summary className="cursor-pointer text-ink-3">History ({consents.data?.history.length ?? 0})</summary>
              <ul className="mt-2 grid gap-1">
                {consents.data?.history.map((h, i) => <li key={i}>{fmtDate(h.ts)} · {h.purpose} {h.granted ? "on" : "off"} ({h.method}, {h.actor}, v{h.policy_version})</li>)}
              </ul>
            </details>
          </Card>
          <Card title="Account actions">
            <div className="grid gap-2">
              {write.error ? <ErrorBox error={write.error} /> : null}
              {can(admin, "users.magic_link") ? <Button icon="bell" onClick={() => write.mutate({ path: `/users/${id}/magic-link`, body: {} })}>Resend sign-in link</Button> : null}
              {can(admin, "users.suspend") ? (
                <ReasonButton label={u.status === "suspended" ? "Unsuspend" : "Suspend account"} variant={u.status === "suspended" ? "secondary" : "danger"} title="Change account status"
                  onConfirm={(reason) => write.mutateAsync({ path: `/users/${id}/suspend`, body: { suspend: u.status !== "suspended", reason } })} />
              ) : null}
            </div>
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

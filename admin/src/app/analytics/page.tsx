"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Card, ErrorBox, Loading, Stat, inputCls } from "@/components/ui";
import { can, useAuth } from "@/lib/api";
import { useAdmin } from "@/lib/hooks";
import type { Dashboards } from "@/lib/types";

type Cohorts = { active_plans: number; intake_sessions: number; by_stack_item: Record<string, number | string>; by_goal: Record<string, number | string>; by_exclusion: Record<string, number | string>; note: string };

export default function AnalyticsPage() {
  const admin = useAuth((s) => s.admin);
  const [days, setDays] = useState(30);
  const dash = useAdmin<Dashboards>("/revenue/dashboards", { query: { days } });
  const cohorts = useAdmin<Cohorts>("/cohorts", { enabled: can(admin, "cohorts.read") });
  const funnel = dash.data?.funnel ?? {};
  const steps = ["intake_started", "intake_completed", "paywall_viewed", "purchased"];
  const max = Math.max(1, ...steps.map((s) => funnel[s] ?? 0));
  return (
    <Shell title="Analytics" scope="dashboards.read" actions={
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls} aria-label="Period">
        <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
      </select>
    }>
      {dash.isLoading ? <Loading /> : dash.error ? <ErrorBox error={dash.error} /> : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revenue / completed intake" value={`$${dash.data!.revenue_per_completed_intake.toFixed(2)}`} hint="North-star metric" />
            <Stat label="One-time revenue" value={`$${dash.data!.one_time_revenue.toFixed(2)}`} />
            <Stat label="MRR" value={`$${dash.data!.mrr.toFixed(2)}`} hint={`ARPU $${dash.data!.arpu.toFixed(2)}`} />
            <Stat label="Affiliate revenue" value={`$${dash.data!.affiliate_revenue.toFixed(2)}`} />
            <Stat label="Churn" value={`${(dash.data!.churn_rate * 100).toFixed(1)}%`} />
            <Stat label="Trial conversion" value={dash.data!.trial_conversion === null ? "–" : `${(dash.data!.trial_conversion * 100).toFixed(0)}%`} />
            <Stat label="Refund rate" value={`${(dash.data!.refund_rate * 100).toFixed(1)}%`} />
            <Stat label="Active subscriptions" value={dash.data!.active_subscriptions} />
          </div>
          <Card title="Funnel">
            <ul className="grid gap-2">
              {steps.map((s) => (
                <li key={s} className="grid grid-cols-[160px_1fr_60px] items-center gap-3 text-[13px]">
                  <span>{s.replace(/_/g, " ")}</span>
                  <span className="h-3 rounded-full bg-sunken"><span className="block h-3 rounded-full bg-sage" style={{ width: `${((funnel[s] ?? 0) / max) * 100}%` }} /></span>
                  <span className="text-right tabular-nums">{funnel[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          </Card>
          {cohorts.data ? (
            <Card title="De-identified cohorts">
              <p className="mb-3 text-[12px] text-ink-3">{cohorts.data.note} {cohorts.data.active_plans} active plans · {cohorts.data.intake_sessions} intakes.</p>
              <div className="grid gap-4 md:grid-cols-3">
                {(["by_stack_item", "by_goal", "by_exclusion"] as const).map((k) => (
                  <div key={k}>
                    <h3 className="eyebrow mb-2">{k.replace("by_", "").replace("_", " ")}</h3>
                    <ul className="grid gap-1 text-[13px]">
                      {Object.entries(cohorts.data![k]).map(([name, n]) => <li key={name} className="flex justify-between"><span>{name}</span><span className="tabular-nums text-ink-2">{n}</span></li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </Shell>
  );
}

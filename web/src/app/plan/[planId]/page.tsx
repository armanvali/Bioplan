"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PaywallSheet } from "@/components/billing/Billing";
import { SaveCard } from "@/components/account/Account";
import { ImpactBars, ImpactRadar } from "@/components/plan/Impact";
import { ProductRow } from "@/components/plan/ProductRow";
import { BudgetNotes, ExcludedDrawer, LockedItems, SafetyBanner, StackCard } from "@/components/plan/StackParts";
import { AppHeader, Footer } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { Button, ErrorNote, LinkButton, Loading, Sheet } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";
import { money, plural } from "@/lib/format";
import { useHydrated, useMeta } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import type { Plan } from "@/lib/types";

type Tab = "impact" | "stack" | "buy";

export default function PlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const t = useT();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const accessToken = useApp((s) => s.accessToken);
  const hasToken = useApp((s) => Boolean(s.planTokens[planId]));
  const rememberPlan = useApp((s) => s.rememberPlan);
  const { data: meta } = useMeta();
  const enabled = hydrated && (hasToken || Boolean(accessToken));
  // Keyed by access token too: buying or signing in changes what the server redacts.
  const plan = useQuery({ queryKey: ["plan", planId, accessToken], queryFn: () => api.plans.get(planId), enabled });
  const impact = useQuery({ queryKey: ["impact", planId, accessToken], queryFn: () => api.plans.impact(planId), enabled });
  const products = useQuery({ queryKey: ["products", planId, accessToken], queryFn: () => api.plans.products(planId), enabled });
  const explanations = useQuery({ queryKey: ["explanations", planId], queryFn: () => api.plans.explanations(planId), enabled, staleTime: Infinity });

  const [tab, setTab] = useState<Tab>("impact");
  const [paywall, setPaywall] = useState<string | null>(null);
  const [labOpen, setLabOpen] = useState(false);
  const [noteError, setNoteError] = useState<unknown>(null);

  useEffect(() => {
    if (plan.data) {
      api.event("results_viewed");
      useApp.setState({ lastPlanId: planId });
    }
  }, [plan.data, planId]);

  if (!hydrated || (enabled && plan.isLoading)) return <Shell><Loading label="Building your plan…" /></Shell>;
  if (!enabled) {
    return (
      <Shell>
        <div className="card p-6">
          <h1 className="display text-2xl">Sign in to see this plan</h1>
          <p className="mt-2 text-ink-2">Plans are private. Open it on the device where you made it, or sign in if you saved it to your account.</p>
          <div className="mt-5 flex gap-3"><LinkButton href={`/account?next=/plan/${planId}`}>Sign in</LinkButton><LinkButton href="/start" variant="secondary">Start a new intake</LinkButton></div>
        </div>
      </Shell>
    );
  }
  if (plan.isError) return <Shell><ErrorNote error={plan.error} onRetry={() => plan.refetch()} /></Shell>;
  const p = plan.data as Plan;
  const free = p.gated.includes("exact_doses");
  const unlock = (trigger: string) => () => setPaywall(trigger);

  const doctorNote = async () => {
    setNoteError(null);
    try {
      await api.plans.downloadDoctorNote(planId);
    } catch (e) {
      if (e instanceof ApiError && e.isPaywall) setPaywall("download_doctor_note");
      else setNoteError(e);
    }
  };

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your plan · {new Date(p.created_at).toLocaleDateString()}</p>
          <h1 className="display mt-1 text-3xl sm:text-4xl">{plural(p.items.length, "supplement")}, picked for you</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            {money(p.totals.monthly_cost, p.totals.currency)} {t("plan.perMonth")} of your {money(p.totals.budget, p.totals.currency)} budget · up to{" "}
            {plural(p.totals.max_pills_day, "pill")} on the busiest day{p.totals.scoops ? ` + ${plural(p.totals.scoops, "scoop")}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/plan/${planId}/calendar`} icon="calendar" variant="secondary">{t("nav.calendar")}</LinkButton>
          {free ? <Button onClick={unlock("see_exact_doses")} icon="unlock">{t("cta.unlock")}</Button> : null}
        </div>
      </div>

      <div className="mt-6"><SafetyBanner plan={p} /></div>

      <div className="sticky top-14 z-20 -mx-4 mt-6 border-b border-line bg-canvas/95 px-4 backdrop-blur">
        <div role="tablist" aria-label="Plan sections" className="flex gap-1">
          {([["impact", t("plan.impact")], ["stack", t("plan.stack")], ["buy", t("plan.buy")]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-3 text-[15px] font-medium ${tab === k ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-6">
          {tab === "impact" ? (
            impact.isLoading ? <Loading /> : impact.isError ? <ErrorNote error={impact.error} /> : impact.data && meta ? (
              <section className="card grid gap-6 p-5 sm:p-6">
                <div className="grid items-center gap-6 md:grid-cols-[300px_1fr]">
                  <ImpactRadar impact={impact.data} areas={meta.areas} need={p.need} />
                  <div>
                    <h2 className="display text-2xl">Where this plan helps</h2>
                    <p className="mt-2 text-[15px] text-ink-2">
                      The dashed line is how much each area needs attention, from your answers. The filled shape is what this plan is likely to cover,
                      based on evidence grades and your doses.
                    </p>
                    {impact.data.summary ? (
                      <p className="mt-3 text-[15px]"><b>{impact.data.summary.areas_met}</b> of {impact.data.summary.areas_with_need} areas well covered.</p>
                    ) : null}
                  </div>
                </div>
                <ImpactBars impact={impact.data} areas={meta.areas} items={p.items} onUnlock={unlock("tap_blurred_area")} />
                <p className="text-xs text-ink-3">Model {impact.data.model_version ?? p.impact_version}. Estimates, not promises: people respond differently.</p>
              </section>
            ) : null
          ) : null}

          {tab === "stack" ? (
            <section className="grid gap-4" aria-label={t("plan.stack")}>
              {p.items.map((it) => (
                <StackCard key={it.ingredient_id} item={it} explanation={explanations.data?.items[it.ingredient_id]} onUnlock={unlock("see_exact_doses")} />
              ))}
              {p.tips.length ? (
                <div className="card p-5">
                  <h2 className="eyebrow">Free tips that help too</h2>
                  <ul className="mt-3 grid gap-3">
                    {p.tips.map((tip) => (
                      <li key={tip.id}><p className="font-medium">{tip.title}</p><p className="text-[15px] text-ink-2">{tip.text}</p></li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === "buy" ? (
            products.isLoading ? <Loading /> : products.isError ? <ErrorNote error={products.error} /> : products.data ? (
              <section className="grid gap-4" aria-label={t("plan.buy")}>
                <p className="flex items-start gap-2 rounded-[12px] bg-sunken p-4 text-sm text-ink-2">
                  <Icon name="info" size={16} className="mt-0.5" /> {products.data.disclosure} We rank by: {products.data.rank_steps.join(" → ")}.
                </p>
                {products.data.items.map((row) => (
                  <ProductRow key={row.ingredient_id} row={row} item={p.items.find((i) => i.ingredient_id === row.ingredient_id)} planId={planId} gated={products.data.gated.includes("product_alternatives")} onUnlock={unlock("product_alternatives")} />
                ))}
              </section>
            ) : null
          ) : null}
        </div>

        <aside className="grid content-start gap-4">
          <LockedItems locked={p.locked} onDoctorNote={doctorNote} onEnterLab={() => setLabOpen(true)} />
          {noteError ? <ErrorNote error={noteError} /> : null}
          <ExcludedDrawer excluded={p.excluded} />
          <BudgetNotes plan={p} />
          <SaveCard planId={planId} />
          <p className="text-xs leading-relaxed text-ink-3">
            {t("plan.disclaimer")} Rules {p.rules_version} · questions {p.graph_version} · catalog {p.catalog_snapshot_id}.{" "}
            <Link href={`/plan/${planId}/calendar`} className="underline">Open calendar</Link>
          </p>
        </aside>
      </div>

      <PaywallSheet open={Boolean(paywall)} onClose={() => setPaywall(null)} planId={planId} trigger={paywall ?? ""} />
      <LabSheet
        open={labOpen}
        onClose={() => setLabOpen(false)}
        planId={planId}
        analytes={p.locked.flatMap((l) => (l.unlock ? [l.unlock] : []))}
        onPaywall={() => { setLabOpen(false); setPaywall("lab_replan"); }}
        onReplanned={(next) => {
          if (next.plan_token) rememberPlan(next.plan_id, next.plan_token);
          qc.setQueryData(["plan", next.plan_id, accessToken], next);
          window.location.assign(`/plan/${next.plan_id}`);
        }}
      />
    </Shell>
  );
}

function LabSheet({ open, onClose, planId, analytes, onPaywall, onReplanned }: {
  open: boolean; onClose: () => void; planId: string; analytes: { analyte: string; name: string; unit: string }[]; onPaywall: () => void; onReplanned: (p: Plan) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.plans.addLabs(planId, analytes.filter((a) => vals[a.analyte]).map((a) => ({ analyte: a.analyte, value: Number(vals[a.analyte]), unit: a.unit })));
      onReplanned({ ...res.plan, plan_token: res.plan_token });
    } catch (e) {
      if (e instanceof ApiError && e.isPaywall) onPaywall();
      else setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Enter your result">
      <div className="grid gap-3">
        <p className="text-[15px] text-ink-2">We&apos;ll re-run the rules with your value: the item either unlocks at the right dose or comes off the list.</p>
        {analytes.map((a) => (
          <label key={a.analyte} className="flex items-center justify-between gap-3">
            <span className="font-medium">{a.name}</span>
            <span className="flex items-center gap-2">
              <input type="number" inputMode="decimal" min={0} value={vals[a.analyte] ?? ""} onChange={(e) => setVals({ ...vals, [a.analyte]: e.target.value })} className="w-28 rounded-[10px] border border-line-2 px-3 py-2 text-right" />
              <span className="w-12 text-sm text-ink-3">{a.unit}</span>
            </span>
          </label>
        ))}
        {err ? <ErrorNote error={err} /> : null}
        <Button onClick={submit} busy={busy} disabled={!Object.values(vals).some(Boolean)}>Re-plan with this result</Button>
      </div>
    </Sheet>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:py-10">{children}</main>
      <Footer />
    </>
  );
}

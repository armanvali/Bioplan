"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { savePending } from "@/lib/checkout";
import { cents } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { BillingPlan, Offers, Price } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { Button, ErrorNote, Loading, Sheet } from "../ui/primitives";

const FEATURE_TEXT: Record<string, string> = {
  impact_full: "Full health impact map with what drives each area",
  impact_history: "Reported vs projected over time",
  exact_doses: "Exact doses and timing",
  product_alternatives: "All product alternatives and why we picked each",
  price_alerts: "Price-drop alerts",
  calendar_90d: "90-day calendar and .ics export",
  calendar_ongoing: "Ongoing calendar that updates itself",
  reminders: "Dose, refill and lab reminders",
  doctor_note: "Doctor note PDF (for lab tests or a check-in)",
  checkins: "Check-ins at weeks 2, 4 and 8",
  lab_replan: "Enter lab results and re-plan automatically",
  rerun_intake: "Re-run the intake when life changes",
};

const FREE_LINES = ["Adaptive intake and “Here’s what we heard”", "Your stack with a one-line why", "Every exclusion, interaction and stop card", "Top 3 impact areas, dose ranges", "Best product match per item", "7-day calendar"];

export function priceLabel(p: Price | undefined, region: string): string {
  if (!p) return "Free";
  const loc = region === "US" ? "en-US" : "en-CA";
  return `${cents(p.amount, p.currency, loc)}${p.interval === "month" ? "/month" : p.interval === "year" ? "/year" : ""}`;
}

export function PricingTable({ offers, onChoose, busyKey, current }: { offers: Offers; onChoose: (plan: BillingPlan, price: Price) => void; busyKey?: string | null; current?: string }) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const plans = offers.plans;
  return (
    <div>
      <div className="mb-6 flex justify-center">
        <div className="inline-flex rounded-full bg-sunken p-1" role="radiogroup" aria-label="Billing period for Plus">
          {(["month", "year"] as const).map((i) => (
            <button key={i} role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${interval === i ? "bg-surface shadow-[var(--shadow-1)]" : "text-ink-2"}`}>
              {i === "month" ? "Monthly" : "Yearly (save 30%)"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const price = p.kind === "subscription" ? p.prices.find((x) => x.interval === interval) ?? p.prices[0] : p.prices[0];
          const featured = p.key === "full_report";
          return (
            <article key={p.key} className={`card flex flex-col p-6 ${featured ? "ring-2 ring-sage" : ""}`}>
              {featured ? <p className="eyebrow !text-sage-ink">Most popular</p> : <p className="eyebrow">&nbsp;</p>}
              <h3 className="display mt-1 text-2xl">{p.name}</h3>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{priceLabel(price, offers.region)}</p>
              <p className="text-sm text-ink-3">{p.kind === "one_time" ? "One time, yours to keep" : p.kind === "subscription" ? (p.trial_days ? `${p.trial_days}-day free trial, cancel anytime` : "Cancel anytime") : "No account needed"}</p>
              <ul className="mt-5 grid flex-1 gap-2 text-[15px]">
                {(p.kind === "free" ? FREE_LINES : p.features.map((f) => FEATURE_TEXT[f] ?? f)).map((line) => (
                  <li key={line} className="flex items-start gap-2"><Icon name="check" size={16} className="mt-1 text-sage" />{line}</li>
                ))}
              </ul>
              {p.kind !== "free" && price ? (
                <Button className="mt-6" variant={featured ? "primary" : "secondary"} busy={busyKey === p.key} disabled={current === p.key} onClick={() => onChoose(p, price)}>
                  {current === p.key ? "Your plan" : p.kind === "subscription" && p.trial_days ? "Start free trial" : `Get ${p.name}`}
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
      <p className="mt-6 text-center text-sm text-ink-3">{offers.paywall.copy.trust_line ?? "Safety information is always free."} Prices in {offers.currency}.</p>
    </div>
  );
}

/** Start checkout for a plan. Fake mode (dev) goes to our own test page; real mode to Stripe. */
export function useCheckout(planId?: string | null) {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const start = async (plan: BillingPlan, price: Price, email?: string) => {
    setBusyKey(plan.key);
    setError(null);
    try {
      api.event("paywall_offer_tapped", { plan_key: plan.key });
      const co = await api.billing.checkout({ plan_key: plan.key, price_id: price.id, plan_id: planId ?? null, email: email ?? user?.email ?? null });
      savePending({ checkoutId: co.checkout_id, planId, email: email ?? user?.email ?? null, planKey: plan.key });
      if (co.mode === "fake") router.push(`/checkout/fake?cs=${co.checkout_id}`);
      else window.location.assign(co.url);
    } catch (e) {
      setError(e);
      setBusyKey(null);
    }
  };
  return { start, busyKey, error };
}

export function PaywallSheet({ open, onClose, planId, trigger }: { open: boolean; onClose: () => void; planId?: string | null; trigger: string }) {
  const user = useApp((s) => s.user);
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.billing.offers(), enabled: open, staleTime: 5 * 60_000 });
  const { start, busyKey, error } = useCheckout(planId);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (open) api.event("paywall_viewed", { trigger });
  }, [open, trigger]);

  const choose = (plan: BillingPlan, price: Price) => {
    if (!user && !/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError("Enter your email so we can send your report and a sign-in link.");
      return;
    }
    void start(plan, price, user ? undefined : email);
  };

  const close = () => {
    api.event("paywall_dismissed", { trigger });
    onClose();
  };

  const copy = offers.data?.paywall.copy ?? {};
  return (
    <Sheet open={open} onClose={close} title={copy.headline ?? "See your full plan"}>
      {offers.isLoading ? <Loading /> : offers.isError ? <ErrorNote error={offers.error} /> : offers.data ? (
        <div className="grid gap-4">
          <p className="text-[15px] text-ink-2">{copy.subhead ?? "Exact doses, the full impact map, every product option and a 90-day calendar."}</p>
          {offers.data.plans.filter((p) => p.kind !== "free").map((p) => {
            const price = p.kind === "subscription" ? p.prices.find((x) => x.interval === "month") ?? p.prices[0] : p.prices[0];
            if (!price) return null;
            return (
              <button
                key={p.key}
                onClick={() => choose(p, price)}
                disabled={Boolean(busyKey)}
                className={`flex items-center justify-between gap-3 rounded-[14px] border p-4 text-left transition-colors hover:bg-sunken disabled:opacity-60 ${p.key === "full_report" ? "border-sage ring-1 ring-sage" : "border-line-2"}`}
              >
                <span>
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-sm text-ink-3">
                    {p.kind === "one_time" ? "One time" : p.trial_days ? `${p.trial_days}-day free trial, then ${priceLabel(price, offers.data.region)}` : "Cancel anytime"}
                  </span>
                </span>
                <span className="text-lg font-semibold tabular-nums">{busyKey === p.key ? "…" : priceLabel(price, offers.data.region)}</span>
              </button>
            );
          })}
          {!user ? (
            <label className="grid gap-1">
              <span className="text-sm font-medium">Email for your receipt and sign-in link</span>
              <input type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(null); }} className="rounded-[10px] border border-line-2 px-3 py-2.5" placeholder="you@example.com" />
              {emailError ? <span className="text-sm text-caution-ink">{emailError}</span> : null}
            </label>
          ) : null}
          {error ? <ErrorNote error={error instanceof ApiError ? error : new Error("Checkout couldn't start.")} /> : null}
          <p className="flex items-center gap-2 text-sm text-ink-3"><Icon name="shield" size={16} /> {copy.trust_line ?? "Safety information is always free."}</p>
          <button onClick={close} className="justify-self-center text-sm text-ink-3 underline">{copy.not_now ?? "Not now"}</button>
        </div>
      ) : null}
    </Sheet>
  );
}

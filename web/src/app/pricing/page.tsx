"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PricingTable, useCheckout } from "@/components/billing/Billing";
import { AppHeader, Footer } from "@/components/ui/AppHeader";
import { ErrorNote, Loading } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useEntitlements } from "@/lib/hooks";
import { useApp } from "@/lib/store";

export default function PricingPage() {
  const [country, setCountry] = useState<"CA" | "US">("CA");
  const lastPlanId = useApp((s) => s.lastPlanId);
  const user = useApp((s) => s.user);
  const me = useEntitlements();
  const offers = useQuery({ queryKey: ["offers", country], queryFn: () => api.billing.offers(country) });
  const { start, busyKey, error } = useCheckout(lastPlanId);
  const [email, setEmail] = useState("");
  const [need, setNeed] = useState<string | null>(null);

  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 py-10">
        <div className="text-center">
          <p className="eyebrow">Pricing</p>
          <h1 className="display mt-2 text-4xl">Free for safety. Pay for depth.</h1>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] text-ink-2">
            Your stack, every exclusion and every interaction warning are free, forever. Upgrade for exact doses, the full impact map, a 90-day
            calendar, reminders and re-planning.
          </p>
          <div className="mt-5 inline-flex rounded-full bg-sunken p-1" role="radiogroup" aria-label="Country">
            {(["CA", "US"] as const).map((c) => (
              <button key={c} role="radio" aria-checked={country === c} onClick={() => setCountry(c)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${country === c ? "bg-surface shadow-[var(--shadow-1)]" : "text-ink-2"}`}>
                {c === "CA" ? "Canada (CAD)" : "United States (USD)"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-10">
          {offers.isLoading ? <Loading /> : offers.isError ? <ErrorNote error={offers.error} onRetry={() => offers.refetch()} /> : offers.data ? (
            <PricingTable
              offers={offers.data}
              busyKey={busyKey}
              current={me.data?.tier}
              onChoose={(plan, price) => {
                if (!user && !/^\S+@\S+\.\S+$/.test(email)) {
                  setNeed(plan.key);
                  return;
                }
                void start(plan, price, user ? undefined : email);
              }}
            />
          ) : null}
          {need && !user ? (
            <div className="card mx-auto mt-6 grid max-w-md gap-3 p-5">
              <label className="grid gap-1">
                <span className="text-sm font-medium">Email for your receipt and sign-in link</span>
                <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-[10px] border border-line-2 px-3 py-2.5" placeholder="you@example.com" />
              </label>
              <p className="text-sm text-ink-3">Then choose your plan again. {lastPlanId ? "We'll attach it to your latest plan." : "Start an intake any time; your purchase carries over."}</p>
            </div>
          ) : null}
          {error ? <div className="mx-auto mt-4 max-w-md"><ErrorNote error={error} /></div> : null}
        </div>
        <section className="mx-auto mt-14 grid max-w-3xl gap-6 text-[15px]">
          {[
            ["Does paying change my recommendations?", "No. The rules engine never sees payment or affiliate data. Paying shows you more detail about the same plan."],
            ["How do affiliate links work?", "When you buy through a product link we may earn a commission. Products are ranked by certification, dose fit, form, reviews and price, never by commission."],
            ["Can I cancel Plus?", "Yes, in one click from your account. You keep access until the end of the period you paid for."],
            ["Is my health data sold?", "Never. Saving your profile is optional, and you can export or delete everything at any time."],
          ].map(([q, a]) => (
            <div key={q}><h2 className="font-semibold">{q}</h2><p className="mt-1 text-ink-2">{a}</p></div>
          ))}
        </section>
      </main>
      <Footer />
    </>
  );
}

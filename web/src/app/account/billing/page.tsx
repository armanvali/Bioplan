"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppHeader, Footer } from "@/components/ui/AppHeader";
import { Button, ErrorNote, LinkButton, Loading, Sheet } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cents } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";
import { useApp } from "@/lib/store";

const NAMES: Record<string, string> = { full_report: "Full Report", plus: "Plus" };

export default function BillingPage() {
  const hydrated = useHydrated();
  const user = useApp((s) => s.user);
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["billing", user?.id], queryFn: api.billing.summary, enabled: Boolean(user) });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const cancel = async () => {
    setBusy(true);
    try {
      await api.billing.cancel();
      setConfirm(false);
      qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const portal = async () => {
    try {
      const r = await api.billing.portal();
      if (!r.url.includes("portal=fake")) window.location.assign(r.url);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-10">
        <p className="eyebrow">Account</p>
        <h1 className="display mt-1 text-3xl">Billing</h1>
        {!hydrated ? <Loading /> : !user ? (
          <div className="card mt-6 p-6"><p>Sign in to see your purchases.</p><LinkButton href="/account?next=/account/billing" className="mt-4">Sign in</LinkButton></div>
        ) : summary.isLoading ? <Loading /> : summary.isError ? <ErrorNote error={summary.error} /> : summary.data ? (
          <div className="mt-6 grid gap-6">
            <section className="card p-5">
              <h2 className="font-semibold">Current plan: {NAMES[summary.data.tier] ?? "Free"}</h2>
              {summary.data.subscriptions.map((s) => (
                <div key={s.id} className="mt-3 text-[15px] text-ink-2">
                  <p>Plus · {s.status === "trialing" ? `free trial until ${s.trial_end ? new Date(s.trial_end).toLocaleDateString() : "soon"}` : s.status}</p>
                  {s.cancel_at ? <p className="text-amber-ink">Ends {new Date(s.cancel_at).toLocaleDateString()}. You keep access until then.</p> : s.current_period_end ? <p>Renews {new Date(s.current_period_end).toLocaleDateString()}</p> : null}
                  {!s.cancel_at && ["active", "trialing"].includes(s.status) ? (
                    <div className="mt-3 flex gap-2">
                      <Button variant="secondary" onClick={portal}>Update card</Button>
                      <Button variant="ghost" onClick={() => setConfirm(true)}>Cancel Plus</Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {summary.data.tier === "free" ? <LinkButton href="/pricing" className="mt-4">See plans</LinkButton> : null}
            </section>
            <section className="card p-5">
              <h2 className="font-semibold">Purchases</h2>
              {summary.data.purchases.length ? (
                <ul className="mt-3 divide-y divide-line text-[15px]">
                  {summary.data.purchases.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3 py-2">
                      <span>{NAMES[p.plan_key] ?? p.plan_key} · {new Date(p.created_at).toLocaleDateString()}</span>
                      <span className="tabular-nums">{cents(p.amount, p.currency)} {p.status === "refunded" ? <span className="text-ink-3">(refunded)</span> : null}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-ink-3">No purchases yet.</p>}
            </section>
            {error ? <ErrorNote error={error} /> : null}
          </div>
        ) : null}
        <Sheet open={confirm} onClose={() => setConfirm(false)} title="Cancel Plus?">
          <p className="text-[15px] text-ink-2">You&apos;ll keep Plus until the end of this period. Your plan, exclusions and safety notes stay available for free.</p>
          <div className="mt-5 flex gap-3">
            <Button variant="danger" onClick={cancel} busy={busy}>Cancel Plus</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Keep it</Button>
          </div>
        </Sheet>
      </main>
      <Footer />
    </>
  );
}

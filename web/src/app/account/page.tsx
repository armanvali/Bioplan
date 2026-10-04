"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { ConsentPanel, SignInForm } from "@/components/account/Account";
import { AppHeader, Footer } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { Button, ErrorNote, LinkButton, Loading } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useEntitlements, useHydrated, useMeta } from "@/lib/hooks";
import { useApp } from "@/lib/store";

const TIER_LABEL: Record<string, string> = { free: "Free", full_report: "Full Report", plus: "Plus" };

function AccountInner() {
  const hydrated = useHydrated();
  const params = useSearchParams();
  const router = useRouter();
  const user = useApp((s) => s.user);
  const signOut = useApp((s) => s.signOut);
  const me = useEntitlements();
  const { data: meta } = useMeta();
  const plans = useQuery({ queryKey: ["my-plans", user?.id], queryFn: api.me.plans, enabled: Boolean(user) });

  useEffect(() => {
    const next = params.get("next");
    if (user && next && next.startsWith("/") && !next.startsWith("//")) router.replace(next);
  }, [user, params, router]);

  if (!hydrated) return <Loading />;
  if (!user) {
    return (
      <div className="card mx-auto max-w-md p-6">
        <h1 className="display text-2xl">Sign in</h1>
        <p className="mt-2 text-[15px] text-ink-2">See saved plans, your purchases and your privacy choices.</p>
        <div className="mt-5"><SignInForm next={params.get("next") ?? "/account"} /></div>
      </div>
    );
  }
  const tier = me.data?.tier ?? "free";
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="display mt-1 text-3xl">{user.email}</h1>
          <p className="mt-1 text-sm text-ink-3">Plan: <b className="text-ink">{TIER_LABEL[tier] ?? tier}</b></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/account/billing" variant="secondary" icon="cart">Billing</LinkButton>
          <LinkButton href="/account/privacy" variant="secondary" icon="shield">Your data</LinkButton>
          <Button variant="ghost" onClick={() => { signOut(); router.push("/"); }}>Sign out</Button>
        </div>
      </div>

      <section>
        <h2 className="eyebrow mb-3">Saved plans</h2>
        {plans.isLoading ? <Loading /> : plans.isError ? <ErrorNote error={plans.error} /> : plans.data?.plans.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {plans.data.plans.map((p) => (
              <li key={p.id}>
                <Link href={`/plan/${p.id}`} className="card block p-5 hover:bg-sunken">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{new Date(p.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.status === "active" ? "bg-sage-tint text-sage-ink" : "bg-sunken text-ink-3"}`}>{p.status}</span>
                  </div>
                  <p className="mt-2 text-sm text-ink-2">{p.items.map((i) => meta?.ingredients[i]?.short ?? i).join(" · ")}</p>
                  <p className="mt-1 text-sm text-ink-3">{money(p.monthly_cost)}/month{p.reason !== "intake" ? ` · ${p.reason.replace(/_/g, " ")}` : ""}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-[15px] text-ink-2">No saved plans yet. Plans are saved only when you turn on &ldquo;Save my health profile&rdquo;.</p>
            <LinkButton href="/start" icon="right">Start an intake</LinkButton>
          </div>
        )}
      </section>

      <section>
        <h2 className="eyebrow mb-3">Privacy choices</h2>
        <ConsentPanel />
        <p className="mt-2 flex items-center gap-1 text-sm text-ink-3"><Icon name="info" size={14} /> Every change is recorded with the policy version, and you can see the history in Your data.</p>
      </section>
    </div>
  );
}

export default function AccountPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 py-10">
        <Suspense fallback={<Loading />}>
          <AccountInner />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

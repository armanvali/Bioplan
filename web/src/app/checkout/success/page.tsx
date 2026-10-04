"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { SignInForm } from "@/components/account/Account";
import { AppHeader } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { LinkButton, Loading } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { clearPending, loadPending, type PendingCheckout } from "@/lib/checkout";
import { useHydrated } from "@/lib/hooks";
import { useApp } from "@/lib/store";

function Success() {
  const hydrated = useHydrated();
  const qc = useQueryClient();
  const user = useApp((s) => s.user);
  const [pending, setPending] = useState<PendingCheckout | null>(null);

  useEffect(() => {
    setPending(loadPending());
  }, []);

  useEffect(() => {
    if (!user) return;
    // Entitlements changed: drop every cached, redacted view.
    qc.invalidateQueries();
    api.me.get().then((u) => useApp.getState().setUser(u)).catch(() => undefined);
    clearPending();
  }, [user, qc]);

  if (!hydrated) return <Loading />;
  const planId = pending?.planId ?? useApp.getState().lastPlanId;
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-sage-tint text-sage"><Icon name="check" size={26} /></span>
      <h1 className="display mt-4 text-3xl">You&apos;re all set</h1>
      {user ? (
        <>
          <p className="mt-2 text-ink-2">Your purchase is on {user.email_masked}. Exact doses, the full map and your calendar are unlocked.</p>
          <div className="mt-6 flex justify-center gap-3">
            {planId ? <LinkButton href={`/plan/${planId}`}>See my full plan</LinkButton> : <LinkButton href="/start">Start my intake</LinkButton>}
            <LinkButton href="/account/billing" variant="secondary">Receipt</LinkButton>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-ink-2">We created your account{pending?.email ? ` for ${pending.email}` : ""}. Sign in to unlock your plan on this device.</p>
          <div className="mt-6 text-left"><SignInForm key={pending?.email ?? ""} defaultEmail={pending?.email ?? ""} next={planId ? `/plan/${planId}` : "/account"} /></div>
        </>
      )}
    </div>
  );
}

export default function SuccessPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="px-4 py-10">
        <Suspense fallback={<Loading />}>
          <Success />
        </Suspense>
      </main>
    </>
  );
}

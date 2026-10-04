"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { Button, ErrorNote, Loading } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { loadPending } from "@/lib/checkout";
import { useApp } from "@/lib/store";

/** Development stand-in for Stripe Checkout. The API runs in fake mode when no Stripe key is set
 *  and emits signed synthetic webhooks, so the whole purchase flow is testable offline. */
function FakeCheckout() {
  const params = useSearchParams();
  const router = useRouter();
  const user = useApp((s) => s.user);
  const cs = params.get("cs") ?? "";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setEmail(user?.email ?? loadPending()?.email ?? "");
  }, [user]);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.billing.completeFake(cs, email || undefined);
      router.replace(`/checkout/success?cs=${cs}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="card mx-auto max-w-md p-6">
      <p className="flex items-center gap-2 rounded-[10px] bg-amber-tint px-3 py-2 text-sm text-amber-ink"><Icon name="info" size={16} /> Test checkout. No card is charged.</p>
      <h1 className="display mt-4 text-2xl">Complete your purchase</h1>
      <label className="mt-4 grid gap-1">
        <span className="text-sm font-medium">Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-[10px] border border-line-2 px-3 py-2.5" />
      </label>
      <div className="mt-3 rounded-[10px] border border-line-2 px-3 py-2.5 text-ink-3">4242 4242 4242 4242 · 12/34 · 123</div>
      {error ? <div className="mt-3"><ErrorNote error={error} /></div> : null}
      <Button className="mt-5 w-full" onClick={pay} busy={busy} disabled={!cs || !/^\S+@\S+\.\S+$/.test(email)}>Pay (test mode)</Button>
      <button className="mt-3 w-full text-sm text-ink-3 underline" onClick={() => router.back()}>Cancel</button>
    </div>
  );
}

export default function FakeCheckoutPage() {
  return (
    <>
      <AppHeader minimal />
      <main id="main" className="px-4 py-10">
        <Suspense fallback={<Loading />}>
          <FakeCheckout />
        </Suspense>
      </main>
    </>
  );
}

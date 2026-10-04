"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConsentPanel, PrivacyHistoryList } from "@/components/account/Account";
import { AppHeader, Footer } from "@/components/ui/AppHeader";
import { Button, ErrorNote, LinkButton, Loading, Sheet } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useHydrated } from "@/lib/hooks";
import { useApp } from "@/lib/store";

export default function PrivacyPage() {
  const hydrated = useHydrated();
  const router = useRouter();
  const user = useApp((s) => s.user);
  const signOut = useApp((s) => s.signOut);
  const forget = useApp((s) => s.forgetDeviceData);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [forgot, setForgot] = useState(false);

  const exportJson = async () => {
    setBusy("json");
    try {
      const r = await api.me.exportJson();
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "stacksense-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const exportPdf = async () => {
    setBusy("pdf");
    try {
      await api.me.exportPdf();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const del = async () => {
    setBusy("delete");
    try {
      await api.me.deleteAccount();
      forget();
      signOut();
      router.replace("/?deleted=1");
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-4xl px-4 py-10">
        <p className="eyebrow">Account</p>
        <h1 className="display mt-1 text-3xl">Your data</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-2">
          Your health answers are encrypted with a key that belongs to you alone. Delete them and the key is destroyed, so even our backups can&apos;t be read.
        </p>

        <section className="card mt-6 p-5">
          <h2 className="font-semibold">This device</h2>
          <p className="mt-1 text-sm text-ink-3">Intakes and plans you made without an account are kept on this device for 30 days.</p>
          <Button variant="secondary" className="mt-3" onClick={() => { forget(); setForgot(true); }} disabled={forgot}>
            {forgot ? "Removed from this device" : "Forget plans on this device"}
          </Button>
        </section>

        {!hydrated ? <Loading /> : !user ? (
          <div className="card mt-6 p-6"><p>Sign in to manage consent, export or delete your account.</p><LinkButton href="/account?next=/account/privacy" className="mt-4">Sign in</LinkButton></div>
        ) : (
          <div className="mt-6 grid gap-6">
            <section>
              <h2 className="eyebrow mb-3">Choices</h2>
              <ConsentPanel />
            </section>
            <section>
              <h2 className="eyebrow mb-3">History</h2>
              <PrivacyHistoryList />
            </section>
            <section className="card p-5">
              <h2 className="font-semibold">Export everything</h2>
              <p className="mt-1 text-sm text-ink-3">Your account, consents, purchases, staff access log and health profile.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" icon="download" busy={busy === "json"} onClick={exportJson}>JSON</Button>
                <Button variant="secondary" icon="doc" busy={busy === "pdf"} onClick={exportPdf}>PDF</Button>
              </div>
            </section>
            <section className="card border-caution/30 p-5">
              <h2 className="font-semibold text-caution-ink">Delete my account</h2>
              <p className="mt-1 text-sm text-ink-3">Deletes your account and all health data now. Billing records are kept as tax law requires, tied to an anonymous record.</p>
              <Button variant="danger" className="mt-3" onClick={() => setStep(1)}>Delete everything</Button>
            </section>
            {error ? <ErrorNote error={error} /> : null}
          </div>
        )}
        <Sheet open={step > 0} onClose={() => setStep(0)} title="Delete your account?">
          <p className="text-[15px] text-ink-2">This can&apos;t be undone. Active subscriptions are cancelled.</p>
          <div className="mt-5 flex gap-3">
            <Button variant="danger" busy={busy === "delete"} onClick={del}>Yes, delete everything</Button>
            <Button variant="secondary" onClick={() => setStep(0)}>Keep my account</Button>
          </div>
        </Sheet>
      </main>
      <Footer />
    </>
  );
}

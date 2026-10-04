"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { ConsentState, PrivacyHistory } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { Button, ErrorNote, Loading, Sheet, Toggle } from "../ui/primitives";

/** Magic-link sign in. In dev/test the API returns the token directly so you can skip the inbox. */
export function SignInForm({ next, compact = false, defaultEmail = "" }: { next?: string; compact?: boolean; defaultEmail?: string }) {
  const signIn = useApp((s) => s.signIn);
  const [email, setEmail] = useState(defaultEmail);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.magicLink(email, next);
      setSent(true);
      setDevToken(r.dev_token ?? null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const useDev = async () => {
    if (!devToken) return;
    setBusy(true);
    try {
      const v = await api.auth.verify(devToken);
      signIn(v.access_token, v.user);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (sent) {
    return (
      <div className="grid gap-3">
        <p className="flex items-start gap-2 text-[15px]"><Icon name="check" className="mt-0.5 text-sage" /> Check {email} for a sign-in link. It works for 15 minutes.</p>
        {devToken ? (
          <Button variant="secondary" onClick={useDev} busy={busy}>Dev mode: sign in now</Button>
        ) : null}
        <button className="justify-self-start text-sm text-ink-3 underline" onClick={() => setSent(false)}>Use a different email</button>
      </div>
    );
  }
  return (
    <form className={`grid gap-3 ${compact ? "" : "max-w-sm"}`} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Email</span>
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-[10px] border border-line-2 bg-surface px-3 py-2.5" placeholder="you@example.com" />
      </label>
      {error ? <ErrorNote error={error} /> : null}
      <Button type="submit" busy={busy}>Email me a sign-in link</Button>
      <p className="text-xs text-ink-3">No passwords. We only use your email to sign you in and send receipts.</p>
    </form>
  );
}

/** Saving needs explicit consent: health profile storage, and personalisation as a separate box. */
export function SaveCard({ planId }: { planId: string }) {
  const user = useApp((s) => s.user);
  const [storage, setStorage] = useState(false);
  const [personal, setPersonal] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "saved" | "declined">("idle");
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  if (state === "saved") {
    return <div className="card flex items-start gap-3 p-5 text-[15px]"><Icon name="check" className="mt-0.5 text-sage" /> Saved to your account. You can change this anytime in Privacy.</div>;
  }
  const save = async () => {
    setState("busy");
    setError(null);
    try {
      const r = await api.me.save({ plan_id: planId, profile_storage: storage, personalisation: storage && personal });
      setState(r.saved ? "saved" : "declined");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setError(e);
      setState("idle");
    }
  };
  return (
    <section className="card p-5" aria-labelledby="save-title">
      <h2 id="save-title" className="font-semibold">Keep this plan</h2>
      {!user ? (
        <>
          <p className="mt-1 text-sm text-ink-3">It stays on this device for 30 days. Sign in to keep it longer and get a calendar that updates itself.</p>
          <div className="mt-4"><SignInForm compact next={`/plan/${planId}`} /></div>
        </>
      ) : (
        <div className="mt-2">
          <Toggle id="consent-storage" checked={storage} onChange={setStorage} label="Save my health profile" sub="Keep my answers, lab values, plans and dose logs in my account." />
          <Toggle id="consent-personal" checked={personal && storage} onChange={setPersonal} label="Personalise my next plan" sub="Use my history to shorten future intakes. Needs the box above." />
          {state === "declined" ? <p className="mt-2 text-sm text-ink-3">Nothing was stored. Your plan stays available on this device for 30 days.</p> : null}
          {error ? <ErrorNote error={error} /> : null}
          <Button className="mt-3 w-full" onClick={save} busy={state === "busy"}>{storage ? "Save to my account" : "Continue without saving"}</Button>
        </div>
      )}
    </section>
  );
}

export function ConsentPanel() {
  const qc = useQueryClient();
  const consents = useQuery({ queryKey: ["consents"], queryFn: api.me.consents });
  const [confirm, setConfirm] = useState<ConsentState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const set = async (purpose: string, granted: boolean) => {
    setError(null);
    try {
      const r = await api.me.setConsent(purpose, granted);
      qc.setQueryData(["consents"], r);
      qc.invalidateQueries({ queryKey: ["privacy-history"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setError(e);
    }
  };
  if (consents.isLoading) return <Loading />;
  if (consents.isError) return <ErrorNote error={consents.error} />;
  return (
    <section className="card divide-y divide-line px-5" aria-label="Privacy choices">
      {consents.data!.purposes.map((c) => (
        <div key={c.purpose}>
          <Toggle
            id={`consent-${c.purpose}`}
            checked={c.granted}
            onChange={(v) => (v ? set(c.purpose, true) : c.purpose === "profile_storage" ? setConfirm(c) : set(c.purpose, false))}
            label={c.label}
            sub={<>{c.text} <span className="block pt-1 text-xs">If you turn this off: {c.if_withdrawn}</span></>}
          />
        </div>
      ))}
      {error ? <div className="py-3"><ErrorNote error={error instanceof ApiError ? error : new Error("Couldn't update that choice.")} /></div> : null}
      <Sheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title="Delete your saved health data?">
        <p className="text-[15px] text-ink-2">{confirm?.if_withdrawn} This happens right away and can&apos;t be undone. Your purchases stay active.</p>
        <div className="mt-5 flex gap-3">
          <Button variant="danger" onClick={() => { void set("profile_storage", false); setConfirm(null); }}>Delete and turn off</Button>
          <Button variant="secondary" onClick={() => setConfirm(null)}>Keep it</Button>
        </div>
      </Sheet>
    </section>
  );
}

export function PrivacyHistoryList() {
  const h = useQuery({ queryKey: ["privacy-history"], queryFn: api.me.privacyHistory });
  if (h.isLoading) return <Loading />;
  if (h.isError) return <ErrorNote error={h.error} />;
  const data = h.data as PrivacyHistory;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="card p-5">
        <h2 className="eyebrow">Consent changes</h2>
        {data.consents.length ? (
          <ul className="mt-3 grid gap-2 text-sm">
            {data.consents.map((c, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{c.purpose.replace(/_/g, " ")}: <b className={c.granted ? "text-sage-ink" : "text-caution-ink"}>{c.granted ? "on" : "off"}</b> <span className="text-ink-3">({c.method}{c.actor !== "user" ? `, by ${c.actor}` : ""})</span></span>
                <time className="text-ink-3">{new Date(c.ts).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-ink-3">No changes yet.</p>}
      </section>
      <section className="card p-5">
        <h2 className="eyebrow">Staff who viewed your data</h2>
        {data.staff_access.length ? (
          <ul className="mt-3 grid gap-2 text-sm">
            {data.staff_access.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.role.replace(/_/g, " ")}</span> · <time className="text-ink-3">{new Date(s.ts).toLocaleString()}</time>
                <p className="text-ink-2">Reason: {s.reason}</p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-ink-3">Nobody at StackSense has opened your health data.</p>}
      </section>
    </div>
  );
}

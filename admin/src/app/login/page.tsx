"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Button, ErrorBox, Field, inputCls } from "@/components/ui";
import { adminApi, useAuth, type Admin } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi<{ access_token: string; admin: Admin; expires_in: number }>("/auth/login", { body: { email, code: code || null } });
      signIn(r.access_token, r.admin, r.expires_in);
      router.replace("/");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form className="card grid w-full max-w-sm gap-4 p-6" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-ink text-white"><Icon name="shield" size={18} /></span>
          <h1 className="display text-xl">StackSense admin</h1>
        </div>
        <Field label="Work email"><input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></Field>
        <Field label="Authenticator code" hint="Required outside local development (TOTP, 6 digits).">
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} />
        </Field>
        <ErrorBox error={error} />
        <Button variant="primary" busy={busy} type="submit">Sign in</Button>
        <p className="text-[11px] text-ink-3">Sessions end after 30 minutes or when you close the browser. Every action is audited.</p>
        <details className="text-[12px] text-ink-3">
          <summary className="cursor-pointer">Local dev accounts</summary>
          <ul className="mt-2 grid gap-1">
            {["admin", "editor", "pharmacist", "catalog", "revenue", "support", "analyst"].map((r) => (
              <li key={r}><button type="button" className="underline" onClick={() => setEmail(`${r}@stacksense.dev`)}>{r}@stacksense.dev</button></li>
            ))}
          </ul>
        </details>
      </form>
    </main>
  );
}

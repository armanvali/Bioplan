"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink/90 disabled:bg-ink/40",
  secondary: "bg-surface border border-line-2 hover:bg-sunken disabled:opacity-50",
  ghost: "text-ink-2 hover:bg-ink/5 disabled:opacity-40",
  danger: "bg-caution text-white hover:bg-caution-ink disabled:opacity-50",
};

export function Button({ variant = "secondary", busy, icon, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; icon?: string }) {
  return (
    <button {...rest} disabled={rest.disabled || busy} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}>
      {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 ${className}`}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-2">{title}</h2>
          <div className="flex gap-2">{actions}</div>
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

const BADGE: Record<string, string> = {
  green: "bg-sage-tint text-sage-ink", amber: "bg-amber-tint text-amber-ink", red: "bg-caution-tint text-caution-ink", grey: "bg-lock-tint text-ink-2", ink: "bg-ink text-white",
};
export function Badge({ tone = "grey", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[tone]}`}>{children}</span>;
}

export const statusTone = (s: string): keyof typeof BADGE =>
  ({ published: "green", approved: "green", checks_passed: "green", active: "green", running: "green", completed: "green", ok: "green", paid: "green", trialing: "green",
     in_review: "amber", draft: "grey", pending: "amber", stale_price: "amber", out_of_stock: "amber", missing_tag: "red",
     checks_failed: "red", rejected: "red", rolled_back: "red", broken: "red", refunded: "red", suspended: "red", stopped: "grey", canceled: "grey" } as Record<string, keyof typeof BADGE>)[s] ?? "grey";

export function Table<T>({ rows, cols, empty = "Nothing here.", rowKey }: {
  rows: T[]; cols: { key: string; label: string; render: (r: T) => ReactNode; className?: string }[]; empty?: string; rowKey: (r: T) => string | number;
}) {
  if (!rows.length) return <p className="py-6 text-center text-ink-3">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-3">
            {cols.map((c) => <th key={c.key} className={`px-4 py-2 font-semibold ${c.className ?? ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-line/70 last:border-0 hover:bg-canvas/70">
              {cols.map((c) => <td key={c.key} className={`px-4 py-2 align-top ${c.className ?? ""}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Json({ value, max = 400 }: { value: unknown; max?: number }) {
  return <pre className="overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12px] leading-relaxed" style={{ maxHeight: max }}>{JSON.stringify(value, null, 2)}</pre>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; code?: string; details?: unknown };
  return (
    <div role="alert" className="rounded-lg border border-caution/30 bg-caution-tint p-3 text-[13px] text-caution-ink">
      <b>{e.code ?? "error"}</b>: {e.message ?? String(error)}
      {e.details && Object.keys(e.details as object).length ? <Json value={e.details} max={160} /> : null}
    </div>
  );
}

export function Loading() {
  return <p className="py-8 text-center text-ink-3" role="status">Loading…</p>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "h-9 rounded-lg border border-line-2 bg-surface px-3 text-[13px]";

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-surface p-5 shadow-2 outline-none">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-lg">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-ink-3 hover:bg-sunken"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Every sensitive staff action asks for a reason; it lands in the audit log (and the user's privacy history). */
export function ReasonButton({ label, title, onConfirm, variant = "secondary", placeholder = "e.g. Ticket #4412: user asked by email", icon, extra }: {
  label: string; title: string; onConfirm: (reason: string) => Promise<unknown>; variant?: Variant; placeholder?: string; icon?: string; extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setReason("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant={variant} icon={icon} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="grid gap-3">
          {extra}
          <Field label="Reason (audited)">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="rounded-lg border border-line-2 p-3 text-[13px]" placeholder={placeholder} />
          </Field>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={variant === "danger" ? "danger" : "primary"} busy={busy} disabled={reason.trim().length < 6} onClick={go}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");
export const fmtMoney = (cents: number, currency = "CAD") => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);

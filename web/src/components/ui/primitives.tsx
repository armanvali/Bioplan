"use client";

import Link from "next/link";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink/90 disabled:bg-ink/40",
  secondary: "bg-surface text-ink border border-line-2 hover:bg-sunken disabled:opacity-50",
  ghost: "text-ink-2 hover:bg-ink/5 disabled:opacity-40",
  danger: "bg-caution text-white hover:bg-caution-ink disabled:opacity-50",
};

export function Button({
  variant = "primary", icon, busy, className = "", children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {busy ? <Spinner size={16} /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", icon, className = "", children }: { href: string; variant?: Variant; icon?: IconName; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium transition-colors ${variants[variant]} ${className}`}>
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </Link>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Chip({ selected, onClick, children, icon, disabled, className = "", value, field }: { selected?: boolean; onClick?: () => void; children: ReactNode; icon?: string; disabled?: boolean; className?: string; value?: string; field?: string }) {
  return (
    <button
      type="button"
      data-option={value}
      data-field={field}
      role="checkbox"
      aria-checked={!!selected}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[15px] transition-colors ${
        selected ? "border-sage bg-sage-tint text-sage-ink" : "border-line-2 bg-surface text-ink hover:bg-sunken"
      } disabled:opacity-40 ${className}`}
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
      {selected ? <Icon name="check" size={16} /> : null}
    </button>
  );
}

export function Sheet({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : title}
        tabIndex={-1}
        className="relative max-h-[88dvh] w-full max-w-lg animate-rise overflow-y-auto rounded-t-3xl bg-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2 outline-none sm:rounded-3xl"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          {title ? <h2 id={labelledBy} className="display text-xl">{title}</h2> : <span />}
          <button onClick={onClose} className="-m-2 rounded-full p-2 text-ink-3 hover:bg-sunken" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[10px] border border-caution/30 bg-caution-tint p-4 text-[15px] text-caution-ink">
      <Icon name="alert" className="mt-0.5" />
      <div className="flex-1">
        <p>{msg}</p>
        {onRetry ? (
          <button onClick={onRetry} className="mt-1 font-medium underline">
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-ink-3" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 100, step = 1, label, unit, field }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; unit?: string | null; field?: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[15px] text-ink-2">{label}</span>
      <div className="flex items-center gap-2" role="group" aria-label={label} data-stepper={field} data-value={value}>
        <button type="button" className="grid size-11 place-items-center rounded-full border border-line-2 bg-surface hover:bg-sunken disabled:opacity-40" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Fewer ${label}`}>
          <Icon name="minus" size={18} />
        </button>
        <output className="min-w-16 text-center text-lg font-semibold tabular-nums" aria-live="polite">
          {value}
          {unit ? <span className="ml-1 text-sm font-normal text-ink-3">{unit}</span> : null}
        </output>
        <button type="button" className="grid size-11 place-items-center rounded-full border border-line-2 bg-surface hover:bg-sunken disabled:opacity-40" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`More ${label}`}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, sub, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode; id: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {sub ? <span className="mt-0.5 block text-sm text-ink-3">{sub}</span> : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-line-2 transition-colors peer-checked:bg-sage peer-focus-visible:outline-2 peer-focus-visible:outline-sage" />
        <span className="absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

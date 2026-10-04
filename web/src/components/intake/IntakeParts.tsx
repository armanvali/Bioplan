"use client";

import { useEffect, useState } from "react";
import { useMeta } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import type { ConfirmNode, ExclusionAdded, StopCardData, Toast } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { Button, Chip } from "../ui/primitives";

export function ConfidenceRing({ value, size = 56 }: { value: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Plan confidence">
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="6" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-sage)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset .6s var(--ease-out-soft)" }}
        />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}

/** "What we're hearing": live signals and exclusions from the server's per-answer deltas. */
export function InsightRail({ signals, exclusions, confidence }: { signals: Record<string, number>; exclusions: ExclusionAdded[]; confidence: number }) {
  const t = useT();
  const { data: meta } = useMeta();
  const strong = Object.entries(signals)
    .filter(([, p]) => p >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const areaColor = (sig: string) => {
    const area = meta?.signals[sig]?.areas?.[0];
    return meta?.areas.find((a) => a.id === area)?.color ?? "var(--color-ink-3)";
  };
  return (
    <aside className="card p-5" aria-label={t("intake.heard")}>
      <div className="flex items-center gap-4">
        <ConfidenceRing value={confidence} />
        <div>
          <p className="eyebrow">{t("intake.confidence")}</p>
          <p className="text-sm text-ink-2">Each answer sharpens the plan. We stop asking once more questions won&apos;t change it.</p>
        </div>
      </div>
      <h2 className="eyebrow mt-5">{t("intake.heard")}</h2>
      {strong.length ? (
        <ul className="mt-2 grid gap-2" aria-live="polite">
          {strong.map(([sig, p]) => (
            <li key={sig} className="flex items-center gap-2 text-sm animate-rise">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: areaColor(sig) }} />
              <span className="flex-1">{meta?.signals[sig]?.label ?? sig.replace(/_/g, " ")}</span>
              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full bg-sage" style={{ width: `${Math.round(p * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-3">Nothing yet. Patterns show up here as you answer.</p>
      )}
      {exclusions.length ? (
        <>
          <h2 className="eyebrow mt-5">{t("intake.excluded")}</h2>
          <ul className="mt-2 grid gap-2">
            {exclusions.map((e) => (
              <li key={e.ingredient} className="flex items-start gap-2 text-sm animate-rise">
                <Icon name="shield" size={16} className="mt-0.5 text-caution" />
                <span>
                  <b className="font-medium">{e.name}</b> <span className="text-ink-3">— {e.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}

export function BranchToast({ toast }: { toast: Toast | null }) {
  const [shown, setShown] = useState<Toast | null>(toast);
  useEffect(() => {
    setShown(toast);
    if (!toast) return;
    const id = setTimeout(() => setShown(null), 4200);
    return () => clearTimeout(id);
  }, [toast]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4">
      {shown ? (
        <div key={shown.key + shown.text} className="pointer-events-auto flex max-w-md animate-toast items-start gap-2 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-2">
          <Icon name="sparkle" size={18} className="mt-0.5 text-amber" />
          <span>{shown.text}</span>
        </div>
      ) : null}
    </div>
  );
}

export function StopCard({ card, onContinue, busy }: { card: StopCardData; onContinue?: () => void; busy?: boolean }) {
  const urgent = card.severity === "urgent" || card.action === "stop";
  return (
    <section className={`card animate-rise overflow-hidden ${urgent ? "border-caution/40" : "border-amber/50"}`} aria-labelledby="stop-title">
      <div className={`flex items-center gap-3 px-6 py-4 ${urgent ? "bg-caution-tint text-caution-ink" : "bg-amber-tint text-amber-ink"}`}>
        <Icon name={urgent ? "stethoscope" : "alert"} size={24} />
        <span className="eyebrow !text-current">{urgent ? "Please pause here" : "Worth a check"}</span>
      </div>
      <div className="p-6">
        <h1 id="stop-title" className="display text-2xl">{card.title}</h1>
        <p className="mt-3 text-[15px] text-ink-2">{card.body}</p>
        {card.referral ? (
          <p className="mt-4 flex items-start gap-2 rounded-[10px] bg-sunken p-3 text-[15px]">
            <Icon name="phoneCall" size={18} className="mt-0.5 text-ink-3" />
            {card.referral}
          </p>
        ) : null}
        {card.can_continue && onContinue ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={onContinue} busy={busy}>
              I understand, continue
            </Button>
          </div>
        ) : (
          <p className="mt-6 text-sm text-ink-3">We won&apos;t build a supplement plan for this. Your answers aren&apos;t saved unless you choose to.</p>
        )}
      </div>
    </section>
  );
}

/** Returning user: "Still true?" over saved stable answers, so we only re-ask what changed. */
export function ConfirmCard({ node, onSubmit, busy }: { node: ConfirmNode; onSubmit: (changed: string[]) => void; busy?: boolean }) {
  const [changed, setChanged] = useState<string[]>([]);
  return (
    <section className="card animate-rise p-6" aria-labelledby="confirm-title">
      <p className="eyebrow">Welcome back</p>
      <h1 id="confirm-title" className="display mt-1 text-2xl">{node.prompt}</h1>
      <p className="mt-2 text-[15px] text-ink-2">{node.helper}</p>
      <ul className="mt-5 grid gap-2">
        {node.items.map((it) => {
          const on = changed.includes(it.node_id);
          return (
            <li key={it.node_id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => setChanged(on ? changed.filter((c) => c !== it.node_id) : [...changed, it.node_id])}
                className={`flex w-full items-center justify-between gap-3 rounded-[12px] border px-4 py-3 text-left ${on ? "border-amber bg-amber-tint" : "border-line-2 bg-surface"}`}
              >
                <span>
                  <span className="block text-xs text-ink-3">{it.label}</span>
                  <span className="block text-[15px] font-medium">{it.summary}</span>
                </span>
                <span className={`text-sm ${on ? "font-semibold text-amber-ink" : "text-ink-3"}`}>{on ? "Changed" : "Still true"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {node.lab_due.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {node.lab_due.map((l) => (
            <Chip key={l.analyte} icon="flask">
              {l.prompt} You can add it on the review screen.
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="mt-6 flex justify-end">
        <Button onClick={() => onSubmit(changed)} busy={busy}>
          {changed.length ? `Update ${changed.length} answer${changed.length > 1 ? "s" : ""}` : "All still true"}
        </Button>
      </div>
    </section>
  );
}

export function ReturningUserBanner({ planDate }: { planDate?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[12px] bg-sage-tint p-4 text-[15px] text-sage-ink">
      <Icon name="restart" className="mt-0.5" />
      <p>
        We&apos;ll reuse what hasn&apos;t changed{planDate ? ` since ${planDate}` : ""} and ask about anything new, so this takes about half the time.
      </p>
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { money } from "@/lib/format";
import type { Banner, Excluded, Locked, Plan, PlanItem, Spacing } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { Button, Sheet } from "../ui/primitives";

const FORM_ICON: Record<string, string> = { capsule: "pill", tablet: "pill", softgel: "softgel", powder: "scoop", liquid: "drops", gummy: "pill" };

export function StackCard({ item, explanation, onUnlock }: { item: PlanItem; explanation?: { why_you: string; what_it_does: string; evidence_summary: string }; onUnlock: () => void }) {
  const [open, setOpen] = useState(false);
  const locked = typeof item.dose === "object";
  return (
    <article className="card overflow-hidden" aria-labelledby={`item-${item.ingredient_id}`}>
      <div className="flex gap-4 p-5">
        <span className="mt-1 grid size-10 shrink-0 place-items-center rounded-[12px]" style={{ background: `${item.color}1f`, color: item.color }}>
          <Icon name={FORM_ICON[item.delivery.form] ?? "pill"} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 id={`item-${item.ingredient_id}`} className="text-[17px] font-semibold">
              {item.name} {item.sub ? <span className="text-sm font-normal text-ink-3">{item.sub}</span> : null}
            </h3>
            <span className="text-sm tabular-nums text-ink-3">{money(item.monthly_cost)}/mo</span>
          </div>
          <p className="mt-1 text-[15px] text-ink-2">
            {explanation?.why_you ?? (item.why.length ? `Because you mentioned ${item.why.slice(0, 3).join(", ")}.` : "")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {locked ? (
              <button onClick={onUnlock} className="inline-flex items-center gap-1.5 rounded-full bg-lock-tint px-3 py-1 text-ink-2 hover:bg-line">
                <Icon name="lock" size={14} /> {(item.dose as { range: string }).range} · exact dose in the Full Report
              </button>
            ) : (
              <span className="rounded-full bg-sage-tint px-3 py-1 font-medium text-sage-ink">
                {item.dose_label} {item.amount_text ? <span className="font-normal">· {item.amount_text}</span> : null}
              </span>
            )}
            <span className="rounded-full bg-sunken px-3 py-1 text-ink-2">{item.frequency_text}</span>
            {item.cue ? <span className="rounded-full bg-sunken px-3 py-1 text-ink-2">{item.cue}</span> : null}
            <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-ink-2" title="Evidence grade (A strongest to D weakest)">
              Evidence {item.evidence_grade}
            </span>
          </div>
          {item.warnings.length || item.notes.length ? (
            <ul className="mt-3 grid gap-1 text-sm text-amber-ink">
              {[...item.warnings, ...item.notes].map((w) => (
                <li key={w} className="flex items-start gap-1.5"><Icon name="info" size={14} className="mt-0.5" />{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between border-t border-line px-5 py-3 text-sm font-medium text-ink-2 hover:bg-sunken">
        What it does, how to take it, interactions <Icon name={open ? "up" : "down"} size={18} />
      </button>
      {open ? (
        <dl className="grid gap-3 border-t border-line bg-canvas/60 px-5 py-4 text-sm animate-rise">
          {[
            ["What it does", explanation?.what_it_does ?? item.info.does],
            ["How to take it", item.info.how],
            ["Interactions", item.info.interacts],
            ["Side effects", item.info.side],
            ["What the research says", explanation?.evidence_summary ?? item.info.research],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold">{k}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
          {item.evidence.length ? (
            <div>
              <dt className="font-semibold">Studies</dt>
              <dd className="text-ink-2">
                <ul className="mt-1 grid gap-1">
                  {item.evidence.map((e) => (
                    <li key={e.claim_id}>
                      <span className="mr-1 rounded bg-sunken px-1 text-xs font-semibold">{e.grade}</span>
                      {e.summary} <span className="text-ink-3">({e.citations.join("; ")})</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}

/** Safety is never behind the paywall: banners, interactions and spacing render for every tier. */
export function SafetyBanner({ plan }: { plan: Plan }) {
  const banners: Banner[] = [...plan.banners, ...plan.warnings.map((w) => (typeof w === "string" ? { text: w } : w))];
  const spacing: Spacing[] = [...plan.spacing, ...plan.drug_spacing];
  if (!banners.length && !spacing.length && !plan.low_confidence) return null;
  return (
    <section className="grid gap-2" aria-label="Safety notes">
      {plan.low_confidence ? (
        <div className="flex items-start gap-3 rounded-[12px] border border-amber/40 bg-amber-tint p-4 text-[15px] text-amber-ink">
          <Icon name="info" className="mt-0.5" />
          <p>We weren&apos;t sure about several answers, so we kept this plan small and conservative. Answering a few more questions will sharpen it.</p>
        </div>
      ) : null}
      {banners.map((b, i) => (
        <div key={b.id ?? i} role="note" className="flex items-start gap-3 rounded-[12px] border border-caution/30 bg-caution-tint p-4 text-[15px] text-caution-ink">
          <Icon name="alert" className="mt-0.5" />
          <p>{b.title ? <b>{b.title}. </b> : null}{b.text}</p>
        </div>
      ))}
      {spacing.map((s, i) => (
        <div key={`${s.a}-${s.b}-${i}`} className="flex items-start gap-3 rounded-[12px] bg-sunken p-4 text-[15px] text-ink-2">
          <Icon name="clock" className="mt-0.5" />
          <p>{s.text ?? `Keep ${s.a.replace(/_/g, " ")} and ${s.b.replace(/_/g, " ")} at least ${s.hours} hours apart. Your calendar already does this.`}</p>
        </div>
      ))}
    </section>
  );
}

export function LockedItems({ locked, onEnterLab, onDoctorNote }: { locked: Locked[]; onEnterLab: () => void; onDoctorNote: () => void }) {
  if (!locked.length) return null;
  return (
    <section className="grid gap-3" aria-labelledby="locked-title">
      <h2 id="locked-title" className="eyebrow">Waiting on a blood test</h2>
      {locked.map((l) => (
        <article key={l.ingredient_id} className="rounded-[16px] border border-dashed border-line-2 bg-surface p-5">
          <div className="flex items-start gap-3">
            <Icon name="lock" className="mt-0.5 text-lock" />
            <div className="flex-1">
              <h3 className="font-semibold">{l.name}</h3>
              <p className="mt-1 text-[15px] text-ink-2">{l.reason}</p>
              {l.sources.length ? (
                <p className="mt-2 text-sm text-ink-3">Signs you mentioned: {[...new Set(l.sources.map((s) => s.text))].slice(0, 4).join(", ")}</p>
              ) : null}
              {l.unlock ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" icon="doc" onClick={onDoctorNote}>
                    Doctor note for a {l.unlock.name.toLowerCase()} test
                  </Button>
                  <Button variant="ghost" icon="flask" onClick={onEnterLab}>
                    I have my {l.unlock.name.toLowerCase()} result
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

export function ExcludedDrawer({ excluded }: { excluded: Excluded[] }) {
  const [open, setOpen] = useState(false);
  if (!excluded.length) return null;
  const shown = excluded.filter((e) => !e.substituted_by);
  const swaps = excluded.filter((e) => e.substituted_by);
  return (
    <>
      <button onClick={() => setOpen(true)} className="card flex w-full items-center gap-3 p-4 text-left hover:bg-sunken">
        <span className="grid size-9 place-items-center rounded-full bg-caution-tint text-caution"><Icon name="shield" size={18} /></span>
        <span className="flex-1">
          <span className="block font-semibold">{shown.length} left out on purpose</span>
          <span className="block text-sm text-ink-3">{shown.slice(0, 3).map((e) => e.name).join(", ")}{shown.length > 3 ? "…" : ""}</span>
        </span>
        <Icon name="right" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Left out on purpose">
        <p className="text-[15px] text-ink-2">These came up for your goals but aren&apos;t right for you. This list is always free.</p>
        <ul className="mt-4 grid gap-3">
          {shown.map((e) => (
            <li key={e.ingredient_id} className="rounded-[12px] border border-line p-4">
              <p className="font-semibold">{e.name}</p>
              <p className="mt-1 text-[15px] text-ink-2">{e.reason}</p>
              <p className="mt-1 text-xs text-ink-3">Rule {e.rule_code}</p>
            </li>
          ))}
          {swaps.map((e) => (
            <li key={e.ingredient_id} className="rounded-[12px] bg-sunken p-4 text-sm text-ink-2">
              <b>{e.name}</b> was swapped for a better fit: {e.reason}
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

export function LockedSection({ title, children, onUnlock, cta = "Unlock with the Full Report" }: { title: string; children: ReactNode; onUnlock: () => void; cta?: string }) {
  return (
    <div className="relative overflow-hidden rounded-[16px] border border-line">
      <div className="blurred p-4" aria-hidden>{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/50 p-4 text-center">
        <Icon name="lock" className="text-ink-2" />
        <p className="text-sm font-medium">{title}</p>
        <Button onClick={onUnlock} className="min-h-9 px-4 text-sm">{cta}</Button>
      </div>
    </div>
  );
}

export function BudgetNotes({ plan }: { plan: Plan }) {
  if (!plan.dropped.length && !plan.suggestions.length) return null;
  return (
    <section className="card p-5" aria-labelledby="budget-title">
      <h2 id="budget-title" className="eyebrow">Didn&apos;t fit this time</h2>
      <ul className="mt-3 grid gap-2 text-[15px]">
        {plan.dropped.map((d) => (
          <li key={d.ingredient_id} className="flex items-start justify-between gap-3">
            <span>{d.name} <span className="text-ink-3">— {d.reason.toLowerCase()}</span></span>
            <span className="text-sm tabular-nums text-ink-3">{money(d.monthly_cost)}/mo</span>
          </li>
        ))}
      </ul>
      {plan.suggestions.map((s) => (
        <p key={s.ingredient_id + s.type} className="mt-3 rounded-[10px] bg-sage-tint p-3 text-sm text-sage-ink">{s.text}</p>
      ))}
    </section>
  );
}

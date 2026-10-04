"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { Button, ErrorNote, LinkButton, Loading } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useHydrated, useMeta } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import type { Review, ReviewSignal } from "@/lib/types";

export default function ReviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const token = useApp((s) => s.sessionTokens[sessionId]);
  const rememberPlan = useApp((s) => s.rememberPlan);
  const { data: meta } = useMeta();
  const review = useQuery({ queryKey: ["review", sessionId], queryFn: () => api.intake.review(sessionId), enabled: hydrated && Boolean(token) });
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);

  const patch = async (sig: ReviewSignal) => {
    setPending(sig.id);
    try {
      const next = await api.intake.patchSignal(sessionId, sig.id, sig.removed ? "restore" : "remove");
      qc.setQueryData(["review", sessionId], next);
    } catch (e) {
      setError(e);
    } finally {
      setPending(null);
    }
  };

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      const plan = await api.plans.build(sessionId);
      if (plan.plan_token) rememberPlan(plan.plan_id, plan.plan_token);
      qc.setQueryData(["plan", plan.plan_id, useApp.getState().accessToken], plan);
      router.push(`/plan/${plan.plan_id}`);
    } catch (e) {
      setError(e);
      setBuilding(false);
    }
  };

  if (!hydrated || review.isLoading) return <Shell><Loading /></Shell>;
  if (!token) return <Shell><ErrorNote error={new Error("This intake was started on another device.")} /></Shell>;
  if (review.isError) return <Shell><ErrorNote error={review.error} onRetry={() => review.refetch()} /></Shell>;
  const r = review.data as Review;
  const areaName = (id: string) => (id === "safety" ? "Safety" : meta?.areas.find((a) => a.id === id)?.name ?? id);
  const areaColor = (id: string) => (id === "safety" ? "var(--color-caution)" : meta?.areas.find((a) => a.id === id)?.color ?? "var(--color-ink-3)");
  const name = (id: string) => meta?.ingredients[id]?.name ?? id.replace(/_/g, " ");

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <p className="eyebrow">Step 2 of 3</p>
          <h1 className="display mt-1 text-3xl">{t("review.title")}</h1>
          <p className="mt-2 text-[15px] text-ink-2">{t("review.sub")}</p>

          {r.stops.length ? (
            <p className="mt-4 flex items-start gap-2 rounded-[12px] bg-amber-tint p-4 text-[15px] text-amber-ink">
              <Icon name="alert" className="mt-0.5" /> Some goals are limited because of a safety check you saw earlier. That stays in your plan.
            </p>
          ) : null}

          <div className="mt-6 grid gap-4">
            {r.groups.map((g) => (
              <section key={g.area} className="card p-5" aria-labelledby={`area-${g.area}`}>
                <h2 id={`area-${g.area}`} className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
                  <span className="size-2.5 rounded-full" style={{ background: areaColor(g.area) }} />
                  {areaName(g.area)}
                </h2>
                <ul className="mt-3 grid gap-3">
                  {g.signals.map((s) => (
                    <li key={s.id} className={`rounded-[12px] border p-4 transition-opacity ${s.removed ? "border-dashed border-line-2 opacity-60" : "border-line"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`font-medium ${s.removed ? "line-through" : ""}`}>{s.label}</p>
                          {s.tip_only ? <p className="text-xs text-ink-3">Lifestyle tip, not a supplement</p> : null}
                        </div>
                        <button
                          onClick={() => patch(s)}
                          disabled={pending === s.id}
                          className="shrink-0 rounded-full border border-line-2 px-3 py-1.5 text-sm hover:bg-sunken disabled:opacity-50"
                          aria-label={`${s.removed ? t("review.restore") : t("review.remove")}: ${s.label}`}
                        >
                          {s.removed ? t("review.restore") : t("review.remove")}
                        </button>
                      </div>
                      {s.sources.length ? (
                        <p className="mt-2 text-sm text-ink-3">
                          {t("review.because")}: {s.sources.slice(0, 3).map((src) => `“${src.text}”`).join(", ")}
                        </p>
                      ) : null}
                      {s.lab ? (
                        <p className="mt-2 flex items-center gap-1 text-sm text-ink-2">
                          <Icon name="flask" size={16} /> A {s.lab.name.toLowerCase()} test can confirm this.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <LabEntry sessionId={sessionId} onDone={(next) => qc.setQueryData(["review", sessionId], next)} />
        </div>

        <aside className="lg:pt-16">
          <div className="card sticky top-20 p-5">
            <p className="eyebrow">Your plan so far</p>
            <ul className="mt-3 grid gap-2" aria-live="polite">
              {r.preview.stack.map((it) => (
                <li key={it.ingredient_id} className="flex items-center gap-2 text-[15px]">
                  <span className="size-2.5 rounded-full" style={{ background: meta?.ingredients[it.ingredient_id]?.color ?? "var(--color-sage)" }} />
                  {it.name}
                </li>
              ))}
              {r.preview.locked.map((id) => (
                <li key={id} className="flex items-center gap-2 text-[15px] text-ink-3">
                  <Icon name="lock" size={14} /> {name(id)} (needs a blood test)
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-2">
              About <b>{money(r.preview.monthly_cost, r.preview.currency)}</b> a month · confidence {Math.round(r.confidence * 100)}%
            </p>
            {error ? <div className="mt-3"><ErrorNote error={error} /></div> : null}
            <Button className="mt-5 w-full" onClick={build} busy={building} icon="right">
              {t("cta.buildPlan")}
            </Button>
            <p className="mt-3 text-xs text-ink-3">Doses, exclusions and interactions come from our rules engine, reviewed by pharmacists. We don&apos;t sell your data.</p>
          </div>
          <div className="mt-4 text-center">
            <LinkButton href={`/intake/${sessionId}`} variant="ghost" icon="back">Change answers</LinkButton>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

const LABS = [
  { analyte: "ferritin", name: "Ferritin", unit: "µg/L" },
  { analyte: "b12", name: "Vitamin B12", unit: "pmol/L" },
  { analyte: "vitamin_d_25oh", name: "Vitamin D (25-OH-D)", unit: "nmol/L" },
];

function LabEntry({ sessionId, onDone }: { sessionId: string; onDone: (r: Review) => void }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const labs = LABS.filter((l) => vals[l.analyte]).map((l) => ({ analyte: l.analyte, value: Number(vals[l.analyte]), unit: l.unit }));
    if (!labs.length) return;
    setBusy(true);
    setErr(null);
    try {
      onDone(await api.intake.addLabs(sessionId, labs));
      setOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't add those values.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card mt-4 p-5">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 font-medium">
          <Icon name="flask" /> Have recent blood test results?
        </span>
        <Icon name={open ? "up" : "down"} />
      </button>
      {open ? (
        <div className="mt-4 grid gap-2 animate-rise">
          {LABS.map((l) => (
            <label key={l.analyte} className="flex items-center justify-between gap-3">
              <span>{l.name}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={vals[l.analyte] ?? ""}
                  onChange={(e) => setVals({ ...vals, [l.analyte]: e.target.value })}
                  className="w-24 rounded-md border border-line-2 px-2 py-1 text-right"
                />
                <span className="w-14 text-xs text-ink-3">{l.unit}</span>
              </span>
            </label>
          ))}
          {err ? <p className="text-sm text-caution-ink">{err}</p> : null}
          <Button variant="secondary" onClick={submit} busy={busy} className="mt-2 justify-self-start">
            Add results
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        {children}
      </main>
    </>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PaywallSheet } from "@/components/billing/Billing";
import { DayTimeline, MonthGrid, monthRange, shiftMonth } from "@/components/calendar/Calendar";
import { AppHeader, Footer } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { Button, ErrorNote, LinkButton, Loading } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";
import { addDays, formatDay, todayIso } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { useApp } from "@/lib/store";

export default function CalendarPage() {
  const { planId } = useParams<{ planId: string }>();
  const t = useT();
  const hydrated = useHydrated();
  const accessToken = useApp((s) => s.accessToken);
  const hasToken = useApp((s) => Boolean(s.planTokens[planId]));
  const enabled = hydrated && (hasToken || Boolean(accessToken));
  const plan = useQuery({ queryKey: ["plan", planId, accessToken], queryFn: () => api.plans.get(planId), enabled });

  const [view, setView] = useState<"day" | "month">("day");
  const [selected, setSelected] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, Record<string, string>>>({});
  const [feed, setFeed] = useState<{ url: string; webcal: string } | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);

  // Start on ?date= (reminder deep links), else today, or day 1 if the plan hasn't started yet.
  useEffect(() => {
    if (!plan.data || selected) return;
    const start = plan.data.start_date;
    const today = todayIso();
    const asked = new URLSearchParams(window.location.search).get("date");
    const first = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked >= start ? asked : today < start ? start : today;
    setSelected(first);
    setMonth(first);
  }, [plan.data, selected]);

  const range = useMemo(() => (month ? monthRange(month) : null), [month]);
  const schedule = useQuery({
    queryKey: ["schedule", planId, accessToken, range?.from, range?.to],
    queryFn: () => api.plans.schedule(planId, range!.from, range!.to, todayIso()),
    enabled: enabled && Boolean(range),
  });

  useEffect(() => {
    if (schedule.data) api.event("calendar_opened");
  }, [schedule.data]);

  if (!hydrated || (enabled && (plan.isLoading || !selected))) return <Shell><Loading /></Shell>;
  if (!enabled) return <Shell><ErrorNote error={new Error("Open this calendar on the device where you made the plan, or sign in.")} /></Shell>;
  if (plan.isError) return <Shell><ErrorNote error={plan.error} onRetry={() => plan.refetch()} /></Shell>;

  const p = plan.data!;
  const s = schedule.data;
  const day = s?.days.find((d) => d.date === selected) ?? null;
  const lockedDay = Boolean(s?.locked_after && selected && selected > s.locked_after);
  const today = todayIso();
  const canLog = Boolean(selected && selected <= addDays(today, 0) && selected >= addDays(today, -2));
  const lockedDose = p.gated.includes("exact_doses");

  const log = async (slot: string, status: "taken" | "skipped") => {
    if (!selected) return;
    setLogs((l) => ({ ...l, [selected]: { ...(l[selected] ?? {}), [slot]: status } }));
    try {
      await api.plans.logDose(planId, selected, slot, status);
    } catch {
      setLogs((l) => ({ ...l, [selected]: { ...(l[selected] ?? {}), [slot]: "" } }));
    }
  };

  const exportAction = async (fn: () => Promise<void>, trigger: string) => {
    setExportError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.isPaywall) setPaywall(trigger);
      else setExportError(e);
    }
  };

  const serverLogs = day?.logged ?? {};
  const dayLogs = { ...serverLogs, ...(selected ? logs[selected] : {}) };

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your calendar</p>
          <h1 className="display mt-1 text-3xl">{selected ? formatDay(selected, undefined, { weekday: "long", month: "long", day: "numeric" }) : ""}</h1>
          {s?.streak ? <p className="mt-1 flex items-center gap-1 text-sm text-amber-ink"><Icon name="flame" size={16} /> {s.streak}-day streak</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <LinkButton href={`/plan/${planId}`} variant="ghost" icon="back">{t("nav.plan")}</LinkButton>
          <div className="inline-flex rounded-full bg-sunken p-1" role="tablist" aria-label="Calendar view">
            {(["day", "month"] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${view === v ? "bg-surface shadow-[var(--shadow-1)]" : "text-ink-2"}`}>
                {v === "day" ? t("calendar.today") : t("calendar.month")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {view === "month" && month ? (
            <section className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <button className="rounded-full p-2 hover:bg-sunken" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><Icon name="left" /></button>
                <h2 className="font-semibold">{new Date(month + "T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
                <button className="rounded-full p-2 hover:bg-sunken" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><Icon name="right" /></button>
              </div>
              {schedule.isLoading ? <Loading /> : (
                <MonthGrid month={month} days={s?.days ?? []} selected={selected!} lockedAfter={s?.locked_after ?? null} startDate={p.start_date} onLocked={() => setPaywall("open_full_calendar")} onSelect={(d) => { setSelected(d); setView("day"); }} />
              )}
            </section>
          ) : (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <button className="flex items-center gap-1 rounded-full px-3 py-2 text-sm hover:bg-sunken disabled:opacity-30" disabled={selected! <= p.start_date} onClick={() => { const d = addDays(selected!, -1); setSelected(d); if (d.slice(0, 7) !== month?.slice(0, 7)) setMonth(d); }}>
                  <Icon name="left" size={16} /> Previous day
                </button>
                {selected !== today && today >= p.start_date ? <button className="text-sm font-medium text-sage-ink" onClick={() => { setSelected(today); setMonth(today); }}>Today</button> : null}
                <button className="flex items-center gap-1 rounded-full px-3 py-2 text-sm hover:bg-sunken" onClick={() => { const d = addDays(selected!, 1); setSelected(d); if (d.slice(0, 7) !== month?.slice(0, 7)) setMonth(d); }}>
                  Next day <Icon name="right" size={16} />
                </button>
              </div>
              {schedule.isLoading ? <Loading /> : schedule.isError ? <ErrorNote error={schedule.error} /> : lockedDay ? (
                <div className="card p-6 text-center">
                  <Icon name="lock" className="mx-auto text-ink-3" />
                  <p className="mt-2 font-medium">The free calendar covers your first 7 days.</p>
                  <p className="mt-1 text-sm text-ink-3">The Full Report includes 90 days, with ramp-up, cycles, refills and lab reminders.</p>
                  <Button className="mt-4" onClick={() => setPaywall("open_full_calendar")}>See the full calendar</Button>
                </div>
              ) : day ? (
                <DayTimeline day={day} logs={dayLogs} canLog={canLog} onLog={log} lockedDose={lockedDose} />
              ) : (
                <p className="card p-6 text-center text-ink-3">Nothing scheduled this day.</p>
              )}
            </section>
          )}
        </div>

        <aside className="grid content-start gap-4">
          <section className="card p-5">
            <h2 className="font-semibold">{t("calendar.export")}</h2>
            <p className="mt-1 text-sm text-ink-3">Subscribe once and your calendar app stays in sync when your plan changes. Times follow daylight saving.</p>
            {feed ? (
              <div className="mt-3 grid gap-2">
                <a href={feed.webcal} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-white">
                  <Icon name="calendar" size={16} /> Open in my calendar app
                </a>
                <button onClick={() => navigator.clipboard?.writeText(feed.url)} className="inline-flex items-center justify-center gap-1 text-sm text-ink-2 underline">
                  <Icon name="copy" size={14} /> Copy feed link (Google Calendar: &ldquo;From URL&rdquo;)
                </button>
              </div>
            ) : (
              <div className="mt-3 grid gap-2">
                <Button icon="calendar" onClick={() => exportAction(async () => setFeed(await api.plans.calendarToken(planId)), "open_full_calendar")}>Subscribe to calendar</Button>
                <Button variant="secondary" icon="download" onClick={() => exportAction(() => api.plans.downloadIcs(planId), "open_full_calendar")}>Download .ics</Button>
              </div>
            )}
            {exportError ? <div className="mt-3"><ErrorNote error={exportError} /></div> : null}
          </section>

          {s?.refills.length ? (
            <section className="card p-5">
              <h2 className="font-semibold">Refills</h2>
              <ul className="mt-3 grid gap-2 text-sm">
                {[...s.refills].sort((a, b) => a.runout.localeCompare(b.runout)).map((r) => (
                  <li key={r.ingredient_id} className="flex items-center justify-between gap-3">
                    <span>{p.items.find((i) => i.ingredient_id === r.ingredient_id)?.short ?? r.ingredient_id} <span className="text-ink-3">runs out {formatDay(r.runout)}</span></span>
                    <a href={r.link} target="_blank" rel="noopener noreferrer sponsored" className="font-medium text-sage-ink underline">Reorder</a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card p-5">
            <h2 className="font-semibold">How we built this</h2>
            <ul className="mt-2 grid gap-1.5 text-sm text-ink-2">
              <li>New items start one or two at a time, every 3 days, gentlest first.</li>
              <li>Nothing new the day before or on race day.</li>
              <li>Items that compete for absorption are kept apart.</li>
              <li>Cycled items (like ashwagandha) pause automatically.</li>
            </ul>
          </section>
        </aside>
      </div>
      <PaywallSheet open={Boolean(paywall)} onClose={() => setPaywall(null)} planId={planId} trigger={paywall ?? ""} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:py-10">{children}</main>
      <Footer />
    </>
  );
}

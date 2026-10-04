"use client";

import { addDays, formatDay, isoDay, parseDay, time12 } from "@/lib/format";
import type { Day, DayTask } from "@/lib/types";
import { Icon } from "../ui/Icon";

const TASK_ICON: Record<string, string> = { new: "sparkle", lab: "flask", checkin: "list", refill: "cart", event: "flag", cycle_off: "minus", cycle_on: "plus" };

export function DayTimeline({ day, logs, onLog, canLog, lockedDose }: {
  day: Day;
  logs: Record<string, string>;
  onLog?: (slot: string, status: "taken" | "skipped") => void;
  canLog: boolean;
  lockedDose: boolean;
}) {
  return (
    <div className="grid gap-4">
      {day.tasks.length ? <TaskList tasks={day.tasks} /> : null}
      <ol className="relative grid gap-3 border-l-2 border-line pl-6">
        {day.slots.map((slot) => {
          const status = logs[slot.id];
          const active = slot.items.filter((i) => !i.off);
          return (
            <li key={slot.id} className="relative">
              <span className={`absolute -left-[33px] top-4 grid size-4 place-items-center rounded-full border-2 ${status === "taken" ? "border-sage bg-sage" : "border-line-2 bg-surface"}`} aria-hidden>
                {status === "taken" ? <Icon name="check" size={10} strokeWidth={3} className="text-white" /> : null}
              </span>
              <article className="card p-4">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">
                    {slot.label} <span className="ml-1 text-sm font-normal tabular-nums text-ink-3">{time12(slot.minutes)}</span>
                  </h3>
                  {onLog && canLog && active.length ? (
                    <div className="flex gap-1">
                      <button onClick={() => onLog(slot.id, "taken")} aria-pressed={status === "taken"} className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === "taken" ? "bg-sage text-white" : "bg-sage-tint text-sage-ink hover:bg-sage/20"}`}>
                        {status === "taken" ? "Taken" : "Mark taken"}
                      </button>
                      <button onClick={() => onLog(slot.id, "skipped")} aria-pressed={status === "skipped"} className={`rounded-full px-3 py-1.5 text-sm ${status === "skipped" ? "bg-ink-3 text-white" : "text-ink-3 hover:bg-sunken"}`}>
                        Skip
                      </button>
                    </div>
                  ) : null}
                </header>
                <ul className="mt-3 grid gap-2">
                  {slot.items.map((it) => (
                    <li key={it.ingredient_id} className={`flex items-center gap-3 ${it.off ? "opacity-50" : ""}`}>
                      <span className="size-3 shrink-0 rounded-full" style={{ background: it.color }} />
                      <span className="flex-1 text-[15px]">
                        {it.name}
                        {it.is_new ? <span className="ml-2 rounded-full bg-amber-tint px-2 py-0.5 text-xs text-amber-ink">New</span> : null}
                        {it.off ? <span className="ml-2 text-xs text-ink-3">(off week)</span> : null}
                      </span>
                      <span className="text-sm text-ink-2">
                        {lockedDose || !it.amount_text ? (
                          <span className="inline-flex items-center gap-1 text-ink-3"><Icon name="lock" size={12} /> dose in report</span>
                        ) : (
                          <>{it.amount_text} <span className="text-ink-3">· {it.dose_label}</span></>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {slot.cues.length ? <p className="mt-3 text-sm text-ink-3">{slot.cues.join(" ")}</p> : null}
              </article>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-ink-3">
        {day.pills} pill{day.pills === 1 ? "" : "s"}{day.scoops ? ` + ${day.scoops} scoop${day.scoops === 1 ? "" : "s"}` : ""} today{day.training_day ? " · training day" : ""}
      </p>
    </div>
  );
}

function TaskList({ tasks }: { tasks: DayTask[] }) {
  return (
    <ul className="grid gap-2">
      {tasks.map((t, i) => (
        <li key={i} className="flex items-start gap-3 rounded-[12px] bg-amber-tint p-3 text-[15px] text-amber-ink">
          <Icon name={TASK_ICON[t.type] ?? "info"} className="mt-0.5" />
          <span className="flex-1">
            <b className="font-semibold">{t.title}</b>
            {t.sub ? <span className="block text-sm">{t.sub}</span> : null}
          </span>
          {t.link ? <a href={t.link} target="_blank" rel="noopener noreferrer sponsored" className="text-sm font-medium underline">Reorder</a> : null}
        </li>
      ))}
    </ul>
  );
}

export function MonthGrid({ month, days, selected, onSelect, lockedAfter, startDate, onLocked }: {
  month: string; // any day in the month
  days: Day[];
  selected: string;
  onSelect: (d: string) => void;
  lockedAfter: string | null;
  startDate: string;
  onLocked: () => void;
}) {
  const first = parseDay(month);
  first.setDate(1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => isoDay(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
  const today = isoDay(new Date());
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-ink-3" aria-hidden>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}>
        {cells.map((iso, i) => {
          if (!iso) return <span key={`e${i}`} />;
          const d = byDate.get(iso);
          const before = iso < startDate;
          const locked = Boolean(lockedAfter && iso > lockedAfter);
          const isSel = iso === selected;
          return (
            <button
              key={iso}
              role="gridcell"
              aria-selected={isSel}
              aria-label={`${formatDay(iso)}${locked ? ", locked" : d ? `, ${d.pills} pills${d.tasks.length ? `, ${d.tasks.length} tasks` : ""}` : ""}`}
              disabled={before}
              onClick={() => (locked ? onLocked() : onSelect(iso))}
              className={`relative flex aspect-square min-h-11 flex-col items-center justify-start rounded-[10px] p-1 text-sm transition-colors disabled:opacity-30 ${
                isSel ? "bg-ink text-white" : locked ? "bg-lock-tint text-ink-3" : "bg-surface hover:bg-sunken"
              } ${iso === today && !isSel ? "ring-2 ring-sage" : ""}`}
            >
              <span className="tabular-nums">{parseDay(iso).getDate()}</span>
              {locked ? (
                <Icon name="lock" size={12} className="mt-1" />
              ) : d ? (
                <span className="mt-auto flex gap-0.5">
                  {d.tasks.slice(0, 3).map((t, j) => (
                    <span key={j} className={`size-1.5 rounded-full ${t.type === "lab" ? "bg-caution" : t.type === "event" ? "bg-ink-2" : "bg-amber"}`} />
                  ))}
                  {!d.tasks.length && d.pills ? <span className={`size-1.5 rounded-full ${isSel ? "bg-white/60" : "bg-sage/50"}`} /> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function monthRange(anyDay: string): { from: string; to: string } {
  const d = parseDay(anyDay);
  const from = isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
  const to = isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return { from, to };
}

export function shiftMonth(anyDay: string, n: number): string {
  const d = parseDay(anyDay);
  return isoDay(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

export { addDays };

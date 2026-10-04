"use client";

import { browserTz } from "@/lib/intake";
import { parseHHMM, toHHMM, WEEKDAYS } from "@/lib/format";
import { Chip, Stepper } from "../ui/primitives";
import type { ControlProps } from "./AnswerControls";

const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function TimeRow({ label, minutes, onChange, field }: { label: string; minutes: number; onChange: (m: number) => void; field: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[10px] bg-surface px-4 py-2">
      <span className="text-[15px] text-ink-2">{label}</span>
      <input
        type="time"
        step={900}
        data-field={field}
        value={toHHMM(minutes)}
        onChange={(e) => {
          const m = parseHHMM(e.target.value);
          if (m !== null) onChange(m);
        }}
        className="rounded-md bg-sunken px-3 py-1.5 tabular-nums"
      />
    </label>
  );
}

export function RoutineFields({ value, onChange }: ControlProps) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const days = (value.training_days as string[]) ?? [];
  const rows: [string, string][] = [["wake", "Wake up"], ["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["bed", "Bedtime"]];
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-[12px] bg-sunken p-2">
        {rows.map(([k, l]) => (
          <TimeRow key={k} field={k} label={l} minutes={Number(value[k] ?? 0)} onChange={(m) => set(k, m)} />
        ))}
      </div>
      <div>
        <p className="mb-2 text-[15px] font-medium">Training days</p>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <Chip key={d} value={d} field="training_days" selected={days.includes(d)} onClick={() => set("training_days", days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}>
              {DAY_LABEL[d]}
            </Chip>
          ))}
        </div>
      </div>
      <p className="text-sm text-ink-3">Time zone: {String(value.tz ?? browserTz())}. Reminders follow your local time, including daylight saving.</p>
    </div>
  );
}

const EVENT_TYPES = [
  { id: "5k", label: "5K" }, { id: "10k", label: "10K" }, { id: "half", label: "Half-marathon" }, { id: "full", label: "Marathon" }, { id: "other", label: "Other" },
];

export function TrainingFields({ value, onChange }: ControlProps) {
  const event = (value.event as { type: string; date: string } | null) ?? null;
  return (
    <div className="grid gap-4">
      <Stepper field="sessions" label="Sessions a week" value={Number(value.sessions ?? 0)} min={0} max={14} onChange={(v) => onChange({ ...value, sessions: v })} />
      <Stepper field="km" label="Km a week" value={Number(value.km ?? 0)} min={0} max={300} step={5} unit="km" onChange={(v) => onChange({ ...value, km: v })} />
      <div>
        <p className="mb-2 text-[15px] font-medium">Any race or event coming up?</p>
        <div className="flex flex-wrap gap-2">
          <Chip value="no_event" field="event" selected={!event} onClick={() => onChange({ ...value, event: null })}>
            No
          </Chip>
          {EVENT_TYPES.map((e) => (
            <Chip key={e.id} value={e.id} field="event" selected={event?.type === e.id} onClick={() => onChange({ ...value, event: { type: e.id, date: event?.date ?? "" } })}>
              {e.label}
            </Chip>
          ))}
        </div>
        {event ? (
          <label className="mt-3 flex items-center justify-between gap-3 rounded-[10px] bg-sunken px-4 py-2 animate-rise">
            <span className="text-[15px] text-ink-2">Date</span>
            <input type="date" data-field="event_date" value={event.date} onChange={(e) => onChange({ ...value, event: { ...event, date: e.target.value } })} className="rounded-md bg-surface px-3 py-1.5" />
          </label>
        ) : null}
        {event ? <p className="mt-2 text-sm text-ink-3">We won&apos;t start anything new the day before or on race day.</p> : null}
      </div>
    </div>
  );
}

export function DemographicsFields({ schema, value, onChange }: ControlProps) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const fields = Object.fromEntries(schema.fields.map((f) => [f.key, f]));
  const regions = schema.regions?.[String(value.country)] ?? [];
  return (
    <div className="grid gap-5">
      <label className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium">{fields.age?.label ?? "Age"}</span>
        <input
          type="number"
          inputMode="numeric"
          min={fields.age?.min ?? 13}
          max={fields.age?.max ?? 100}
          value={value.age === null || value.age === undefined ? "" : String(value.age)}
          onChange={(e) => set("age", e.target.value === "" ? null : Number(e.target.value))}
          className="w-28 rounded-[10px] border border-line-2 bg-surface px-3 py-2 text-right text-lg tabular-nums"
          aria-describedby="age-help"
          data-field="age"
        />
      </label>
      {typeof value.age === "number" && value.age < 18 ? (
        <p id="age-help" className="-mt-3 text-sm text-caution-ink">StackSense is for adults. We&apos;ll explain on the next screen.</p>
      ) : null}
      {(["sex", "country"] as const).map((k) =>
        fields[k] ? (
          <fieldset key={k}>
            <legend className="mb-2 text-[15px] font-medium">{fields[k].label}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {fields[k].options.map((o) => (
                <Chip key={o.id} value={o.id} field={k} selected={value[k] === o.id} onClick={() => onChange({ ...value, [k]: o.id, ...(k === "country" ? { region: null } : {}) })}>
                  {o.label}
                </Chip>
              ))}
            </div>
          </fieldset>
        ) : null,
      )}
      {regions.length ? (
        <label className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-medium">{fields.region?.label ?? "Province or state"}</span>
          <select data-field="region" value={String(value.region ?? "")} onChange={(e) => set("region", e.target.value || null)} className="max-w-[60%] rounded-[10px] border border-line-2 bg-surface px-3 py-2">
            <option value="">Choose…</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

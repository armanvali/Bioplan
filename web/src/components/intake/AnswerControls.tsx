"use client";

import { followVisible } from "@/lib/intake";
import type { AnswerSchema, AnswerValue, FollowField, Option } from "@/lib/types";
import { Chip, Stepper } from "../ui/primitives";
import { Icon } from "../ui/Icon";
import { BodyMap } from "./BodyMap";
import { EnergyCurve } from "./EnergyCurve";
import { DemographicsFields, RoutineFields, TrainingFields } from "./FormControls";
import { MedsSearch } from "./MedsSearch";

export interface ControlProps {
  schema: AnswerSchema;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}

export function AnswerControls(props: ControlProps) {
  const { schema } = props;
  switch (schema.type) {
    case "single":
    case "scale":
      return <SingleChoice {...props} />;
    case "multi":
      return <MultiChoice {...props} />;
    case "rank":
      return <RankChoice {...props} />;
    case "time":
      return <TimeOfDay {...props} />;
    case "energy_curve":
      return <EnergyCurve {...props} />;
    case "body_map":
      return <BodyMap {...props} />;
    case "pss4":
      return <Pss4 {...props} />;
    case "meds":
      return <MedsSearch {...props} />;
    case "budget":
      return <Budget {...props} />;
    case "pills":
      return <Pills {...props} />;
    case "routine":
      return <RoutineFields {...props} />;
    case "training":
      return <TrainingFields {...props} />;
    case "demographics":
      return <DemographicsFields {...props} />;
    case "free_text":
      return <FreeText {...props} />;
    case "number":
      return <NumberInput {...props} />;
    default:
      return <p className="text-ink-3">This question type isn&apos;t supported yet.</p>;
  }
}

function OptionCard({ option, selected, onSelect, role = "radio" }: { option: Option; selected: boolean; onSelect: () => void; role?: "radio" | "checkbox" }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      data-option={option.id}
      onClick={onSelect}
      className={`flex min-h-12 w-full items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors ${
        selected ? "border-sage bg-sage-tint" : "border-line-2 bg-surface hover:bg-sunken"
      }`}
    >
      {option.icon ? <Icon name={option.icon} className={selected ? "text-sage-ink" : "text-ink-3"} /> : null}
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{option.label}</span>
        {option.sub ? <span className="block text-sm text-ink-3">{option.sub}</span> : null}
      </span>
      <span className={`grid size-5 place-items-center rounded-full border ${selected ? "border-sage bg-sage text-white" : "border-line-2"}`}>
        {selected ? <Icon name="check" size={14} strokeWidth={2.5} /> : null}
      </span>
    </button>
  );
}

function SingleChoice({ schema, value, onChange }: ControlProps) {
  return (
    <div className="grid gap-4">
      <div role="radiogroup" className="grid gap-2">
        {schema.options.map((o) => (
          <OptionCard key={o.id} option={o} selected={value.choice === o.id} onSelect={() => onChange({ ...value, choice: o.id })} />
        ))}
      </div>
      <FollowFields schema={schema} value={value} onChange={onChange} />
    </div>
  );
}

function MultiChoice({ schema, value, onChange }: ControlProps) {
  const picks = (value.picks as string[]) ?? [];
  const exclusive = new Set(schema.options.filter((o) => o.exclusive).map((o) => o.id));
  const toggle = (id: string) => {
    let next: string[];
    if (picks.includes(id)) next = picks.filter((p) => p !== id);
    else if (exclusive.has(id)) next = [id];
    else next = [...picks.filter((p) => !exclusive.has(p)), id];
    onChange({ ...value, picks: next });
  };
  return (
    <div className="grid gap-4">
      <div className="grid gap-2" role="group">
        {schema.options.map((o) => (
          <OptionCard key={o.id} role="checkbox" option={o} selected={picks.includes(o.id)} onSelect={() => toggle(o.id)} />
        ))}
      </div>
      <FollowFields schema={schema} value={value} onChange={onChange} />
    </div>
  );
}

function RankChoice({ schema, value, onChange }: ControlProps) {
  const ranked = (value.ranked as string[]) ?? [];
  const max = schema.max_picks ?? 3;
  const toggle = (id: string) => {
    if (ranked.includes(id)) onChange({ ...value, ranked: ranked.filter((r) => r !== id) });
    else if (ranked.length < max) onChange({ ...value, ranked: [...ranked, id] });
  };
  return (
    <div>
      <p className="mb-3 text-sm text-ink-3">
        Tap up to {max}, most important first. {ranked.length ? `${ranked.length} of ${max} picked.` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group">
        {schema.options.map((o) => {
          const pos = ranked.indexOf(o.id);
          const on = pos >= 0;
          return (
            <button
              key={o.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              data-option={o.id}
              aria-label={on ? `${o.label}, priority ${pos + 1}` : o.label}
              onClick={() => toggle(o.id)}
              disabled={!on && ranked.length >= max}
              className={`relative flex min-h-20 flex-col items-start justify-between gap-2 rounded-[12px] border p-3 text-left transition-colors disabled:opacity-40 ${
                on ? "border-sage bg-sage-tint" : "border-line-2 bg-surface hover:bg-sunken"
              }`}
            >
              {o.icon ? <Icon name={o.icon} className={on ? "text-sage-ink" : "text-ink-3"} /> : null}
              <span className="text-[15px] font-medium leading-tight">{o.label}</span>
              {on ? (
                <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-sage text-xs font-bold text-white">{pos + 1}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeOfDay({ schema, value, onChange }: ControlProps) {
  const minutes = typeof value.minutes === "number" ? value.minutes : 900;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return (
    <div className="grid gap-3">
      <label className={`flex items-center justify-between gap-3 rounded-[12px] border border-line-2 bg-surface px-4 py-3 ${value.none ? "opacity-40" : ""}`}>
        <span className="text-[15px] text-ink-2">Time</span>
        <input
          type="time"
          step={900}
          value={`${hh}:${mm}`}
          disabled={Boolean(value.none)}
          onChange={(e) => {
            const [h, m] = e.target.value.split(":").map(Number);
            if (!Number.isNaN(h)) onChange({ minutes: h * 60 + (m || 0) });
          }}
          className="rounded-md bg-sunken px-3 py-2 text-lg tabular-nums"
        />
      </label>
      {schema.none_label ? (
        <Chip value="none" selected={Boolean(value.none)} onClick={() => onChange(value.none ? { minutes } : { none: true })}>
          {schema.none_label}
        </Chip>
      ) : null}
    </div>
  );
}

function Pss4({ schema, value, onChange }: ControlProps) {
  const items = (value.items as (number | null)[]) ?? schema.items.map(() => null);
  const scale = schema.scale.length ? schema.scale : ["Never", "Almost never", "Sometimes", "Fairly often", "Very often"];
  return (
    <div className="grid gap-5">
      {schema.items.map((it, i) => (
        <fieldset key={i}>
          <legend className="mb-2 text-[15px] font-medium">{it.q}</legend>
          <div className="grid grid-cols-5 gap-1" role="radiogroup">
            {scale.map((label, v) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={items[i] === v}
                data-item={i}
                data-value={v}
                aria-label={label}
                onClick={() => {
                  const next = [...items];
                  next[i] = v;
                  onChange({ ...value, items: next });
                }}
                className={`min-h-12 rounded-[10px] border px-1 text-xs leading-tight transition-colors ${
                  items[i] === v ? "border-sage bg-sage-tint font-semibold text-sage-ink" : "border-line-2 bg-surface hover:bg-sunken"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      {schema.sources.length ? (
        <div>
          <p className="mb-2 text-[15px] font-medium">Main source of stress (optional)</p>
          <div className="flex flex-wrap gap-2">
            {schema.sources.map((s) => (
              <Chip key={s} value={s} field="source" selected={value.source === s} onClick={() => onChange({ ...value, source: value.source === s ? null : s })}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Budget({ schema, value, onChange }: ControlProps) {
  const amount = Number(value.amount ?? 80);
  const min = schema.min ?? 20;
  const max = schema.max ?? 250;
  return (
    <div className="grid gap-4">
      <output className="display block text-center text-5xl tabular-nums" aria-live="polite">
        ${amount}
        <span className="ml-1 font-sans text-base text-ink-3">/ month</span>
      </output>
      <input
        type="range"
        min={min}
        max={max}
        step={schema.step ?? 5}
        value={amount}
        onChange={(e) => onChange({ amount: Number(e.target.value) })}
        aria-label="Monthly budget in dollars"
        className="w-full"
      />
      <div className="flex justify-between text-xs text-ink-3">
        <span>${min}</span>
        <span>${max}+</span>
      </div>
      <p className="text-sm text-ink-3">We fit the highest-impact items inside this. You&apos;ll see what didn&apos;t fit and what it would cost to add.</p>
    </div>
  );
}

function Pills({ schema, value, onChange }: ControlProps) {
  return (
    <div className="grid gap-4">
      <Stepper field="max" label="Pills on the busiest day" value={Number(value.max ?? 6)} min={schema.min ?? 1} max={schema.max ?? 12} onChange={(v) => onChange({ ...value, max: v })} />
      <div className="flex flex-wrap gap-2">
        <Chip value="powders" selected={value.powders !== false} onClick={() => onChange({ ...value, powders: true })}>
          Powders are fine
        </Chip>
        <Chip value="no_powders" selected={value.powders === false} onClick={() => onChange({ ...value, powders: false })}>
          Capsules only
        </Chip>
      </div>
    </div>
  );
}

function FreeText({ schema, value, onChange }: ControlProps) {
  const text = String(value.text ?? "");
  const limit = schema.max_length ?? 500;
  return (
    <div>
      <textarea
        value={text}
        maxLength={limit}
        rows={4}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="For example: my knees ache after long runs, and I get headaches in the afternoon."
        className="w-full rounded-[12px] border border-line-2 bg-surface p-4 text-[15px] placeholder:text-ink-3"
        aria-label="Anything else"
      />
      <p className="mt-1 text-right text-xs text-ink-3">
        {text.length}/{limit}
      </p>
      <p className="text-sm text-ink-3">We match what you write to things we already ask about, and check with you before using anything. It never picks a supplement by itself.</p>
    </div>
  );
}

function NumberInput({ schema, value, onChange }: ControlProps) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={schema.min ?? undefined}
      max={schema.max ?? undefined}
      step={schema.step ?? "any"}
      value={value.value === undefined || value.value === null ? "" : String(value.value)}
      onChange={(e) => onChange({ value: e.target.value === "" ? null : Number(e.target.value) })}
      className="w-full rounded-[12px] border border-line-2 bg-surface p-4 text-lg"
      aria-label="Value"
    />
  );
}

function FollowFields({ schema, value, onChange }: ControlProps) {
  const visible = schema.follow.filter((f) => followVisible(f, value));
  if (!visible.length) return null;
  return (
    <div className="grid gap-4 rounded-[12px] bg-sunken p-4 animate-rise">
      {visible.map((f) => (
        <FollowControl key={f.key} field={f} value={value} onChange={onChange} />
      ))}
    </div>
  );
}

const LAB_META: Record<string, { name: string; unit: string }> = {
  ferritin: { name: "Ferritin", unit: "µg/L" },
  b12: { name: "Vitamin B12", unit: "pmol/L" },
  vitamin_d_25oh: { name: "Vitamin D (25-OH-D)", unit: "nmol/L" },
  tsh: { name: "TSH", unit: "mIU/L" },
};

function FollowControl({ field, value, onChange }: { field: FollowField; value: AnswerValue; onChange: (v: AnswerValue) => void }) {
  if (field.type === "chips") {
    return (
      <div>
        <p className="mb-2 text-[15px] font-medium">{field.label}</p>
        <div className="flex flex-wrap gap-2">
          {field.options.map((o) => (
            <Chip key={o.id} value={o.id} field={field.key} selected={value[field.key] === o.id} onClick={() => onChange({ ...value, [field.key]: o.id })}>
              {o.label}
            </Chip>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === "stepper") {
    const v = typeof value[field.key] === "number" ? (value[field.key] as number) : (field.min ?? 0);
    return <Stepper field={field.key} label={field.label} value={v} min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} unit={field.unit} onChange={(n) => onChange({ ...value, [field.key]: n })} />;
  }
  const labs = (value[field.key] as { analyte: string; value: number; unit?: string }[]) ?? [];
  const setLab = (analyte: string, raw: string) => {
    const rest = labs.filter((l) => l.analyte !== analyte);
    const n = Number(raw);
    onChange({ ...value, [field.key]: raw === "" || Number.isNaN(n) ? rest : [...rest, { analyte, value: n, unit: LAB_META[analyte]?.unit }] });
  };
  return (
    <div>
      <p className="mb-2 text-[15px] font-medium">{field.label}</p>
      <div className="grid gap-2">
        {field.analytes.map((a) => (
          <label key={a} className="flex items-center justify-between gap-3 rounded-[10px] bg-surface px-3 py-2">
            <span className="text-[15px]">{LAB_META[a]?.name ?? a}</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={labs.find((l) => l.analyte === a)?.value ?? ""}
                onChange={(e) => setLab(a, e.target.value)}
                className="w-24 rounded-md border border-line-2 px-2 py-1 text-right tabular-nums"
                aria-label={`${LAB_META[a]?.name ?? a} value`}
              />
              <span className="w-14 text-xs text-ink-3">{LAB_META[a]?.unit}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

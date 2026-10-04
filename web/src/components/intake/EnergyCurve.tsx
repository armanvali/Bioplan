"use client";

import type { ControlProps } from "./AnswerControls";

const label = (h: number) => (h === 12 ? "noon" : `${h % 12 || 12}${h < 12 ? "a" : "p"}`);

/** Drag each hour's bar to sketch how your energy moves through a typical day. */
export function EnergyCurve({ schema, value, onChange }: ControlProps) {
  const hours = schema.hours.length ? schema.hours : [6, 8, 10, 12, 14, 16, 18, 20, 22];
  const pts = (value.points as number[]) ?? hours.map(() => 5);
  const set = (i: number, v: number) => {
    const next = [...pts];
    next[i] = v;
    onChange({ points: next });
  };
  const w = 320;
  const h = 120;
  const step = w / (hours.length - 1);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (p / 10) * h).toFixed(1)}`).join(" ");
  return (
    <div className="grid gap-3">
      <svg viewBox={`-8 -8 ${w + 16} ${h + 16}`} className="w-full" aria-hidden>
        <rect x="0" y="0" width={w} height={h} rx="8" fill="var(--color-sunken)" />
        <path d={`${path} L${w},${h} L0,${h} Z`} fill="rgba(185,138,18,0.14)" />
        <path d={path} fill="none" stroke="var(--color-area-energy)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={i * step} cy={h - (p / 10) * h} r="4" fill="var(--color-area-energy)" />
        ))}
      </svg>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
        {hours.map((hr, i) => (
          <div key={hr} className="flex flex-col items-center gap-1">
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={pts[i]}
              data-hour={hr}
              onChange={(e) => set(i, Number(e.target.value))}
              aria-label={`Energy at ${label(hr)}, 0 to 10`}
              className="h-28 w-6 [writing-mode:vertical-lr] [direction:rtl]"
            />
            <span className="text-[11px] text-ink-3">{label(hr)}</span>
          </div>
        ))}
      </div>
      <p className="text-sm text-ink-3">0 is running on empty, 10 is your best. Roughly is fine.</p>
    </div>
  );
}

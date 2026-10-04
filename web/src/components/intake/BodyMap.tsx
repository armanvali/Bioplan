"use client";

import { useState } from "react";
import { Chip } from "../ui/primitives";
import type { ControlProps } from "./AnswerControls";

// Spot positions on a 100 x 200 figure. Front view is mirrored: the person's left is on the viewer's right.
const POS: Record<string, [number, number]> = {
  neck: [50, 30], shoulder_l: [66, 40], shoulder_r: [34, 40], elbow_l: [74, 70], elbow_r: [26, 70], wrist_l: [80, 98], wrist_r: [20, 98],
  hip_l: [60, 102], hip_r: [40, 102], knee_l: [58, 142], knee_r: [42, 142], ankle_l: [57, 184], ankle_r: [43, 184],
  neck_b: [50, 30], upperback: [50, 52], lowerback: [50, 86], glute_l: [41, 106], glute_r: [59, 106], hamstring_l: [42, 128],
  hamstring_r: [58, 128], calf_l: [43, 160], calf_r: [57, 160], heel_l: [44, 190], heel_r: [56, 190],
};

const SILHOUETTE =
  "M50 6a11 11 0 1 1 0 22a11 11 0 1 1 0-22zM36 34h28c6 0 10 4 11 10l8 52c.5 3-1.5 5-4 5s-4-2-4.5-4L69 60v42l-3 44 -2 42c0 3-2 5-5 5s-5-2-5-5l-2-60h-4l-2 60c0 3-2 5-5 5s-5-2-5-5l-2-42-3-44V60l-5.5 37c-.5 2-2 4-4.5 4s-4.5-2-4-5l8-52c1-6 5-10 11-10z";

export function BodyMap({ schema, value, onChange }: ControlProps) {
  const spots = schema.spots ?? { front: {}, back: {} };
  const [side, setSide] = useState<"front" | "back">((value.side as "front" | "back") ?? "front");
  const picked = (value.spots as string[]) ?? [];
  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((s) => s !== id) : [...picked, id];
    onChange({ spots: next, side });
  };
  const current = spots[side] ?? {};
  return (
    <div className="grid gap-4">
      <div className="flex gap-2" role="tablist" aria-label="Body side">
        {(["front", "back"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${side === s ? "bg-ink text-white" : "bg-sunken text-ink-2"}`}
          >
            {s === "front" ? "Front" : "Back"}
          </button>
        ))}
      </div>
      <div className={`grid gap-4 sm:grid-cols-[180px_1fr] ${value.none ? "opacity-40" : ""}`}>
        <svg viewBox="0 0 100 200" className="mx-auto h-72 w-auto" role="group" aria-label={`Body map, ${side}`}>
          <path d={SILHOUETTE} fill="var(--color-sunken)" stroke="var(--color-line-2)" strokeWidth="1" />
          {Object.entries(current).map(([id, label]) => {
            const [x, y] = POS[id] ?? [50, 100];
            const on = picked.includes(id);
            return (
              <g key={id}>
                <circle
                  cx={x}
                  cy={y}
                  r={on ? 6 : 4.5}
                  role="checkbox"
                  aria-checked={on}
                  aria-label={label}
                  tabIndex={0}
                  onClick={() => !value.none && toggle(id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !value.none && (e.preventDefault(), toggle(id))}
                  className="cursor-pointer outline-none focus-visible:stroke-ink"
                  fill={on ? "var(--color-caution)" : "white"}
                  stroke={on ? "var(--color-caution-ink)" : "var(--color-ink-3)"}
                  strokeWidth="1.2"
                />
              </g>
            );
          })}
        </svg>
        <div className="flex flex-wrap content-start gap-2">
          {Object.entries(current).map(([id, label]) => (
            <Chip key={id} value={id} selected={picked.includes(id)} onClick={() => toggle(id)} disabled={Boolean(value.none)}>
              {label}
            </Chip>
          ))}
        </div>
      </div>
      {schema.none_label ? (
        <Chip value="none" selected={Boolean(value.none)} onClick={() => onChange(value.none ? { spots: [], side } : { none: true })}>
          {schema.none_label}
        </Chip>
      ) : null}
    </div>
  );
}

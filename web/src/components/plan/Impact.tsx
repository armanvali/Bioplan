"use client";

import type { Area, AreaId, Impact, ImpactArea, PlanItem } from "@/lib/types";
import { Icon } from "../ui/Icon";

const AREA_ICON: Record<string, string> = {
  sleep: "moon", energy: "bolt", joints_recovery: "joint", mood_stress: "smile", performance: "run", skin_hair: "drop", immunity: "shield", heart_metabolic: "heart",
};

/** Radar of need (dashed) vs projected effect (filled) across the 8 body areas. */
export function ImpactRadar({ impact, areas, need: needFallback, size = 300 }: { impact: Impact; areas: Area[]; need?: Partial<Record<AreaId, number>>; size?: number }) {
  const byId = new Map(impact.areas.map((a) => [a.area, a]));
  const ordered = areas.map((a) => ({ meta: a, data: byId.get(a.id) }));
  const c = size / 2;
  const R = size / 2 - 44;
  const point = (i: number, v: number) => {
    const ang = (Math.PI * 2 * i) / ordered.length - Math.PI / 2;
    return [c + Math.cos(ang) * R * (v / 10), c + Math.sin(ang) * R * (v / 10)] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => point(i, v).join(",")).join(" ");
  // Need is free for every area (it comes from your answers); projected effect is redacted on locked areas.
  const need = ordered.map((o) => o.data?.need ?? needFallback?.[o.meta.id] ?? 0);
  const projected = ordered.map((o) => o.data?.projected ?? 0);
  const anyLocked = ordered.some((o) => o.data?.locked);
  const label = impact.aria_summary ?? ordered.map((o) => `${o.meta.name}: ${o.data?.locked ? "locked" : `${o.data?.projected ?? 0} of 10`}`).join(", ");

  return (
    <figure className="mx-auto w-full max-w-[340px]">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Health impact map. ${label}`} className="w-full">
        {[2.5, 5, 7.5, 10].map((r) => (
          <polygon key={r} points={poly(ordered.map(() => r))} fill="none" stroke="var(--color-line)" strokeWidth="1" />
        ))}
        {ordered.map((o, i) => {
          const [x, y] = point(i, 10);
          return <line key={o.meta.id} x1={c} y1={c} x2={x} y2={y} stroke="var(--color-line)" strokeWidth="1" />;
        })}
        <polygon points={poly(need)} fill="none" stroke="var(--color-ink-3)" strokeWidth="1.5" strokeDasharray="4 4" />
        {anyLocked ? (
          // A partial polygon would read as "zero" on locked axes, so show visible areas as spokes.
          ordered.map((o, i) => {
            if (o.data?.locked || o.data?.projected === undefined) return null;
            const [x, y] = point(i, projected[i]);
            return (
              <g key={o.meta.id}>
                <line x1={c} y1={c} x2={x} y2={y} stroke={o.meta.color} strokeWidth="6" strokeLinecap="round" opacity="0.85" />
                <circle cx={x} cy={y} r="5" fill="white" stroke={o.meta.color} strokeWidth="2" />
              </g>
            );
          })
        ) : (
          <polygon points={poly(projected)} fill="rgba(62,124,107,0.22)" stroke="var(--color-sage)" strokeWidth="2" strokeLinejoin="round" style={{ transition: "all .6s" }} />
        )}
        {ordered.map((o, i) => {
          const [x, y] = point(i, 11.6);
          const locked = o.data?.locked;
          return (
            <g key={o.meta.id} transform={`translate(${x},${y})`}>
              <circle r="15" fill={locked ? "var(--color-lock-tint)" : "white"} stroke={locked ? "var(--color-line-2)" : o.meta.color} strokeWidth="1.5" />
              <g transform="translate(-9,-9)" color={locked ? "var(--color-lock)" : o.meta.color}>
                <Icon name={locked ? "lock" : AREA_ICON[o.meta.id] ?? "info"} size={18} />
              </g>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex justify-center gap-4 text-xs text-ink-3">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-ink-3" /> Your need</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-sage/40 ring-1 ring-sage" /> With this plan</span>
      </figcaption>
      <table className="sr-only">
        <caption>Need and projected effect by area (0 to 10)</caption>
        <tbody>
          {ordered.map((o) => (
            <tr key={o.meta.id}>
              <th>{o.meta.name}</th>
              <td>{o.data?.locked ? "Locked" : `need ${o.data?.need ?? 0}, projected ${o.data?.projected ?? 0}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function gapText(g: NonNullable<ImpactArea["gap_reason"]>, itemName: (id: string) => string): string {
  if (g.text) return g.text;
  if (g.code === "locked_ingredient" && g.ingredient) return `The biggest gap here needs ${itemName(g.ingredient).toLowerCase()}, which unlocks with a blood test.`;
  if (g.code === "no_contributor") return "Nothing in your budget and safety limits covers this area yet. See the tips below.";
  return "Partly covered. Raising your budget or pill limit could close the gap.";
}

/** One row per area: contributors stacked to the projected score, need as a marker. */
export function ImpactBars({ impact, areas, items, onUnlock }: { impact: Impact; areas: Area[]; items: PlanItem[]; onUnlock?: () => void }) {
  const byId = new Map(impact.areas.map((a) => [a.area, a]));
  const itemColor = (id: string) => items.find((i) => i.ingredient_id === id)?.color ?? "var(--color-sage)";
  const itemName = (id: string) => items.find((i) => i.ingredient_id === id)?.short ?? id.replace(/_/g, " ");
  const ordered = [...areas].sort((a, b) => Number(Boolean(byId.get(a.id)?.locked)) - Number(Boolean(byId.get(b.id)?.locked)) || (byId.get(b.id)?.need ?? 0) - (byId.get(a.id)?.need ?? 0));
  return (
    <ul className="grid gap-4">
      {ordered.map((meta) => {
        const a = byId.get(meta.id);
        if (!a) return null;
        return <AreaRow key={meta.id} meta={meta} a={a} itemColor={itemColor} itemName={itemName} onset={impact.onset_weeks?.[meta.id as AreaId]} onUnlock={onUnlock} />;
      })}
    </ul>
  );
}

function AreaRow({ meta, a, itemColor, itemName, onset, onUnlock }: { meta: Area; a: ImpactArea; itemColor: (id: string) => string; itemName: (id: string) => string; onset?: [number, number]; onUnlock?: () => void }) {
  if (a.locked) {
    return (
      <li className="relative rounded-[12px] border border-line p-4">
        <div className="blurred" aria-hidden>
          <div className="flex justify-between text-sm font-medium"><span>{meta.name}</span><span>7.0 / 10</span></div>
          <div className="mt-2 h-3 rounded-full bg-sunken"><div className="h-3 w-2/3 rounded-full" style={{ background: meta.color }} /></div>
        </div>
        <button onClick={onUnlock} className="absolute inset-0 flex items-center justify-center gap-2 rounded-[12px] text-sm font-medium text-ink-2 hover:bg-white/40">
          <Icon name="lock" size={16} /> {meta.name}: unlock the full map
        </button>
      </li>
    );
  }
  const projected = a.projected ?? 0;
  const need = a.need ?? 0;
  const contributors = a.contributors ?? [];
  const showShares = contributors.some((c) => typeof c.share === "number");
  return (
    <li className="rounded-[12px] border border-line p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-[15px] font-medium">
          <span className="size-2.5 rounded-full" style={{ background: meta.color }} /> {meta.name}
        </span>
        <span className="text-sm tabular-nums text-ink-2">
          {projected.toFixed(1)} <span className="text-ink-3">/ need {need.toFixed(1)}</span>
        </span>
      </div>
      <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-sunken" aria-hidden>
        {showShares ? (
          <div className="flex h-full">
            {contributors.map((c) => (
              <span key={c.ingredient} title={itemName(c.ingredient)} style={{ width: `${((c.share ?? 0) / 10) * 100}%`, background: itemColor(c.ingredient) }} />
            ))}
          </div>
        ) : (
          <span className="block h-full rounded-full" style={{ width: `${projected * 10}%`, background: meta.color }} />
        )}
        <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${need * 10}% - 1px)` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        {contributors.map((c) => (
          <span key={c.ingredient} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: itemColor(c.ingredient) }} />
            {itemName(c.ingredient)}
            {c.grade ? <span className="rounded bg-sunken px-1 font-semibold">{c.grade}</span> : null}
          </span>
        ))}
        {onset ? <span className="ml-auto">Usually felt in {onset[0]}–{onset[1]} weeks</span> : null}
      </div>
      {a.gap_reason ? <p className="mt-2 text-xs text-amber-ink">{gapText(a.gap_reason, itemName)}</p> : null}
    </li>
  );
}

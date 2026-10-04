"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import type { DrugResult } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { Chip } from "../ui/primitives";
import type { ControlProps } from "./AnswerControls";

/** Search-as-you-type (3+ letters). Each pick shows, right away, what it rules out. */
export function MedsSearch({ schema, value, onChange }: ControlProps) {
  const [q, setQ] = useState("");
  const [known, setKnown] = useState<Record<string, DrugResult>>({});
  const query = useDebounced(q.trim(), 200);
  const { data, isFetching } = useQuery({
    queryKey: ["drugs", query],
    queryFn: () => api.intake.drugs(query),
    enabled: query.length >= 3,
    staleTime: 5 * 60_000,
  });
  const meds = (value.meds as string[]) ?? [];
  const free = (value.free_text as string[]) ?? [];
  const none = Boolean(value.none);

  const add = (d: DrugResult) => {
    setKnown((k) => ({ ...k, [d.id]: d }));
    if (!meds.includes(d.id)) onChange({ meds: [...meds, d.id], free_text: free });
    setQ("");
  };
  const addFree = () => {
    if (!q.trim()) return;
    onChange({ meds, free_text: [...free, q.trim()] });
    setQ("");
  };
  const blocks = useMemo(() => meds.flatMap((m) => (known[m]?.blocks ?? []).map((b) => ({ ...b, drug: known[m]?.name ?? m }))), [meds, known]);

  return (
    <div className="grid gap-3">
      <div className={`relative ${none ? "opacity-40" : ""}`}>
        <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" size={18} />
        <input
          type="search"
          value={q}
          disabled={none}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), data?.results[0] ? add(data.results[0]) : addFree())}
          placeholder="Type a medicine or supplement (e.g. Zoloft)"
          aria-label="Search medicines"
          aria-autocomplete="list"
          aria-controls="med-results"
          className="w-full rounded-[12px] border border-line-2 bg-surface py-3 pl-11 pr-4 text-[15px]"
        />
        {query.length >= 3 && q ? (
          <ul id="med-results" role="listbox" className="absolute z-10 mt-1 w-full overflow-hidden rounded-[12px] border border-line bg-surface shadow-2">
            {(data?.results ?? []).map((d) => (
              <li key={d.id}>
                <button type="button" role="option" aria-selected={false} data-option={d.id} onClick={() => add(d)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-sunken">
                  <span>
                    <span className="block font-medium">{d.name}</span>
                    {d.aliases.length ? <span className="block text-xs text-ink-3">{d.aliases.slice(0, 3).join(", ")}</span> : null}
                  </span>
                  {d.blocks.length ? <span className="rounded-full bg-amber-tint px-2 py-0.5 text-xs text-amber-ink">{d.blocks.length} interaction{d.blocks.length > 1 ? "s" : ""}</span> : null}
                </button>
              </li>
            ))}
            {!isFetching && data && data.results.length === 0 ? (
              <li className="px-4 py-3 text-sm text-ink-3">No match.</li>
            ) : null}
            <li className="border-t border-line">
              <button type="button" onClick={addFree} className="w-full px-4 py-3 text-left text-sm text-sage-ink hover:bg-sunken">
                Add &ldquo;{q.trim()}&rdquo; as written
              </button>
            </li>
          </ul>
        ) : null}
      </div>

      {meds.length || free.length ? (
        <div className="flex flex-wrap gap-2">
          {meds.map((m) => (
            <Chip key={m} selected onClick={() => onChange({ meds: meds.filter((x) => x !== m), free_text: free })}>
              {known[m]?.name ?? m}
            </Chip>
          ))}
          {free.map((f) => (
            <Chip key={f} selected onClick={() => onChange({ meds, free_text: free.filter((x) => x !== f) })}>
              {f} <span className="text-xs text-amber-ink">(unmatched)</span>
            </Chip>
          ))}
        </div>
      ) : null}

      {blocks.length ? (
        <ul className="grid gap-2" aria-live="polite">
          {blocks.map((b) => (
            <li key={`${b.drug}-${b.ingredient_id}`} className="flex items-start gap-2 rounded-[10px] bg-amber-tint p-3 text-sm text-amber-ink">
              <Icon name="shield" size={18} className="mt-0.5" />
              <span>
                <b>{b.name}</b> will be left out. {b.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {free.length ? (
        <p className="flex items-start gap-2 rounded-[10px] bg-sunken p-3 text-sm text-ink-2">
          <Icon name="info" size={18} className="mt-0.5" />
          We couldn&apos;t match {free.length === 1 ? "one medicine" : "some medicines"}, so we&apos;ll be extra careful and suggest checking with a pharmacist.
        </p>
      ) : null}

      {schema.none_label ? (
        <Chip value="none" selected={none} onClick={() => onChange(none ? { meds: [], free_text: [] } : { none: true })}>
          {schema.none_label}
        </Chip>
      ) : null}
    </div>
  );
}

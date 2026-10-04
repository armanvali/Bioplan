"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { PlanItem, ProductPick, ProductsResponse } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { LockedSection } from "./StackParts";

type Row = ProductsResponse["items"][number];

export function ProductRow({ row, item, planId, gated, onUnlock }: { row: Row; item?: PlanItem; planId: string; gated: boolean; onUnlock: () => void }) {
  const [showAlts, setShowAlts] = useState(false);
  const [showFiltered, setShowFiltered] = useState(false);
  if (!row.best) {
    return (
      <article className="card p-5">
        <h3 className="font-semibold">{item?.name ?? row.ingredient_id}</h3>
        <p className="mt-1 text-sm text-ink-3">No product in our catalog fits your filters right now. Any certified {item?.name.toLowerCase()} at this dose works.</p>
      </article>
    );
  }
  return (
    <article className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-5 py-2 text-sm text-ink-3">
        <span className="size-2.5 rounded-full" style={{ background: item?.color }} />
        {item?.name ?? row.ingredient_id}
      </div>
      <Pick pick={row.best} planId={planId} ingredientId={row.ingredient_id} best />
      {row.swapped ? (
        <p className="flex items-start gap-2 border-t border-line bg-amber-tint/60 px-5 py-2 text-sm text-amber-ink">
          <Icon name="swap" size={16} className="mt-0.5" /> {row.swapped.product.brand} {row.swapped.product.name} is out of stock, so we picked the next best.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-sm">
        <button onClick={() => (gated ? onUnlock() : setShowAlts((s) => !s))} className="inline-flex items-center gap-1 font-medium text-sage-ink">
          {gated ? <Icon name="lock" size={14} /> : null} Alternatives{!gated ? ` (${row.alternatives.length})` : ""}
        </button>
        {row.filtered.length ? (
          <button onClick={() => setShowFiltered((s) => !s)} className="text-ink-3 hover:text-ink">
            Why not others? ({row.filtered.length})
          </button>
        ) : null}
      </div>
      {showAlts && !gated ? (
        <div className="grid gap-px border-t border-line bg-line">
          {row.alternatives.map((p) => (
            <div key={p.product_id} className="bg-surface">
              <Pick pick={p} planId={planId} ingredientId={row.ingredient_id} />
            </div>
          ))}
        </div>
      ) : null}
      {gated && showAlts ? (
        <div className="p-4">
          <LockedSection title="All alternatives and why we picked each" onUnlock={onUnlock}>
            <p>Brand · 4.7★ · $0.30/day</p>
          </LockedSection>
        </div>
      ) : null}
      {showFiltered ? (
        <ul className="grid gap-1 border-t border-line bg-canvas/60 px-5 py-3 text-sm">
          {row.filtered.map((f) => (
            <li key={f.product.id}>
              <b className="font-medium">{f.product.brand} {f.product.name}</b> <span className="text-ink-3">— {f.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function Pick({ pick, planId, ingredientId, best }: { pick: ProductPick; planId: string; ingredientId: string; best?: boolean }) {
  const [busy, setBusy] = useState(false);
  const o = pick.offer;
  const go = async () => {
    // Open synchronously (popup blockers), then point it at the logged click.
    const w = window.open("about:blank", "_blank", "noopener");
    setBusy(true);
    try {
      const c = await api.click(planId, pick.product_id, ingredientId);
      if (w) w.location.href = c.url;
      else window.location.href = c.url;
    } catch {
      if (w) w.location.href = o.url;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {pick.brand} <span className="font-normal">{pick.name}</span>
        </p>
        <p className="mt-0.5 text-sm text-ink-3">
          {pick.rating ? `${pick.rating.toFixed(1)}★ (${pick.review_count.toLocaleString()})` : null} · {pick.form} · {money(pick.monthly_cost)}/mo
        </p>
        {pick.certs.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {pick.certs.map((c) => (
              <span key={c} className="rounded-full bg-sage-tint px-2 py-0.5 text-xs text-sage-ink">{c}</span>
            ))}
          </div>
        ) : null}
        {best && pick.why_this_product.length ? (
          <ul className="mt-2 grid gap-0.5 text-sm text-ink-2">
            {pick.why_this_product.map((w) => (
              <li key={w} className="flex items-start gap-1.5"><Icon name="check" size={14} className="mt-1 text-sage" />{w}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <button onClick={go} disabled={busy || !o.in_stock} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50">
          <Icon name="cart" size={16} /> {money(o.price_local, o.currency_local)} at {o.retailer_name}
        </button>
        <span className="text-[11px] text-ink-3">
          {o.price_stale ? "Price as of " : "Checked "}
          {new Date(o.price_as_of).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Field, Json, Loading, Modal, ReasonButton, Table, fmtDate, inputCls, statusTone } from "@/components/ui";
import { adminApi, can, useAuth } from "@/lib/api";
import { useAdmin, useAdminWrite } from "@/lib/hooks";

interface Product {
  id: string; brand: string; name: string; form: string; ingredients: { ingredient_id: string; amount: number; unit: string }[];
  certs: string[]; rating: number; review_count: number; active: boolean; certification_tier: number; certification_score: number; updated_at: string;
  offers: { retailer: string; price: number; currency: string; in_stock: boolean }[];
}

type Tab = "products" | "overrides" | "links" | "retailers" | "performance";

export default function CatalogPage() {
  const admin = useAuth((s) => s.admin);
  const [tab, setTab] = useState<Tab>("products");
  const [ingredient, setIngredient] = useState("");
  const products = useAdmin<{ products: Product[] }>("/catalog/products", { query: { ingredient: ingredient || undefined } });
  const overrides = useAdmin<{ overrides: { id: number; product_id: string; action: string; reason: string; expires_at: string | null; created_by: string }[] }>("/catalog/overrides", { enabled: tab === "overrides" });
  const links = useAdmin<{ checks: { product_id: string; retailer: string; status: string; detail: string | null; checked_at: string }[] }>("/catalog/link-health", { enabled: tab === "links" });
  const retailers = useAdmin<{ retailers: Record<string, unknown>[] }>("/catalog/retailers", { enabled: tab === "retailers" });
  const perf = useAdmin<{ days: number; by_retailer: Record<string, unknown>; by_product: Record<string, unknown> }>("/catalog/performance", { enabled: tab === "performance" });
  const write = useAdminWrite(({ path, method, body }: { path: string; method?: string; body?: unknown }) => adminApi(path, { method, body }));
  const [ov, setOv] = useState<{ product_id: string; action: string; expires_days: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);

  return (
    <Shell title="Catalog" scope="catalog.read">
      <div role="tablist" className="mb-4 flex flex-wrap gap-1">
        {(["products", "overrides", "links", "retailers", "performance"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-[13px] ${tab === t ? "bg-ink text-white" : "bg-surface text-ink-2 hover:bg-sunken"}`}>{t === "links" ? "Link health" : t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {write.error ? <div className="mb-3"><ErrorBox error={write.error} /></div> : null}

      {tab === "products" ? (
        <Card title={`Products (${products.data?.products.length ?? "…"})`} actions={<input value={ingredient} onChange={(e) => setIngredient(e.target.value)} placeholder="Filter by ingredient id" className={inputCls} aria-label="Ingredient filter" />}>
          {products.isLoading ? <Loading /> : (
            <Table
              rows={products.data?.products ?? []}
              rowKey={(p) => p.id}
              cols={[
                { key: "n", label: "Product", render: (p) => <span><b className="font-medium">{p.brand}</b> {p.name}<br /><span className="text-[11px] text-ink-3">{p.id} · {p.form} · {p.ingredients.map((i) => `${i.ingredient_id} ${i.amount}${i.unit}`).join(", ")}</span></span> },
                { key: "c", label: "Certification", render: (p) => <span>tier {p.certification_tier} <span className="text-ink-3">({p.certs.join(", ") || "none"})</span></span> },
                { key: "r", label: "Rating", render: (p) => `${p.rating}★ (${p.review_count.toLocaleString()})` },
                { key: "o", label: "Offers", render: (p) => p.offers.map((o) => `${o.retailer} ${o.price} ${o.currency}${o.in_stock ? "" : " (OOS)"}`).join(" · ") },
                { key: "a", label: "Active", render: (p) => <Badge tone={p.active ? "green" : "grey"}>{p.active ? "active" : "off"}</Badge> },
                {
                  key: "x", label: "", render: (p) => (
                    <div className="flex gap-1">
                      {can(admin, "catalog.write") ? <Button onClick={() => setEdit({ id: p.id, text: JSON.stringify({ ...p, active: undefined, certification_tier: undefined, certification_score: undefined, updated_at: undefined }, null, 2) })}>Edit</Button> : null}
                      {can(admin, "catalog.write") ? <ReasonButton label={p.active ? "Deactivate" : "Activate"} title={`${p.active ? "Deactivate" : "Activate"} ${p.name}`} onConfirm={(reason) => write.mutateAsync({ path: `/catalog/products/${p.id}/active`, body: { active: !p.active, reason } })} /> : null}
                      {can(admin, "catalog.overrides") ? <Button onClick={() => setOv({ product_id: p.id, action: "pin", expires_days: "" })}>Override</Button> : null}
                    </div>
                  ),
                },
              ]}
            />
          )}
          <p className="mt-3 text-[12px] text-ink-3">Ranking: 0.30 certification + 0.25 dose fit + 0.15 form fit + 0.15 rating (Bayesian) + 0.10 price + 0.05 editorial. Commission is never an input.</p>
        </Card>
      ) : null}

      {tab === "overrides" ? (
        <Card title="Overrides (pin, demote, ban)">
          {overrides.isLoading ? <Loading /> : (
            <Table rows={overrides.data?.overrides ?? []} rowKey={(o) => o.id} empty="No overrides."
              cols={[
                { key: "p", label: "Product", render: (o) => o.product_id },
                { key: "a", label: "Action", render: (o) => <Badge tone={o.action === "ban" ? "red" : o.action === "pin" ? "green" : "amber"}>{o.action}</Badge> },
                { key: "r", label: "Reason", render: (o) => o.reason },
                { key: "e", label: "Expires", render: (o) => fmtDate(o.expires_at) },
                { key: "x", label: "", render: (o) => can(admin, "catalog.overrides") ? <ReasonButton label="Remove" title="Remove override" onConfirm={(reason) => write.mutateAsync({ path: `/catalog/overrides/${o.id}`, method: "DELETE", body: { reason } })} /> : null },
              ]} />
          )}
        </Card>
      ) : null}

      {tab === "links" ? (
        <Card title="Link health" actions={can(admin, "catalog.write") ? <Button variant="primary" busy={write.isPending} onClick={() => write.mutate({ path: "/catalog/link-health/run", body: {} })}>Run check now</Button> : null}>
          {links.isLoading ? <Loading /> : (
            <Table rows={(links.data?.checks ?? []).filter((c) => c.status !== "ok")} rowKey={(c) => `${c.product_id}-${c.retailer}-${c.checked_at}`} empty="All links healthy (or no check has run yet)."
              cols={[
                { key: "p", label: "Product", render: (c) => c.product_id },
                { key: "r", label: "Retailer", render: (c) => c.retailer },
                { key: "s", label: "Status", render: (c) => <Badge tone={statusTone(c.status)}>{c.status}</Badge> },
                { key: "d", label: "Detail", render: (c) => c.detail },
                { key: "t", label: "Checked", render: (c) => fmtDate(c.checked_at) },
              ]} />
          )}
        </Card>
      ) : null}

      {tab === "retailers" ? (
        <Card title="Retailer programs">{retailers.isLoading ? <Loading /> : <Json value={retailers.data?.retailers} max={700} />}</Card>
      ) : null}
      {tab === "performance" ? (
        <Card title={`Clicks and conversions (last ${perf.data?.days ?? 30} days)`}>{perf.isLoading ? <Loading /> : <Json value={{ by_retailer: perf.data?.by_retailer, by_product: perf.data?.by_product }} max={700} />}</Card>
      ) : null}

      <Modal open={Boolean(ov)} onClose={() => setOv(null)} title={`Override ${ov?.product_id ?? ""}`}>
        {ov ? (
          <div className="grid gap-3">
            <Field label="Action"><select className={inputCls} value={ov.action} onChange={(e) => setOv({ ...ov, action: e.target.value })}><option value="pin">Pin (rank first when eligible)</option><option value="demote">Demote</option><option value="ban">Ban (never show)</option></select></Field>
            <Field label="Expires after (days, optional)"><input className={inputCls} value={ov.expires_days} onChange={(e) => setOv({ ...ov, expires_days: e.target.value })} /></Field>
            <p className="text-[12px] text-ink-3">Overrides never bypass safety: a pinned product still has to pass every hard filter.</p>
            <ReasonButton label="Save override" title="Reason for override" onConfirm={async (reason) => { await write.mutateAsync({ path: "/catalog/overrides", body: { product_id: ov.product_id, action: ov.action, reason, expires_days: ov.expires_days ? Number(ov.expires_days) : null } }); setOv(null); }} />
          </div>
        ) : null}
      </Modal>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={`Edit ${edit?.id ?? ""}`}>
        {edit ? (
          <div className="grid gap-3">
            <textarea value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={18} spellCheck={false} className="rounded-lg border border-line-2 p-3 font-mono text-[12px]" />
            <ReasonButton label="Save product" title="Reason for change" onConfirm={async (reason) => { await write.mutateAsync({ path: `/catalog/products/${edit.id}`, method: "PUT", body: { ...JSON.parse(edit.text), _reason: reason } }); setEdit(null); }} />
          </div>
        ) : null}
      </Modal>
    </Shell>
  );
}

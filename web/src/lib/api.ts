import { appState } from "./store";
import type {
  AnswerResponse, AnswerValue, BillingSummary, CheckoutResponse, ConsentState, DrugResult, Explanations, Impact, Meta,
  Offers, Plan, PrivacyHistory, ProductsResponse, Review, SavedPlan, Schedule, SessionCreated, SessionState, Step, User,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
  /** 402: the feature exists but the user's tier doesn't include it. */
  get isPaywall() {
    return this.status === 402;
  }
}

interface Opts {
  method?: string;
  body?: unknown;
  session?: string; // session id -> X-Session-Token
  plan?: string; // plan id -> X-Plan-Token
  query?: Record<string, string | number | undefined | null>;
  raw?: boolean;
}

function headersFor(o: Opts): Record<string, string> {
  const s = appState();
  const h: Record<string, string> = { Accept: "application/json" };
  if (o.body !== undefined) h["Content-Type"] = "application/json";
  if (s.accessToken) h.Authorization = `Bearer ${s.accessToken}`;
  if (o.session && s.sessionTokens[o.session]) h["X-Session-Token"] = s.sessionTokens[o.session];
  if (o.plan && s.planTokens[o.plan]) h["X-Plan-Token"] = s.planTokens[o.plan];
  return h;
}

function url(path: string, query?: Opts["query"]): string {
  const u = new URL(API_URL + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

export async function request<T>(path: string, o: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path, o.query), {
      method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
      headers: headersFor(o),
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "offline", "We couldn't reach StackSense. Check your connection and try again.");
  }
  if (!res.ok) {
    let err: { code?: string; message?: string; details?: Record<string, unknown> } = {};
    try {
      const j = await res.json();
      err = j.error ?? { message: typeof j.detail === "string" ? j.detail : undefined };
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && appState().accessToken && err.code === "no_user") appState().signOut();
    throw new ApiError(res.status, err.code ?? `http_${res.status}`, err.message ?? res.statusText, err.details ?? {});
  }
  if (o.raw) return res as unknown as T;
  return (await res.json()) as T;
}

/** Fetch a file that needs our auth headers, then hand it to the browser as a download. */
export async function download(path: string, filename: string, o: Opts = {}): Promise<void> {
  const res = await request<Response>(path, { ...o, raw: true });
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export const api = {
  meta: () => request<Meta>("/v1/meta"),

  intake: {
    create: (contextDate?: string) =>
      request<SessionCreated>("/v1/intake/sessions", { body: { locale: appState().locale, context_date: contextDate } }),
    get: (id: string) => request<SessionState>(`/v1/intake/sessions/${id}`, { session: id }),
    answer: (id: string, nodeId: string, value: AnswerValue) =>
      request<AnswerResponse>(`/v1/intake/sessions/${id}/answers`, { session: id, body: { node_id: nodeId, value } }),
    back: (id: string) => request<{ next: Step }>(`/v1/intake/sessions/${id}/back`, { session: id, method: "POST" }),
    acknowledge: (id: string, cardId: string) =>
      request<{ next: Step }>(`/v1/intake/sessions/${id}/stops/${cardId}/acknowledge`, { session: id, method: "POST" }),
    finish: (id: string) => request<{ next: Step }>(`/v1/intake/sessions/${id}/finish`, { session: id, method: "POST" }),
    review: (id: string) => request<Review>(`/v1/intake/sessions/${id}/review`, { session: id }),
    patchSignal: (id: string, signalId: string, action: "remove" | "restore" | "confirm") =>
      request<Review>(`/v1/intake/sessions/${id}/signals`, { session: id, method: "PATCH", body: { signal_id: signalId, action } }),
    addLabs: (id: string, labs: { analyte: string; value: number; unit?: string }[]) =>
      request<Review>(`/v1/intake/sessions/${id}/labs`, { session: id, body: { labs } }),
    freeText: (id: string, text: string) =>
      request<{ mappings: { signal_id: string; confidence: number; quote: string; needs_confirmation?: boolean }[]; source: string }>(
        `/v1/intake/sessions/${id}/free-text`, { session: id, body: { text } }),
    rephrase: (id: string, nodeId: string) =>
      request<{ prompt: string; helper: string; source: string }>(`/v1/intake/sessions/${id}/rephrase`, { session: id, body: { node_id: nodeId } }),
    drugs: (q: string) => request<{ results: DrugResult[] }>("/v1/intake/drugs", { query: { q } }),
  },

  plans: {
    build: (sessionId: string, startDate?: string) =>
      request<Plan>("/v1/plans", { session: sessionId, body: { session_id: sessionId, start_date: startDate } }),
    get: (id: string) => request<Plan>(`/v1/plans/${id}`, { plan: id }),
    impact: (id: string) => request<Impact>(`/v1/plans/${id}/impact`, { plan: id }),
    products: (id: string) => request<ProductsResponse>(`/v1/plans/${id}/products`, { plan: id }),
    schedule: (id: string, from: string, to: string, today?: string) =>
      request<Schedule>(`/v1/plans/${id}/schedule`, { plan: id, query: { from, to, today } }),
    explanations: (id: string) => request<Explanations>(`/v1/plans/${id}/explanations`, { plan: id }),
    calendarToken: (id: string) => request<{ url: string; webcal: string }>(`/v1/plans/${id}/calendar-token`, { plan: id, method: "POST" }),
    downloadIcs: (id: string) => download(`/v1/plans/${id}/calendar.ics`, "stacksense.ics", { plan: id }),
    downloadDoctorNote: (id: string) => download(`/v1/plans/${id}/doctor-note.pdf`, "stacksense-doctor-note.pdf", { plan: id }),
    addLabs: (id: string, labs: { analyte: string; value: number; unit?: string }[]) =>
      request<{ plan: Plan; plan_token: string; diff: unknown }>(`/v1/plans/${id}/labs`, { plan: id, body: { labs } }),
    logDose: (id: string, date: string, slot: string, status: "taken" | "skipped" | "late") =>
      request<{ date: string; slot: string; status: string }>(`/v1/plans/${id}/dose-logs`, { plan: id, body: { date, slot, status } }),
    checkin: (id: string, week: number, areaScores: Record<string, number>) =>
      request<unknown>(`/v1/plans/${id}/checkins`, { plan: id, body: { week, area_scores: areaScores, side_effects: [] } }),
    progress: (id: string) => request<{ reported: { week: number; area_scores: Record<string, number> }[]; projected: Record<string, number> }>(`/v1/plans/${id}/progress`, { plan: id }),
  },

  billing: {
    offers: (country?: string) => request<Offers>("/v1/billing/offers", { query: { country, anon_id: appState().anonId } }),
    checkout: (body: { plan_key: string; price_id: string; plan_id?: string | null; email?: string | null; promo?: string | null }) =>
      request<CheckoutResponse>("/v1/billing/checkout", { body }),
    completeFake: (checkoutId: string, email?: string) =>
      request<{ checkout_id: string; results: { user_id?: string; user_created?: boolean }[] }>(
        `/v1/billing/fake-checkout/${checkoutId}/complete`, { body: { email } }),
    portal: () => request<{ url: string }>("/v1/billing/portal", { method: "POST" }),
    cancel: () => request<{ subscription: string; cancel_at: string | null }>("/v1/billing/cancel", { method: "POST" }),
    summary: () => request<BillingSummary>("/v1/billing/summary"),
  },

  auth: {
    magicLink: (email: string, next?: string) => request<{ sent: boolean; dev_token?: string }>("/v1/auth/magic-link", { body: { email, next } }),
    verify: (token: string) => request<{ access_token: string; user: User; created: boolean; next: string | null }>("/v1/auth/verify", { body: { token } }),
  },

  me: {
    get: () => request<User>("/v1/me"),
    update: (body: Partial<Pick<User, "locale" | "tz" | "country">>) => request<User>("/v1/me", { method: "PATCH", body }),
    consents: () => request<{ purposes: ConsentState[] }>("/v1/me/consents"),
    setConsent: (purpose: string, granted: boolean) =>
      request<{ purposes: ConsentState[] }>(`/v1/me/consents/${purpose}`, { method: "PUT", body: { granted, method: "settings" } }),
    save: (body: { plan_id?: string; session_id?: string; profile_storage: boolean; personalisation?: boolean }) =>
      request<{ saved: boolean; note?: string }>("/v1/me/save", { body, plan: body.plan_id, session: body.session_id }),
    plans: () => request<{ plans: SavedPlan[] }>("/v1/me/plans"),
    privacyHistory: () => request<PrivacyHistory>("/v1/me/privacy/history"),
    exportJson: () => request<{ request_id: string; data: unknown }>("/v1/me/privacy/export", { method: "POST" }),
    exportPdf: () => download("/v1/me/privacy/export?format=pdf", "stacksense-export.pdf", { method: "POST" }),
    deleteAccount: () => request<{ deleted: boolean; kept: string[] }>("/v1/me/privacy/delete", { body: { confirm: true } }),
    pushSubscribe: (sub: PushSubscriptionJSON) =>
      request<{ ok: boolean; vapid_public_key: string | null }>("/v1/me/push-subscriptions", { body: { endpoint: sub.endpoint, keys: sub.keys } }),
  },

  click: (planId: string, productId: string, ingredientId?: string) =>
    request<{ click_id: string; url: string; retailer: string; go: string }>("/v1/clicks", {
      plan: planId, body: { plan_id: planId, product_id: productId, ingredient_id: ingredientId },
    }),

  event: (event: string, props: Record<string, string | number | boolean> = {}) =>
    request<{ ok: boolean }>("/v1/events", { body: { event, anon_id: appState().anonId, props } }).catch(() => undefined),
};

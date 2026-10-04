// Response shapes of the StackSense API (backend/stacksense/api/v1). Kept narrow on purpose:
// the client renders what the server returns and never derives doses or exclusions itself.

export type AreaId =
  | "sleep" | "energy" | "joints_recovery" | "mood_stress" | "performance" | "skin_hair" | "immunity" | "heart_metabolic";

export interface Area { id: AreaId; name: string; short: string; color: string; icon: string }
export interface Goal { id: string; label: string; area: AreaId; icon: string; word: string }

export interface ConsentPurposeMeta { key: string; label: string; text: string; if_withdrawn: string }

export interface Meta {
  rules_version: string;
  graph_version: string;
  areas: Area[];
  goals: Goal[];
  signals: Record<string, { label: string; tag: string; areas: AreaId[] }>;
  ingredients: Record<string, { name: string; short: string; sub?: string | null; color: string }>;
  labs: Record<string, { name: string; unit: string }>;
  consent: { policy_version: string; purposes: ConsentPurposeMeta[] };
  regions: Record<string, { id: string; label: string }[]>;
  disclaimer: string;
  affiliate_disclosure: string;
}

// ---------------------------------------------------------------- intake

export interface Option { id: string; label: string; icon?: string | null; sub?: string | null; level?: number | null; exclusive?: boolean; area?: AreaId }

export interface FollowField {
  key: string; when?: string | null; type: "chips" | "stepper" | "labs"; label: string;
  options: Option[]; min?: number | null; max?: number | null; step?: number | null; unit?: string | null; analytes: string[];
}

export interface FieldDef { key: string; type: string; label: string; options: Option[]; min?: number | null; max?: number | null; step?: number | null; unit?: string | null }

export type AnswerType =
  | "single" | "scale" | "multi" | "rank" | "time" | "energy_curve" | "body_map" | "pss4" | "meds"
  | "budget" | "pills" | "routine" | "training" | "demographics" | "free_text" | "number" | "confirm";

export interface AnswerSchema {
  type: AnswerType;
  options: Option[];
  allow_unsure: boolean;
  none_label?: string | null;
  max_picks?: number | null;
  min_picks?: number | null;
  follow: FollowField[];
  fields: FieldDef[];
  hours: number[];
  items: { q: string; reverse?: boolean }[];
  scale: string[];
  sources: string[];
  min?: number | null;
  max?: number | null;
  step?: number | null;
  default?: number | null;
  max_length?: number | null;
  spots?: Record<"front" | "back", Record<string, string>>;
  regions?: Record<string, { id: string; label: string }[]>;
}

export interface QuestionNode {
  id: string;
  phase: string;
  prompt: string;
  helper?: string | null;
  why: string;
  answer: AnswerSchema;
  optional?: boolean;
  required?: boolean;
  lab_entry?: boolean;
  previous?: AnswerValue;
}

export interface ConfirmNode {
  id: "R0_still_true";
  prompt: string;
  helper: string;
  why: string;
  answer: { type: "confirm" };
  items: { node_id: string; label: string; summary: string }[];
  lab_due: { analyte: string; name: string; unit: string; prompt: string }[];
}

export interface StopCardData {
  id: string;
  action: "stop" | "restrict";
  severity: "urgent" | "caution" | string;
  title: string;
  body: string;
  referral?: string | null;
  can_continue: boolean;
}

export interface Progress { answered: number; estimated_total: number; max_cards: number }

export type Step =
  | { kind: "node"; progress: Progress; node: QuestionNode }
  | { kind: "confirm"; progress: Progress; node: ConfirmNode }
  | { kind: "stop"; progress: Progress; card: StopCardData }
  | { kind: "review"; progress: Progress };

export type AnswerValue = Record<string, unknown>;

export interface SignalDelta { signal: string; p: number; from: number }
export interface Toast { text: string; key: string }
export interface ExclusionAdded { ingredient: string; name: string; reason: string; rule: string }

export interface SessionCreated {
  session_id: string; session_token: string; graph_version: string; rules_version: string;
  returning: boolean; next: Step; confidence: number;
}

export interface SessionState {
  session_id: string; status: string; step: Step; confidence: number;
  state: { answers: Record<string, AnswerValue>; order: string[]; stops: string[]; removed_signals: string[]; graph_version: string };
}

export interface AnswerResponse {
  next: Step; toast: Toast | null; signals_delta: SignalDelta[]; confidence: number; exclusions_added: ExclusionAdded[];
}

export interface SignalSource { node: string; text: string; lr: number; option?: string | null }

export interface ReviewSignal {
  id: string; label: string; tag: string; p: number; removed: boolean; confirmed: boolean;
  sources: SignalSource[]; lab: { analyte: string; name: string } | null; tip_only: boolean; areas: AreaId[];
}

export interface Review {
  groups: { area: AreaId | "safety"; signals: ReviewSignal[] }[];
  facts: { goals: string[]; diet?: string; medications: string[]; unknown_meds: string[]; conditions: string[]; allergies: string[]; pregnancy?: string };
  labs: Record<string, { value: number; unit?: string }>;
  stops: string[];
  confidence: number;
  unsure_count: number;
  cards_answered: number;
  preview: {
    stack: { ingredient_id: string; name: string; short: string }[];
    locked: string[];
    need: Record<AreaId, number>;
    monthly_cost: number;
    currency: string;
  };
}

export interface DrugResult { id: string; name: string; aliases: string[]; classes: string[]; blocks: { ingredient_id: string; name: string; text: string }[] }

// ---------------------------------------------------------------- plan

export type Dose = number | { locked: true; range: string };

export interface PlanItem {
  ingredient_id: string;
  name: string;
  short: string;
  sub?: string | null;
  color: string;
  dose: Dose;
  dose_label: string | null;
  dose_level: string | null;
  amount_text: string | null;
  unit: string;
  range: { min: number; max: number; unit: string } | null;
  frequency: string;
  frequency_text: string;
  weekdays: string[];
  cycle: { on_weeks: number; off_weeks: number } | null;
  delivery: { form: string; pills: number; scoops: number };
  with_food: boolean;
  cue: string;
  training_cue?: string | null;
  why: string[];
  why_sources: (SignalSource & { signal: string })[];
  evidence: { area: AreaId; c: number; claim_id: string; grade: string; summary: string; citations: string[] }[];
  evidence_grade: string;
  info: { does: string; how: string; interacts: string; research: string; side: string };
  monthly_cost: number;
  notes: string[];
  warnings: string[];
  group?: string | null;
  state: string;
}

export interface Excluded {
  ingredient_id: string; name: string; reason: string; short: string; kind: string; rule_code: string; rule_id?: string;
  source_node?: string | null; stage: string; considered_because: string[]; substituted_by?: string | null;
}

export interface Locked {
  ingredient_id: string; name: string; short: string; reason: string; considered_because: string[];
  sources: SignalSource[]; unlock?: { analyte: string; name: string; unit: string };
}

export interface Banner { id?: string; level?: string; title?: string; text: string }
export interface Spacing { a: string; b: string; hours: number; text?: string }

export interface PlanTotals {
  budget: number; busiest_day: string; currency: string; items: number; max_pills_day: number;
  monthly_cost: number; pill_limit: number; pills_by_weekday: number[]; scoops: number;
}

export interface Plan {
  plan_id: string;
  plan_token?: string;
  created_at: string;
  status: string;
  start_date: string;
  rules_version: string;
  graph_version: string;
  impact_version: string;
  catalog_snapshot_id: string;
  items: PlanItem[];
  excluded: Excluded[];
  locked: Locked[];
  warnings: (string | Banner)[];
  banners: Banner[];
  tips: { id: string; area: AreaId; title: string; text: string }[];
  spacing: Spacing[];
  drug_spacing: Spacing[];
  dropped: { ingredient_id: string; name: string; reason: string; reason_code: string; monthly_cost: number }[];
  trimmed: unknown[];
  suggestions: { type: string; ingredient_id: string; amount: number; text: string }[];
  totals: PlanTotals;
  low_confidence: boolean;
  need: Record<AreaId, number>;
  gated: string[];
  reason: string;
  parent_plan_id: string | null;
  audit_summary: { stages: string[]; records: number };
}

export interface ImpactContributor { ingredient: string; c?: number; claim?: string; grade?: string; share?: number; summary?: string; locked?: boolean }

export interface ImpactArea {
  area: AreaId;
  need?: number;
  projected?: number;
  coverage?: number | null;
  contributors?: ImpactContributor[];
  gap_reason?: { code: string; text?: string; ingredient?: string } | null;
  locked?: boolean;
}

export interface Impact {
  plan_id: string;
  areas: ImpactArea[];
  model_version?: string;
  onset_weeks?: Record<AreaId, [number, number]>;
  summary?: { areas_met: number; areas_with_need: number };
  aria_summary?: string;
  locked?: boolean;
}

export interface Offer {
  retailer: string; retailer_name: string; price: number; currency: string; price_local: number; currency_local: string;
  in_stock: boolean; url: string; price_as_of: string; price_stale: boolean; disclosure: string;
}

export interface ProductPick {
  product_id: string; brand: string; name: string; form: string; note?: string | null; certs: string[];
  rating: number; review_count: number; units_per_dose: number; doses_per_container: number; monthly_cost: number;
  score: number; score_breakdown: Record<string, number>; certification_tier: number; why_this_product: string[]; offer: Offer;
}

export interface ProductsResponse {
  plan_id: string;
  catalog_version: string;
  storefront: string;
  items: {
    ingredient_id: string;
    best: ProductPick | null;
    alternatives: ProductPick[];
    filtered: { product: { id: string; brand: string; name: string; form: string }; reason: string }[];
    swapped: { product: { id: string; brand: string; name: string }; reason: string } | null;
  }[];
  rank_steps: string[];
  disclosure: string;
  gated: string[];
}

export interface DayItem {
  ingredient_id: string; name: string; short: string; amount_text: string | null; dose_label: string | null;
  off: boolean; is_new: boolean; started_today: boolean; color: string; pills: number; scoops: number;
}

export interface DaySlot { id: string; label: string; minutes: number; items: DayItem[]; cues: string[] }
export interface DayTask { date: string; type: string; title: string; sub?: string; ingredient_id?: string; analyte?: string; link?: string }

export interface Day {
  date: string; index: number; weekday: string; training_day: boolean; slots: DaySlot[]; tasks: DayTask[];
  pills: number; scoops: number; logged: Record<string, string>;
}

export interface Schedule {
  plan_id: string;
  from: string;
  to: string;
  days: Day[];
  locked_after: string | null;
  calendar_days: number;
  refills: { ingredient_id: string; runout: string; remind_on: string; product_id: string; link: string }[];
  spacing_notes: string[];
  slots: Record<string, { label: string; minutes: number }>;
  tz: string;
  start_date: string;
  streak: number;
}

export interface Explanations {
  items: Record<string, { why_you: string; what_it_does: string; evidence_summary: string; source: string }>;
  disclaimer?: string;
  source?: string;
}

// ---------------------------------------------------------------- billing + account

export interface Price { id: string; currency: string; region: string; amount: number; interval: string | null }

export interface BillingPlan {
  key: string; name: string; kind: "free" | "one_time" | "subscription"; features: string[];
  limits: Record<string, number>; trial_days: number; prices: Price[];
}

export interface Offers {
  region: string;
  currency: string;
  plans: BillingPlan[];
  paywall: { version?: string; gates: Record<string, unknown>; triggers: Record<string, unknown>; copy: Record<string, string> };
  experiments: { key: string; variant: string }[];
}

export interface CheckoutResponse {
  checkout_id: string; url: string; mode: "fake" | "stripe";
  price: Price; plan: { key: string; name: string; kind: string; trial_days: number };
}

export interface User {
  id: string; email: string; email_masked: string; locale: string; tz: string; country: string | null;
  has_profile: boolean; created_at: string; tier?: string; entitlements?: string[]; limits?: Record<string, number>;
}

export interface ConsentState {
  purpose: string; label: string; text: string; granted: boolean; policy_version: string;
  updated_at: string | null; method: string | null; if_withdrawn: string; asked_when: string;
}

export interface BillingSummary {
  tier: string; features: string[]; limits: Record<string, number>;
  purchases: { id: string; plan_key: string; amount: number; currency: string; status: string; created_at: string }[];
  subscriptions: { id: string; plan_key: string; status: string; current_period_end: string | null; trial_end: string | null; cancel_at: string | null }[];
}

export interface PrivacyHistory {
  consents: { purpose: string; granted: boolean; method: string; actor: string; policy_version: string; ts: string }[];
  staff_access: { role: string; reason: string; scope: string; ts: string }[];
}

export interface SavedPlan {
  id: string; status: string; created_at: string; items: string[]; locked: string[]; monthly_cost: number; reason: string; rules_version: string;
}

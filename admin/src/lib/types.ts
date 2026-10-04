export interface Release {
  id: string;
  kind: "rules" | "graph";
  version: string;
  base_version: string;
  status: "draft" | "checks_failed" | "checks_passed" | "in_review" | "approved" | "rejected" | "published" | "rolled_back";
  author: string;
  reviewer: string | null;
  rollout_pct: number;
  notes: string | null;
  check_report: CheckReport | Record<string, never>;
  created_at: string;
  published_at: string | null;
  data?: Record<string, unknown>;
}

export interface CheckReport {
  ran_at: string;
  passed: boolean;
  knowledge?: string[];
  graph?: { errors: string[]; warnings: string[] };
  personas?: { passed: boolean; results: { persona: string; passed: boolean; problems: string[]; stack: string[]; cards: number }[] };
  unreviewed_rows?: number;
  schema?: unknown;
}

export interface PlanDiff {
  from_version: string; to_version: string; added: string[]; removed: string[];
  dose_changes: { ingredient_id: string; from: string; to: string }[];
  exclusions_added: string[]; exclusions_removed: string[]; locks_added: string[]; locks_removed: string[]; cost_change: number; changed: boolean;
}

export interface SimBrief {
  asked: string[]; stops: string[]; terminal_stop: string | null;
  stack: { ingredient_id: string; dose: string | null; frequency: string }[];
  excluded: { ingredient_id: string; reason: string }[];
  locked: string[];
  monthly_cost: number | null;
}

export interface Dashboards {
  days: number;
  funnel: Record<string, number>;
  mrr: number; arpu: number; churn_rate: number; trial_conversion: number | null; refund_rate: number;
  one_time_revenue: number; affiliate_revenue: number; revenue_per_completed_intake: number; active_subscriptions: number;
}

export interface UserCard {
  id: string; email_masked: string; status: string; tier: string; plan_status: string | null; subscription: string | null;
  consents: Record<string, boolean>; last_active_at: string | null; created_at: string;
}

export interface UserRecord extends UserCard {
  health_profile: { masked: boolean; stable_facts: Record<string, string>; labs: unknown[]; plans: unknown[]; sessions: unknown[] } | null;
  entitlements: { id: number; feature: string; source: string; source_id: string; granted_at: string; expires_at: string | null; revoked_at: string | null }[];
  plans: { id: string; status: string; rules_version: string; created_at: string; items: string[] }[];
  purchases: { id: string; plan_key: string; amount: number; currency: string; status: string; created_at: string; refunded_at: string | null }[];
}

export interface AuditRecord {
  id: number; actor: string; role: string; action: string; target_type: string; target_id: string | null;
  before: unknown; after: unknown; reason: string | null; ts: string;
}

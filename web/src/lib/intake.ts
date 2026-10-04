// Client-side helpers for answer cards: sensible starting values and "can I press Continue?"
// checks. The server validates every answer again; these only keep the UI honest.

import type { AnswerSchema, AnswerValue, FollowField, QuestionNode } from "./types";

export function initialValue(node: QuestionNode): AnswerValue {
  if (node.previous && !node.previous.unsure) return { ...node.previous };
  const a = node.answer;
  switch (a.type) {
    case "multi":
      return { picks: [] };
    case "rank":
      return { ranked: [] };
    case "time":
      return { minutes: 15 * 60 };
    case "energy_curve":
      return { points: (a.hours.length ? a.hours : [6, 8, 10, 12, 14, 16, 18, 20, 22]).map(() => 5) };
    case "body_map":
      return { spots: [], side: "front" };
    case "pss4":
      return { items: a.items.map(() => null), source: null };
    case "meds":
      return { meds: [], free_text: [] };
    case "budget":
      return { amount: a.default ?? 80 };
    case "pills":
      return { max: a.default ?? 6, powders: true };
    case "routine":
      return { wake: 420, breakfast: 450, lunch: 750, dinner: 1140, bed: 1380, training_days: [], tz: browserTz() };
    case "training":
      return { sessions: 3, km: 0, event: null };
    case "demographics":
      return { age: null, sex: null, country: guessCountry(), region: null };
    case "free_text":
      return { text: "" };
    case "number":
      return { value: a.min ?? 0 };
    default:
      return {};
  }
}

// Server answers carry derived fields (summary, count ...). Only the raw input goes back.
const RAW_KEYS: Record<string, string[]> = {
  single: ["choice"], scale: ["choice"], multi: ["picks"], rank: ["ranked"], time: ["minutes", "none"],
  energy_curve: ["points"], body_map: ["spots", "side", "none"], pss4: ["items", "source"], meds: ["meds", "free_text", "none"],
  budget: ["amount"], pills: ["max", "powders"], routine: ["wake", "breakfast", "lunch", "dinner", "bed", "training_days", "tz"],
  training: ["sessions", "km", "event"], demographics: ["age", "sex", "country", "region", "latitude"], free_text: ["text", "skip"], number: ["value"],
};

export function rawAnswer(schema: AnswerSchema, value: AnswerValue): AnswerValue {
  const keep = new Set([...(RAW_KEYS[schema.type] ?? Object.keys(value)), ...schema.follow.map((f) => f.key)]);
  const out: AnswerValue = {};
  for (const [k, v] of Object.entries(value)) if (keep.has(k) && v !== undefined) out[k] = v;
  if (schema.type === "meds" && !out.none) {
    // "free_text" is the list of medicines we couldn't match, not a sentence.
    out.free_text = (out.free_text as string[] | undefined)?.filter((x) => x.trim()) ?? [];
  }
  return out;
}

/** Evaluate the tiny subset of the expression language that follow-up `when`s use. */
export function followVisible(f: FollowField, value: AnswerValue): boolean {
  if (!f.when) return true;
  const inList = /^answer\.(\w+)\s+in\s+\[(.*)\]$/.exec(f.when.trim());
  if (inList) {
    const items = inList[2].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    return items.includes(String(value[inList[1]] ?? ""));
  }
  const eq = /^answer\.(\w+)\s*==\s*['"](.+)['"]$/.exec(f.when.trim());
  if (eq) return String(value[eq[1]] ?? "") === eq[2];
  const contains = /^answer\.(\w+)\s+contains\s+['"](.+)['"]$/.exec(f.when.trim());
  if (contains) return Array.isArray(value[contains[1]]) && (value[contains[1]] as unknown[]).includes(contains[2]);
  return true;
}

export function canSubmit(schema: AnswerSchema, v: AnswerValue): boolean {
  switch (schema.type) {
    case "single":
    case "scale":
      return typeof v.choice === "string";
    case "multi":
      return Array.isArray(v.picks) && v.picks.length > 0;
    case "rank":
      return Array.isArray(v.ranked) && v.ranked.length >= (schema.min_picks ?? 1);
    case "time":
      return Boolean(v.none) || typeof v.minutes === "number";
    case "body_map":
      return Boolean(v.none) || (Array.isArray(v.spots) && v.spots.length > 0);
    case "pss4":
      return Array.isArray(v.items) && v.items.every((x) => typeof x === "number");
    case "meds":
      return Boolean(v.none) || (Array.isArray(v.meds) && v.meds.length > 0) || (Array.isArray(v.free_text) && v.free_text.some((x) => String(x).trim()));
    case "demographics":
      return typeof v.age === "number" && v.age >= 13 && typeof v.sex === "string" && typeof v.country === "string";
    case "routine":
      return ["wake", "breakfast", "lunch", "dinner", "bed"].every((k) => typeof v[k] === "number");
    case "training": {
      const ev = v.event as { type?: string; date?: string } | null | undefined;
      return !ev || /^\d{4}-\d{2}-\d{2}$/.test(ev.date ?? "");
    }
    default:
      return true;
  }
}

export function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
}

function guessCountry(): string | null {
  const tz = browserTz();
  if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Whitehorse|Yellowknife|Iqaluit)/.test(tz)) return "CA";
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise)|^Pacific\/Honolulu/.test(tz)) return "US";
  return null;
}

export const PHASE_LABELS: Record<string, string> = {
  about: "About you", follow_signals: "Following up", safety: "Safety check", preferences: "Your preferences", confirm: "Welcome back",
};

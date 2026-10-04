import { describe, expect, it } from "vitest";
import { addDays, cents, money, parseHHMM, time12, toHHMM } from "./format";
import { translate } from "./i18n";
import { canSubmit, followVisible, initialValue, rawAnswer } from "./intake";
import type { AnswerSchema, FollowField, QuestionNode } from "./types";

const schema = (over: Partial<AnswerSchema>): AnswerSchema => ({
  type: "single", options: [], allow_unsure: false, follow: [], fields: [], hours: [], items: [], scale: [], sources: [], ...over,
});

describe("format", () => {
  it("formats money and cents", () => {
    expect(money(77.64, "CAD")).toBe("$77.64");
    expect(cents(999, "CAD")).toBe("$9.99");
    expect(money(80, "USD", "en-US")).toBe("$80");
  });
  it("round-trips clock times", () => {
    expect(time12(450)).toBe("7:30 am");
    expect(time12(1290)).toBe("9:30 pm");
    expect(time12(0)).toBe("12:00 am");
    expect(parseHHMM("21:30")).toBe(1290);
    expect(parseHHMM("25:00")).toBeNull();
    expect(toHHMM(1290)).toBe("21:30");
  });
  it("adds days across month ends without timezone drift", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2027-03-14", 1)).toBe("2027-03-15"); // DST weekend in North America
  });
});

describe("intake helpers", () => {
  it("only lets Continue through when the answer is complete", () => {
    expect(canSubmit(schema({ type: "single" }), {})).toBe(false);
    expect(canSubmit(schema({ type: "single" }), { choice: "vegan" })).toBe(true);
    expect(canSubmit(schema({ type: "multi" }), { picks: [] })).toBe(false);
    expect(canSubmit(schema({ type: "rank", min_picks: 1 }), { ranked: ["sleep"] })).toBe(true);
    expect(canSubmit(schema({ type: "pss4", items: [{ q: "a" }, { q: "b" }] }), { items: [1, null] })).toBe(false);
    expect(canSubmit(schema({ type: "training" }), { sessions: 3, event: { type: "half", date: "" } })).toBe(false);
    expect(canSubmit(schema({ type: "training" }), { sessions: 3, event: { type: "half", date: "2026-12-13" } })).toBe(true);
    expect(canSubmit(schema({ type: "demographics" }), { age: 34, sex: "female", country: "CA" })).toBe(true);
    expect(canSubmit(schema({ type: "demographics" }), { age: 9, sex: "female", country: "CA" })).toBe(false);
  });

  it("evaluates follow-up conditions from the graph", () => {
    const years: FollowField = { key: "years", when: "answer.choice in ['vegetarian', 'vegan']", type: "stepper", label: "", options: [], analytes: [] };
    expect(followVisible(years, { choice: "vegan" })).toBe(true);
    expect(followVisible(years, { choice: "meat" })).toBe(false);
    const labs: FollowField = { key: "labs", when: "answer.choice == 'yes'", type: "labs", label: "", options: [], analytes: [] };
    expect(followVisible(labs, { choice: "yes" })).toBe(true);
    const legs: FollowField = { key: "legs_freq", when: "answer.picks contains 'legs'", type: "chips", label: "", options: [], analytes: [] };
    expect(followVisible(legs, { picks: ["racing", "legs"] })).toBe(true);
  });

  it("sends only raw input back, never derived fields", () => {
    const s = schema({ type: "single", follow: [{ key: "years", type: "stepper", label: "", options: [], analytes: [] }] });
    expect(rawAnswer(s, { choice: "vegetarian", years: 6, summary: "Vegetarian", label: "x" })).toEqual({ choice: "vegetarian", years: 6 });
    expect(rawAnswer(schema({ type: "meds" }), { meds: ["coc"], free_text: ["", " "], names: ["x"] })).toEqual({ meds: ["coc"], free_text: [] });
  });

  it("starts from the saved answer for returning users", () => {
    const node = { id: "D1_budget", phase: "preferences", prompt: "", why: "", answer: schema({ type: "budget", default: 80 }), previous: { amount: 120 } } as QuestionNode;
    expect(initialValue(node)).toEqual({ amount: 120 });
    expect(initialValue({ ...node, previous: undefined })).toEqual({ amount: 80 });
  });
});

describe("i18n", () => {
  it("falls back to English and fills variables", () => {
    expect(translate("fr-CA", "cta.continue")).toBe("Continuer");
    expect(translate("fr-CA", "intake.finishEarly")).toContain("results");
    expect(translate("en", "intake.questionOf", { n: 3, total: 18 })).toBe("Question 3 of about 18");
  });
});

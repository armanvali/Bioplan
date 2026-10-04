import { expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Persona {
  id: string;
  name: string;
  context_date?: string;
  answers: Record<string, Record<string, unknown>>;
  expect: Record<string, unknown>;
}

const PERSONA_DIR = join(__dirname, "..", "..", "backend", "stacksense", "data", "personas");

export function persona(id: string): Persona {
  return JSON.parse(readFileSync(join(PERSONA_DIR, `${id}.json`), "utf8")) as Persona;
}

// What to type in the medicine search to find each catalogued drug.
const MED_QUERY: Record<string, string> = { coc: "birth control" };

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function setStepper(card: Locator, field: string, target: number) {
  const group = card.locator(`[data-stepper="${field}"]`);
  for (let i = 0; i < 80; i++) {
    const v = Number(await group.getAttribute("data-value"));
    if (v === target) return;
    await group.getByRole("button").nth(v < target ? 1 : 0).click();
  }
  throw new Error(`stepper ${field} never reached ${target}`);
}

async function fillRange(input: Locator, value: number) {
  await input.fill(String(value));
}

/** Answer whatever card is on screen using the persona's answer for that node. */
export async function answerCurrent(page: Page, p: Persona): Promise<string> {
  const card = page.locator("[data-node-id]");
  await expect(card).toBeVisible();
  const nodeId = (await card.getAttribute("data-node-id"))!;
  const v = p.answers[nodeId];
  if (!v) throw new Error(`${p.id} has no answer for ${nodeId}`);

  if (v.unsure) {
    await card.getByRole("button", { name: "Not sure" }).click();
    return nodeId;
  }
  if (v.skip) {
    await card.getByRole("button", { name: "Skip" }).click();
    return nodeId;
  }
  if (v.none) await card.locator('[data-option="none"]').click();

  const handled = new Set(["none", "side", "tz"]);
  const click = (sel: string) => card.locator(sel).first().click();

  if (typeof v.choice === "string") { await click(`[data-option="${v.choice}"]`); handled.add("choice"); }
  for (const id of (v.picks as string[]) ?? []) await click(`[data-option="${id}"]`);
  for (const id of (v.ranked as string[]) ?? []) await click(`[data-option="${id}"]`);
  handled.add("picks").add("ranked");
  if (typeof v.minutes === "number") { await card.locator('input[type="time"]').fill(hhmm(v.minutes)); handled.add("minutes"); }
  if (Array.isArray(v.points)) {
    const inputs = card.locator('input[type="range"][data-hour]');
    for (let i = 0; i < v.points.length; i++) await fillRange(inputs.nth(i), v.points[i] as number);
    handled.add("points");
  }
  if (Array.isArray(v.spots)) { for (const s of v.spots as string[]) await click(`button[data-option="${s}"]`); handled.add("spots"); }
  if (Array.isArray(v.items)) {
    for (let i = 0; i < v.items.length; i++) await click(`[data-item="${i}"][data-value="${v.items[i]}"]`);
    handled.add("items");
  }
  if (typeof v.source === "string") { await click(`[data-field="source"][data-option="${v.source}"]`); handled.add("source"); }
  if (Array.isArray(v.meds)) {
    for (const m of v.meds as string[]) {
      await card.getByRole("searchbox").fill(MED_QUERY[m] ?? m);
      await card.locator(`#med-results [data-option="${m}"]`).click();
    }
    handled.add("meds");
  }
  if (typeof v.amount === "number") { await fillRange(card.locator('input[type="range"]'), v.amount); handled.add("amount"); }
  if (typeof v.max === "number") { await setStepper(card, "max", v.max); handled.add("max"); }
  if (typeof v.powders === "boolean") { await click(`[data-option="${v.powders ? "powders" : "no_powders"}"]`); handled.add("powders"); }
  for (const k of ["wake", "breakfast", "lunch", "dinner", "bed"]) {
    if (typeof v[k] === "number") { await card.locator(`input[data-field="${k}"]`).fill(hhmm(v[k] as number)); handled.add(k); }
  }
  if (Array.isArray(v.training_days)) { for (const d of v.training_days as string[]) await click(`[data-field="training_days"][data-option="${d}"]`); handled.add("training_days"); }
  if (typeof v.sessions === "number") { await setStepper(card, "sessions", v.sessions); handled.add("sessions"); }
  if (typeof v.km === "number") { await setStepper(card, "km", v.km); handled.add("km"); }
  if ("event" in v) {
    const ev = v.event as { type: string; date: string } | null;
    if (ev) {
      await click(`[data-field="event"][data-option="${ev.type}"]`);
      await card.locator('input[data-field="event_date"]').fill(ev.date);
    }
    handled.add("event");
  }
  if (typeof v.age === "number") { await card.locator('input[data-field="age"]').fill(String(v.age)); handled.add("age"); }
  if (typeof v.sex === "string") { await click(`[data-field="sex"][data-option="${v.sex}"]`); handled.add("sex"); }
  if (typeof v.country === "string") { await click(`[data-field="country"][data-option="${v.country}"]`); handled.add("country"); }
  if (typeof v.region === "string") { await card.locator('select[data-field="region"]').selectOption(v.region); handled.add("region"); }

  // Remaining keys are follow-up fields inside the card (chips or steppers).
  for (const [k, val] of Object.entries(v)) {
    if (handled.has(k)) continue;
    if (typeof val === "number") await setStepper(card, k, val);
    else if (typeof val === "string") await click(`[data-field="${k}"][data-option="${val}"]`);
  }
  await card.getByRole("button", { name: "Continue" }).click();
  return nodeId;
}

/** Resolve once the card on screen is no longer `before` (next card, a stop card or the review page). */
export async function waitForNextStep(page: Page, before: string | null) {
  await expect
    .poll(async () => {
      if (page.url().endsWith("/review")) return true;
      if (await page.locator("#stop-title").count()) return true;
      const ids = await page.locator("[data-node-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-node-id")));
      return ids.length > 0 && ids[0] !== before;
    })
    .toBe(true);
}

/** Answer cards until the review screen. Returns the node ids in the order asked. */
export async function runIntake(page: Page, p: Persona): Promise<string[]> {
  await page.goto(`/start?date=${p.context_date ?? "2026-10-04"}`);
  const asked: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.waitForURL(/\/intake\/ses_[a-z0-9]+(\/review)?$/);
    if (page.url().endsWith("/review")) return asked;
    const stop = page.locator("#stop-title");
    const card = page.locator("[data-node-id]");
    await expect(card.or(stop).first()).toBeVisible();
    if (await stop.isVisible()) {
      const cont = page.getByRole("button", { name: "I understand, continue" });
      if (await cont.isVisible()) { await cont.click(); continue; }
      return asked; // terminal stop
    }
    const before = await card.getAttribute("data-node-id");
    asked.push(await answerCurrent(page, p));
    await waitForNextStep(page, before);
  }
  throw new Error("intake did not finish in 40 cards");
}

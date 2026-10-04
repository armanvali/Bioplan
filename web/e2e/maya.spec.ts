import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { answerCurrent, persona, runIntake, waitForNextStep } from "./helpers";

// Maya's path from the spec: restless legs -> iron path, vegetarian -> collagen excluded,
// birth control -> St John's wort blocked. Then the free plan, a Full Report purchase and the calendar.
test("Maya: intake, free plan, Full Report, calendar", async ({ page }) => {
  const maya = persona("maya");
  const asked = await runIntake(page, maya);
  expect(asked[0]).toBe("A0_about");
  expect(asked.length).toBeLessThanOrEqual(30);

  // "Here's what we heard"
  await expect(page.getByRole("heading", { name: "Here's what we heard" })).toBeVisible();
  await expect(page.getByText("Iron bisglycinate (needs a blood test)")).toBeVisible();
  await page.getByRole("button", { name: "Build my plan" }).click();

  // Free plan: names and safety visible, exact doses locked.
  await page.waitForURL(/\/plan\/pl_[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: /7 supplements, picked for you/ })).toBeVisible();
  await expect(page.getByText(/left out on purpose/)).toBeVisible();
  await page.getByText(/left out on purpose/).click();
  await expect(page.getByRole("dialog").getByText("St John's wort")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Collagen peptides")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Your stack" }).click();
  await expect(page.getByText(/exact dose in the Full Report/).first()).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).disableRules(["color-contrast"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // Buy the Full Report (fake Stripe in dev), sign in with the dev magic link.
  await page.getByRole("button", { name: "Unlock" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Email for your receipt and sign-in link").fill(`maya+${Date.now()}@example.com`);
  await sheet.getByRole("button", { name: /Full Report/ }).click();
  await page.waitForURL(/\/checkout\/fake/);
  await page.getByRole("button", { name: "Pay (test mode)" }).click();
  await page.waitForURL(/\/checkout\/success/);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("button", { name: "Dev mode: sign in now" }).click();
  await page.getByRole("link", { name: "See my full plan" }).click();

  await page.getByRole("tab", { name: "Your stack" }).click();
  await expect(page.getByText("600 mg").first()).toBeVisible();
  await expect(page.getByText(/exact dose in the Full Report/)).toHaveCount(0);

  // Calendar: Maya's moments on a full day of the plan.
  await page.getByRole("link", { name: "Calendar" }).first().click();
  await page.waitForURL(/\/calendar$/);
  // Day 15 (a Monday): ramp-up is over, so every moment is in use.
  await page.goto(page.url() + "?date=2026-10-19");
  await expect(page.getByRole("heading", { name: "Monday, October 19" })).toBeVisible();
  for (const slot of ["Breakfast", "Dinner", "Wind-down"]) await expect(page.getByRole("heading", { name: new RegExp(`^${slot}`) })).toBeVisible();
});

test("Teo (16): stopped before any plan", async ({ page }) => {
  await runIntake(page, persona("teo_teen"));
  await expect(page.locator("#stop-title")).toBeVisible();
  await expect(page.getByRole("button", { name: "I understand, continue" })).toHaveCount(0);
});

test("Sam on sertraline: St John's wort blocked as soon as the medicine is picked", async ({ page }) => {
  const sam = persona("sam_ssri");
  await page.goto(`/start?date=${sam.context_date ?? "2026-10-04"}`);
  await page.waitForURL(/\/intake\//);
  // The live interaction check shows in the medicine card itself.
  for (let i = 0; i < 30; i++) {
    const card = page.locator("[data-node-id]");
    await expect(card).toBeVisible();
    if ((await card.getAttribute("data-node-id")) === "C1_medications") {
      await card.getByRole("searchbox").fill("zol");
      await card.locator('#med-results [data-option="sertraline"]').click();
      await expect(card.getByText(/St John's wort/)).toBeVisible();
      return;
    }
    const before = await card.getAttribute("data-node-id");
    await answerCurrent(page, sam);
    await waitForNextStep(page, before);
    if (await page.locator("#stop-title").isVisible()) await page.getByRole("button", { name: "I understand, continue" }).click();
  }
  throw new Error("never reached the medicine card");
});

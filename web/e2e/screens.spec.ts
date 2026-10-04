import { expect, test } from "@playwright/test";
import { answerCurrent, persona, waitForNextStep } from "./helpers";

// Not part of CI: `SHOTS_DIR=... npx playwright test screens` captures key screens for design review.
test.skip(!process.env.SHOTS_DIR, "set SHOTS_DIR to capture screenshots");

test("screens", async ({ page }, info) => {
  const dir = `${process.env.SHOTS_DIR}/${info.project.name}`;
  const shot = (n: string) => page.screenshot({ path: `${dir}/${n}.png`, fullPage: true });
  await page.goto("/");
  await shot("01-home");
  const maya = persona("maya");
  await page.goto("/start?date=2026-10-04");
  await page.waitForURL(/\/intake\//);
  const want = new Set(["A1_goals", "B3_diet", "B1_energy_curve", "B8_body_map", "C1_medications", "D3_routine"]);
  for (let i = 0; i < 40 && !page.url().endsWith("/review"); i++) {
    const card = page.locator("[data-node-id]");
    await expect(card).toBeVisible();
    const id = (await card.getAttribute("data-node-id"))!;
    if (want.has(id)) await shot(`02-${id}`);
    await answerCurrent(page, maya);
    await waitForNextStep(page, id);
  }
  await page.waitForURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "Here's what we heard" })).toBeVisible();
  await shot("03-review");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.waitForURL(/\/plan\/pl_/);
  await expect(page.getByRole("heading", { name: /picked for you/ })).toBeVisible();
  await page.waitForTimeout(600);
  await shot("04-plan-impact");
  await page.getByRole("tab", { name: "Your stack" }).click();
  await shot("05-plan-stack");
  await page.getByRole("tab", { name: "Buy list" }).click();
  await page.waitForTimeout(400);
  await shot("06-plan-buy");
  await page.getByRole("button", { name: "Unlock" }).first().click();
  await page.waitForTimeout(400);
  await shot("07-paywall");
  await page.keyboard.press("Escape");
  await page.goto(page.url() + "/calendar?date=2026-10-08");
  await expect(page.getByRole("heading", { name: /October 8/ })).toBeVisible();
  await shot("08-calendar-day");
  await page.getByRole("tab", { name: "Month" }).click();
  await shot("09-calendar-month");
});

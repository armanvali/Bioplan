import { expect, test, type Page } from "@playwright/test";

// The staff console (admin/) on its own origin. Section 15: roles see only their scopes;
// a release needs automated checks and a reviewer who isn't the author before it ships.
const ADMIN = process.env.ADMIN_BASE_URL ?? "http://localhost:3001";

async function signIn(page: Page, who: string) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Work email").fill(`${who}@stacksense.dev`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Hello/ })).toBeVisible();
}

test("clinical release: editor drafts, checks and submits; pharmacist approves and publishes", async ({ browser }) => {
  const editor = await (await browser.newContext()).newPage();
  await signIn(editor, "editor");
  await editor.getByRole("link", { name: "Engine releases" }).click();
  await editor.getByRole("button", { name: "New draft" }).click();
  await editor.getByRole("dialog").getByRole("textbox").fill("Add a screen-light tip");
  await editor.getByRole("button", { name: "Create from live" }).click();
  await editor.waitForURL(/\/engine\/rel_/);
  const releaseUrl = editor.url();

  await editor.getByRole("button", { name: "Edit rows" }).click();
  const dialog = editor.getByRole("dialog");
  await dialog.getByLabel("Table").selectOption("tips");
  await dialog.getByLabel("Row", { exact: true }).selectOption("__new__");
  await dialog.getByLabel("Row JSON").fill(JSON.stringify({
    id: `tip_e2e_${Date.now()}`, area: "sleep", when: "signals.sleep_onset >= 0.6", title: "Dim screens after 10 pm",
    text: "Bright light late in the evening delays sleep onset.", source: "Chang et al., PNAS 2015",
  }));
  await dialog.getByLabel("Why").fill("E2E: evidence review");
  await dialog.getByRole("button", { name: "Save row" }).click();
  await expect(dialog).toHaveCount(0);

  await editor.getByRole("button", { name: "Run automated checks" }).click();
  await expect(editor.getByText(/Automated checks · passed/)).toBeVisible({ timeout: 60_000 });
  await editor.getByRole("button", { name: "Submit for clinical review" }).click();
  await expect(editor.getByText("in_review").first()).toBeVisible();
  // Editors can't approve, least of all their own work.
  await expect(editor.getByRole("button", { name: "Approve" })).toHaveCount(0);

  const pharmacist = await (await browser.newContext()).newPage();
  await signIn(pharmacist, "pharmacist");
  await pharmacist.goto(releaseUrl);
  await pharmacist.getByLabel("Review notes").fill("Citation checked");
  await pharmacist.getByRole("button", { name: "Approve" }).click();
  await expect(pharmacist.getByRole("button", { name: "Publish" })).toBeVisible();
  await pharmacist.getByRole("button", { name: "Publish" }).click();
  await expect(pharmacist.getByRole("button", { name: "Roll back" })).toBeVisible();

  // Roll back so the shared dev database keeps the seed rules live.
  await pharmacist.getByRole("button", { name: "Roll back" }).click();
  await pharmacist.getByRole("dialog").getByLabel(/Reason/).fill("E2E cleanup after publish");
  await pharmacist.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(pharmacist.getByText("rolled_back").first()).toBeVisible();
});

test("roles only see their own sections", async ({ page }) => {
  await signIn(page, "support");
  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link", { name: "Users" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Engine releases" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Revenue" })).toHaveCount(0);
  await page.goto(`${ADMIN}/engine`);
  await expect(page.getByText(/doesn.t include/)).toBeVisible();
  await page.goto(`${ADMIN}/users`);
  await page.getByLabel("Search users").fill("nobody@example.com");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No account matches.")).toBeVisible();
});

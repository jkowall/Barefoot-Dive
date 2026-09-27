import { expect, test, type Page } from "@playwright/test";

async function acceptSafety(page: Page) {
  await page.getByRole("button", { name: /understand and accept/i }).click();
}

async function calculateAndOpenReview(page: Page) {
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const results = page.getByRole("region", { name: "Calculated plan" });
  await expect(results).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  return results;
}

test("switches Oxygen off and on from Plan Review without leaving Review", async ({ page }) => {
  await page.goto("/");
  await acceptSafety(page);
  const results = await calculateAndOpenReview(page);
  const runtimeMetric = results.locator(".bf-metric").filter({ hasText: "Runtime" }).first().locator("strong");
  const initialRuntime = await runtimeMetric.innerText();
  const save = results.getByRole("button", { name: "Save snapshot" });
  await expect(save).toBeEnabled();

  const includeOxygen = results.getByRole("checkbox", { name: "Include Oxygen in plan" });
  await expect(includeOxygen).toBeChecked();
  await expect(results.getByRole("heading", { name: "Primary gas ledger" })).toBeVisible();
  await includeOxygen.uncheck();

  await expect(page.getByRole("radiogroup", { name: "Plan workspace" }).getByRole("radio", { name: "Review" })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /^Updating$/ })).toBeVisible();
  await expect(results.getByText("Inputs changed. Recalculating automatically; previous results are hidden.")).toBeVisible();
  await expect(results.locator(".bf-metric").filter({ hasText: "Runtime" })).toHaveCount(0);
  await expect(save).toHaveCount(0);
  await expect(includeOxygen).toBeVisible();
  await expect(includeOxygen).not.toBeChecked();
  await expect(results.getByText("Not in plan")).toBeVisible();

  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(runtimeMetric).toBeVisible();
  const withoutOxygen = await runtimeMetric.innerText();
  expect(withoutOxygen).not.toBe(initialRuntime);
  // Runtime is mm:ss (or h:mm:ss) from formatDuration; longer without oxygen.
  const parse = (text: string) => {
    const parts = text.trim().split(":").map(Number);
    if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
    if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    throw new Error(`unexpected runtime ${text}`);
  };
  expect(parse(withoutOxygen)).toBeGreaterThan(parse(initialRuntime));
  await expect(save).toBeEnabled();

  await includeOxygen.check();
  await expect(page.getByRole("status").filter({ hasText: /^Updating$/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(runtimeMetric).toHaveText(initialRuntime);
  await expect(results.getByText("Not in plan")).toHaveCount(0);
});

test("toggles a CCR bailout gas from the Bailout gas ledger and recovers when all are off", async ({ page }) => {
  await page.goto("/");
  await acceptSafety(page);
  await page.getByRole("radiogroup", { name: "Mode" }).getByText("CCR", { exact: true }).click();
  const results = await calculateAndOpenReview(page);

  const bailoutLedger = results.getByRole("heading", { name: "Bailout gas ledger" });
  await expect(bailoutLedger).toBeVisible();
  const includeEan50 = results.getByRole("checkbox", { name: "Include EAN50 bailout in plan" });
  const includeBottom = results.getByRole("checkbox", { name: "Include Tx18/45 bailout in plan" });
  await expect(includeEan50).toBeChecked();
  await expect(includeBottom).toBeChecked();

  await includeEan50.uncheck();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(includeEan50).not.toBeChecked();
  await expect(results.getByText("Not in plan")).toBeVisible();

  await includeEan50.check();
  await includeBottom.uncheck();
  await includeEan50.uncheck();
  await expect(page.getByRole("radiogroup", { name: "Plan workspace" }).getByRole("radio", { name: "Review" })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /^Needs attention$/ })).toBeVisible();
  await expect(results.getByRole("heading", { name: "Calculation diagnostics" })).toBeVisible();
  await expect(includeBottom).toBeVisible();
  await expect(includeEan50).toBeVisible();
  await expect(results.locator(".bf-metric").filter({ hasText: "Runtime" })).toHaveCount(0);

  await includeBottom.check();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(results.locator(".bf-metric").filter({ hasText: "Runtime" }).first()).toBeVisible();
});

test("keeps keyboard focus on the Review include switch across recalculation", async ({ page }) => {
  await page.goto("/");
  await acceptSafety(page);
  const results = await calculateAndOpenReview(page);
  const includeOxygen = results.getByRole("checkbox", { name: "Include Oxygen in plan" });
  await includeOxygen.focus();
  await expect(includeOxygen).toBeFocused();
  await page.keyboard.press("Space");
  await expect(includeOxygen).not.toBeChecked();
  await expect(includeOxygen).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(includeOxygen).toBeFocused();
  await page.keyboard.press("Space");
  await expect(includeOxygen).toBeChecked();
  await expect(includeOxygen).toBeFocused();
});

test("Cave Review and a reopened Saved Plan show no include switches", async ({ page }) => {
  await page.goto("/");
  await acceptSafety(page);
  await calculateAndOpenReview(page);
  await page.getByRole("button", { name: "Save snapshot" }).click();
  await page.getByLabel("Plan name").fill("Review switch snapshot");
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Snapshot saved locally" })).toBeVisible();

  await page.getByRole("button", { name: /^Saved plans/ }).first().click();
  const record = page.getByRole("heading", { name: "Review switch snapshot" }).locator("../..");
  await record.getByRole("button", { name: "Open" }).click();
  const stored = page.getByRole("region", { name: "Stored calculated output" });
  await expect(stored).toBeVisible();
  await expect(stored.getByRole("checkbox", { name: /Include .+ in plan/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  const calculatedCave = page.getByRole("region", { name: "Calculated cave plan" });
  await expect(calculatedCave).toBeVisible();
  await expect(calculatedCave.getByRole("checkbox", { name: /Include .+ in plan/ })).toHaveCount(0);
});

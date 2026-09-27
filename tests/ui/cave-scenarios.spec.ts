import { expect, test } from "@playwright/test";

test("Cave omits inapplicable defaults and exposes per-scenario triggers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await expect(page.getByRole("checkbox", { name: "Scooter failure" })).toBeDisabled();
  await expect(page.getByText("Needs a scooter leg", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Stage failure" })).toBeDisabled();
  await expect(page.getByText("Needs a leg that drops or recovers a stage", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cave calculation complete" })).toBeVisible();
  await expect(page.getByText(/Scooter failure is not calculated: the route has no scooter leg/)).toBeVisible();
});

test("Cave scooter trigger is keyboard-accessible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByRole("button", { name: "Add route leg" }).click();
  const added = page.locator(".bf-route-editor").last();
  await added.locator('select[aria-label="Propulsion"]').selectOption("scooter");
  const trigger = page.locator('select[aria-label="Scooter failure trigger leg"]');
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toHaveValue("route-2");
});

test("Cave assigns independent scenario triggers and repairs them after route edits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByRole("button", { name: "Add route leg" }).click();
  const second = page.locator(".bf-route-editor").last();
  await second.locator('select[aria-label="Propulsion"]').selectOption("scooter");
  await second.locator('select[aria-label="Stage action"]').selectOption("drop");

  const lostBuddyLeg = page.locator('select[aria-label="Lost buddy trigger leg"]');
  const scooterLeg = page.locator('select[aria-label="Scooter failure trigger leg"]');
  await expect(scooterLeg).toHaveValue("route-2");
  await lostBuddyLeg.selectOption("route-1");
  await expect(lostBuddyLeg).toHaveValue("route-1");
  await expect(scooterLeg).toHaveValue("route-2");

  const lostBuddyDistance = page.getByRole("spinbutton", { name: /Lost buddy trigger distance/ });
  await lostBuddyDistance.fill("120");
  await expect(lostBuddyDistance).toHaveValue("120");
  await expect(page.getByText(/Trigger: route-1 · 120 /)).toBeVisible();

  // Shrinking the selected trigger leg invalidates the typed distance and repairs to end-of-leg.
  await page.locator(".bf-route-editor").first().getByRole("spinbutton", { name: /^Distance/ }).fill("50");
  await expect(page.getByRole("status").filter({ hasText: /Trigger distance returned to the end of its leg/ })).toBeVisible();
  await expect(lostBuddyDistance).toHaveValue("0");

  // Removing the scooter leg repairs scooter failure onto an eligible default and disables it when none remain.
  await second.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("checkbox", { name: "Scooter failure" })).toBeDisabled();
  await expect(page.getByText("Needs a scooter leg", { exact: true })).toBeVisible();
});

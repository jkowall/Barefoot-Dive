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
  const trigger = page.getByLabel("Scooter failure trigger leg");
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toHaveValue("route-2");
});

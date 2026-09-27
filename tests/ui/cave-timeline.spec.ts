import { expect, test, type Page } from "@playwright/test";

async function openCave(page: Page) {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Cave route timeline" })).toBeVisible();
}

test("Cave Setup timeline exposes route segments and links them to editors and triggers", async ({ page }) => {
  await openCave(page);
  const timeline = page.getByRole("region", { name: "Cave route timeline" });
  await expect(timeline.getByRole("button", { name: /route-1, 0 ft to 197 ft/i })).toBeVisible();

  await timeline.getByRole("button", { name: /route-1, 0 ft to 197 ft/i }).click();
  await expect(page.locator("#cave-route-route-1")).toBeFocused();

  await page.getByRole("button", { name: "Add route leg" }).click();
  const second = page.locator(".bf-route-editor").last();
  await second.getByLabel("Propulsion").selectOption("scooter");
  const scooterMarker = timeline.getByRole("button", { name: /Scooter failure trigger/i });
  await expect(scooterMarker).toBeVisible();
  await scooterMarker.click();
  await expect(page.locator("#cave-scenario-scooter-failure")).toBeFocused();
});

test("Cave Review mirrors current route geometry and selects a scenario marker", async ({ page }) => {
  await openCave(page);
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  const timeline = page.getByRole("region", { name: "Calculated cave route timeline" });
  await expect(timeline).toBeVisible();
  await timeline.getByRole("button", { name: /Lost buddy trigger/i }).click();
  await expect(page.getByRole("group", { name: "Scenario result" }).getByRole("radio", { checked: true })).toHaveAccessibleName("Lost buddy");
});

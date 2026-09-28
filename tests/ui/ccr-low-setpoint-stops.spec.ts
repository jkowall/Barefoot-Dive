import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("new CCR plans hold ambient-limited high on shallow stops instead of warning about the low setpoint", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("radiogroup", { name: "Mode" }).getByText("CCR", { exact: true }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const results = page.getByRole("region", { name: "Calculated plan" });
  await expect(results).toBeVisible();
  // Defaults hold the high setpoint at the last stop; no low-setpoint stop warning.
  await expect(results.getByText(/runs on the 0\.70 bar low setpoint/)).toHaveCount(0);

  await page.getByRole("button", { name: "Edit inputs" }).click();
  await page.getByRole("spinbutton", { name: "Switch-down depth (ft)" }).fill("30");
  await page.getByRole("button", { name: "Review plan" }).click();
  // Engine 0.4.0 ambient-limited ascent: a deeper switch-down no longer drops shallow
  // stops onto the fixed low setpoint, so the 0.6.0 warning does not appear.
  await expect(results.getByText(/runs on the 0\.70 bar low setpoint/)).toHaveCount(0);
});

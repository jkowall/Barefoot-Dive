import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("warns in Review when a CCR decompression stop runs on the low setpoint", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("radiogroup", { name: "Mode" }).getByText("CCR", { exact: true }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const results = page.getByRole("region", { name: "Calculated plan" });
  await expect(results).toBeVisible();
  // The default switch-down at the 20 ft last stop holds the high setpoint at every stop.
  await expect(results.getByText(/runs on the 0\.70 bar low setpoint/)).toHaveCount(0);

  await page.getByRole("button", { name: "Edit inputs" }).click();
  await page.getByRole("spinbutton", { name: "Switch down to low setpoint (ft)" }).fill("30");
  await page.getByRole("button", { name: "Review plan" }).click();
  await expect(results.getByText(
    /^The 20 ft stop runs on the 0\.70 bar low setpoint for \d+ min, because the loop switches down when leaving 30 ft\. On the low setpoint the loop carries more inert gas, so decompression can take longer than on the 1\.30 bar high setpoint\. Set the switch-down depth to 20 ft to hold the high setpoint at that stop\.$/,
  )).toBeVisible();
});

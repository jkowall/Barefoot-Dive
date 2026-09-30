import { expect, test, type Locator, type Page } from "@playwright/test";

// DEFAULT_ENVIRONMENT: 1 bar at the surface, 10 m per bar, 0.0627 bar water vapor.
const loopMaximumAt = (depthM: number) => 1 + depthM / 10 - 0.0627;

async function calculateCcrDefault(page: Page) {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("radiogroup", { name: "Mode" }).getByText("CCR", { exact: true }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan calculation complete" })).toBeVisible();
}

/** The readout cell for a label, inside the profile that holds `slider`. */
const readoutValue = (page: Page, slider: Locator, label: string) =>
  page.locator("section.bf-profile").filter({ has: slider }).getByTestId("profile-readout")
    .locator("span").filter({ has: page.locator("small", { hasText: new RegExp(`^${label}$`) }) }).locator("strong");

/** Hovers the scrubber at a runtime; the plot spans x 62 to 704 of the 720-wide viewBox. */
async function hoverRuntime(page: Page, slider: Locator, runtimeSeconds: number) {
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  const maximum = Number(await slider.getAttribute("aria-valuemax"));
  await page.mouse.move(box.x + box.width * (62 + runtimeSeconds / maximum * 642) / 720, box.y + box.height * 0.3);
}

test("shows the loop PPO₂ the depth allows on the CCR final ascent, not the held setpoint", async ({ page }) => {
  await calculateCcrDefault(page);
  const primary = page.getByRole("slider", { name: "Primary profile timeline" });
  const maximum = Number(await primary.getAttribute("aria-valuemax"));
  // The default draft's final ascent climbs the last 3.6 m on the held 1.30 bar high setpoint.
  await hoverRuntime(page, primary, maximum - 30);
  await expect(readoutValue(page, primary, "Phase")).toHaveText("Ascent");
  await expect(readoutValue(page, primary, "Active gas / loop")).toHaveText("CCR 1.30 / Tx18/45 diluent");
  const loopText = await readoutValue(page, primary, "Loop PPO₂").innerText();
  const loop = Number(loopText.replace(" bar", ""));
  expect(loop).toBeGreaterThan(loopMaximumAt(0) - 0.005);
  expect(loop).toBeLessThan(1.25);
  // The value is the loop maximum at the displayed depth (whole feet, so within half a foot).
  const depthFeet = Number((await readoutValue(page, primary, "Depth").innerText()).replace(" ft", ""));
  expect(Math.abs(loop - loopMaximumAt(depthFeet * 0.3048))).toBeLessThan(0.02);
  await expect(primary).toHaveAttribute("aria-valuetext", new RegExp(`loop PPO₂ ${loopText}`));
});

test("says a saved CCR plan from before held setpoints did not record the loop PPO₂", async ({ page }) => {
  await calculateCcrDefault(page);
  await page.getByRole("button", { name: "Save snapshot" }).click();
  await page.getByLabel("Plan name").fill("Loop PPO2 snapshot");
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Snapshot saved locally" })).toBeVisible();

  const openSaved = async () => {
    await page.getByRole("button", { name: /^Saved plans/ }).first().click();
    await page.getByRole("heading", { name: "Loop PPO2 snapshot" }).locator("../..").getByRole("button", { name: "Open" }).click();
    return page.getByRole("slider", { name: "Primary profile timeline" });
  };
  let primary = await openSaved();
  await expect(readoutValue(page, primary, "Loop PPO₂")).toHaveText("0.70 bar");

  // A snapshot calculated before plans recorded the held setpoint has no heldSetpointBar.
  await page.evaluate(() => {
    const key = "barefoot-dive:saved-plans";
    const stored = JSON.parse(localStorage.getItem(key)!) as { records: { calculatedPlan: unknown }[] };
    type StoredPlan = { segments: Record<string, unknown>[]; bailoutPlan?: StoredPlan };
    const strip = (plan: StoredPlan | undefined): void => {
      if (!plan) return;
      for (const segment of plan.segments) delete segment.heldSetpointBar;
      strip(plan.bailoutPlan);
    };
    for (const record of stored.records) strip(record.calculatedPlan as StoredPlan);
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  primary = await openSaved();
  await expect(readoutValue(page, primary, "Loop PPO₂")).toHaveText("Not recorded; recalculate to show");
  await expect(primary).toHaveAttribute("aria-valuetext", /loop PPO₂ not recorded; recalculate to show/);
  await expect(readoutValue(page, primary, "Active gas / loop")).toHaveText("CCR 0.70 / Tx18/45 diluent");
});

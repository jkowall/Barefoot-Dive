import { expect, test, type Page } from "@playwright/test";

async function acceptSafety(page: Page) {
  await page.getByRole("button", { name: /understand and accept/i }).click();
}

async function createOxygenDecoWithSwitch20ft(page: Page) {
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByLabel("Cylinder name").fill("Oxygen stage");
  await page.getByLabel("Gas name").fill("Oxygen");
  await page.getByLabel("O₂ (%)").fill("100");
  await page.getByLabel("He (%)").fill("0");
  await page.getByLabel("Maximum PPO₂ (bar)").fill("1.6");
  await page.getByLabel("Cylinder role").selectOption("deco");
  const switchDepth = page.getByLabel(/Switch depth/);
  await expect(switchDepth).toBeVisible();
  await switchDepth.fill("20");
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await expect(page.getByRole("heading", { name: "Oxygen stage" })).toBeVisible();
  await expect(page.getByText(/Switch 20 ft/)).toBeVisible();
}

test("choosing an Oxygen Tank Bank cylinder fills Plan deco switch depth at 20 ft", async ({ page }) => {
  await page.goto("/");
  await acceptSafety(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Depth and distance" }).getByText("Feet", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await createOxygenDecoWithSwitch20ft(page);
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();

  const oxygenEditor = page.locator(".bf-gas-editor").filter({ has: page.getByRole("heading", { name: "Oxygen", exact: true }) });
  const switchDepth = oxygenEditor.getByLabel(/Switch depth/);
  // Default oxygen is already 20 ft; move it away so the Tank Bank copy is observable.
  await switchDepth.fill("70");
  await expect(switchDepth).toHaveValue("70");
  await page.getByLabel("Oxygen cylinder source", { exact: true }).selectOption({ label: /Oxygen stage/ });
  await expect(switchDepth).toHaveValue("20");

  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Calculation diagnostics" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Calculated plan" })).toBeVisible();
});

test("choosing the same cylinder for a Cave deco gas fills 20 ft", async ({ page }) => {
  await page.goto("/");
  await acceptSafety(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Depth and distance" }).getByText("Feet", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await createOxygenDecoWithSwitch20ft(page);
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  const oxygenEditor = page.locator(".bf-gas-editor").filter({ has: page.getByRole("heading", { name: "Oxygen", exact: true }) });
  const switchDepth = oxygenEditor.getByLabel(/Switch depth/);
  await switchDepth.fill("70");
  await page.getByLabel("Oxygen cylinder source", { exact: true }).selectOption({ label: /Oxygen stage/ });
  await expect(switchDepth).toHaveValue("20");
});

test("editing Tank Bank switch depth prompts Update plan and leaves the plan value", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await acceptSafety(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Depth and distance" }).getByText("Feet", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await createOxygenDecoWithSwitch20ft(page);
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();
  const oxygenEditor = page.locator(".bf-gas-editor").filter({ has: page.getByRole("heading", { name: "Oxygen", exact: true }) });
  const switchDepth = oxygenEditor.getByLabel(/Switch depth/);
  await switchDepth.fill("70");
  await page.getByLabel("Oxygen cylinder source", { exact: true }).selectOption({ label: /Oxygen stage/ });
  await expect(switchDepth).toHaveValue("20");
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await page.getByRole("button", { name: "Edit inputs" }).click();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel(/Switch depth/).fill("10");
  await page.getByRole("button", { name: "Save cylinder" }).click();

  await page.getByRole("button", { name: "Plan", exact: true }).first().click();
  await expect(page.getByRole("status").filter({ hasText: /^Source changed$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update plan" })).toBeVisible();
  await expect(switchDepth).toHaveValue("20");
  await page.clock.fastForward(1_000);
  await expect(page.getByRole("status").filter({ hasText: /^Source changed$/ })).toBeVisible();
  await expect(switchDepth).toHaveValue("20");
});

test("a switch depth deeper than the MOD shows a form error", async ({ page }) => {
  await page.goto("/");
  await acceptSafety(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Depth and distance" }).getByText("Feet", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByLabel("Gas name").fill("Oxygen");
  await page.getByLabel("O₂ (%)").fill("100");
  await page.getByLabel("Maximum PPO₂ (bar)").fill("1.6");
  await page.getByLabel("Cylinder role").selectOption("deco");
  await page.getByLabel(/Switch depth/).fill("70");
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await expect(page.getByText("Switch depth must not be deeper than the MOD at this maximum PPO₂.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New cylinder", exact: true })).toHaveCount(0);
});

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("persists the safety acknowledgement and exposes every primary workspace", async ({ page }) => {
  await expect(page.getByRole("dialog", { name: /decision support/i })).toBeVisible();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();

  for (const [button, heading] of [
    ["Cave", "Cave"],
    ["Tools", "Tools"],
    ["Tank bank", "Tank Bank"],
    ["Saved plans", "Saved plans"],
    ["Plan", "Plan"],
  ] as const) {
    await page.getByRole("button", { name: button, exact: true }).first().click();
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  }
});

test("keeps the safety-gated workspace and Settings controls accessible", async ({ page }) => {
  const safetyGate = page.getByRole("dialog", { name: /decision support/i });
  await expect(safetyGate).toBeVisible();
  await expect(safetyGate.getByRole("button", { name: /understand and accept/i })).toBeFocused();
  await safetyGate.getByRole("button", { name: /understand and accept/i }).click();

  const navigation = page.getByRole("navigation", { name: "Primary navigation" }).first();
  await expect(navigation).toBeVisible();
  for (const label of ["Plan", "Cave", "Tools", "Tank bank", "Saved plans"]) {
    await expect(navigation.getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  const unnamedControls = await page.locator("button:visible, input:visible, select:visible, textarea:visible, [role='button']:visible, [role='link']:visible").evaluateAll((controls) => controls.filter((control) => {
    const element = control as HTMLElement;
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")
      : "";
    const nativeLabelText = "labels" in element
      ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent ?? "").join(" ")
      : "";
    const label = element.getAttribute("aria-label") ?? labelledText ?? nativeLabelText;
    return !(label?.trim() || nativeLabelText.trim() || element.textContent?.trim() || element.getAttribute("title")?.trim());
  }));
  expect(unnamedControls).toHaveLength(0);

  const settingsButton = page.getByRole("button", { name: "Open settings" });
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Done" })).toBeFocused();
  await expect(settings.getByRole("radiogroup", { name: "Depth and distance" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
});

test("calculates and saves an OC plan, then keeps the snapshot immutable in the library", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("heading", { name: "Calculated plan" })).toBeVisible();
  await expect(page.getByText("Calculated", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Save snapshot" }).click();
  await page.getByLabel("Plan name").fill("OC regression plan");
  await page.getByRole("button", { name: "Save plan" }).click();
  await page.getByRole("button", { name: /^Saved plans/ }).first().click();
  await expect(page.getByRole("heading", { name: "OC regression plan" })).toBeVisible();
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: "OC regression plan copy" })).toBeVisible();
});

test("calculates CCR, cave, and the Tools library without a remote dependency", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByText("CCR", { exact: true }).first().click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("heading", { name: "Calculated plan" })).toBeVisible();

  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByRole("heading", { name: "Cave summary" })).toBeVisible();

  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  const tools = ["MOD", "Best Mix", "END", "Gas Density", "PPO₂", "SAC / RMV", "Gas Duration", "Cylinder Gas", "Emergency Gas", "CNS"];
  for (const tool of tools) {
    await page.getByRole("button", { name: new RegExp(`^${tool}`) }).first().click();
    await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
    await expect(page.getByText("Live result", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "All tools" }).click();
  }
  await expect(page.getByText(/Rock Bottom \/ Minimum Gas/)).toBeVisible();
  await expect(page.getByText(/Simplified Bailout/)).toBeVisible();
});

test("retains cave-layer safety errors in an immutable saved snapshot", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByRole("spinbutton", { name: /Entered turn pressure/ }).fill("1");
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByText(/Entered turn pressure is below the calculated operational turn threshold/)).toBeVisible();
  await page.getByRole("button", { name: "Save cave snapshot" }).click();
  await page.getByLabel("Plan name").fill("Unsafe cave snapshot regression");
  await page.getByRole("button", { name: "Save plan" }).click();

  await page.getByRole("button", { name: /^Saved plans/ }).first().click();
  const record = page.getByRole("heading", { name: "Unsafe cave snapshot regression" }).locator("../..");
  await record.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("SAVED CAVE SNAPSHOT · UNSAFE")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stored cave calculation diagnostics" })).toBeVisible();
  await expect(page.getByText(/Entered turn pressure is below the calculated operational turn threshold/)).toBeVisible();
});

test("marks a saved cave snapshot unsafe when a nested failure scenario is invalid", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await page.getByRole("button", { name: "Save cave snapshot" }).click();
  await page.getByLabel("Plan name").fill("Unsafe cave scenario regression");
  await page.getByRole("button", { name: "Save plan" }).click();

  await page.getByRole("button", { name: /^Saved plans/ }).first().click();
  const record = page.getByRole("heading", { name: "Unsafe cave scenario regression" }).locator("../..");
  await expect(page.getByText(/scooter failure: Scooter failure must target a scooter-propelled leg/)).toBeVisible();
  await record.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("SAVED CAVE SNAPSHOT · UNSAFE")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stored cave calculation diagnostics" })).toBeVisible();
  await expect(page.getByText(/scooter failure: Scooter failure must target a scooter-propelled leg/)).toBeVisible();
});

test("moves an applicable Tool result into the planner", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^Best Mix/ }).click();
  await page.getByRole("button", { name: "Copy mix to Plan" }).click();
  await page.getByRole("button", { name: "Apply to current Plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Gas name" }).first()).toHaveValue(/Tx/);
});

test("keeps PSI cylinder fields whole-number while retaining canonical precision", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();

  const workingPressure = page.getByRole("spinbutton", { name: "Working pressure (psi)" });
  const currentPressure = page.getByRole("spinbutton", { name: "Current pressure (psi)" });
  const minimumPressure = page.getByRole("spinbutton", { name: "Minimum pressure (psi)" });
  await expect(workingPressure).toHaveValue("3365");
  await expect(currentPressure).toHaveValue("3365");
  await expect(minimumPressure).toHaveValue("508");
  await expect(workingPressure).toHaveAttribute("step", "1");
  await expect(currentPressure).toHaveAttribute("step", "1");
  await expect(minimumPressure).toHaveAttribute("step", "1");

  await currentPressure.fill("3365");
  await expect(currentPressure).toHaveValue("3365");
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await expect(page.getByText("3365 psi", { exact: true })).toBeVisible();
  const storedCurrentPressure = await page.evaluate(() => {
    const raw = localStorage.getItem("barefoot-dive:tank-bank");
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as { records?: { currentPressureBar?: number }[] };
    return stored.records?.[0]?.currentPressureBar;
  });
  expect(storedCurrentPressure).toBe(232);

  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^Gas Duration/ }).click();
  await page.getByRole("combobox", { name: "Tank Bank source" }).selectOption({ label: "New cylinder · Air · rev 1" });
  await expect(page.getByRole("spinbutton", { name: "Working pressure (psi)" })).toHaveValue("3365");
  const toolStartingPressure = page.getByRole("spinbutton", { name: "Starting pressure (psi)" });
  await expect(toolStartingPressure).toHaveValue("3365");
  await expect(page.getByRole("spinbutton", { name: "Reserve pressure (psi)" })).toHaveValue("508");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Cylinder pressure" }).getByText("Bar", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("combobox", { name: "Tank Bank source" })).toHaveValue(/.+/);
  await expect(page.getByRole("spinbutton", { name: "Starting pressure (bar)" })).toHaveValue("232");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Cylinder pressure" }).getByText("PSI", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(toolStartingPressure).toHaveValue("3365");
  await toolStartingPressure.fill("3000.5");
  await expect(toolStartingPressure).toHaveValue("3001");
});

test("reloads the production PWA while offline after first load", async ({ page, context }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await context.setOffline(false);
});

test("keeps a Tool draft through the library and Plan navigation, then resets it on reload", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^MOD/ }).click();
  const oxygen = page.getByRole("spinbutton", { name: "O₂ fraction (%)" });
  await oxygen.fill("32");
  await page.getByRole("button", { name: "All tools" }).click();
  await page.getByRole("button", { name: /^MOD/ }).click();
  await expect(oxygen).toHaveValue("32");
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await expect(page.getByRole("spinbutton", { name: "O₂ fraction (%)" })).toHaveValue("32");
  await page.reload();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^MOD/ }).click();
  await expect(page.getByRole("spinbutton", { name: "O₂ fraction (%)" })).toHaveValue("21");
});

test("uses task names once and keeps display labels away from canonical suffixes", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  const library = page.getByLabel("Tools library");
  for (const name of ["MOD", "Best Mix", "PPO₂", "END", "Gas Density", "SAC / RMV", "Gas Duration", "Cylinder Gas", "Emergency Gas", "CNS", "Rock Bottom / Minimum Gas", "Simplified Bailout"]) {
    await expect(library.getByText(name, { exact: true })).toHaveCount(1);
  }
  await expect(page.getByText(/DEPTH M|PRESSURE BAR/)).toHaveCount(0);
});

test("maps SAC targets to the active planning mode", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^SAC \/ RMV/ }).click();
  let target = page.getByRole("radiogroup", { name: "Plan target" });
  await expect(target.getByText("OC bottom RMV", { exact: true })).toBeVisible();
  await expect(target.getByText("OC deco RMV", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();
  await page.getByRole("radiogroup", { name: "Mode" }).getByText("CCR", { exact: true }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  target = page.getByRole("radiogroup", { name: "Plan target" });
  await expect(target.getByText("CCR bailout RMV", { exact: true })).toBeVisible();
  await expect(target.getByText("CCR bailout deco RMV", { exact: true })).toBeVisible();
});

test("changes Tool presentation units without rewriting canonical inputs", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^MOD/ }).click();
  const oxygen = page.getByRole("spinbutton", { name: "O₂ fraction (%)" });
  await oxygen.fill("32");
  const depthMetric = page.getByText("Maximum operating depth").locator("..");
  await expect(depthMetric.getByText(/ft$/)).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Depth and distance" }).getByText("Meters", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(oxygen).toHaveValue("32");
  await expect(depthMetric.getByText(/m$/)).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Depth and distance" }).getByText("Feet", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(oxygen).toHaveValue("32");
  await expect(depthMetric.getByText(/ft$/)).toBeVisible();
});

test("offers Tank Bank only when the active Tool mode uses cylinder context", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^SAC \/ RMV/ }).click();
  await expect(page.getByRole("combobox", { name: "Tank Bank source" })).toHaveCount(0);
  await page.getByRole("radiogroup", { name: "Measurement mode" }).getByText("Cylinder pressure drop", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Tank Bank source" })).toBeVisible();

  await page.getByRole("button", { name: "All tools" }).click();
  await page.getByRole("button", { name: /^Emergency Gas/ }).click();
  await page.getByRole("radiogroup", { name: "Cylinder context" }).getByText("Schedule only", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Tank Bank source" })).toHaveCount(0);
  await page.getByRole("radiogroup", { name: "Emergency mode" }).getByText("Simplified Bailout", { exact: true }).click();
  await expect(page.getByText("Planning context: CCR", { exact: false })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tank Bank source" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Cylinder context" }).getByRole("radio", { name: "Required cylinder" })).toBeChecked();
});

test("detaches a copied Tank Bank snapshot when a sourced field is edited", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("spinbutton", { name: "Current pressure (psi)" }).fill("3365");
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^Gas Duration/ }).click();
  const source = page.getByRole("combobox", { name: "Tank Bank source" });
  await source.selectOption({ label: "New cylinder · Air · rev 1" });
  await page.getByRole("spinbutton", { name: "Working pressure (psi)" }).fill("3200");
  await expect(source).toHaveValue("");
  await expect(page.getByText(/Editing sourced fields detaches to Manual/)).toHaveCount(0);
});

test("does not silently refresh a calculated Tool snapshot after its Tank Bank record changes", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();

  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^Emergency Gas/ }).click();
  await page.getByRole("combobox", { name: "Tank Bank source" }).selectOption({ label: "New cylinder · Air · rev 1" });
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await page.getByText("Calculated assumptions", { exact: true }).click();
  const calculatedResult = page.locator("section.bf-tool-result-panel");
  const calculatedAssumptions = page.locator("details.bf-tool-details--nested");
  const assumptionsBeforeBankEdit = await calculatedAssumptions.innerText();
  const resultBeforeBankEdit = await calculatedResult.textContent();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Gas name" }).fill("Air updated");
  await page.getByRole("spinbutton", { name: "Current pressure (psi)" }).fill("3000");
  await page.getByRole("button", { name: "Save cylinder" }).click();

  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Emergency Gas", exact: true })).toBeVisible();
  await expect(page.getByText(/Snapshot from Tank Bank: New cylinder · Air, revision 1/)).toBeVisible();
  await expect(page.getByText(/Tank Bank now rev 2; reselect to refresh/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tank Bank source" }).locator("option:checked")).toHaveText(/snapshot rev 1 \(bank rev 2\)/);
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  expect(await calculatedResult.textContent()).toBe(resultBeforeBankEdit);
  await page.getByText("Calculated assumptions", { exact: true }).click();
  expect(await calculatedAssumptions.innerText()).toBe(assumptionsBeforeBankEdit);
});

test("keeps Emergency Gas live while never pairing edited inputs with an old result", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^Emergency Gas/ }).click();
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await page.getByText("Calculated assumptions", { exact: true }).click();
  await expect(page.getByText("Stressed RMV: 20.0 L/min", { exact: false })).toBeVisible();
  const apply = page.getByRole("button", { name: "Apply reserve assumptions" });
  await expect(apply).toBeEnabled();
  await page.getByRole("spinbutton", { name: "Stressed RMV (L/min)" }).fill("25");
  await expect(page.getByText("Updating", { exact: true })).toBeVisible();
  await expect(page.getByText("Stressed RMV: 20.0 L/min", { exact: false })).toHaveCount(0);
  await expect(apply).toBeDisabled();
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await page.getByText("Calculated assumptions", { exact: true }).click();
  await expect(page.getByText("Stressed RMV: 25.0 L/min", { exact: false })).toBeVisible();
  await expect(apply).toBeEnabled();
  const calculatedAssumptions = page.locator("details.bf-tool-details--nested");
  const afterRmv = await calculatedAssumptions.innerText();
  await page.getByRole("spinbutton", { name: "Duration (min)" }).first().fill("4.5");
  await expect(page.getByText("Updating", { exact: true })).toBeVisible();
  await expect(calculatedAssumptions).toHaveCount(0);
  await expect(apply).toBeDisabled();
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await page.getByText("Calculated assumptions", { exact: true }).click();
  const afterSegment = await calculatedAssumptions.innerText();
  expect(afterSegment).not.toBe(afterRmv);
  await page.getByRole("spinbutton", { name: "Working pressure (psi)" }).fill("3000");
  await expect(page.getByText("Updating", { exact: true })).toBeVisible();
  await expect(calculatedAssumptions).toHaveCount(0);
  await expect(apply).toBeDisabled();
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await expect(apply).toBeEnabled();
  await page.getByRole("spinbutton", { name: "Stressed RMV (L/min)" }).fill("0");
  await expect(page.getByText("Check inputs", { exact: true })).toBeVisible();
  await expect(page.getByText("Fix the highlighted inputs to restore the live result.", { exact: true })).toBeVisible();
  await expect(apply).toBeDisabled();
  await page.getByRole("spinbutton", { name: "Stressed RMV (L/min)" }).fill("25");
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Emergency mode" }).getByText("Simplified Bailout", { exact: true }).click();
  await expect(page.getByText("Updating", { exact: true })).toBeVisible();
  await expect(page.getByText("Planning context: CCR", { exact: false })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Cylinder context" }).getByRole("radio", { name: "Required cylinder" })).toBeChecked();
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
});

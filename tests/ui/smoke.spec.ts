import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("persists the safety acknowledgement and exposes every primary workspace", async ({ page }) => {
  await expect(page.getByRole("dialog", { name: /decision support/i })).toBeVisible();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();

  const footer = page.getByRole("contentinfo");
  const versions = footer.locator(".bf-app-footer__versions");
  await expect(versions.getByText("App", { exact: true })).toBeVisible();
  await expect(versions.getByText("0.5.0", { exact: true })).toBeVisible();
  await expect(versions.getByText("Calculation engine", { exact: true })).toBeVisible();
  await expect(versions.getByText("barefoot-dive-engine-0.3.0", { exact: true })).toBeVisible();
  const projectLinks = footer.getByRole("navigation", { name: "Project links" });
  for (const [label, href] of [
    ["GitHub", "https://github.com/jkowall/Barefoot-Dive"],
    ["Changelog", "https://github.com/jkowall/Barefoot-Dive/blob/main/CHANGELOG.md"],
    ["Roadmap", "https://github.com/jkowall/Barefoot-Dive/blob/main/ROADMAP.md"],
    ["Validation notes", "https://github.com/jkowall/Barefoot-Dive/blob/main/documentation/reference-validation.md"],
    ["Apache 2.0 license", "https://github.com/jkowall/Barefoot-Dive/blob/main/LICENSE"],
    ["Report an issue", "https://github.com/jkowall/Barefoot-Dive/issues/new"],
  ] as const) {
    const link = projectLinks.getByRole("link", { name: `${label} (opens in a new tab)`, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }

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

  const ccrMode = page.getByRole("radio", { name: "CCR", exact: true }).first();
  await ccrMode.focus();
  await expect(ccrMode.locator("..")).toHaveCSS("outline-style", "solid");

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
  await expect(settings.getByText("App 0.5.0 · Calculation engine barefoot-dive-engine-0.3.0")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  const footerLink = page.getByRole("contentinfo").getByRole("link", { name: "GitHub (opens in a new tab)", exact: true });
  await footerLink.focus();
  await expect(footerLink).toBeFocused();
  await expect(footerLink).toHaveCSS("outline-style", "solid");
});

test("keeps the footer content above mobile navigation without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("button", { name: /understand and accept/i }).click();

  const footer = page.getByRole("contentinfo");
  await footer.scrollIntoViewIfNeeded();
  const [versionsBox, linksBox, navigationBox] = await Promise.all([
    footer.locator(".bf-app-footer__versions").boundingBox(),
    footer.getByRole("navigation", { name: "Project links" }).boundingBox(),
    page.locator(".bf-nav--bottom").boundingBox(),
  ]);
  expect(versionsBox).not.toBeNull();
  expect(linksBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(Math.max(versionsBox!.y + versionsBox!.height, linksBox!.y + linksBox!.height)).toBeLessThanOrEqual(navigationBox!.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("traces a completion border once and removes its motion when requested", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.evaluate(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options) {
      if (typeof options === "object") {
        (window as Window & { __barefootLastScrollBehavior?: ScrollBehavior }).__barefootLastScrollBehavior = options.behavior;
      }
      originalScrollIntoView.call(this, options);
    };
  });
  await page.getByRole("button", { name: "Calculate plan" }).click();

  const notice = page.locator(".bf-completion-notice");
  await expect(notice.getByRole("status")).toContainText("Plan calculation complete");
  await expect(notice).toBeInViewport();
  await expect.poll(() => page.evaluate(() => (window as Window & { __barefootLastScrollBehavior?: ScrollBehavior }).__barefootLastScrollBehavior)).toBe("smooth");
  await expect(notice.locator("svg")).toHaveCount(0);
  const topEdge = notice.locator(".bf-completion-notice__edge--top");
  await expect(topEdge).toHaveCSS("animation-name", "bf-completion-border-x");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.evaluate(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options) {
      if (typeof options === "object") {
        (window as Window & { __barefootLastScrollBehavior?: ScrollBehavior }).__barefootLastScrollBehavior = options.behavior;
      }
      originalScrollIntoView.call(this, options);
    };
  });
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __barefootLastScrollBehavior?: ScrollBehavior }).__barefootLastScrollBehavior)).toBe("auto");
  await expect(topEdge).toHaveCSS("animation-name", "none");
  await expect(topEdge).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect(notice.locator(".bf-completion-notice__copy")).toHaveCSS("opacity", "1");
});

test("scrolls a newly added deco gas editor into view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.evaluate(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options) {
      if (this instanceof HTMLElement && this.matches(".bf-gas-editor") && typeof options === "object") {
        (window as Window & { __barefootGasScroll?: { name: string; behavior?: ScrollBehavior; block?: ScrollLogicalPosition } }).__barefootGasScroll = {
          name: this.querySelector("h3")?.textContent ?? "",
          behavior: options.behavior,
          block: options.block,
        };
      }
      originalScrollIntoView.call(this, options);
    };
  });

  const editors = page.locator("article.bf-gas-editor");
  const editorCount = await editors.count();
  await page.getByRole("button", { name: "Add deco gas", exact: true }).click();

  await expect(editors).toHaveCount(editorCount + 1);
  const addedEditor = page.locator("article.bf-gas-editor", { hasText: "New deco gas" });
  await expect(addedEditor).toHaveCount(1);
  await expect(addedEditor.getByRole("heading", { name: "New deco gas", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __barefootGasScroll?: { name: string; behavior?: ScrollBehavior; block?: ScrollLogicalPosition } }).__barefootGasScroll)).toEqual({
    name: "New deco gas",
    behavior: "auto",
    block: "start",
  });
  await expect(addedEditor).toBeInViewport();

  const [topbarBox, editorBox] = await Promise.all([
    page.locator(".bf-topbar").boundingBox(),
    addedEditor.boundingBox(),
  ]);
  expect(topbarBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(editorBox!.y).toBeGreaterThanOrEqual(topbarBox!.y + topbarBox!.height - 1);
});

test("scrolls a newly added Cave route leg into view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.evaluate(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options) {
      if (this instanceof HTMLElement && this.matches(".bf-route-editor") && typeof options === "object") {
        (window as Window & { __barefootRouteScroll?: { name: string; behavior?: ScrollBehavior; block?: ScrollLogicalPosition } }).__barefootRouteScroll = {
          name: this.querySelector("h3")?.textContent ?? "",
          behavior: options.behavior,
          block: options.block,
        };
      }
      originalScrollIntoView.call(this, options);
    };
  });

  const editors = page.locator("article.bf-route-editor");
  await page.getByRole("button", { name: "Add route leg", exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });

  await expect(editors).toHaveCount(3);
  await expect(editors.locator("h3")).toHaveText(["route-1", "route-2", "route-3"]);
  const latestEditor = editors.filter({ has: page.getByRole("heading", { name: "route-3", exact: true }) });
  await expect(latestEditor).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as Window & { __barefootRouteScroll?: { name: string; behavior?: ScrollBehavior; block?: ScrollLogicalPosition } }).__barefootRouteScroll)).toEqual({
    name: "route-3",
    behavior: "auto",
    block: "start",
  });
  await expect(latestEditor).toBeInViewport();
});

test("keeps the calculated safety status inside its metric card", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();

  const safetyMetric = page.locator(".bf-metric", { hasText: "Safety status" });
  await expect(safetyMetric.getByText("Calculated", { exact: true })).toBeVisible();
  const bounds = await safetyMetric.evaluate((element) => {
    const value = element.querySelector("strong");
    if (!value) return null;
    const cardBox = element.getBoundingClientRect();
    const valueRange = document.createRange();
    valueRange.selectNodeContents(value);
    const valueBox = valueRange.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      contentLeft: cardBox.left + Number.parseFloat(style.paddingLeft),
      contentRight: cardBox.right - Number.parseFloat(style.paddingRight),
      valueLeft: valueBox.left,
      valueRight: valueBox.right,
    };
  });

  expect(bounds).not.toBeNull();
  expect(bounds!.valueLeft).toBeGreaterThanOrEqual(bounds!.contentLeft - 1);
  expect(bounds!.valueRight).toBeLessThanOrEqual(bounds!.contentRight + 1);
});

test("scrubs the planned profile with mouse, touch pointer, and keyboard input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("spinbutton", { name: "Starting pressure (psi)" }).first().fill("1400");
  await page.getByRole("button", { name: "Calculate plan" }).click();

  const graph = page.getByRole("slider", { name: "Primary profile timeline" });
  const profile = page.locator(".bf-profile").filter({ has: graph });
  await expect(graph).toBeVisible();
  await expect(graph).toHaveCSS("touch-action", "pan-y");
  await expect(graph).toHaveAttribute("aria-valuenow", "0");
  await expect(graph).toHaveAttribute("aria-valuetext", /0:00, 0 ft, Descent, plan Open circuit, Open circuit, Tx18\/45/i);
  await expect(profile.getByTestId("profile-readout")).toContainText("Active gas / loop");
  await expect(profile.locator(".bf-profile__marker--reserve")).not.toHaveCount(0);
  await expect(profile.getByText(/horizontal position for segment-end time/i)).toBeVisible();
  await expect(profile.getByText(/No marker means no ceiling at that segment’s end/i)).toBeVisible();
  const timelineDurations = profile.getByRole("region", { name: "Timeline durations" });
  await expect(timelineDurations).toContainText("Descent travel");
  await expect(timelineDurations).toContainText("Bottom time");
  await expect(timelineDurations).toContainText("Ascent travel");
  await expect(timelineDurations).toContainText("Deco stops");
  const events = profile.getByRole("list", { name: "Profile events" });
  await expect(events).toBeVisible();
  const reserveEvent = events.getByRole("button", { name: /inspect .* reserve crossing/i }).first();
  await expect(reserveEvent).toBeVisible();
  await reserveEvent.click();
  await expect(graph).toHaveAttribute("aria-valuetext", /reserve crossing/i);
  await expect(reserveEvent.locator(".bf-profile__event-number")).toHaveText(/^\d+$/);

  await graph.scrollIntoViewIfNeeded();
  const bounds = await graph.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * .62, bounds!.y + bounds!.height * .5);
  await expect.poll(async () => Number(await graph.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await expect(profile.locator(".bf-profile__ceiling-current")).toBeVisible();
  await expect(profile.locator(".bf-profile__ceiling-label")).toContainText(/Ceiling .+ · \d+:/);
  await expect(profile.locator(".bf-profile__ceiling-label")).toHaveCSS("font-size", "17px");

  await graph.focus();
  await page.keyboard.press("Home");
  await expect(graph).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("ArrowRight");
  const firstBoundary = Number(await graph.getAttribute("aria-valuenow"));
  expect(firstBoundary).toBeGreaterThan(0);
  await page.keyboard.press("End");
  const maximum = Number(await graph.getAttribute("aria-valuemax"));
  await expect(graph).toHaveAttribute("aria-valuenow", String(maximum));

  await graph.dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    clientX: bounds!.x + bounds!.width * .25,
    clientY: bounds!.y + bounds!.height * .5,
  });
  await graph.dispatchEvent("pointermove", {
    pointerId: 41,
    pointerType: "touch",
    clientX: bounds!.x + bounds!.width * .45,
    clientY: bounds!.y + bounds!.height * .5,
  });
  await graph.dispatchEvent("pointerup", {
    pointerId: 41,
    pointerType: "touch",
    clientX: bounds!.x + bounds!.width * .45,
    clientY: bounds!.y + bounds!.height * .5,
  });
  const touchRuntime = Number(await graph.getAttribute("aria-valuenow"));
  expect(touchRuntime).toBeGreaterThan(maximum * .25);
  expect(touchRuntime).toBeLessThan(maximum * .6);

  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const scrollStart = await page.evaluate(() => window.scrollY);
  const touchX = bounds!.x + bounds!.width * .5;
  const touchStartY = bounds!.y + bounds!.height * .7;
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchX, y: touchStartY }],
  });
  for (let distance = 24; distance <= 120; distance += 24) {
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: touchX, y: touchStartY - distance }],
    });
  }
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollStart);
  await touchSession.detach();

  await profile.getByText("Profile data", { exact: false }).click();
  await expect(profile.getByRole("table", { name: "Profile segment data" })).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByText("Meters", { exact: true }).click();
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("slider", { name: "Primary profile timeline" })).toHaveAttribute("aria-valuetext", /\bm\b/);

  await page.setViewportSize({ width: 1024, height: 800 });
  const chartShell = profile.locator(".bf-profile__chart-shell");
  const readout = profile.getByTestId("profile-readout");
  const plotFrame = profile.locator(".bf-profile__plot-frame");
  await graph.scrollIntoViewIfNeeded();
  const containment = await Promise.all([
    chartShell.boundingBox(),
    readout.boundingBox(),
    plotFrame.boundingBox(),
  ]);
  expect(containment[0]).not.toBeNull();
  expect(containment[1]).not.toBeNull();
  expect(containment[2]).not.toBeNull();
  expect(containment[1]!.x).toBeGreaterThanOrEqual(containment[0]!.x);
  expect(containment[1]!.x + containment[1]!.width).toBeLessThanOrEqual(
    containment[0]!.x + containment[0]!.width,
  );
  expect(containment[1]!.y + containment[1]!.height).toBeLessThanOrEqual(containment[2]!.y);
});

test("exposes distinct CCR primary and bailout profile scrubbers", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByText("CCR", { exact: true }).first().click();
  await page.getByRole("button", { name: "Calculate plan" }).click();

  const primary = page.getByRole("slider", { name: "Primary profile timeline" });
  const bailout = page.getByRole("slider", { name: "Bailout profile timeline" });
  await expect(primary).toBeVisible();
  await expect(bailout).toBeVisible();
  const labelledIds = await page.locator("section.bf-profile").evaluateAll((profiles) =>
    profiles.map((profile) => profile.getAttribute("aria-labelledby")),
  );
  expect(new Set(labelledIds).size).toBe(labelledIds.length);

  await primary.focus();
  let setpointText = await primary.getAttribute("aria-valuetext") ?? "";
  // The loop is closed on the low setpoint from the surface, then switches up.
  expect(setpointText).toContain("setpoint 0.70 bar");
  for (let index = 0; index < 12 && !setpointText.includes("setpoint 1.30 bar"); index += 1) {
    await page.keyboard.press("ArrowRight");
    setpointText = await primary.getAttribute("aria-valuetext") ?? "";
  }
  expect(setpointText).toContain("plan CCR");
  expect(setpointText).toContain("setpoint 1.30 bar");
  await expect(bailout).toHaveAttribute("aria-valuetext", /plan CCR/i);
});
test("requires the pre-bailout diluent use and bails out onto the diluent when dil-out is the only bailout gas", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("radiogroup", { name: "Mode" }).getByText("CCR", { exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Low setpoint (bar)" })).toHaveValue("0.7");
  await expect(page.getByRole("spinbutton", { name: "High setpoint (bar)" })).toHaveValue("1.3");
  await expect(page.getByRole("spinbutton", { name: "Switch down to low setpoint (ft)" })).toBeVisible();
  const bailoutPanel = page.locator("section.bf-panel", { has: page.getByRole("heading", { name: "Bailout gases", exact: true }) });
  await bailoutPanel.getByRole("button", { name: "Remove" }).first().click();
  await bailoutPanel.getByRole("button", { name: "Remove" }).first().click();
  await page.getByText("Use diluent as bailout (dil-out)", { exact: true }).click();
  const preUse = page.getByRole("spinbutton", { name: "Diluent used before bailout (ft³)" });
  await expect(preUse).toHaveValue("");
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("heading", { name: "Calculation diagnostics" })).toBeVisible();
  await expect(page.getByText(/Dil-out needs the diluent volume you expect to use before bailout/)).toBeVisible();
  await preUse.fill("5");
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const results = page.getByRole("region", { name: "Calculated plan" });
  await expect(results).toBeVisible();
  await expect(results.getByText(/No open-circuit gas is breathed on this plan/)).toBeVisible();
  await expect(results.getByText(/diluent, bailout use only after 5\.0 ft³ used before bailout/)).toBeVisible();
});

test("plans gas volumes only and asks for a volume-based reserve", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("radiogroup", { name: "Gas planning" }).getByText("Gas only", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: /cylinder source/ })).toHaveCount(0);
  await expect(page.getByRole("spinbutton", { name: "Max PPO₂ (bar)" }).first()).toBeVisible();
  const useThirds = page.getByRole("button", { name: "Use thirds" });
  await expect(useThirds).toBeVisible();
  await useThirds.click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const results = page.getByRole("region", { name: "Calculated plan" });
  await expect(results.getByRole("columnheader", { name: "Minimum to carry" })).toBeVisible();
  await expect(results.getByText("Not checked (gas only)", { exact: true }).first()).toBeVisible();
  await expect(results.getByRole("columnheader", { name: "Remaining" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Cave", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Gas planning" })).toHaveCount(0);
});

test("charges the bottom RMV until the first stop for new OC plans and can switch back", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  const firstStopRule = page.getByRole("checkbox", { name: /^Bottom RMV until first stop/ });
  await expect(firstStopRule).toBeChecked();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const results = page.getByRole("region", { name: "Calculated plan" });
  const bottomGasRow = results.getByRole("row", { name: /^Tx18\/45 cylinder · / }).first();
  await expect(results.getByText(/charged at the bottom RMV until the first stop/)).toBeVisible();
  await expect(results.getByText(/the rule before 0\.5\.0/)).toHaveCount(0);
  const firstStopUse = await bottomGasRow.innerText();

  await page.getByRole("button", { name: "Edit inputs" }).click();
  await page.getByText("Bottom RMV until first stop", { exact: true }).click();
  await expect(firstStopRule).not.toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /^Updating$/ })).toBeVisible();
  await expect(results).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Plan workspace" }).getByText("Review", { exact: true }).click();
  await expect(results.getByText(/the rule before 0\.5\.0/)).toBeVisible();
  await expect(results.getByText(/charged at the bottom RMV until the first stop/)).toHaveCount(0);
  expect(await bottomGasRow.innerText()).not.toBe(firstStopUse);

  await page.getByRole("button", { name: "Edit inputs" }).click();
  await page.getByRole("radiogroup", { name: "Mode" }).getByText("CCR", { exact: true }).click();
  await expect(firstStopRule).toHaveCount(0);
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Cave", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Bottom RMV until first stop/ })).toHaveCount(0);
});

test("calculates and saves an OC plan, then keeps the snapshot immutable in the library", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("heading", { name: "Calculated plan" })).toBeVisible();
  await expect(page.getByText("Calculated", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Plan calculation complete" })).toBeVisible();
  await page.getByRole("button", { name: "Save snapshot" }).click();
  await page.getByLabel("Plan name").fill("OC regression plan");
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Snapshot saved locally" })).toBeVisible();
  await page.getByRole("button", { name: /^Saved plans/ }).first().click();
  await expect(page.getByRole("heading", { name: "OC regression plan" })).toBeVisible();
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: "OC regression plan copy" })).toBeVisible();
});

test("keeps the active Plan result current through edits and workspace navigation", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();

  const planWorkspace = page.getByRole("radiogroup", { name: "Plan workspace" });
  const calculatedPlan = page.getByRole("region", { name: "Calculated plan" });
  await expect(page.getByRole("status").filter({ hasText: /^Draft$/ })).toBeVisible();
  await expect(planWorkspace.getByRole("radio", { name: "Setup" })).toBeChecked();

  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(planWorkspace.getByRole("radio", { name: "Review" })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(calculatedPlan).toBeVisible();
  const runtimeMetric = calculatedPlan.locator(".bf-metric").filter({ hasText: "Runtime" }).first().locator("strong");
  const initialRuntime = await runtimeMetric.innerText();

  await page.getByRole("button", { name: "Edit inputs" }).click();
  await expect(planWorkspace.getByRole("radio", { name: "Setup" })).toBeChecked();
  await page.getByRole("spinbutton", { name: "Time at target depth (min)" }).fill("26");
  await expect(page.getByRole("status").filter({ hasText: /^Updating$/ })).toBeVisible();
  await expect(calculatedPlan).toBeHidden();

  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await planWorkspace.getByText("Review", { exact: true }).click();
  await expect(calculatedPlan).toBeVisible();
  await expect(calculatedPlan.getByRole("button", { name: "Save snapshot" })).toBeEnabled();
  const updatedRuntime = await runtimeMetric.innerText();
  expect(updatedRuntime).not.toBe(initialRuntime);

  await page.getByRole("button", { name: "Edit inputs" }).click();
  await page.getByRole("spinbutton", { name: "GF Low (%)" }).fill("80");
  await expect(page.getByRole("status").filter({ hasText: /^Updating$/ })).toBeVisible();
  await expect(calculatedPlan).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: /^Needs attention$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Calculation diagnostics" })).toBeVisible();
  await expect(planWorkspace.getByRole("radio", { name: "Review" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save snapshot" })).toBeHidden();

  await page.getByRole("spinbutton", { name: "GF Low (%)" }).fill("30");
  // Returning to the exact previously calculated input can restore that
  // matching result immediately; no new calculation is necessary.
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await planWorkspace.getByText("Review", { exact: true }).click();
  await expect(calculatedPlan).toBeVisible();

  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Tools", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();
  await expect(planWorkspace.getByRole("radio", { name: "Review" })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(runtimeMetric).toHaveText(updatedRuntime);
  await expect(calculatedPlan.getByRole("button", { name: "Save snapshot" })).toBeEnabled();
});

test("requires an explicit Plan update after a selected Tank Bank record changes", async ({ page }) => {
  await page.clock.install();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Use", exact: true }).click();

  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Calculated plan" })).toBeVisible();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Gas name" }).fill("Air revised");
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();

  const sourceChanged = page.getByRole("status").filter({ hasText: /^Source changed$/ });
  const calculatedPlan = page.getByRole("region", { name: "Calculated plan" });
  const review = page.getByRole("radio", { name: "Review" });
  const updatePlan = page.getByRole("button", { name: "Update plan" });
  await expect(sourceChanged).toBeVisible();
  await expect(calculatedPlan).toBeHidden();
  await expect(page.getByRole("button", { name: "Save snapshot" })).toBeHidden();
  await expect(review).toBeDisabled();

  // Ordinary Plan edits recalculate after 400 ms. A Tank Bank revision change
  // must remain blocked even after that automatic-update window has elapsed.
  await page.clock.fastForward(1_000);
  await expect(sourceChanged).toBeVisible();
  await expect(calculatedPlan).toBeHidden();
  await expect(page.getByRole("button", { name: "Save snapshot" })).toBeHidden();
  await expect(review).toBeDisabled();
  await expect(updatePlan).toBeVisible();

  await updatePlan.click();

  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(review).toBeChecked();
  await expect(calculatedPlan).toContainText("Air revised");
  await expect(calculatedPlan.getByRole("button", { name: "Save snapshot" })).toBeEnabled();
});

const unavailableSourceNotice = (page: Page) => page.getByRole("alert").filter({ hasText: "Tank Bank source unavailable." });

test("blocks Plan while its Tank Bank cylinder is archived and detaches only to the ad hoc values it shows", async ({ page }) => {
  await page.clock.install();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Use", exact: true }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();

  const unavailable = page.getByRole("status").filter({ hasText: /^Source unavailable$/ });
  const calculatedPlan = page.getByRole("region", { name: "Calculated plan" });
  const review = page.getByRole("radio", { name: "Review" });
  await expect(unavailable).toBeVisible();
  await expect(calculatedPlan).toBeHidden();
  await expect(review).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resolve Tank Bank source" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^(Calculate|Update) plan$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save snapshot" })).toBeHidden();
  // No automatic recalculation, even after the ordinary 400 ms update window.
  await page.clock.fastForward(1_000);
  await expect(unavailable).toBeVisible();
  await expect(calculatedPlan).toBeHidden();

  await expect(page.getByRole("region", { name: "Tank Bank sources unavailable" })).toContainText(
    "Bottom gas Air: “New cylinder” is archived in Tank Bank. Choose another cylinder or detach it to ad hoc values before calculating.",
  );
  const notice = unavailableSourceNotice(page);
  await expect(notice).toContainText("“New cylinder” is archived in Tank Bank. This gas is not calculated until you choose another cylinder or detach it to these ad hoc values:");
  // "Use" copied only the mix; the cylinder values are the ad hoc defaults, not the record's 232 bar fill.
  await expect(notice.getByRole("term")).toHaveText(["Gas", "O₂", "He", "Capacity", "Working pressure", "Starting pressure", "Cylinder minimum", "Cylinder max PPO₂"]);
  await expect(notice.getByRole("definition")).toHaveText(["Air", "21%", "0%", "196.6 ft³ rated", "3365 psi", "3046 psi", "508 psi", "1.40 bar"]);
  const bottomGas = page.locator(".bf-gas-editor").filter({ has: notice });
  await expect(bottomGas.getByRole("spinbutton")).toHaveCount(0);
  const source = page.getByLabel("Air cylinder source", { exact: true });
  await expect(source.locator("option:checked")).toHaveText("Unavailable · New cylinder");
  await expect(source.locator("option")).toHaveText(["Unavailable · New cylinder", "Ad hoc plan cylinder"]);
  await expect(page.getByRole("radiogroup", { name: "Gas planning" }).getByRole("radio", { name: "Gas only" })).toBeDisabled();

  await notice.getByRole("button", { name: "Detach to ad hoc values" }).click();
  await expect(unavailableSourceNotice(page)).toHaveCount(0);
  await expect(source).toBeFocused();
  await expect(source).toHaveValue("");
  const detached = page.locator(".bf-gas-editor").first();
  await expect(detached.getByRole("spinbutton", { name: "Starting pressure (psi)" })).toHaveValue("3046");
  await expect(detached.getByRole("spinbutton", { name: "Working pressure (psi)" })).toHaveValue("3365");
  await expect(detached.getByRole("spinbutton", { name: "O₂ (%)" })).toHaveValue("21");
  const sourceChanged = page.getByRole("status").filter({ hasText: /^Source changed$/ });
  await expect(sourceChanged).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(sourceChanged).toBeVisible();
  await expect(calculatedPlan).toBeHidden();

  await page.getByRole("button", { name: "Update plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(review).toBeChecked();
  await expect(calculatedPlan.getByRole("button", { name: "Save snapshot" })).toBeEnabled();
});

test("blocks Plan after its Tank Bank cylinder is deleted until the diver chooses another cylinder", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Duplicate" }).click();
  const cards = page.locator(".bf-tank-card");
  await expect(cards).toHaveCount(2);
  await cards.filter({ hasNotText: "New cylinder copy" }).getByRole("button", { name: "Use", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Draft$/ })).toBeVisible();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await cards.filter({ hasNotText: "New cylinder copy" }).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete cylinder" }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();

  await expect(page.getByRole("status").filter({ hasText: /^Source unavailable$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Calculate plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resolve Tank Bank source" })).toBeDisabled();
  await expect(unavailableSourceNotice(page)).toContainText("The selected Tank Bank cylinder no longer exists in Tank Bank.");
  const source = page.getByLabel("Air cylinder source", { exact: true });
  await expect(source.locator("option")).toHaveText(["Unavailable · selected cylinder", "Ad hoc plan cylinder", "New cylinder copy · Air"]);

  await source.selectOption({ label: "New cylinder copy · Air" });
  await expect(unavailableSourceNotice(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Tank Bank sources unavailable" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^Draft$/ })).toBeVisible();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
});

test("names an unreadable Tank Bank on a sourced Plan gas and leaves the stored data untouched", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Use", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Draft$/ })).toBeVisible();

  const unreadable = JSON.stringify({ schemaVersion: 2, records: [] });
  await page.evaluate((raw) => localStorage.setItem("barefoot-dive:tank-bank", raw), unreadable);
  // Plan reads the Tank Bank again when it reopens; the session draft keeps its selected cylinder.
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();

  await expect(page.getByRole("status").filter({ hasText: /^Source unavailable$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tank Bank sources unavailable" })).toContainText(
    "Bottom gas Air: Tank Bank could not be read, so the selected cylinder cannot be loaded: Stored schema version 2 is not supported by this app version.",
  );
  const source = page.getByLabel("Air cylinder source", { exact: true });
  await expect(source.locator("option")).toHaveText(["Unavailable · selected cylinder", "Ad hoc plan cylinder"]);
  await expect(page.getByRole("radiogroup", { name: "Gas planning" }).getByRole("radio", { name: "Gas only" })).toBeDisabled();
  await expect(page.getByText("Gas only is off while a Tank Bank source is unavailable")).toBeVisible();

  await unavailableSourceNotice(page).getByRole("button", { name: "Detach to ad hoc values" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Draft$/ })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Gas planning" }).getByRole("radio", { name: "Gas only" })).toBeEnabled();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("barefoot-dive:tank-bank"))).toBe(unreadable);
});

test("blocks Plan when its Tank Bank record is quarantined and names the stored cylinder", async ({ page }) => {
  await page.clock.install();
  const backGas = { ...storedCylinder("cylinder-back-gas", "Back gas 24 L", { id: "air", name: "Air", oxygen: 0.21, helium: 0, role: "bottom" }), waterVolumeL: 24 };
  const spare = { ...storedCylinder("cylinder-spare", "Spare 24 L", { id: "air-spare", name: "Air", oxygen: 0.21, helium: 0, role: "bottom" }), waterVolumeL: 24 };
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.evaluate((records) => localStorage.setItem("barefoot-dive:tank-bank", JSON.stringify({ schemaVersion: 1, records })), [backGas, spare]);
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.locator(".bf-tank-card").filter({ hasText: "Back gas 24 L" }).getByRole("button", { name: "Use", exact: true }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();

  // The stored record is damaged outside the app: a text O₂ fraction fails validation, so the read quarantines it.
  const damaged = JSON.stringify({ schemaVersion: 1, records: [{ ...backGas, gas: { ...backGas.gas, oxygen: "0.21" } }, spare] });
  await page.evaluate((raw) => localStorage.setItem("barefoot-dive:tank-bank", raw), damaged);
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();

  const unavailable = page.getByRole("status").filter({ hasText: /^Source unavailable$/ });
  await expect(unavailable).toBeVisible();
  await expect(page.getByRole("region", { name: "Calculated plan" })).toBeHidden();
  await expect(page.getByRole("radio", { name: "Review" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resolve Tank Bank source" })).toBeDisabled();
  await page.clock.fastForward(1_000);
  await expect(unavailable).toBeVisible();
  await expect(page.getByRole("region", { name: "Tank Bank sources unavailable" })).toContainText(
    "Bottom gas Air: “Back gas 24 L” failed validation and is quarantined in Tank Bank. Choose another cylinder or detach it to ad hoc values before calculating.",
  );
  await expect(unavailableSourceNotice(page)).toContainText("“Back gas 24 L” failed validation and is quarantined in Tank Bank.");
  const source = page.getByLabel("Air cylinder source", { exact: true });
  await expect(source.locator("option:checked")).toHaveText("Unavailable · Back gas 24 L");
  await expect(source.locator("option")).toHaveText(["Unavailable · Back gas 24 L", "Ad hoc plan cylinder", "Spare 24 L · Air"]);

  await source.selectOption({ label: "Spare 24 L · Air" });
  await expect(unavailableSourceNotice(page)).toHaveCount(0);
  const sourceChanged = page.getByRole("status").filter({ hasText: /^Source changed$/ });
  await expect(sourceChanged).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(sourceChanged).toBeVisible();
  await page.getByRole("button", { name: "Update plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  // Reading, blocking, and re-selecting never wrote to the stored Tank Bank.
  expect(await page.evaluate(() => localStorage.getItem("barefoot-dive:tank-bank"))).toBe(damaged);
});

/** Makes the Tank Bank unreadable, then restores its exact stored text, reopening `workspace` after each step. */
async function interruptTankBank(page: Page, workspace: "Plan" | "Cave") {
  const reopen = async () => {
    await page.getByRole("button", { name: "Tools", exact: true }).first().click();
    await page.getByRole("button", { name: workspace, exact: true }).first().click();
  };
  const stored = await page.evaluate(() => localStorage.getItem("barefoot-dive:tank-bank") ?? "");
  await page.evaluate(() => localStorage.setItem("barefoot-dive:tank-bank", JSON.stringify({ schemaVersion: 2, records: [] })));
  await reopen();
  await expect(page.getByRole("status").filter({ hasText: /^Source unavailable$/ })).toBeVisible();
  await page.evaluate((raw) => localStorage.setItem("barefoot-dive:tank-bank", raw), stored);
  await reopen();
}

test("keeps an earlier Plan result hidden after an unavailable source returns unchanged", async ({ page }) => {
  await page.clock.install();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Use", exact: true }).click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();

  await interruptTankBank(page, "Plan");
  // The record and every input are byte-identical to the calculation, but the source went missing in between.
  const sourceChanged = page.getByRole("status").filter({ hasText: /^Source changed$/ });
  await expect(sourceChanged).toBeVisible();
  await expect(unavailableSourceNotice(page)).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Review" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Calculated plan" })).toBeHidden();
  await page.clock.fastForward(1_000);
  await expect(sourceChanged).toBeVisible();

  await page.getByRole("button", { name: "Update plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Calculated plan" })).toBeVisible();
});

test("blocks Plan while one Tank Bank cylinder is selected for two gases and names both", async ({ page }) => {
  await page.clock.install();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();

  // Once the oxygen gas takes the cylinder, the bottom gas's source control names that gas and does not offer it.
  const bottomSource = page.getByLabel("Tx18/45 cylinder source", { exact: true });
  const oxygenSource = page.getByLabel("Oxygen cylinder source", { exact: true });
  await oxygenSource.selectOption({ label: "New cylinder · Air" });
  const bottomOption = bottomSource.locator("option", { hasText: "New cylinder" });
  await expect(bottomOption).toHaveText("New cylinder · Air · used by deco gas Oxygen");
  await expect(bottomOption).toBeDisabled();

  // Switched off, the oxygen gas holds no cylinder, so the bottom gas can take it. Calculate that plan.
  const includeOxygen = page.getByRole("checkbox", { name: "Include Air in plan" });
  await includeOxygen.uncheck();
  await expect(bottomOption).toHaveText("New cylinder · Air");
  await bottomSource.selectOption({ label: "New cylinder · Air" });
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const current = page.getByRole("status").filter({ hasText: /^Current$/ });
  await expect(current).toBeVisible();
  await page.getByRole("button", { name: "Edit inputs" }).click();

  // Switching the oxygen gas back on puts both gases on one record.
  await includeOxygen.check();
  const shared = page.getByRole("status").filter({ hasText: /^Cylinder shared$/ });
  const calculatedPlan = page.getByRole("region", { name: "Calculated plan" });
  await expect(shared).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve shared cylinder" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^(Calculate|Update) plan$/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Review" })).toBeDisabled();
  await expect(calculatedPlan).toBeHidden();
  await expect(page.getByRole("region", { name: "Shared Tank Bank cylinders" })).toContainText(
    "Bottom gas Tx18/45 and deco gas Oxygen both use Tank Bank cylinder “New cylinder”. Choose another cylinder for one of them; a plan needs one cylinder per gas.",
  );
  await expect(page.getByText(/Gas identifier .* is duplicated/)).toHaveCount(0);
  // Each gas's source control shows the record it shares, names the other gas, and is described by its error.
  await expect(bottomSource.locator("option:checked")).toHaveText("New cylinder · Air · used by deco gas Oxygen");
  await expect(oxygenSource.locator("option:checked")).toHaveText("New cylinder · Air · used by bottom gas Tx18/45");
  await expect(bottomSource).toHaveAttribute("aria-invalid", "true");
  await expect(bottomSource).toHaveAccessibleDescription("Deco gas Oxygen also uses this cylinder. Give each gas its own cylinder.");
  await expect(oxygenSource).toHaveAccessibleDescription("Bottom gas Tx18/45 also uses this cylinder. Give each gas its own cylinder.");
  // Nothing recalculates while the cylinder is shared, even after the ordinary 400 ms update window.
  await page.clock.fastForward(1_000);
  await expect(shared).toBeVisible();
  await expect(calculatedPlan).toBeHidden();

  // No Tank Bank record changed, so the earlier result matches again once the draft returns to it.
  await includeOxygen.uncheck();
  await expect(current).toBeVisible();
  await expect(page.getByRole("region", { name: "Shared Tank Bank cylinders" })).toHaveCount(0);
  await expect(bottomSource).not.toHaveAttribute("aria-invalid");
  await expect(bottomSource).toHaveAccessibleDescription("");
  await expect(page.getByRole("button", { name: "Review plan" })).toBeEnabled();

  // Cave uses the same source controls.
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByLabel("Tx18/45 cylinder source", { exact: true }).selectOption({ label: "New cylinder · Air" });
  const caveOption = page.getByLabel("Oxygen cylinder source", { exact: true }).locator("option", { hasText: "New cylinder" });
  await expect(caveOption).toHaveText("New cylinder · Air · used by bottom gas Tx18/45");
  await expect(caveOption).toBeDisabled();
});

test("calculates CCR, cave, and the Tools library without a remote dependency", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByText("CCR", { exact: true }).first().click();
  await page.getByRole("button", { name: "Calculate plan" }).click();
  await expect(page.getByRole("heading", { name: "Calculated plan" })).toBeVisible();

  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByRole("heading", { name: "Cave summary" })).toBeVisible();
  const caveCompletion = page.getByRole("status").filter({ hasText: "Cave calculation contains safety errors" });
  await expect(caveCompletion).toBeVisible();
  await expect(caveCompletion).toBeInViewport();

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

test("keeps the active Cave result current through edits and workspace navigation", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();

  const caveWorkspace = page.getByRole("radiogroup", { name: "Cave workspace" });
  const calculatedCave = page.getByRole("region", { name: "Calculated cave plan" });
  await expect(page.getByRole("status").filter({ hasText: /^Draft$/ })).toBeVisible();
  await expect(caveWorkspace.getByRole("radio", { name: "Setup" })).toBeChecked();

  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(caveWorkspace.getByRole("radio", { name: "Review" })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(calculatedCave).toBeVisible();

  const caveSummary = page.getByRole("heading", { name: "Cave summary" });
  await expect(caveSummary).toBeVisible();
  const penetrationTime = calculatedCave.locator(".bf-metric").filter({ hasText: "Penetration time" }).locator("strong");
  const initialTime = await penetrationTime.innerText();

  await page.getByRole("button", { name: "Edit inputs" }).click();
  await expect(caveWorkspace.getByRole("radio", { name: "Setup" })).toBeChecked();
  await page.locator(".bf-route-editor").first().getByRole("spinbutton", { name: "Duration (min)" }).fill("6");
  await expect(page.getByRole("status").filter({ hasText: /^Updating$/ })).toBeVisible();
  await expect(calculatedCave).toBeHidden();
  await expect(caveWorkspace.getByRole("radio", { name: "Review" })).toBeDisabled();

  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await caveWorkspace.getByText("Review", { exact: true }).click();
  await expect(caveSummary).toBeVisible();
  await expect(calculatedCave.getByRole("button", { name: "Save cave snapshot" })).toBeEnabled();
  const updatedTime = await penetrationTime.innerText();
  expect(updatedTime).not.toBe(initialTime);

  const scenarioResults = page.getByRole("radiogroup", { name: "Scenario result" });
  await scenarioResults.getByText("Lost buddy", { exact: true }).click();
  await expect(scenarioResults.getByRole("radio", { name: "Lost buddy" })).toBeChecked();
  const baseTimeline = calculatedCave.getByRole("region", { name: "Base cave plan" }).getByRole("slider", { name: "Primary profile timeline" });
  const scenarioTimeline = calculatedCave.getByRole("region", { name: "Lost buddy plan" }).getByRole("slider", { name: "Primary profile timeline" });
  await expect(baseTimeline).toBeVisible();
  await expect(scenarioTimeline).toBeVisible();
  const baseDurations = calculatedCave.getByRole("region", { name: "Base cave plan" }).getByRole("region", { name: "Timeline durations" });
  const scenarioDurations = calculatedCave.getByRole("region", { name: "Lost buddy plan" }).getByRole("region", { name: "Timeline durations" });
  await expect(baseDurations).toContainText("Penetration travel");
  await expect(baseDurations).toContainText("Exit travel");
  await expect(scenarioDurations).toContainText("Penetration travel");
  await expect(scenarioDurations).toContainText("Exit travel");
  await scenarioTimeline.focus();
  await page.keyboard.press("End");
  await expect(scenarioTimeline).toHaveAttribute("aria-valuenow", await scenarioTimeline.getAttribute("aria-valuemax") ?? "");

  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await expect(caveWorkspace.getByRole("radio", { name: "Review" })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(penetrationTime).toHaveText(updatedTime);
  await expect(scenarioResults.getByRole("radio", { name: "Lost buddy" })).toBeChecked();

  await page.getByRole("button", { name: "Edit inputs" }).click();
  await page.locator(".bf-route-editor").first().getByRole("spinbutton", { name: "Duration (min)" }).fill("0");
  await expect(page.getByRole("status").filter({ hasText: /^Updating$/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Needs attention$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cave calculation diagnostics" })).toBeVisible();
  await expect(caveWorkspace.getByRole("radio", { name: "Review" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save cave snapshot" })).toBeHidden();

  await page.locator(".bf-route-editor").first().getByRole("spinbutton", { name: "Duration (min)" }).fill("6");
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await caveWorkspace.getByText("Review", { exact: true }).click();
  await expect(calculatedCave).toBeVisible();
});

test("requires an explicit Cave update after a selected Tank Bank record changes", async ({ page }) => {
  await page.clock.install();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();

  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByLabel("Tx18/45 cylinder source").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Calculated cave plan" })).toBeVisible();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Gas name" }).fill("Air revised");
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();

  const sourceChanged = page.getByRole("status").filter({ hasText: /^Source changed$/ });
  const calculatedCave = page.getByRole("region", { name: "Calculated cave plan" });
  const review = page.getByRole("radio", { name: "Review" });
  const updateCave = page.getByRole("button", { name: "Update cave plan" });
  await expect(sourceChanged).toBeVisible();
  await expect(calculatedCave).toBeHidden();
  await expect(page.getByRole("button", { name: "Save cave snapshot" })).toBeHidden();
  await expect(review).toBeDisabled();

  await page.clock.fastForward(1_000);
  await expect(sourceChanged).toBeVisible();
  await expect(calculatedCave).toBeHidden();
  await expect(updateCave).toBeVisible();

  await updateCave.click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(review).toBeChecked();
  await expect(calculatedCave).toContainText("Air revised");
  await expect(calculatedCave.getByRole("button", { name: "Save cave snapshot" })).toBeEnabled();
});

test("blocks Cave while its Tank Bank cylinder is archived, like Plan, until the diver detaches it", async ({ page }) => {
  await page.clock.install();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();

  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByLabel("Tx18/45 cylinder source").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();

  const unavailable = page.getByRole("status").filter({ hasText: /^Source unavailable$/ });
  const calculatedCave = page.getByRole("region", { name: "Calculated cave plan" });
  await expect(unavailable).toBeVisible();
  await expect(calculatedCave).toBeHidden();
  await expect(page.getByRole("radio", { name: "Review" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resolve Tank Bank source" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save cave snapshot" })).toBeHidden();
  await page.clock.fastForward(1_000);
  await expect(unavailable).toBeVisible();
  await expect(calculatedCave).toBeHidden();

  // Selecting a cylinder copies nothing into the draft, so the ad hoc fields still hold Tx18/45.
  await expect(page.getByRole("region", { name: "Tank Bank sources unavailable" })).toContainText("Bottom gas Tx18/45: “New cylinder” is archived in Tank Bank.");
  const notice = page.getByRole("alert").filter({ hasText: "Tank Bank source unavailable." });
  await expect(notice.getByRole("definition")).toHaveText(["Tx18/45", "18%", "45%", "196.6 ft³ rated", "3365 psi", "3046 psi", "508 psi", "1.40 bar"]);
  await expect(page.getByLabel("Tx18/45 cylinder source").locator("option:checked")).toHaveText("Unavailable · New cylinder");

  await notice.getByRole("button", { name: "Detach to ad hoc values" }).click();
  const sourceChanged = page.getByRole("status").filter({ hasText: /^Source changed$/ });
  await expect(sourceChanged).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(sourceChanged).toBeVisible();
  await page.getByRole("button", { name: "Update cave plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(calculatedCave).toContainText("Tx18/45");
});

test("keeps an earlier Cave result hidden after an unavailable source returns unchanged", async ({ page }) => {
  await page.clock.install();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByLabel("Tx18/45 cylinder source").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();

  await interruptTankBank(page, "Cave");
  const sourceChanged = page.getByRole("status").filter({ hasText: /^Source changed$/ });
  await expect(sourceChanged).toBeVisible();
  await expect(page.getByRole("radio", { name: "Review" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Calculated cave plan" })).toBeHidden();
  await page.clock.fastForward(1_000);
  await expect(sourceChanged).toBeVisible();

  await page.getByRole("button", { name: "Update cave plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Calculated cave plan" })).toBeVisible();
});

test("keeps Cave leg access and the stage with each gas when its cylinder source changes", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();

  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  const bottomSource = page.getByLabel("Tx18/45 cylinder source");
  await bottomSource.selectOption({ label: "New cylinder · Air" });
  const leg = page.locator(".bf-route-editor").first();
  const access = (name: string) => leg.getByRole("checkbox", { name, exact: true });
  await expect(access("New cylinder")).toBeChecked();
  // Untick and re-tick a cylinder so the leg records its own access list.
  await access("EAN50 cylinder").uncheck();
  await access("EAN50 cylinder").check();

  // Back to the ad hoc cylinder: the bottom gas stays accessible on the leg under its new cylinder id.
  await bottomSource.selectOption({ label: "Ad hoc plan cylinder" });
  await expect(leg.getByRole("checkbox")).toHaveCount(3);
  for (const name of ["Tx18/45 cylinder", "EAN50 cylinder", "Oxygen cylinder"]) await expect(access(name)).toBeChecked();
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Current$/ })).toBeVisible();
  const calculatedCave = page.getByRole("region", { name: "Calculated cave plan" });
  await expect(calculatedCave).toContainText("Tx18/45");

  // A stage dropped on the leg stays with its gas when that gas is sourced from Tank Bank and detached again.
  await page.getByRole("button", { name: "Edit inputs" }).click();
  await leg.getByRole("combobox", { name: "Stage action" }).selectOption("drop");
  const stageCylinder = leg.getByRole("combobox", { name: "Stage cylinder" });
  await stageCylinder.selectOption({ label: "EAN50 cylinder" });
  const ean50Source = page.getByLabel("EAN50 cylinder source");
  await ean50Source.selectOption({ label: "New cylinder · Air" });
  await expect(stageCylinder.locator("option:checked")).toHaveText("New cylinder");
  await expect(access("New cylinder")).toBeChecked();
  await expect(access("EAN50 cylinder")).toHaveCount(0);
  await ean50Source.selectOption({ label: "Ad hoc plan cylinder" });
  await expect(stageCylinder.locator("option:checked")).toHaveText("EAN50 cylinder");
  await expect(access("EAN50 cylinder")).toBeChecked();
  await expect(page.getByRole("region", { name: "Shared Tank Bank cylinders" })).toHaveCount(0);
});

test("blocks Cave while one Tank Bank cylinder is selected for two gases and keeps each gas's leg access", async ({ page }) => {
  await page.clock.install();
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();

  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  const oxygenSource = page.getByLabel("Oxygen cylinder source");
  const includeOxygen = page.getByRole("checkbox", { name: "Include Air in plan" });
  const leg = page.locator(".bf-route-editor").first();
  const access = (name: string) => leg.getByRole("checkbox", { name, exact: true });
  // The source control does not offer a record another active gas uses, so the oxygen gas takes the record
  // first, is made inaccessible on the leg, and is switched off while the bottom gas takes the record too.
  await oxygenSource.selectOption({ label: "New cylinder · Air" });
  await access("New cylinder").uncheck();
  await includeOxygen.uncheck();
  await page.getByLabel("Tx18/45 cylinder source").selectOption({ label: "New cylinder · Air" });
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  const current = page.getByRole("status").filter({ hasText: /^Current$/ });
  await expect(current).toBeVisible();
  await page.getByRole("button", { name: "Edit inputs" }).click();

  // Switched back on, the oxygen gas shares the record the bottom gas uses.
  await includeOxygen.check();
  const shared = page.getByRole("status").filter({ hasText: /^Cylinder shared$/ });
  await expect(shared).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve shared cylinder" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^(Calculate|Update) cave plan$/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Review" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Shared Tank Bank cylinders" })).toContainText(
    "Bottom gas Tx18/45 and deco gas Oxygen both use Tank Bank cylinder “New cylinder”. Choose another cylinder for one of them; a cave plan needs one cylinder per gas.",
  );
  // The leg shows the two gases' different access as mixed and cannot overwrite either one.
  await expect(access("New cylinder")).toBeChecked({ indeterminate: true });
  await expect(access("New cylinder")).toBeDisabled();
  await expect(leg.getByRole("group", { name: "Cylinders accessible on this leg" })).toContainText("“New cylinder” is selected for more than one gas.");
  // Nothing recalculates while the cylinder is shared, even after the ordinary 400 ms update window.
  await page.clock.fastForward(1_000);
  await expect(shared).toBeVisible();
  await expect(page.getByRole("region", { name: "Calculated cave plan" })).toBeHidden();

  // Switched off again, the draft is the one calculated, so the earlier result matches again.
  await includeOxygen.uncheck();
  await expect(current).toBeVisible();

  // Back on and then on its own cylinder, the oxygen gas is still inaccessible and the bottom gas accessible.
  await includeOxygen.check();
  await expect(shared).toBeVisible();
  await oxygenSource.selectOption({ label: "Ad hoc plan cylinder" });
  await expect(access("Oxygen cylinder")).not.toBeChecked();
  await expect(access("New cylinder")).toBeChecked();
  await expect(page.getByRole("region", { name: "Shared Tank Bank cylinders" })).toHaveCount(0);
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
  await expect(page.getByRole("status").filter({ hasText: "Cave snapshot saved locally" })).toBeVisible();

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
  const calculatedCave = page.getByRole("region", { name: "Calculated cave plan" });
  await expect(calculatedCave.getByText("Aggregate cave status", { exact: true })).toBeVisible();
  await expect(calculatedCave.getByText("Unsafe or unavailable", { exact: true }).first()).toBeVisible();
  await expect(calculatedCave.getByRole("heading", { name: "Aggregate cave diagnostics" })).toBeVisible();
  await expect(calculatedCave.getByText(/scooter failure: Scooter failure must target a scooter-propelled leg/)).toBeVisible();
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
  await expect(page.getByRole("status").filter({ hasText: "Plan updated" })).toBeVisible();
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
  await expect(page.getByRole("status").filter({ hasText: "Cylinder saved locally" })).toBeVisible();
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

test("keeps every Tank Bank delete action inside its card and clickable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await page.getByRole("button", { name: "Duplicate" }).click();

  const cards = page.locator(".bf-tank-card");
  await expect(cards).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const card = cards.nth(index);
    const deleteButton = card.getByRole("button", { name: "Delete", exact: true });
    const cardBox = await card.boundingBox();
    const buttonBox = await deleteButton.boundingBox();

    expect(cardBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);

    await deleteButton.click();
    await expect(page.getByRole("dialog", { name: "Delete this cylinder?" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  }
});

const storedCylinder = (id: string, name: string, gas: Record<string, unknown>) => ({
  id,
  name,
  waterVolumeL: 12,
  workingPressureBar: 232,
  currentPressureBar: 200,
  minimumPressureBar: 50,
  maximumPPO2: 1.4,
  role: "bottom",
  archived: false,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  gas,
});

test("quarantines one invalid Tank Bank record while the valid cylinders stay usable", async ({ page }) => {
  const valid = storedCylinder("cylinder-valid", "Back gas 12 L", { id: "air", name: "Air", oxygen: 0.21, helium: 0, role: "bottom" });
  const invalid = storedCylinder("cylinder-broken", "Broken deco", { id: "ean50", name: "EAN50", oxygen: "0.50", helium: 0, role: "deco" });
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.evaluate((records) => {
    localStorage.setItem("barefoot-dive:tank-bank", JSON.stringify({ schemaVersion: 1, records }));
  }, [valid, invalid]);
  await page.reload();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  const notice = page.getByRole("region", { name: "Quarantined cylinder records" });
  await expect(notice).toContainText("Stored record 2 (“Broken deco”) has missing or invalid fields: gas.oxygen.");
  await expect(notice).toContainText("Quarantined records stay unchanged in local storage and are not listed here or offered to Plan, Cave, or Tools.");
  await expect(page.locator(".bf-tank-card")).toHaveCount(1);
  await expect(page.locator(".bf-tank-card")).toContainText("Back gas 12 L");
  await page.getByRole("textbox", { name: "Search tanks" }).fill("no such cylinder");
  await expect(page.getByRole("heading", { name: "No matching cylinders" })).toBeVisible();
  await expect(page.getByText("Tank Bank is empty")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search tanks" }).fill("");
  await expect(page.locator(".bf-tank-card")).toHaveCount(1);

  await page.getByRole("button", { name: "Plan", exact: true }).first().click();
  await expect(page.getByLabel("Tx18/45 cylinder source").locator("option")).toHaveText(["Ad hoc plan cylinder", "Back gas 12 L · Air"]);

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Cylinder name" }).fill("Back gas revised");
  await page.getByRole("button", { name: "Save cylinder" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cylinder updated locally" })).toBeVisible();
  await expect(notice).toBeVisible();
  const raw = await page.evaluate(() => localStorage.getItem("barefoot-dive:tank-bank") ?? "");
  const stored = JSON.parse(raw) as { schemaVersion: number; records: { name: string }[] };
  expect(stored.schemaVersion).toBe(1);
  expect(stored.records.map((record) => record.name)).toEqual(["Back gas revised", "Broken deco"]);
  expect(raw).toContain(`,${JSON.stringify(invalid)}]}`);
});

test("reports an unreadable Tank Bank instead of an empty one and leaves the stored data untouched", async ({ page }) => {
  const future = JSON.stringify({ schemaVersion: 2, records: [{ id: "cylinder-future" }] });
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.evaluate((raw) => localStorage.setItem("barefoot-dive:tank-bank", raw), future);
  await page.reload();

  await page.getByRole("button", { name: "Tank bank", exact: true }).first().click();
  const unreadable = page.locator(".bf-empty-state");
  await expect(unreadable.getByRole("heading", { name: "Tank Bank could not be read" })).toBeVisible();
  await expect(unreadable).toContainText("Stored schema version 2 is not supported by this app version. (STORAGE_INVALID) The stored data has not been changed");
  await expect(page.getByText("Tank Bank is empty")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add cylinder" })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("barefoot-dive:tank-bank"))).toBe(future);
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
  await expect(depthMetric.getByText("111 ft", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Depth and distance" }).getByText("Meters", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(oxygen).toHaveValue("32");
  await expect(depthMetric.getByText("34 m", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Depth and distance" }).getByText("Feet", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(oxygen).toHaveValue("32");
  await expect(depthMetric.getByText("111 ft", { exact: true })).toBeVisible();
});

test("uses the configured surface-gas units throughout Tools without rewriting canonical values", async ({ page }) => {
  await page.getByRole("button", { name: /understand and accept/i }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^SAC \/ RMV/ }).click();

  const imperialGasUsed = page.getByRole("spinbutton", { name: "Gas used (ft³)" });
  const sacMetric = page.locator(".bf-metric").filter({ hasText: "SAC / RMV" });
  await expect(imperialGasUsed).toHaveValue("21.2");
  await expect(imperialGasUsed).toHaveAttribute("step", "0.1");
  await expect(sacMetric.getByText("0.5 ft³/min", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Cylinder capacity" }).getByText("Water-volume L", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  const metricGasUsed = page.getByRole("spinbutton", { name: "Gas used (L)" });
  await expect(metricGasUsed).toHaveValue("600");
  await expect(metricGasUsed).toHaveAttribute("step", "1");
  await expect(sacMetric.getByText("15.0 L/min", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radiogroup", { name: "Cylinder capacity" }).getByText("Rated ft³", { exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(imperialGasUsed).toHaveValue("21.2");
  await expect(sacMetric.getByText("0.5 ft³/min", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Apply OC bottom RMV" }).click();
  const confirmation = page.getByRole("dialog", { name: "Apply this exact change?" });
  await expect(confirmation).toContainText("ft³/min");
  await expect(confirmation).not.toContainText("L/min");
  await confirmation.getByRole("button", { name: "Keep checking" }).click();

  await page.getByRole("button", { name: "All tools" }).click();
  await page.getByRole("button", { name: /^Gas Duration/ }).click();
  const rmv = page.getByRole("spinbutton", { name: "RMV (ft³/min)" });
  await expect(rmv).toHaveValue("0.7");
  await expect(rmv).toHaveAttribute("step", "0.1");
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
  await expect(page.getByText("Stressed RMV: 0.7 ft³/min", { exact: false })).toBeVisible();
  const apply = page.getByRole("button", { name: "Apply reserve assumptions" });
  await expect(apply).toBeEnabled();
  await page.getByRole("spinbutton", { name: "Stressed RMV (ft³/min)" }).fill("0.9");
  await expect(page.getByText("Updating", { exact: true })).toBeVisible();
  await expect(page.getByText("Stressed RMV: 0.7 ft³/min", { exact: false })).toHaveCount(0);
  await expect(apply).toBeDisabled();
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await page.getByText("Calculated assumptions", { exact: true }).click();
  await expect(page.getByText("Stressed RMV: 0.9 ft³/min", { exact: false })).toBeVisible();
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
  await page.getByRole("spinbutton", { name: "Stressed RMV (ft³/min)" }).fill("0");
  await expect(page.getByText("Check inputs", { exact: true })).toBeVisible();
  await expect(page.getByText("Fix the highlighted inputs to restore the live result.", { exact: true })).toBeVisible();
  await expect(apply).toBeDisabled();
  await page.getByRole("spinbutton", { name: "Stressed RMV (ft³/min)" }).fill("0.9");
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Emergency mode" }).getByText("Simplified Bailout", { exact: true }).click();
  await expect(page.getByText("Updating", { exact: true })).toBeVisible();
  await expect(page.getByText("Planning context: CCR", { exact: false })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Cylinder context" }).getByRole("radio", { name: "Required cylinder" })).toBeChecked();
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
});

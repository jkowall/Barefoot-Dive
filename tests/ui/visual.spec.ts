import { expect, test, type Page } from "@playwright/test";

async function prepareLongCapture(page: Page) {
  const mobileStyles = (page.viewportSize()?.width ?? 900) < 900
    ? ".bf-nav--bottom { position: static !important; } .bf-content { padding-bottom: 1.5rem !important; }"
    : "";
  await page.addStyleTag({ content: `
    .bf-topbar { position: static !important; }
    .bf-plan-context { position: static !important; }
    ${mobileStyles}
  ` });
  await page.evaluate(() => window.scrollTo(0, 0));
}

test("plan workspace visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await prepareLongCapture(page);
  await expect(page).toHaveScreenshot(`plan-${testInfo.project.name}.png`, { fullPage: true });
});

test("calculated plan output visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const results = page.getByRole("region", { name: "Calculated plan" });
  await expect(results).toBeVisible();
  await prepareLongCapture(page);
  await expect(results).toHaveScreenshot(`plan-results-${testInfo.project.name}.png`);
});

test("selected profile scrubber visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Calculate plan" }).click();
  const graph = page.getByRole("slider", { name: "Primary profile timeline" });
  await expect(graph).toBeVisible();
  await prepareLongCapture(page);
  await graph.scrollIntoViewIfNeeded();
  const bounds = await graph.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * .68, bounds!.y + bounds!.height * .5);
  await expect.poll(async () => Number(await graph.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  const panel = graph.locator("xpath=ancestor::section[contains(@class, 'bf-panel')][1]");
  await expect(panel).toHaveScreenshot(`profile-selected-${testInfo.project.name}.png`);
});

test("cave workspace visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Cave", exact: true })).toBeVisible();
  await prepareLongCapture(page);
  await expect(page).toHaveScreenshot(`cave-${testInfo.project.name}.png`, { fullPage: true });
});

test("calculated cave output visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  const results = page.getByRole("region", { name: "Calculated cave plan" });
  await expect(results).toBeVisible();
  await prepareLongCapture(page);
  await expect(results).toHaveScreenshot(`cave-results-${testInfo.project.name}.png`);
});

test("Tools library visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Tools", exact: true })).toBeVisible();
  await prepareLongCapture(page);
  await expect(page).toHaveScreenshot(`tools-library-${testInfo.project.name}.png`, { fullPage: true });
});

test("Tools simple result visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^MOD/ }).click();
  await expect(page.getByRole("heading", { name: "Result", exact: true })).toBeVisible();
  await prepareLongCapture(page);
  await expect(page).toHaveScreenshot(`tools-result-${testInfo.project.name}.png`, { fullPage: true });
});

test("Tools emergency result visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: /^Emergency Gas/ }).click();
  await expect(page.getByText("Live result", { exact: true })).toBeVisible();
  await expect(page.getByText("Required gas", { exact: true })).toBeVisible();
  await prepareLongCapture(page);
  await expect(page).toHaveScreenshot(`tools-emergency-${testInfo.project.name}.png`, { fullPage: true });
});

import { expect, test, type Page } from "@playwright/test";

async function prepareLongCapture(page: Page) {
  const mobileStyles = (page.viewportSize()?.width ?? 900) < 900
    ? ".bf-nav--bottom { position: static !important; } .bf-content { padding-bottom: 1.5rem !important; }"
    : "";
  await page.addStyleTag({ content: `
    .bf-topbar { position: static !important; }
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

test("cave workspace visual baseline", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Cave", exact: true })).toBeVisible();
  await prepareLongCapture(page);
  await expect(page).toHaveScreenshot(`cave-${testInfo.project.name}.png`, { fullPage: true });
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

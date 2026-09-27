import { expect, test, type Page } from "@playwright/test";

async function openCave(page: Page) {
  await page.addInitScript(() => localStorage.setItem("barefoot-dive:safety-acknowledged", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "Cave", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Cave", exact: true })).toBeVisible();
}

test("Cave Setup names an unambiguous route ceiling failure without an engine event index", async ({ page }) => {
  await openCave(page);
  await page.getByRole("spinbutton", { name: "Maximum depth (ft)" }).fill("69");
  const first = page.locator(".bf-route-editor").first();
  await first.getByRole("spinbutton", { name: "Start depth (ft)" }).fill("0");
  await first.getByRole("spinbutton", { name: "End depth (ft)" }).fill("30");
  await first.getByRole("spinbutton", { name: "Duration (min)" }).fill("3");
  await first.getByRole("spinbutton", { name: "Distance (ft)" }).fill("197");
  await page.getByRole("button", { name: "Add route leg" }).click();
  await page.getByRole("button", { name: "Add route leg" }).click();
  const second = page.locator(".bf-route-editor").nth(1);
  const third = page.locator(".bf-route-editor").nth(2);
  await second.getByRole("spinbutton", { name: "Start depth (ft)" }).fill("30");
  await second.getByRole("spinbutton", { name: "End depth (ft)" }).fill("59");
  await second.getByRole("spinbutton", { name: "Duration (min)" }).fill("12");
  await second.getByRole("spinbutton", { name: "Distance (ft)" }).fill("2297");
  await third.getByRole("spinbutton", { name: "Start depth (ft)" }).fill("59");
  await third.getByRole("spinbutton", { name: "End depth (ft)" }).fill("69");
  await third.getByRole("spinbutton", { name: "Duration (min)" }).fill("10");
  await third.getByRole("spinbutton", { name: "Distance (ft)" }).fill("820");
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  const diagnostics = page.getByRole("region", { name: "Cave calculation diagnostics" });
  await expect(diagnostics).toContainText(/The exit of leg “route-1” ends at 0 ft at \d+:\d\d, above the \d+ ft decompression ceiling there/);
  await expect(diagnostics).not.toContainText("events.");
});

test("Cave Review labels entered and gas-derived maxima", async ({ page }) => {
  await openCave(page);
  await page.getByRole("button", { name: "Calculate cave plan" }).click();
  await expect(page.getByText("Gas-derived: every leg scaled together; failure scenarios not rechecked", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Edit inputs" }).click();
  await page.getByRole("spinbutton", { name: "Maximum penetration distance (ft; 0 = gas-derived)" }).fill("230");
  await expect(page.getByRole("status").filter({ hasText: "Current" })).toBeVisible();
  await page.getByRole("button", { name: "Review cave plan" }).click();
  await expect(page.getByText("Entered limit", { exact: true })).toBeVisible();
});

test("Cylinder access table is semantic and tracks access and stage controls", async ({ page }) => {
  await openCave(page);
  const table = page.getByRole("table", { name: "Cylinder access by leg" });
  await expect(table.getByRole("columnheader", { name: /route-1/ })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: /Oxygen cylinder/ })).toBeVisible();
  await expect(table.getByRole("cell", { name: "carried" })).toHaveCount(3);
  const leg = page.locator(".bf-route-editor").first();
  await leg.getByRole("checkbox", { name: "Oxygen cylinder", exact: true }).uncheck();
  await expect(table.getByRole("row", { name: /Oxygen cylinder/ }).getByRole("cell")).toHaveText("not carried");
  await leg.getByRole("combobox", { name: "Stage action" }).selectOption("drop");
  await leg.getByRole("combobox", { name: "Stage cylinder" }).selectOption({ label: "Oxygen cylinder" });
  await expect(table.getByRole("row", { name: /Oxygen cylinder/ }).getByRole("cell")).toHaveText("dropped at the end of this leg");
});

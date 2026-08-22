import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "./ToolsPage";
import { TOOL_CATEGORIES, TOOLS } from "./toolsCatalog";

describe("Tools catalog", () => {
  it("lists each named capability exactly once", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["MOD", "Best Mix", "PPO₂", "END", "Gas Density", "SAC / RMV", "Gas Duration", "Cylinder Gas", "Emergency Gas", "CNS"]);
    expect(TOOL_CATEGORIES).toHaveLength(3);
    expect(TOOL_NAMES).toHaveLength(11);
    expect(new Set(TOOL_NAMES).size).toBe(11);
    expect(TOOL_NAMES).toContain("Rock Bottom / Minimum Gas");
    expect(TOOL_NAMES).toContain("Simplified Bailout");
  });
});

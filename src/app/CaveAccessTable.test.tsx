import { describe, expect, it } from "vitest";
import { caveAccessCellState } from "./CaveAccessTable";
import type { RouteCylinder } from "./caveRoute";
import type { RouteDraft } from "./caveWorkspace";

const bottom: RouteCylinder = { id: "bottom-cylinder", name: "Back gas", gases: [{ key: "bottom", label: "bottom gas Tx18/45" }] };
const stage: RouteCylinder = { id: "stage-cylinder", name: "EAN50 stage", gases: [{ key: "deco-50", label: "deco gas EAN50" }] };
const added: RouteCylinder = { id: "added-cylinder", name: "Oxygen stage", gases: [{ key: "deco-o2", label: "deco gas Oxygen" }] };
const shared: RouteCylinder = {
  id: "shared-cylinder",
  name: "Shared cylinder",
  gases: [{ key: "bottom", label: "bottom gas Tx18/45" }, { key: "deco-50", label: "deco gas EAN50" }],
};
const cylinders = [bottom, stage, added] as const;
const leg: RouteDraft = {
  id: "entrance",
  startDepthM: 0,
  endDepthM: 18,
  durationMinutes: 5,
  distanceM: 60,
  propulsion: "fins",
  stageAction: "none",
};

describe("CaveAccessTable cell states", () => {
  it("shows every cylinder as carried on an unedited leg", () => {
    expect(cylinders.map((cylinder) => caveAccessCellState(leg, cylinder, cylinders))).toEqual([
      "carried", "carried", "carried",
    ]);
  });

  it("shows an unticked cylinder and a later gas that has not been set", () => {
    const edited = { ...leg, accessibleGasKeys: ["bottom"], setGasKeys: ["bottom", "deco-50"] };
    expect(caveAccessCellState(edited, stage, cylinders)).toBe("not carried");
    expect(caveAccessCellState(edited, added, cylinders)).toBe("not set");
  });

  it("shows stage drop and recovery on their selected cylinder", () => {
    expect(caveAccessCellState({ ...leg, stageAction: "drop", stageGasKey: "deco-50" }, stage, cylinders)).toBe("dropped at the end of this leg");
    expect(caveAccessCellState({ ...leg, stageAction: "recover", stageGasKey: "deco-50" }, stage, cylinders)).toBe("recovered on this leg");
  });

  it("locks a cylinder selected for more than one gas", () => {
    expect(caveAccessCellState(leg, shared, [shared])).toBe("shared (locked)");
  });
});

export type ToolId =
  | "mod"
  | "best-mix"
  | "ppo2"
  | "end"
  | "gas-density"
  | "sac-rmv"
  | "gas-duration"
  | "cylinder-gas"
  | "emergency-gas"
  | "cns";

export type ToolCategory = "Gas & depth" | "Consumption & cylinders" | "Emergency & exposure";

export type ToolCatalogItem = {
  readonly id: ToolId;
  readonly name: string;
  readonly category: ToolCategory;
  readonly purpose: string;
  readonly tankBank: boolean;
  readonly modes?: readonly string[];
};

export const TOOLS: readonly ToolCatalogItem[] = [
  { id: "mod", name: "MOD", category: "Gas & depth", purpose: "Find the maximum operating depth for a gas and PPO₂ limit.", tankBank: true },
  { id: "best-mix", name: "Best Mix", category: "Gas & depth", purpose: "Choose an oxygen and helium mix for a depth, PPO₂ ceiling, and END policy.", tankBank: false },
  { id: "ppo2", name: "PPO₂", category: "Gas & depth", purpose: "Check the oxygen partial pressure of a gas at depth.", tankBank: true },
  { id: "end", name: "END", category: "Gas & depth", purpose: "Estimate equivalent narcotic depth from oxygen, helium, and depth.", tankBank: true },
  { id: "gas-density", name: "Gas Density", category: "Gas & depth", purpose: "Estimate breathing-gas density at a selected depth.", tankBank: true },
  { id: "sac-rmv", name: "SAC / RMV", category: "Consumption & cylinders", purpose: "Calculate surface consumption from measured gas use or a cylinder pressure drop.", tankBank: true },
  { id: "gas-duration", name: "Gas Duration", category: "Consumption & cylinders", purpose: "Estimate usable breathing time from a cylinder, reserve, and RMV.", tankBank: true },
  { id: "cylinder-gas", name: "Cylinder Gas", category: "Consumption & cylinders", purpose: "Convert cylinder water volume and pressure into surface gas volumes.", tankBank: true },
  { id: "emergency-gas", name: "Emergency Gas", category: "Emergency & exposure", purpose: "Estimate gas for an entered emergency ascent and, when applicable, check one cylinder.", tankBank: true, modes: ["Rock Bottom / Minimum Gas", "Simplified Bailout"] },
  { id: "cns", name: "CNS", category: "Emergency & exposure", purpose: "Estimate single-exposure CNS percentage from PPO₂ and duration.", tankBank: false },
];

export const TOOL_CATEGORIES: readonly ToolCategory[] = ["Gas & depth", "Consumption & cylinders", "Emergency & exposure"];
export const EMERGENCY_MODES = ["Rock Bottom / Minimum Gas", "Simplified Bailout"] as const;
export type EmergencyModeLabel = (typeof EMERGENCY_MODES)[number];
export const toolById = (id: ToolId): ToolCatalogItem => TOOLS.find((tool) => tool.id === id) ?? TOOLS[0];

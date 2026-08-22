import type { Diagnostic } from "../domain/types";
import type { ToolId } from "./toolsCatalog";

export type ToolsView = "library" | "tool";
export type ToolDraft = Record<string, unknown>;
export type EmergencyResultSignature = {
  readonly inputHash: string;
  readonly tankId?: string;
  readonly tankRevision?: number;
  readonly calculatedAt: number;
};
export type StoredToolResult = {
  readonly value: unknown;
  readonly warnings: readonly Diagnostic[];
  readonly errors?: readonly Diagnostic[];
  readonly signature?: EmergencyResultSignature;
  readonly emergencyInputSnapshot?: EmergencyInputSnapshot;
};
export type EmergencyInputSnapshot = {
  readonly mode: "oc" | "ccr";
  readonly emergencyMode: "rock-bottom" | "simplified-bailout";
  readonly failureDepthM: number;
  readonly teamSize: number;
  readonly stressedRmvLpm: number;
  readonly segments: readonly { readonly kind: "ascent" | "stop"; readonly startDepthM: number; readonly endDepthM: number; readonly durationSeconds: number; readonly rmvLpm: number }[];
  readonly environment: { readonly surfacePressureBar: number; readonly metersPerBar: number };
  readonly cylinder?: { readonly waterVolumeL: number; readonly workingPressureBar: number; readonly startingPressureBar: number; readonly reservePressureBar: number };
  readonly tank?: { readonly id: string; readonly revision: number; readonly name: string; readonly gas: { readonly id: string; readonly name: string; readonly oxygen: number; readonly helium: number } };
};
export type ToolsSessionState = {
  readonly view: ToolsView;
  readonly activeTool: ToolId;
  readonly lastTool?: ToolId;
  readonly drafts: Readonly<Partial<Record<ToolId, ToolDraft>>>;
  readonly results: Readonly<Partial<Record<ToolId, StoredToolResult>>>;
  readonly emergencyResultSignature?: EmergencyResultSignature;
};

export const createInitialToolsSessionState = (): ToolsSessionState => ({
  view: "library",
  activeTool: "mod",
  lastTool: undefined,
  drafts: {},
  results: {},
  emergencyResultSignature: undefined,
});

export function updateToolsSession(state: ToolsSessionState, change: Partial<ToolsSessionState>): ToolsSessionState {
  return { ...state, ...change };
}

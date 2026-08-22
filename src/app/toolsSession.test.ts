import { describe, expect, it } from "vitest";
import { createInitialToolsSessionState, updateToolsSession } from "./toolsSession";

describe("Tools session", () => {
  it("starts ephemeral in the library without local persistence", () => {
    const state = createInitialToolsSessionState();
    expect(state.view).toBe("library");
    expect(state.drafts).toEqual({});
    expect(state.results).toEqual({});
  });

  it("retains drafts and the last tool through controlled updates", () => {
    const state = createInitialToolsSessionState();
    const next = updateToolsSession(state, { view: "tool", activeTool: "end", lastTool: "end", drafts: { end: { depthM: 40 } } });
    expect(next.drafts.end).toEqual({ depthM: 40 });
    expect(next.lastTool).toBe("end");
  });
});

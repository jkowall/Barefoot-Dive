import { describe, expect, it } from "vitest";
import { registerPwa } from "./platform/pwa";

describe("Barefoot Dive foundation", () => {
  it("keeps platform registration safe in a test environment", () => {
    expect(registerPwa()).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  registerSW: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));
vi.mock("virtual:pwa-register", () => ({ registerSW: mocks.registerSW }));

import { registerPwa } from "./pwa";

describe("PWA registration boundary", () => {
  beforeEach(() => {
    mocks.isNativePlatform.mockReset();
    mocks.registerSW.mockReset();
  });

  it("registers the service worker in a browser build", () => {
    mocks.isNativePlatform.mockReturnValue(false);
    registerPwa();
    expect(mocks.registerSW).toHaveBeenCalledWith({ immediate: true });
  });

  it("does not register a service worker inside a native Capacitor shell", () => {
    mocks.isNativePlatform.mockReturnValue(true);
    registerPwa();
    expect(mocks.registerSW).not.toHaveBeenCalled();
  });
});

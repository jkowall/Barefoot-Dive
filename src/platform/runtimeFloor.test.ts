import { fileURLToPath } from "node:url";
import { loadConfigFromFile, type UserConfig } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import pbxproj from "../../ios/App/App.xcodeproj/project.pbxproj?raw";
import tsconfig from "../../tsconfig.json";

// The iOS app runs this bundle in the system WKWebView, so the Vite JS and CSS targets, the Xcode
// deployment target, and the ES built-ins TypeScript admits must all describe one oldest runtime.
let build: UserConfig["build"];
let targets: readonly string[] = [];
const targetVersion = (engine: string) => targets.find((entry) => entry.startsWith(engine))?.slice(engine.length);

beforeAll(async () => {
  // Load vite.config.ts the way Vite does; it belongs to tsconfig.node.json, so it cannot be imported here.
  const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, fileURLToPath(new URL("../../vite.config.ts", import.meta.url)));
  build = loaded?.config.build;
  const target = build?.target;
  targets = Array.isArray(target) ? target : [];
});

describe("runtime floor", () => {
  it("pins the JS and CSS build targets instead of Vite's default", () => {
    expect(targets).not.toHaveLength(0);
    expect(build?.cssTarget).toEqual(build?.target);
    expect(targetVersion("safari")).toBe(targetVersion("ios"));
  });

  it("builds every iOS configuration for the build target's iOS version", () => {
    const deploymentTargets = [...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((match) => match[1]);
    expect(deploymentTargets).not.toHaveLength(0);
    expect(new Set(deploymentTargets)).toEqual(new Set([targetVersion("ios")]));
  });

  it("stays at or above iOS 15.4, where WebKit shipped Array.prototype.at and structuredClone", () => {
    const [major, minor = 0] = (targetVersion("ios") ?? "0").split(".").map(Number);
    expect(major > 15 || (major === 15 && minor >= 4)).toBe(true);
  });

  it("types no ES built-ins newer than ES2022", () => {
    // ES2023 adds toSorted, toReversed, and with, which WebKit shipped only in Safari 16.
    expect(tsconfig.compilerOptions.lib.filter((lib) => /^es(next|20(2[3-9]|[3-9]\d))/i.test(lib))).toEqual([]);
  });
});

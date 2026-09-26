import { beforeAll, describe, expect, it } from "vitest";
import variablesGradle from "../../android/variables.gradle?raw";
import pbxproj from "../../ios/App/App.xcodeproj/project.pbxproj?raw";
import tsconfig from "../../tsconfig.json";

// The native shells run this bundle in the system WebView, so the Vite JS and CSS targets, the Xcode
// deployment target, Android's minSdkVersion, and the built-ins TypeScript admits must all describe
// one oldest runtime.
type BuildTarget = string | readonly string[] | false | undefined;
type LoadConfigFromFile = (env: { command: "build"; mode: string }) => Promise<{ config: { build?: { target?: BuildTarget; cssTarget?: BuildTarget } } } | null>;

// documentation/architecture.md and variables.md list these targets; change them together.
const DOCUMENTED_TARGETS = ["safari15.4", "ios15.4", "chrome111", "edge111", "firefox114"];

// Chrome and Android System WebView 119 were the last releases for Android 7 (API 24 and 25).
const LAST_WEBVIEW_BY_MIN_SDK: Readonly<Record<number, number>> = { 24: 119, 25: 119 };

let build: { target?: BuildTarget; cssTarget?: BuildTarget } | undefined;
let targets: readonly string[] = [];
const targetVersion = (engine: string) => targets.find((entry) => entry.startsWith(engine))?.slice(engine.length);

beforeAll(async () => {
  // Load vite.config.ts the way Vite does. Vite's types would pull Node's globals and ESNext
  // built-ins into this browser program, so the module is imported untyped.
  const { loadConfigFromFile } = (await import("vite" as string)) as { loadConfigFromFile: LoadConfigFromFile };
  build = (await loadConfigFromFile({ command: "build", mode: "production" }))?.config.build;
  const target = build?.target;
  targets = Array.isArray(target) ? target : [];
});

describe("runtime floor", () => {
  it("pins the JS and CSS build targets to the documented list instead of Vite's default", () => {
    expect([...targets].sort()).toEqual([...DOCUMENTED_TARGETS].sort());
    expect(build?.cssTarget).toEqual(build?.target);
  });

  it("sets every Xcode build configuration to the build target's iOS version", () => {
    // A configuration without its own setting inherits the project's, and without that the SDK
    // default (the SDK's own iOS version), so check each configuration, not every match in the file.
    const configurations = pbxproj.split("isa = XCBuildConfiguration;").slice(1);
    const deploymentTargets = configurations.map((settings) => /IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/.exec(settings)?.[1]);
    expect(deploymentTargets).not.toHaveLength(0);
    expect(deploymentTargets).toEqual(configurations.map(() => targetVersion("ios")));
  });

  it("stays at or above iOS 15.4, where WebKit shipped Array.prototype.at and structuredClone", () => {
    const [major, minor = 0] = (targetVersion("ios") ?? "0").split(".").map(Number);
    expect(major > 15 || (major === 15 && minor >= 4)).toBe(true);
  });

  it("keeps the Chrome target within the last WebView the Android minSdkVersion can install", () => {
    const minSdk = Number(/minSdkVersion = (\d+)/.exec(variablesGradle)?.[1]);
    const lastWebView = LAST_WEBVIEW_BY_MIN_SDK[minSdk];
    expect(lastWebView, `Record the last Chrome and WebView release for Android API ${minSdk}.`).toBeDefined();
    expect(Number(targetVersion("chrome"))).toBeLessThanOrEqual(lastWebView);
  });

  it("admits no Node globals or ES built-ins newer than ES2022 to the app's type check", () => {
    // ES2023 adds toSorted, toReversed, and with, which WebKit shipped only in Safari 16.
    expect(tsconfig.compilerOptions.lib.filter((lib) => /^es(next|20(2[3-9]|[3-9]\d))/i.test(lib))).toEqual([]);
    // A dependency's types can admit more than tsconfig lists, as Vite's Node types would. If any
    // probe below starts to type-check, tsc (npm run build) fails on the unused directive.
    // @ts-expect-error Node globals do not exist in the WebView.
    void typeof process;
    // @ts-expect-error Array change-by-copy methods need Safari 16.
    void [].toSorted;
    // @ts-expect-error Explicit resource management is newer than the floor.
    void typeof DisposableStack;
  });
});

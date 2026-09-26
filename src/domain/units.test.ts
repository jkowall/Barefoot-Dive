import { describe, expect, it } from "vitest";
import { formatBound, formatMessageDepth, roundBound } from "./units";

describe("limit rounding", () => {
  it("prints a maximum rounded down and a minimum rounded up", () => {
    // The loop reaches at most 1.0 - 0.0627 bar at the surface.
    expect(formatBound(0.9373, 2, "upper")).toBe("0.93");
    expect(formatBound(3.627, 1, "lower")).toBe("3.7");
    expect(formatBound(3.627, 1, "upper")).toBe("3.6");
  });

  it("does not move a value that is already on the printed precision", () => {
    expect(formatBound(0.93, 2, "upper")).toBe("0.93");
    expect(formatBound(0.93, 2, "lower")).toBe("0.93");
    expect(roundBound(1.6, 2, "upper")).toBe(1.6);
    expect(roundBound(6, 0, "lower")).toBe(6);
  });

  it("guarantees the printed maximum satisfies the limit", () => {
    for (let hundredths = 50; hundredths <= 200; hundredths += 1) {
      const limit = hundredths / 100 + 0.0037;
      expect(Number(formatBound(limit, 2, "upper"))).toBeLessThanOrEqual(limit);
    }
  });

  it("prints message depths in metres with the stated rounding", () => {
    expect(formatMessageDepth(6.096)).toBe("6.1 m");
    expect(formatMessageDepth(3.627, "up")).toBe("3.7 m");
    expect(formatMessageDepth(3.627, "down")).toBe("3.6 m");
  });
});

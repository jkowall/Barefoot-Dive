import { describe, expect, it } from "vitest";
import type { BarAbsolute, BarDelta, BarGauge } from "./types";
import { barAbsolute, barDelta, barGauge } from "./units";

const absolute: BarAbsolute = barAbsolute(1);
const gauge: BarGauge = barGauge(200);
const delta: BarDelta = barDelta(10);

const absoluteFromAbsolute: BarAbsolute = absolute;
const gaugeFromGauge: BarGauge = gauge;
const deltaFromDelta: BarDelta = delta;

// Pressure brands must not be interchangeable at compile time.
// @ts-expect-error absolute pressure is not a gauge reading
const gaugeFromAbsolute: BarGauge = absolute;
// @ts-expect-error absolute pressure is not a pressure delta
const deltaFromAbsolute: BarDelta = absolute;
// @ts-expect-error gauge pressure is not absolute pressure
const absoluteFromGauge: BarAbsolute = gauge;
// @ts-expect-error gauge pressure is not a pressure delta
const deltaFromGauge: BarDelta = gauge;
// @ts-expect-error a pressure delta is not absolute pressure
const absoluteFromDelta: BarAbsolute = delta;
// @ts-expect-error a pressure delta is not a gauge reading
const gaugeFromDelta: BarGauge = delta;

void [absoluteFromAbsolute, gaugeFromGauge, deltaFromDelta, gaugeFromAbsolute, deltaFromAbsolute, absoluteFromGauge, deltaFromGauge, absoluteFromDelta, gaugeFromDelta];

describe("pressure brands", () => {
  it("constructs distinct pressure values", () => {
    expect(absolute).toBe(1);
    expect(gauge).toBe(200);
    expect(delta).toBe(10);
  });
});

// Finger travel -> terminal lines.
//
// Every failure mode here is silent: drop the remainder and a slow drag never
// scrolls, round the wrong way and a reversal sticks, mishandle a zero cell
// height and one touchmove scrolls to infinity.
import { describe, expect, it } from "vitest";
import { consumeScrollPixels } from "./scroll";

const CELL = 17;

describe("consumeScrollPixels", () => {
  it("emits nothing until a whole line has been travelled", () => {
    expect(consumeScrollPixels(0, 8, CELL)).toEqual({ lines: 0, residual: 8 });
  });

  it("carries the remainder, so a slow drag still scrolls", () => {
    // Eight-pixel steps: each is under a line, but they must accumulate.
    let residual = 0;
    let total = 0;
    for (let step = 0; step < 5; step += 1) {
      const next = consumeScrollPixels(residual, 8, CELL);
      residual = next.residual;
      total += next.lines;
    }
    expect(total).toBe(2); // 40px of travel over a 17px cell
    expect(residual).toBeCloseTo(6);
  });

  it("scrolls both ways", () => {
    expect(consumeScrollPixels(0, 40, CELL).lines).toBe(2);
    expect(consumeScrollPixels(0, -40, CELL).lines).toBe(-2);
  });

  it("truncates towards zero, so reversing direction responds immediately", () => {
    // Leftover travel downwards, then a flick the other way: the very next
    // whole line upwards must come out, not be swallowed paying off the debt.
    const back = consumeScrollPixels(16, -40, CELL);
    expect(back.lines).toBe(-1);
    expect(back.residual).toBeCloseTo(-7);
  });

  it("keeps the remainder signed like the travel", () => {
    expect(consumeScrollPixels(0, -8, CELL)).toEqual({ lines: 0, residual: -8 });
  });

  it("scales with the cell, so a bigger font scrolls fewer lines", () => {
    expect(consumeScrollPixels(0, 60, 10).lines).toBe(6);
    expect(consumeScrollPixels(0, 60, 30).lines).toBe(2);
  });

  it("refuses to divide by a cell height it has not measured yet", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(consumeScrollPixels(4, 100, bad)).toEqual({
        lines: 0,
        residual: 4,
      });
    }
  });

  it("does not drift over a long drag", () => {
    let residual = 0;
    let lines = 0;
    for (let step = 0; step < 100; step += 1) {
      const next = consumeScrollPixels(residual, 3, CELL);
      residual = next.residual;
      lines += next.lines;
    }
    // 300px of travel is 17.6 lines: 17 emitted, the rest still carried.
    expect(lines).toBe(17);
    expect(lines * CELL + residual).toBeCloseTo(300);
  });
});

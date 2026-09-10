// Window geometry.
//
// The clamping here is deliberately lossy — it exists to keep the window on
// screen — and that is exactly what makes it dangerous to run against a
// viewport the frame was not authored in. A desktop frame clamped once at phone
// width comes back 393px wide, so the sheet has to keep the stored frame away
// from it entirely.
import { afterEach, describe, expect, it } from "vitest";
import { clampFrame, defaultFrame, loadFrame, saveFrame } from "./frame";

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const original = (globalThis as { window?: unknown }).window;

function stubWindow(
  innerWidth: number,
  innerHeight: number,
  store: Map<string, string> = new Map(),
): void {
  const localStorage: FakeStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  (globalThis as { window?: unknown }).window = {
    innerWidth,
    innerHeight,
    localStorage,
  };
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = original;
});

describe("defaultFrame", () => {
  it("rests in the bottom-left corner with the same gap on both edges", () => {
    stubWindow(1440, 900);
    const frame = defaultFrame();
    expect(frame.x).toBe(40);
    // The gap underneath equals the gap on the leading edge; that symmetry is
    // what makes the corner read as a corner.
    expect(window.innerHeight - (frame.y + frame.height)).toBe(40);
  });

  it("stops growing once the screen is big enough", () => {
    stubWindow(3840, 2160);
    expect(defaultFrame()).toMatchObject({ width: 760, height: 460 });
  });

  it("gives back a phone-sized frame on a phone-sized viewport", () => {
    stubWindow(393, 800);
    const frame = defaultFrame();
    // 393 - 2*40 is under the 360 minimum, so the floor wins rather than the
    // gutter. Either way it is nowhere near 760 — which is precisely why this
    // must never become the remembered desktop geometry. See the sheet guard
    // in floating-terminal.tsx.
    expect(frame.width).toBe(360);
    expect(frame.width).toBeLessThan(760);
  });
});

describe("clampFrame", () => {
  it("shrinks a frame that is wider than the viewport", () => {
    stubWindow(393, 800);
    expect(clampFrame({ x: 40, y: 400, width: 760, height: 460 }).width).toBe(
      393,
    );
  });

  it("leaves a frame that already fits completely alone", () => {
    stubWindow(1440, 900);
    const frame = { x: 240, y: 250, width: 760, height: 460 };
    expect(clampFrame(frame)).toEqual(frame);
  });

  it("never lets the window be dragged out of reach", () => {
    stubWindow(1440, 900);
    // Far off to the left: enough of it has to stay grabbable to drag back.
    expect(clampFrame({ x: -5000, y: 10, width: 760, height: 460 }).x).toBe(
      140 - 760,
    );
    expect(clampFrame({ x: 9000, y: 10, width: 760, height: 460 }).x).toBe(
      1440 - 140,
    );
  });

  it("never lets the header — the only drag handle — leave the viewport", () => {
    stubWindow(1440, 900);
    expect(clampFrame({ x: 40, y: -300, width: 760, height: 460 }).y).toBe(0);
    expect(clampFrame({ x: 40, y: 5000, width: 760, height: 460 }).y).toBe(
      900 - 40,
    );
  });

  it("holds a frame to the minimum size rather than letting it vanish", () => {
    stubWindow(1440, 900);
    const frame = clampFrame({ x: 40, y: 40, width: 10, height: 10 });
    expect(frame.width).toBe(360);
    expect(frame.height).toBe(180);
  });
});

describe("loadFrame", () => {
  it("falls back to the default when nothing was ever saved", () => {
    stubWindow(1440, 900);
    expect(loadFrame()).toEqual(defaultFrame());
  });

  it("restores a saved frame", () => {
    const store = new Map<string, string>();
    stubWindow(1440, 900, store);
    saveFrame({ x: 240, y: 250, width: 760, height: 460 });
    expect(loadFrame()).toEqual({ x: 240, y: 250, width: 760, height: 460 });
  });

  it("re-derives the default for the viewport it is loaded into", () => {
    // The same storage read on a narrower screen: what makes reloading on
    // sheet exit safe rather than merely convenient.
    const store = new Map<string, string>();
    stubWindow(1440, 900, store);
    saveFrame({ x: 240, y: 250, width: 760, height: 460 });
    stubWindow(500, 700, store);
    expect(loadFrame().width).toBe(500);
  });

  it("ignores junk rather than throwing the window away", () => {
    const store = new Map<string, string>([
      ["bb-plugin-floating-ghostty:frame:v5", '{"x":"nope"}'],
    ]);
    stubWindow(1440, 900, store);
    expect(loadFrame()).toEqual(defaultFrame());
  });
});

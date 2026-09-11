// Window geometry.
//
// The clamping here is deliberately lossy — it exists to keep the window on
// screen — and that is exactly what makes it dangerous to run against a
// viewport the frame was not authored in. A desktop frame clamped once at phone
// width comes back 393px wide, so the sheet has to keep the stored frame away
// from it entirely.
import { afterEach, describe, expect, it } from "vitest";
import {
  clampFrame,
  defaultFrame,
  loadFrame,
  saveFrame,
  windowPreferences,
  openingFrame,
  needsFullscreen,
} from "./frame";

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
  it("centers the overlay while leaving the surrounding context visible", () => {
    stubWindow(1440, 900);
    const frame = defaultFrame();
    expect(frame.x).toBe((window.innerWidth - frame.width) / 2);
    expect(frame.y).toBe((window.innerHeight - frame.height) / 2);
  });

  it("stops growing once the screen is big enough", () => {
    stubWindow(3840, 2160);
    expect(defaultFrame()).toMatchObject({ width: 1100, height: 720 });
  });

  it("gives back a phone-sized frame on a phone-sized viewport", () => {
    stubWindow(393, 800);
    const frame = defaultFrame();
    // This fallback is never saved while fullscreen owns the layout.
    expect(frame.width).toBe(393);
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
      ["bb-plugin-floating-ghostty:frame:v6", '{"x":"nope"}'],
    ]);
    stubWindow(1440, 900, store);
    expect(loadFrame()).toEqual(defaultFrame());
  });
});

describe("opening preferences", () => {
  it("remembers geometry by default and ignores custom dimensions until opted in", () => {
    stubWindow(1440, 900);
    saveFrame({ x: 80, y: 40, width: 900, height: 600 });
    expect(
      openingFrame(windowPreferences({ windowWidth: 800, windowHeight: 500 })),
    ).toEqual({ x: 80, y: 40, width: 900, height: 600 });
  });
  it("recenters each opening while retaining the user's resized dimensions", () => {
    stubWindow(1440, 900);
    saveFrame({ x: 80, y: 40, width: 900, height: 600 });
    expect(openingFrame(windowPreferences({ centerOnOpen: true }))).toEqual({
      x: 270,
      y: 150,
      width: 900,
      height: 600,
    });
  });
  it("uses exact custom dimensions on first open even with little surrounding space", () => {
    stubWindow(1024, 768);
    expect(
      openingFrame(
        windowPreferences({
          customWindowSize: true,
          windowWidth: 1000,
          windowHeight: 750,
        }),
      ),
    ).toEqual({ x: 12, y: 9, width: 1000, height: 750 });
  });
  it("changes size independently from position and can combine both opt-ins", () => {
    stubWindow(1440, 900);
    saveFrame({ x: 80, y: 40, width: 900, height: 600 });
    const values = {
      customWindowSize: true,
      windowWidth: 800,
      windowHeight: 500,
    };
    expect(openingFrame(windowPreferences(values))).toEqual({
      x: 80,
      y: 40,
      width: 800,
      height: 500,
    });
    expect(
      openingFrame(windowPreferences({ ...values, centerOnOpen: true })),
    ).toEqual({ x: 320, y: 200, width: 800, height: 500 });
  });
  it("fills the screen if either viewport dimension is too small", () => {
    const size = windowPreferences({
      customWindowSize: true,
      windowWidth: 800,
      windowHeight: 500,
    });
    expect(needsFullscreen({ width: 799, height: 900 }, size)).toBe(true);
    expect(needsFullscreen({ width: 1440, height: 499 }, size)).toBe(true);
    expect(needsFullscreen({ width: 800, height: 500 }, size)).toBe(false);
  });
  it("bounds invalid saved settings at the frontend boundary", () => {
    expect(
      windowPreferences({
        customWindowSize: true,
        windowWidth: -1,
        windowHeight: Infinity,
      }),
    ).toMatchObject({ width: 360, height: 720 });
  });
});

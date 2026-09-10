// The terminal's font stack.
//
// Order is the whole contract here. The bundled symbol font has to come last or
// it overrides glyphs an installed Nerd Font would draw better, and the host's
// own mono token has to survive an unresolved `var()` — Ghostty applies this
// string as a literal `font-family`, where one bad entry invalidates the whole
// declaration rather than falling through to the next.
import { afterEach, describe, expect, it } from "vitest";
import { resolveMonoFont } from "./theme";

const original = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;

function stubFontMono(value: string): HTMLElement {
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({
    getPropertyValue: (name: string) => (name === "--font-mono" ? value : ""),
  });
  return {} as HTMLElement;
}

afterEach(() => {
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = original;
});

describe("resolveMonoFont", () => {
  it("puts the bundled symbol font last, behind every installed option", () => {
    const stack = resolveMonoFont(stubFontMono('"Fira Code", monospace'));
    expect(stack.endsWith('"BB FG Nerd Symbols"')).toBe(true);
  });

  it("asks for an installed Nerd Font before anything else", () => {
    const stack = resolveMonoFont(stubFontMono('"Fira Code", monospace'));
    expect(stack.startsWith('"JetBrainsMono Nerd Font Mono"')).toBe(true);
    expect(stack.indexOf("JetBrainsMono Nerd Font Mono")).toBeLessThan(
      stack.indexOf("BB FG Nerd Symbols"),
    );
  });

  it("keeps the host's mono token ahead of the generic fallbacks", () => {
    const stack = resolveMonoFont(stubFontMono('"Fira Code", monospace'));
    expect(stack.indexOf('"Fira Code"')).toBeLessThan(
      stack.indexOf("ui-monospace"),
    );
  });

  it("drops a token that did not resolve rather than poisoning the list", () => {
    // A literal var() reaches Ghostty as text and invalidates the declaration.
    const stack = resolveMonoFont(stubFontMono("var(--something-else)"));
    expect(stack).not.toContain("var(");
    expect(stack.endsWith('"BB FG Nerd Symbols"')).toBe(true);
  });

  it("still yields a usable stack when the host declares no mono token", () => {
    const stack = resolveMonoFont(stubFontMono(""));
    expect(stack).toContain("ui-monospace");
    expect(stack.endsWith('"BB FG Nerd Symbols"')).toBe(true);
  });
});

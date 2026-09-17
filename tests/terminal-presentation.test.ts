// @vitest-environment jsdom
import { expect, it } from "vitest";
import { TerminalPresentation, oscColor } from "../lib/terminal-presentation";

it("handles cursor changes split across chunks, ignores strings, and resets", () => {
  const el = document.createElement("div");
  const observer = new TerminalPresentation(el);
  const write = (s: string) => observer.consume(new TextEncoder().encode(s));
  write("\x1b[6"); write(" q");
  expect(el.dataset.cursorShape).toBe("bar");
  expect(el.classList.contains("cursor-blink")).toBe(false);
  write("\x1b]0;fake \x1b[3 q\x07");
  expect(el.dataset.cursorShape).toBe("bar");
  write("\x1b[3 q");
  expect(el.dataset.cursorShape).toBe("underline");
  expect(el.classList.contains("cursor-blink")).toBe(true);
  write("\x1bc");
  expect(el.dataset.cursorShape).toBe("block");
});
it("encodes resolved theme colors for terminal queries", () => {
  expect(oscColor("rgb(255, 128, 0)")).toBe("rgb:ffff/8080/0000");
  expect(oscColor("var(--background)")).toBeNull();
});

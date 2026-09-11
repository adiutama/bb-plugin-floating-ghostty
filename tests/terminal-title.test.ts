import { expect, it } from "vitest";
import { TerminalTitleObserver } from "../lib/terminal-title";

it("reads fragmented UTF-8 OSC titles with BEL or split ST and ignores other controls", () => {
  const titles: string[] = [];
  const observer = new TerminalTitleObserver((title) => titles.push(title));
  const bytes = new TextEncoder().encode(
    "normal\x1b[31m\x1b]0;café\x07\x1b]52;c;secret\x07\x1b]2;vim\x1b\\\x1b]0;\x07",
  );
  for (const byte of bytes) observer.consume(new Uint8Array([byte]));
  expect(titles).toEqual(["café", "vim", ""]);
});

it("discards oversized or cancelled frames and recovers at the next title", () => {
  const titles: string[] = [];
  const observer = new TerminalTitleObserver((title) => titles.push(title));
  for (const text of [
    "\x1b]0;" + "a".repeat(10000),
    "\x07\x1b]0;cancel\x18",
    "\x1b]2;bash\x07",
  ]) {
    observer.consume(new TextEncoder().encode(text));
  }
  expect(titles).toEqual(["bash"]);
});

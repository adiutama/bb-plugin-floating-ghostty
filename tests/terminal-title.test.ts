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

it("tracks fragmented working directory signals independently of shell titles", () => {
  const titles: string[] = [],
    directories: string[] = [];
  const observer = new TerminalTitleObserver(
    (title) => titles.push(title),
    (cwd) => directories.push(cwd),
  );
  const bytes = new TextEncoder().encode(
    "\x1b]1337;CurrentDir=/tmp/a b\x07\x1b]0;zsh\x07\x1b]7;file://localhost/tmp/caf%C3%A9\x1b\\\x1b]1337;CurrentDir=relative\x07",
  );
  for (const byte of bytes) observer.consume(new Uint8Array([byte]));
  expect(directories).toEqual(["/tmp/a b", "/tmp/café"]);
  expect(titles).toEqual(["zsh"]);
});

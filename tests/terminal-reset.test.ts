import { expect, it } from "vitest";
import { TerminalResetWriter } from "../lib/terminal-reset";

function replay(chunks: string[]) {
  const writer = new TerminalResetWriter();
  const parts: string[] = [];
  for (const chunk of chunks) {
    writer.write(new TextEncoder().encode(chunk),
      bytes => parts.push(new TextDecoder().decode(bytes)),
      () => parts.push("<reset>"));
  }
  return parts.join("");
}

it("recognizes full resets across every transport boundary", () => {
  const text = "before\x1bcafter\x1bcend";
  for (let split = 0; split <= text.length; split++) {
    expect(replay([text.slice(0, split), text.slice(split)]))
      .toBe("before\x1b<reset>after\x1b<reset>end");
  }
});
it("keeps reset-looking text inside terminal strings opaque", () => {
  for (const introducer of ["]", "P", "X", "^", "_"]) {
    const text = `\x1b${introducer}payload\x1bc\x1b\\after`;
    expect(replay(Array.from(text))).toBe(text);
  }
});
it("preserves other escape controls, cancellation, and Unicode", () => {
  const text = "界🙂\x1b(c\x1b[31mred\x1b\x18c";
  expect(replay([text])).toBe(text);
});

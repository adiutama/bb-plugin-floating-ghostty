import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { GhosttyCore } from "@wterm/ghostty";
import { supportAnyEventMouseMode } from "../lib/ghostty";
import { searchTerminal } from "../lib/search";

let wasmUrl: string;
const cores: GhosttyCore[] = [];
beforeAll(async () => {
  const bytes = await readFile(
    createRequire(import.meta.url).resolve("@wterm/ghostty/ghostty-vt.wasm"),
  );
  wasmUrl = `data:application/wasm;base64,${bytes.toString("base64")}`;
});
afterEach(() => {
  for (const core of cores.splice(0)) core.dispose();
});
async function makeCore() {
  const core = supportAnyEventMouseMode(
    await GhosttyCore.load({ wasmPath: wasmUrl, scrollbackLimit: 1024 * 1024 }),
  );
  cores.push(core);
  core.init(80, 24);
  return core;
}

describe("the shipped Ghostty WASM", () => {
  it("renders real VT output, colors, and wide Unicode", async () => {
    const core = await makeCore();
    core.writeString("\x1b[31mBoo\x1b[0m 界");
    expect(String.fromCodePoint(core.getCell(0, 0).char)).toBe("B");
    expect(core.getCell(0, 0).fgRgb).toBeTypeOf("number");
    expect(core.getCell(0, 4).width).toBe(2);
    expect(core.getCell(0, 5).width).toBe(0);
  });
  it("preserves contents across duplicate init and collapsed resizes", async () => {
    const core = await makeCore();
    core.writeString("persistent");
    core.init(80, 24);
    core.resize(1, 1);
    expect(core.getCols()).toBe(80);
    expect(core.getRows()).toBe(24);
    expect(String.fromCodePoint(core.getCell(0, 0).char)).toBe("p");
  });
  it("handles alternate-screen entry and restores the shell", async () => {
    const core = await makeCore();
    core.writeString("shell\x1b[?1049hTUI");
    expect(core.usingAltScreen()).toBe(true);
    core.writeString("\x1b[?1049l");
    expect(core.usingAltScreen()).toBe(false);
    expect(String.fromCodePoint(core.getCell(0, 0).char)).toBe("s");
  });
  it("filters unsafe OSC links and terminal-driven clipboard writes", async () => {
    const core = await makeCore();
    core.writeString("\x1b]8;;javascript:alert(1)\x07bad\x1b]8;;\x07");
    expect(core.getCell(0, 0).linkUri).toBeUndefined();
    expect(() => core.writeString("\x1b]52;c;Ym9v\x07")).not.toThrow();
  });
  it("searches retained history and wide cells without duplicate characters", async () => {
    const core = await makeCore();
    core.writeString("ghost 界\r\n".repeat(40));
    expect(core.getScrollbackCount()).toBeGreaterThan(0);
    expect(searchTerminal(core, "ghost 界")).toHaveLength(40);
    expect(searchTerminal(core, "")).toEqual([]);
  });
});

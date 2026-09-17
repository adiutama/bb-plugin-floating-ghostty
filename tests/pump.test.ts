// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { createElement } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import {
  TerminalView,
  type TerminalViewProps,
} from "../components/terminal-view";
import { isolateTerminalKey } from "../lib/keyboard";
import { TerminalPump } from "../lib/pump";

const assets = vi.hoisted(() => ({ url: "" }));
vi.mock("../lib/ghostty", async (original) => {
  const actual = await original<typeof import("../lib/ghostty")>();
  const { GhosttyCore } = await import("@wterm/ghostty");
  return {
    ...actual,
    loadCore: async () =>
      actual.supportAnyEventMouseMode(
        await GhosttyCore.load({ wasmPath: assets.url }),
      ),
  };
});
const pumps: TerminalPump[] = [];
beforeAll(async () => {
  const bytes = await readFile(
    createRequire(import.meta.url).resolve("@wterm/ghostty/ghostty-vt.wasm"),
  );
  assets.url = `data:application/wasm;base64,${bytes.toString("base64")}`;
});
beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const width =
        this.tagName === "SPAN" ? (this.textContent?.length ?? 1) * 8 : 640;
      return {
        width,
        height: 16,
        top: 0,
        left: 0,
        right: width,
        bottom: 16,
        x: 0,
        y: 0,
        toJSON() {},
      };
    },
  );
});
afterEach(() => {
  cleanup();
  for (const pump of pumps.splice(0)) pump.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps the real renderer scrollable and focused after switching away and back through search", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(384);
  const history = Array.from(
    { length: 100 },
    (_, i) => `line${String(i).padStart(3, "0")}\r\n`,
  ).join("");
  const call = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "read" ? output(input.replay ? history : "") : { ok: true },
  );
  const props: TerminalViewProps = {
    rpc: { call } as PluginRpcClient<typeof rpcContract>,
    terminalId: "switch-history",
    visible: true,
    focused: true,
    fontSize: 13,
    themeVersion: 0,
    fitVersion: 0,
    onStatus: vi.fn(),
    onTitle: vi.fn(),
    onCwd: vi.fn(),
    onCtrlArmed: vi.fn(),
    onFindRequested: vi.fn(),
    onScrollState: vi.fn(),
    onSearchResults: vi.fn(),
    onToggleRequested: vi.fn(),
    onPumpReady: vi.fn(),
    onPumpGone: vi.fn(),
  };
  const view = render(createElement(TerminalView, props));
  await vi.waitFor(() =>
    expect(view.container.textContent).toContain("line099"),
  );
  const viewport = view.container.querySelector<HTMLElement>(
    "[data-renderer=ghostty]",
  )!;
  let top = 1216;
  Object.defineProperties(viewport, {
    scrollHeight: { value: 1600 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, 1216));
      },
    },
  });
  for (let cycle = 0; cycle < 3; cycle++) {
    // Search blurs the active tab; selecting another tab hides it. Opening
    // search again and returning shows the same mounted renderer.
    view.rerender(createElement(TerminalView, { ...props, focused: false }));
    view.rerender(
      createElement(TerminalView, { ...props, visible: false, focused: false }),
    );
    view.rerender(createElement(TerminalView, props));
    expect(view.container.querySelector("[data-renderer=ghostty]")).toBe(
      viewport,
    );
    expect(viewport.classList.contains("wterm")).toBe(true);
    expect(viewport.classList.contains("cursor-blink")).toBe(true);
    expect(viewport.closest("[inert]")).toBeNull();
    expect(viewport.contains(document.activeElement)).toBe(true);
    fireEvent.wheel(viewport, { deltaY: -1600 });
    await vi.waitFor(() =>
      expect(
        viewport.querySelector(".term-scrollback-row")?.textContent,
      ).toContain("line000"),
    );
    fireEvent.wheel(viewport, { deltaY: 1600 });
    await vi.waitFor(() =>
      expect(
        viewport.querySelector(".term-scrollback-row")?.textContent,
      ).not.toContain("line000"),
    );
  }
  expect(
    call.mock.calls.filter(
      ([method, input]) => method === "read" && input.replay,
    ),
  ).toHaveLength(1);
});
const output = (text: string, seq = 1, exitCode: number | null = null) => ({
  chunks: text ? [{ seq, dataBase64: btoa(text) }] : [],
  nextSeq: seq,
  truncated: false,
  status: "running",
  exitCode,
});
function createPump(
  call = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "read" ? output(input.replay ? "Boo\x1b[6n" : "") : { ok: true },
  ),
) {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { value: 640 },
    clientHeight: { value: 384 },
  });
  document.body.append(container);
  const onStatus = vi.fn();
  const onTitle = vi.fn();
  const pump = new TerminalPump({
    container,
    rpc: { call } as PluginRpcClient<typeof rpcContract>,
    terminalId: "owned",
    fontSize: 13,
    onStatus,
    onTitle,
    onToggleRequested: vi.fn(),
  });
  pumps.push(pump);
  pump.setVisible(true);
  return { pump, container, call, onStatus, onTitle };
}
it("renders actual Ghostty output and suppresses replay-generated terminal replies", async () => {
  const { container, call } = createPump();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  expect(container.dataset.renderer).toBe("ghostty");
  expect(call.mock.calls.filter(([method]) => method === "write")).toHaveLength(
    0,
  );
});
it.each([true, false])(
  "reports exit during replay=%s without a restart prompt or accepting more input",
  async (duringReplay) => {
    const call = vi.fn(
      async (method: string, input: Record<string, unknown>) =>
        method === "read"
          ? input.replay && !duringReplay
            ? output("Boo")
            : { ...output(""), status: "exited", exitCode: 0 }
          : { ok: true },
    );
    const { pump, container, onStatus } = createPump(call);
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith(
        "exited",
        "Shell exited with code 0",
      ),
    );
    expect(container.textContent).not.toContain("press Enter");
    pump.send("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(call.mock.calls.some(([method]) => method === "write")).toBe(false);
  },
);
it("stops polling when hidden and keeps the rendered buffer on reopen", async () => {
  const { pump, container, call } = createPump();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  pump.setVisible(false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const reads = call.mock.calls.filter(([method]) => method === "read").length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(call.mock.calls.filter(([method]) => method === "read")).toHaveLength(
    reads,
  );
  pump.setVisible(true);
  await vi.waitFor(() =>
    expect(
      call.mock.calls.filter(([method]) => method === "read").length,
    ).toBeGreaterThan(reads),
  );
  expect(container.textContent).toContain("Boo");
  expect(
    call.mock.calls.filter(
      ([method, input]) => method === "read" && input.replay,
    ),
  ).toHaveLength(1);
});
it("serializes input and applies bracketed paste requested by the application", async () => {
  const call = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "read"
      ? output(input.replay ? "ready\x1b[?2004h" : "")
      : { ok: true },
  );
  const { pump, container } = createPump(call);
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  pump.paste("hello\nworld");
  await vi.waitFor(() =>
    expect(call.mock.calls.some(([method]) => method === "write")).toBe(true),
  );
  const writes = call.mock.calls.filter(([method]) => method === "write");
  expect(
    writes.map(([, input]) => atob(String(input.dataBase64))).join(""),
  ).toBe("\x1b[200~hello\nworld\x1b[201~");
});
it("cleans up the DOM and ignores pending output after disposal", async () => {
  const { pump, container, call } = createPump();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  pump.dispose();
  const count = call.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(container.childElementCount).toBe(0);
  expect(call.mock.calls).toHaveLength(count);
});

it("does not steal search focus when Ghostty finishes loading behind a picker", async () => {
  const { pump, container } = createPump();
  pump.setFocused(false);
  const search = document.createElement("input");
  document.body.append(search);
  search.focus();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  expect(document.activeElement).toBe(search);
  pump.setFocused(true);
  expect(container.contains(document.activeElement)).toBe(true);
});

it("delivers actual terminal control keys before isolating BB shortcuts and preserves link modifiers", async () => {
  const { container, call } = createPump();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  const hostKey = vi.fn();
  document.addEventListener("keydown", hostKey);
  const wrapper = render(
    createElement(
      "div",
      { onKeyDown: isolateTerminalKey, onKeyUp: isolateTerminalKey },
      createElement("div", {
        ref: (node: HTMLDivElement | null) => {
          node?.append(container);
        },
      }),
    ),
  );
  try {
    const input = container.querySelector("textarea")!;
    input.focus();
    fireEvent.keyDown(input, { key: "c", code: "KeyC", ctrlKey: true });
    fireEvent.keyUp(input, { key: "c", code: "KeyC", ctrlKey: true });
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });
    fireEvent.keyDown(input, { key: "d", code: "KeyD", ctrlKey: true });
    await vi.waitFor(() =>
      expect(
        call.mock.calls
          .filter(([method]) => method === "write")
          .map(([, input]) => atob(String(input.dataBase64)))
          .join(""),
      ).toBe("\x03\t\x04"),
    );
    expect(document.activeElement).toBe(input);
    const mac = navigator.platform.startsWith("Mac");
    fireEvent.keyDown(input, {
      key: mac ? "Meta" : "Control",
      code: mac ? "MetaLeft" : "ControlLeft",
      metaKey: mac,
      ctrlKey: !mac,
    });
    expect(container.classList.contains("link-modifier-active")).toBe(true);
    fireEvent.keyUp(input, {
      key: mac ? "Meta" : "Control",
      code: mac ? "MetaLeft" : "ControlLeft",
    });
    expect(container.classList.contains("link-modifier-active")).toBe(false);
    expect(hostKey).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener("keydown", hostKey);
    wrapper.unmount();
  }
});

it("restores the latest automatic title from replay without sending terminal replies", async () => {
  const call = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "read"
      ? output(input.replay ? "\x1b]0;bb-fg:shell:zsh\x07ready\x1b[6n" : "")
      : { ok: true },
  );
  const { onTitle } = createPump(call);
  await vi.waitFor(() =>
    expect(onTitle).toHaveBeenCalledWith("bb-fg:shell:zsh"),
  );
  expect(call.mock.calls.some(([method]) => method === "write")).toBe(false);
});

it("scrolls an alternate-screen app with wheel arrows when mouse reporting is off", async () => {
  const call = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "read"
      ? output(input.replay ? "\x1b[?1049h\x1b[?1hready" : "")
      : { ok: true },
  );
  const { container } = createPump(call);
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  fireEvent.wheel(container, { deltaY: -48 });
  await vi.waitFor(() =>
    expect(
      call.mock.calls
        .filter(([method]) => method === "write")
        .map(([, input]) => atob(String(input.dataBase64)))
        .join(""),
    ).toBe("\x1bOA".repeat(3)),
  );
});

it("lets Shift-wheel scroll history without sending a mouse report to the shell", async () => {
  const call = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "read"
      ? output(input.replay ? "\x1b[?1000h\x1b[?1006hready" : "")
      : { ok: true },
  );
  const { container } = createPump(call);
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  container.scrollTop = 300;
  fireEvent.wheel(container, { deltaY: -48, shiftKey: true });
  expect(container.scrollTop).toBe(252);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(call.mock.calls.some(([method]) => method === "write")).toBe(false);
  fireEvent.wheel(container, { deltaY: 48 });
  await vi.waitFor(() =>
    expect(
      call.mock.calls
        .filter(([method]) => method === "write")
        .map(([, input]) => atob(String(input.dataBase64)))
        .join(""),
    ).toContain("\x1b[<65;"),
  );
});

it("handles history scrolling while containing wheel events inside the terminal", async () => {
  const { container, call } = createPump();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  const hostWheel = vi.fn((event: Event) => event.preventDefault());
  document.addEventListener("wheel", hostWheel);
  try {
    const wheel = new WheelEvent("wheel", {
      deltaY: -64,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(hostWheel).not.toHaveBeenCalled();
    expect(call.mock.calls.some(([method]) => method === "write")).toBe(false);
  } finally {
    document.removeEventListener("wheel", hostWheel);
  }
});

it("scrolls history even when a surrounding overlay cancels native wheel defaults", async () => {
  const { container, call } = createPump();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  container.scrollTop = 300;
  const hostLock = (event: Event) => event.preventDefault();
  document.addEventListener("wheel", hostLock, { capture: true });
  try {
    fireEvent.wheel(container, { deltaY: -48 });
    expect(container.scrollTop).toBe(252);
    expect(call.mock.calls.some(([method]) => method === "write")).toBe(false);
  } finally {
    document.removeEventListener("wheel", hostLock, { capture: true });
  }
});

it("repaints the history viewport when Latest is clicked after scrolling back", async () => {
  const lines = Array.from(
    { length: 100 },
    (_, index) => `line-${String(index).padStart(3, "0")}`,
  ).join("\r\n");
  const call = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "read" ? output(input.replay ? lines : "") : { ok: true },
  );
  const { pump, container } = createPump(call);
  let top = 0;
  Object.defineProperties(container, {
    scrollHeight: { value: 1600 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, 1600 - container.clientHeight));
      },
    },
  });
  await vi.waitFor(() => expect(container.textContent).toContain("line-099"));
  container.scrollTop = 0;
  fireEvent.scroll(container);
  await vi.waitFor(() =>
    expect(
      container.querySelector(".term-scrollback-row")?.textContent,
    ).toContain("line-000"),
  );
  pump.scrollToBottom();
  await vi.waitFor(() =>
    expect(
      container.querySelector(".term-scrollback-row")?.textContent,
    ).not.toContain("line-000"),
  );
  expect(container.scrollTop).toBe(1600 - container.clientHeight);
});

it("inherits live host colors for the terminal and existing history", async () => {
  const { pump, container } = createPump();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  pump.refreshTheme();
  expect(container.style.getPropertyValue("--term-bg")).toBe(
    "var(--background)",
  );
  expect(container.style.getPropertyValue("--term-fg")).toBe(
    "var(--foreground)",
  );
  expect(container.querySelector(".term-row")?.textContent).toContain("Boo");
});

it("coalesces typing behind a slow write instead of adding one round trip per key", async () => {
  const releases: Array<() => void> = [];
  const call = vi.fn(async (method: string, input: Record<string, unknown>) => {
    if (method === "read") return output(input.replay ? "ready" : "");
    if (method === "write") await new Promise<void>((resolve) => releases.push(resolve));
    return { ok: true };
  });
  const { pump, container } = createPump(call);
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  const writes = () => call.mock.calls.filter(([method]) => method === "write");
  try {
    pump.send("a");
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    for (const key of ["b", "c", "d"]) {
      pump.send(key);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    expect(writes()).toHaveLength(1);
    releases.shift()!();
    await vi.waitFor(() => expect(writes()).toHaveLength(2));
    expect(atob(String(writes()[1][1].dataBase64))).toBe("bcd");
  } finally {
    pump.dispose();
    for (const release of releases) release();
  }
});

it("keeps queued input after every bounded chunk of an in-flight large paste", async () => {
  const releases: Array<() => void> = [];
  const call = vi.fn(async (method: string, input: Record<string, unknown>) => {
    if (method === "read") return output(input.replay ? "ready" : "");
    if (method === "write") await new Promise<void>((resolve) => releases.push(resolve));
    return { ok: true };
  });
  const { pump, container } = createPump(call);
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  const writes = () => call.mock.calls.filter(([method]) => method === "write");
  const text = "x".repeat(65536 + 10);
  try {
    pump.send(text);
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    pump.send("tail");
    releases.shift()!();
    await vi.waitFor(() => expect(writes()).toHaveLength(2));
    releases.shift()!();
    await vi.waitFor(() => expect(writes()).toHaveLength(3));
    const chunks = writes().map(([, input]) => atob(String(input.dataBase64)));
    expect(chunks.every((chunk) => chunk.length <= 65536)).toBe(true);
    expect(chunks.join("")).toBe(text + "tail");
  } finally {
    pump.dispose();
    for (const release of releases) release();
  }
});

it("uses a single grid calculation when the viewport changes", async () => {
  const observers: Array<{ callback: ResizeObserverCallback; target?: Element }> = [];
  vi.stubGlobal("ResizeObserver", class {
    entry: typeof observers[number];
    constructor(callback: ResizeObserverCallback) { this.entry = { callback }; observers.push(this.entry); }
    observe(target: Element) { this.entry.target = target; }
    disconnect() {}
  });
  const { WTerm } = await import("@wterm/dom");
  const resize = vi.spyOn(WTerm.prototype, "resize");
  const { pump, container } = createPump();
  await vi.waitFor(() => expect(container.textContent).toContain("Boo"));
  resize.mockClear();
  // The inner viewport can change before the outer box settles (e.g.
  // keyboard animation). Only the outer box should determine the grid.
  for (const observer of observers) {
    observer.callback([{ target: observer.target, contentRect: { width: 640, height: 312 } } as ResizeObserverEntry], {} as ResizeObserver);
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(resize.mock.calls.filter(([cols, rows]) => cols !== 80 || rows !== 24)).toEqual([]);
  expect(pump.rows()).toBe(24);
});

it("reads fresh echo immediately after a pre-input read finishes", async () => {
  let release!: () => void;
  let reads = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const call = vi.fn(async (method: string, input: Record<string, unknown>) => {
    if (method !== "read") return { ok: true };
    if (input.replay) return output("ready");
    if (++reads === 1) await pending;
    return output("");
  });
  const { pump, container } = createPump(call);
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  await vi.waitFor(() => expect(reads).toBe(1));
  vi.useFakeTimers();
  try {
    pump.send("a");
    await vi.advanceTimersByTimeAsync(4);
    expect(reads).toBe(1); // Never overlap an existing read.
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(2); // No polling backoff after that obsolete response.
  } finally {
    release();
    pump.dispose();
    vi.useRealTimers();
  }
});

it("answers startup queries in the first attachment so the shell can draw its prompt", async () => {
  let answered = false;
  const call = vi.fn(async (method: string, input: Record<string, unknown>) => {
    if (method === "write") { answered = true; return { ok: true }; }
    if (method === "read") return {
      ...output(input.replay ? "\x1b[6n" : answered ? "fish> " : ""),
      respondToQueries: input.replay === true,
    };
    return { ok: true };
  });
  const { container } = createPump(call);
  await vi.waitFor(() => expect(container.textContent).toContain("fish> "));
});

import { GhosttyCore } from "@wterm/ghostty";
import { searchTerminal } from "../lib/search";
const fixture = (text: string) => createPump(vi.fn(async (method: string, input: Record<string, unknown>) => method === "read" ? output(input.replay ? text : "") : { ok: true }));
const sent = (call: ReturnType<typeof vi.fn>) => call.mock.calls.filter(([method]) => method === "write").map(([, input]) => atob(input.dataBase64)).join("");

it("polish: last-column styling stays within its cell", async () => {
  const { container } = fixture("a".repeat(79) + "\x1b[41m ");
  await vi.waitFor(() => expect(container.textContent).toContain("a".repeat(79)));
  const style = document.createElement("style"); style.textContent = await readFile("styles.css", "utf8"); container.append(style);
  const row = container.querySelector<HTMLElement>(".term-row")!;

  // jsdom does not implement stylesheet !important over inline styles.
  // Verify the matching override and that the cell keeps its explicit color.
  const rules = Array.from(style.sheet!.cssRules).filter((rule): rule is CSSStyleRule => "selectorText" in rule);
  expect(rules.some(rule => row.matches(rule.selectorText) && rule.style.getPropertyValue("background") === "transparent" && rule.style.getPropertyPriority("background") === "important")).toBe(true);
  expect(row.lastElementChild?.getAttribute("style")).toContain("rgb(204,102,102)");
});
it("polish: physical Ctrl+F reaches the PTY on macOS", async () => {
  const { container, call } = fixture("ready");
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  fireEvent.keyDown(container.querySelector("textarea")!, { key: "f", code: "KeyF", ctrlKey: true });
  await new Promise(r => setTimeout(r, 30));
  expect(sent(call)).toBe("\x06");
});
it("polish: Cmd+Left goes to line start and Ctrl+Left keeps its modifier", async () => {
  const { container, call } = fixture("ready");
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  const input = container.querySelector("textarea")!;
  fireEvent.keyDown(input, { key: "ArrowLeft", metaKey: true });
  fireEvent.keyDown(input, { key: "ArrowLeft", ctrlKey: true });
  await vi.waitFor(() => expect(sent(call)).toBe("\x01\x1b[1;5D"));
});
it("polish: Cmd+A selects all retained history", async () => {
  const { container } = fixture(Array.from({length: 1000}, (_, i) => `line${i.toString().padStart(4,"0")}\r\n`).join(""));
  await vi.waitFor(() => expect(container.textContent).toContain("line0999"));
  fireEvent.keyDown(container.querySelector("textarea")!, { key: "a", metaKey: true });
  const text = window.getSelection()!.toString();
  expect(text).toContain("line0999");
  expect(text).toContain("line0000");
  expect((text.match(/line[0-9]{4}/g) ?? []).length).toBe(1000);
});
it("polish: toolbar send and physical typing both return to newest output", async () => {
  const { pump, container } = fixture("ready");
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  let top = 0;
  Object.defineProperties(container, { scrollHeight: {value:1600}, scrollTop:{ get:()=>top, set:(value:number)=>{top=Math.min(value,1216);} } });
  fireEvent.scroll(container);
  pump.send("x");
  expect(top).toBe(1216);
  fireEvent.keyDown(container.querySelector("textarea")!, {key:"y"});
  expect(top).toBe(1216);
});
it("polish: search includes the newest matches beyond 1000 results", async () => {
  const core = await GhosttyCore.load({wasmPath:assets.url,scrollbackLimit:1024*1024});
  try {
    core.init(20, 24); core.writeString("error\r\n".repeat(1100));
    const matches = searchTerminal(core,"error");
    expect(matches).toHaveLength(1100);
    expect(matches.at(-1)!.row).toBe(1099);
    expect(core.getScrollbackCount()+core.getRows()).toBeGreaterThan(1100);
  } finally {core.dispose();}
});
it("polish: terminal input is labelled and remains within the viewport", async () => {
  const { container } = fixture("ready");
  await vi.waitFor(() => expect(container.textContent).toContain("ready"));
  const input = container.querySelector("textarea")!;
  expect(input.getAttribute("aria-hidden")).toBeNull();
  expect(input.style.left).not.toBe("-9999px");
  expect(container.querySelector('[role="log"], [aria-live]')).toBeNull();
});

it("answers real Ghostty color queries using the current host theme", async () => {
  let light = false;
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const result = computed(element);
    const color = (element as HTMLElement).style.color;
    if (color === "var(--foreground)" || color === "var(--background)") {
      const foreground = color === "var(--foreground)";
      return new Proxy(result, { get(target, property) {
        if (property === "color") return foreground === light ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
        return Reflect.get(target, property);
      } });
    }
    return result;
  });
  let revision = 0;
  const call = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "read" ? {
      ...output(revision === 0 || light && revision === 1 ? "ready\x1b]10;?\x07\x1b]11;?\x07" : "", ++revision),
      respondToQueries: true,
    } : { ok: true },
  );
  const { pump } = createPump(call);
  await vi.waitFor(() => expect(sent(call)).toContain("\x1b]11;rgb:0000/0000/0000"));
  light = true;
  pump.refreshTheme();
  revision = 1;
  await vi.waitFor(() => expect(sent(call)).toContain("\x1b]11;rgb:ffff/ffff/ffff"));
});

it("keeps an idle prompt visible after changing terminal dimensions", async () => {
  const { pump, container } = fixture("~\r\nprompt> ");
  await vi.waitFor(() => expect(container.textContent).toContain("prompt>"));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const width = this.tagName === "SPAN" ? (this.textContent?.length ?? 1) * 7 : 640;
    return { width, height: 16, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 16, toJSON() {} };
  });
  pump.fit();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(container.textContent).toContain("prompt>");
});

it("keeps idle prompt cells through row-only resizing", async () => {
  const { pump, container } = fixture("directory\r\nprompt> ");
  await vi.waitFor(() => expect(container.textContent).toContain("prompt>"));
  for (const rows of [30, 20, 24, 40, 24]) {
    (pump as any).fitting = true;
    (pump as any).terminal.resize(80, rows);
    (pump as any).fitting = false;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(container.textContent, `rows ${rows}`).toContain("prompt>");
  }
});

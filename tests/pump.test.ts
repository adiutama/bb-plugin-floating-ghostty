// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { createElement } from "react";
import { render, fireEvent } from "@testing-library/react";
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
  for (const pump of pumps.splice(0)) pump.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const output = (text: string, seq = 1) => ({
  chunks: text ? [{ seq, dataBase64: btoa(text) }] : [],
  nextSeq: seq,
  truncated: false,
  status: "running",
  exitCode: null,
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
    onRequestRestart: vi.fn(),
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

it("preserves browser history scrolling while containing wheel events inside the terminal", async () => {
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
    expect(wheel.defaultPrevented).toBe(false);
    expect(hostWheel).not.toHaveBeenCalled();
    expect(call.mock.calls.some(([method]) => method === "write")).toBe(false);
  } finally {
    document.removeEventListener("wheel", hostWheel);
  }
});

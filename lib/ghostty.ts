// Ghostty compatibility guards adapted from Wterm Terminal Preview (MIT).
import { GhosttyCore } from "@wterm/ghostty";
import { Osc52ClipboardFilter } from "./osc52-clipboard";
import { terminalLinkHref } from "./terminal-links";
import { createRetryablePromiseCache } from "./retryable-cache";
const anyEventMouseModes = new WeakMap<
  object,
  { enabled: boolean; generation: number }
>();
function isUsableTerminalSize(cols: number, rows: number): boolean {
  return (
    Number.isSafeInteger(cols) &&
    Number.isSafeInteger(rows) &&
    cols >= 2 &&
    rows >= 2
  );
}
export function supportAnyEventMouseMode(
  core: GhosttyCore,
  onClipboardRequest: (text: string) => void = () => {},
): GhosttyCore {
  const decodeMouseControl = new TextDecoder("latin1");
  const writeRaw = core.writeRaw.bind(core);
  const writeString = core.writeString.bind(core);
  const initCore = core.init.bind(core);
  const resizeCore = core.resize.bind(core);
  const supportedMode = core.mouseTracking.bind(core);
  const getCell = core.getCell?.bind(core);
  const getScrollbackCell = core.getScrollbackCell?.bind(core);
  const decorateCell = <Cell extends { linkUri?: string }>(
    cell: Cell,
  ): Cell => {
    const href = terminalLinkHref(cell.linkUri);
    return href === cell.linkUri ? cell : ({ ...cell, linkUri: href } as Cell);
  };
  const osc52 = new Osc52ClipboardFilter(onClipboardRequest);
  let anyEventMouse = false;
  let anyEventGeneration = 0;
  let controlTail = "";
  let initialized = false;
  anyEventMouseModes.set(core, {
    enabled: anyEventMouse,
    generation: anyEventGeneration,
  });

  const observeMouseMode = (text: string) => {
    const control = controlTail + text;
    let nextAnyEventMouse = anyEventMouse;
    for (const match of control.matchAll(/\x1b\[\?([0-9;]*)([hl])/g)) {
      const modes = match[1]?.split(";") ?? [];
      for (const mode of modes) {
        if (
          match[2] === "h" &&
          (mode === "9" ||
            mode === "1000" ||
            mode === "1001" ||
            mode === "1002" ||
            mode === "1003")
        ) {
          nextAnyEventMouse = mode === "1003";
        } else if (match[2] === "l" && mode === "1003") {
          nextAnyEventMouse = false;
        }
        if (
          match[2] === "l" &&
          (mode === "47" || mode === "1047" || mode === "1049")
        ) {
          nextAnyEventMouse = false;
        }
      }
    }
    if (nextAnyEventMouse !== anyEventMouse) {
      anyEventMouse = nextAnyEventMouse;
      anyEventGeneration += 1;
      anyEventMouseModes.set(core, {
        enabled: anyEventMouse,
        generation: anyEventGeneration,
      });
    }
    controlTail = control.slice(-64);
  };

  core.init = (cols, rows) => {
    if (!isUsableTerminalSize(cols, rows)) return;
    if (initialized) {
      resizeCore(cols, rows);
      return;
    }
    initCore(cols, rows);
    initialized = true;
  };
  core.resize = (cols, rows) => {
    if (!isUsableTerminalSize(cols, rows)) return;
    if (!initialized) {
      initCore(cols, rows);
      initialized = true;
      return;
    }
    resizeCore(cols, rows);
  };
  core.writeRaw = (data, afterChunk) => {
    let filtered = data;
    try {
      filtered = osc52.consumeBytes(data);
      if (controlTail.length > 0 || filtered.indexOf(0x1b) >= 0) {
        observeMouseMode(decodeMouseControl.decode(filtered));
      }
    } catch {
      filtered = data;
    }
    writeRaw(filtered, afterChunk);
  };
  core.writeString = (data, afterChunk) => {
    let filtered = data;
    try {
      filtered = osc52.consumeString(data);
      if (controlTail.length > 0 || filtered.includes("\x1b")) {
        observeMouseMode(filtered);
      }
    } catch {
      filtered = data;
    }
    writeString(filtered, afterChunk);
  };
  core.mouseTracking = () => (anyEventMouse ? 1002 : supportedMode());
  if (getCell) {
    core.getCell = (row, col) => decorateCell(getCell(row, col));
  }
  if (getScrollbackCell) {
    core.getScrollbackCell = (offset, col) =>
      decorateCell(getScrollbackCell(offset, col));
  }
  return core;
}

const wasmBytes = createRetryablePromiseCache(async () => {
  const tokenResponse = await fetch("/api/v1/plugins/floating-ghostty/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  const json: unknown = await tokenResponse.json();
  if (
    !tokenResponse.ok ||
    !json ||
    typeof json !== "object" ||
    !("token" in json) ||
    typeof json.token !== "string"
  )
    throw new Error("Could not authorize Ghostty assets");
  const response = await fetch(
    "/api/v1/plugins/floating-ghostty/http/ghostty-vt.wasm",
    {
      headers: { "x-bb-plugin-token": json.token },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(`Ghostty WASM request failed (${response.status})`);
  return response.arrayBuffer();
});
export async function loadCore(): Promise<GhosttyCore> {
  const url = URL.createObjectURL(
    new Blob([await wasmBytes()], { type: "application/wasm" }),
  );
  try {
    // Clipboard writes from terminal programs are filtered. Normal user copy
    // and paste stay browser-owned; output cannot overwrite the clipboard.
    return supportAnyEventMouseMode(
      await GhosttyCore.load({
        wasmPath: url,
        scrollbackLimit: 1024 * 1024,
        foregroundColor: "#d4d4d4",
        backgroundColor: "#1e1e1e",
        imageStorageLimit: 32 * 1024 * 1024,
      }),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { TabStatus } from "./tabs";
import {
  base64ToBytes,
  encodeInputChunks,
  normalizeTerminalTitle,
} from "./terminal-io";
import { controlCode } from "./keys";
import { resolveMonoFont } from "./theme";
import { loadCore } from "./ghostty";
import { searchTerminal } from "./search";
import { TerminalTitleObserver } from "./terminal-title";
import { installTerminalScrolling, scrollTerminalTo } from "./terminal-scroll";

type Rpc = PluginRpcClient<typeof rpcContract>;
const FAST_INTERVAL = 40;
const SLOW_INTERVAL = 320;
const INPUT_FLUSH_MS = 4;
const RESIZE_DEBOUNCE_MS = 90;
export interface PumpOptions {
  container: HTMLElement;
  rpc: Rpc;
  terminalId: string;
  fontSize: number;
  onStatus: (status: TabStatus, detail: string | null) => void;
  /** Fired when the user presses Enter at a dead shell prompt. */
  onRequestRestart: () => void;
  /** Fired for shortcuts Ghostty must not swallow (the global toggle). */
  onToggleRequested: () => void;
  /** A meaningful OSC title the shell set, already normalised. Null clears it. */
  onTitle?: (title: string | null) => void;
  /** The armed-Ctrl latch changed, so the bar can show it. */
  onCtrlArmed?: (armed: boolean) => void;
  /** Cmd/Ctrl+F landed in the terminal; the window should open its find bar. */
  onFindRequested?: () => void;
  /** Whether the view sits at the newest output. Drives the jump-to-latest pill. */
  onScrollState?: (atBottom: boolean) => void;
  /** Match counts from an active search: null when the search is cleared. */
  onSearchResults?: (results: { index: number; count: number } | null) => void;
}

export class TerminalPump {
  private terminal: WTerm | null = null;
  private core: GhosttyCore | null = null;
  private readonly options: PumpOptions;
  private nextSeq = 0;
  private interval = FAST_INTERVAL;
  private pollTimer: number | null = null;
  private reading = false;
  private restartRequested = false;
  private flushTimer: number | null = null;
  private resizeTimer: number | null = null;
  private outbox: string[] = [];
  private writeChain: Promise<unknown> = Promise.resolve();
  private status: TabStatus = "connecting";
  private visible = false;
  private wantsFocus = true;
  private started = false;
  private disposed = false;
  private replayWrites = 0;
  private replayPending = true;
  private ctrlArmed = false;
  private fontSize: number;
  private resizeObserver: ResizeObserver;
  private fitFrame: number | null = null;
  private searchQuery = "";
  private searchIndex = -1;
  private abort = new AbortController();
  private titleObserver = new TerminalTitleObserver((title) => {
    this.options.onTitle?.(normalizeTerminalTitle(title));
  });

  constructor(options: PumpOptions) {
    this.options = options;
    this.fontSize = options.fontSize;
    installTerminalScrolling({
      element: options.container,
      mode: () => ({
        alternate: this.core?.usingAltScreen() ?? false,
        reportsMouse: !!this.core?.mouseTracking() && !!this.core?.mouseSgr(),
        applicationCursor: this.applicationCursorKeys(),
      }),
      rowHeight: () => Math.ceil(this.fontSize * 1.2),
      send: (input) => this.send(input),
      signal: this.abort.signal,
    });
    options.container.dataset.renderer = "ghostty";
    this.applyFont();
    this.refreshTheme();
    // Keyboard isolation stops bubbling before Wterm's document-level listener.
    // Track the link activation modifier locally as well, before that boundary.
    const trackLinkModifier = (event: KeyboardEvent) => {
      options.container.classList.toggle(
        "link-modifier-active",
        navigator.platform.startsWith("Mac") ? event.metaKey : event.ctrlKey,
      );
    };
    for (const type of ["keydown", "keyup"] as const) {
      options.container.addEventListener(type, trackLinkModifier, {
        capture: true,
        signal: this.abort.signal,
      });
    }
    options.container.addEventListener(
      "blur",
      () => {
        options.container.classList.remove("link-modifier-active");
      },
      { capture: true, signal: this.abort.signal },
    );
    options.container.addEventListener("keydown", this.onKeyDown, {
      capture: true,
      signal: this.abort.signal,
    });
    options.container.addEventListener(
      "scroll",
      () => this.reportScrollState(),
      { passive: true, signal: this.abort.signal },
    );
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitFrame !== null) return;
      this.fitFrame = requestAnimationFrame(() => {
        this.fitFrame = null;
        this.fit();
      });
    });
    this.resizeObserver.observe(options.container);
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const core = await loadCore();
      if (this.disposed) {
        core.dispose();
        return;
      }
      this.core = core;
      const terminal = new WTerm(this.options.container, {
        core,
        autoResize: true,
        cursorBlink: true,
        onData: (data) => {
          if (this.replayWrites === 0) this.handleInput(data);
        },
        onResize: (cols, rows) => this.scheduleResize(cols, rows),
      });
      // Wterm's observer reports 1x1 for display:none. Preserve the actual grid
      // while hidden; a collapsed window must never reflow the shell.
      const resize = terminal.resize.bind(terminal);
      terminal.resize = (cols, rows) => {
        if (this.disposed || !this.visible || cols < 2 || rows < 2) return;
        if (cols === terminal.cols && rows === terminal.rows) return;
        resize(cols, rows);
      };
      this.terminal = terminal;
      const previousFocus = document.activeElement;
      await terminal.init();
      if (this.disposed) {
        terminal.destroy();
        core.dispose();
        return;
      }
      this.applyFont();
      this.refreshTheme();
      this.fit();
      if (this.visible) {
        this.start();
      }
      if (this.visible && this.wantsFocus) {
        this.focus();
      } else {
        this.blur();
        if (previousFocus instanceof HTMLElement) previousFocus.focus();
      }
      void document.fonts
        ?.load(`${this.fontSize}px "BB FG Nerd Symbols"`, "\ue0a0")
        .then(() => {
          if (!this.disposed) this.fit();
        })
        .catch(() => {});
    } catch (error) {
      if (this.disposed) return;
      this.setStatus(
        "error",
        error instanceof Error ? error.message : "Ghostty failed to load",
      );
      this.terminal?.destroy();
      this.terminal = null;
      this.core?.dispose();
      this.core = null;
      const message = document.createElement("button");
      message.type = "button";
      message.className = "m-4 rounded border border-border px-3 py-2 text-xs";
      message.textContent = "Ghostty could not load. Retry";
      message.onclick = () => {
        message.remove();
        void this.initialize();
      };
      this.options.container.append(message);
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const stop = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (this.ctrlArmed && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const code = controlCode(event.key);
      if (code !== null) {
        stop();
        this.setCtrlArmed(false);
        this.send(code);
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "f") {
      stop();
      this.options.onFindRequested?.();
      return;
    }
    const selection = window.getSelection();
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "c" &&
      selection &&
      !selection.isCollapsed &&
      this.options.container.contains(selection.anchorNode) &&
      this.options.container.contains(selection.focusNode)
    ) {
      stop();
      void navigator.clipboard?.writeText(selection.toString()).catch(() => {});
    }
  };

  private applyFont(): void {
    const el = this.options.container;
    el.style.setProperty("--term-font-family", resolveMonoFont(el));
    el.style.setProperty("--term-font-size", `${this.fontSize}px`);
    el.style.setProperty(
      "--term-row-height",
      `${Math.ceil(this.fontSize * 1.2)}px`,
    );
  }

  private writeOutput(bytes: Uint8Array, replay: boolean): void {
    this.titleObserver.consume(bytes);
    if (replay) this.replayWrites++;
    try {
      this.terminal?.write(bytes);
    } finally {
      if (replay) this.replayWrites--;
    }
    requestAnimationFrame(() => {
      if (!this.disposed) this.reportScrollState();
    });
  }

  private reportScrollState(): void {
    const el = this.options.container;
    this.options.onScrollState?.(
      this.core?.usingAltScreen() ||
        el.scrollHeight - el.scrollTop - el.clientHeight < 5,
    );
  }
  scrollToBottom(): void {
    scrollTerminalTo(
      this.options.container,
      this.options.container.scrollHeight,
    );
    this.reportScrollState();
  }
  searchAvailable(): boolean {
    return this.core !== null;
  }
  findNext(query: string, incremental = false): void {
    this.find(query, incremental ? 0 : 1);
  }
  findPrevious(query: string): void {
    this.find(query, -1);
  }
  private find(query: string, direction: number): void {
    if (!this.core) return;
    const matches = searchTerminal(this.core, query);
    this.searchIndex =
      query !== this.searchQuery || direction === 0
        ? 0
        : this.searchIndex + direction;
    this.searchQuery = query;
    this.searchIndex = matches.length
      ? (this.searchIndex + matches.length) % matches.length
      : -1;
    const match = matches[this.searchIndex];
    if (match)
      scrollTerminalTo(
        this.options.container,
        match.row * Math.ceil(this.fontSize * 1.2),
      );
    this.options.onSearchResults?.({
      index: this.searchIndex,
      count: matches.length,
    });
  }
  clearSearch(): void {
    this.searchQuery = "";
    this.searchIndex = -1;
    this.options.onSearchResults?.(null);
  }
  private handleInput(data: string): void {
    if (this.disposed) return;
    if (this.ctrlArmed && data.length === 1) {
      const control = controlCode(data);
      if (control !== null) {
        this.setCtrlArmed(false);
        data = control;
      }
    }
    if (this.status === "exited" && data.includes("\r")) {
      // Latched: the pump stays "exited" for the whole restart round trip, so
      // without this every extra Enter fires another restart, and each one
      // creates a PTY the tab strip will never show.
      if (this.restartRequested) return;
      this.restartRequested = true;
      this.options.onRequestRestart();
      return;
    }
    this.queueInput(data);
  }

  /** Write bytes as if they had been typed. Used by the on-screen key bar. */
  send(data: string): void {
    this.handleInput(data);
  }

  /** True when the program asked for SS3 arrows (vim, less, anything full-screen). */
  applicationCursorKeys(): boolean {
    return this.core?.cursorKeysApp() ?? false;
  }

  setCtrlArmed(armed: boolean): void {
    if (this.ctrlArmed === armed) return;
    this.ctrlArmed = armed;
    this.options.onCtrlArmed?.(armed);
  }

  blur(): void {
    (
      this.terminal?.element.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null
    )?.blur();
  }

  private setStatus(status: TabStatus, detail: string | null = null): void {
    if (this.status === status && detail === null) return;
    this.status = status;
    this.options.onStatus(status, detail);
  }

  private queueInput(data: string): void {
    this.outbox.push(data);
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flushInput();
    }, INPUT_FLUSH_MS);
  }

  private flushInput(): void {
    const pending = this.outbox.join("");
    this.outbox = [];
    if (pending === "" || this.disposed) return;

    // Chained so keystrokes reach the pty in the order they were typed, and
    // chunked so a paste over the transport ceiling is split instead of refused.
    for (const dataBase64 of encodeInputChunks(pending)) {
      this.writeChain = this.writeChain
        .then(() =>
          this.disposed
            ? undefined
            : this.options.rpc.call("write", {
                terminalId: this.options.terminalId,
                dataBase64,
              }),
        )
        .catch((error: unknown) => {
          this.setStatus(
            "error",
            error instanceof Error ? error.message : "Write failed",
          );
        });
    }
    // Any keystroke pulls polling back to its fastest.
    this.interval = FAST_INTERVAL;
    if (this.pollTimer !== null) this.schedule(FAST_INTERVAL);
  }

  private scheduleResize(cols: number, rows: number): void {
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      if (this.disposed) return;
      void this.options.rpc
        .call("resize", { terminalId: this.options.terminalId, cols, rows })
        .catch(() => {
          // A resize racing a closed session is not worth surfacing; the next
          // poll reports the real state.
        });
    }, RESIZE_DEBOUNCE_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private schedule(delay: number): void {
    this.stopPolling();
    if (this.disposed || !this.visible || !this.started) return;
    // A read already in flight will schedule the next one when it lands;
    // arming another here is what duplicates output.
    if (this.reading) return;
    this.pollTimer = window.setTimeout(() => void this.poll(), delay);
  }

  // What to do once the read settles. Decided inside the try, acted on after
  // the finally has cleared `reading` — an early return would run the finally
  // and skip the follow-up, leaving the loop dead.
  private async poll(): Promise<void> {
    this.pollTimer = null;
    if (this.disposed || !this.visible || this.reading) return;
    if (this.replayPending) {
      await this.replay();
      return;
    }
    this.reading = true;
    let next: "schedule" | "replay" | "stop" = "schedule";

    try {
      const result = await this.options.rpc.call("read", {
        terminalId: this.options.terminalId,
        sinceSeq: this.nextSeq,
      });

      if (this.disposed) {
        next = "stop";
      } else if (result.truncated && this.nextSeq > 0) {
        // The ring buffer wrapped past our cursor while this tab was hidden;
        // redraw from the tail rather than splicing a hole into scrollback.
        next = "replay";
      } else {
        for (const chunk of result.chunks) {
          this.writeOutput(base64ToBytes(chunk.dataBase64), false);
        }
        this.nextSeq = result.nextSeq;

        if (result.chunks.length > 0) {
          this.interval = FAST_INTERVAL;
          if (this.status !== "live") this.setStatus("live");
        } else if (
          result.status !== null &&
          result.status !== "running" &&
          result.status !== "starting"
        ) {
          this.reportExit(result.status, result.exitCode);
          next = "stop";
        } else {
          this.interval = Math.min(this.interval * 2, SLOW_INTERVAL);
          if (this.status !== "live") this.setStatus("live");
        }
      }
    } catch (error) {
      if (this.disposed) {
        next = "stop";
      } else {
        this.setStatus(
          "error",
          error instanceof Error ? error.message : "Read failed",
        );
        this.interval = SLOW_INTERVAL;
      }
    } finally {
      this.reading = false;
    }

    if (next === "replay") await this.replay();
    else if (next === "schedule") this.schedule(this.interval);
  }

  private reportExit(status: string, exitCode: number | null): void {
    this.stopPolling();
    const label =
      status === "gone"
        ? "Session closed"
        : exitCode === null
          ? "Shell exited"
          : `Shell exited with code ${exitCode}`;
    this.terminal?.write(
      `\r\n\x1b[2m[${label} — press Enter to start a new one]\x1b[0m\r\n`,
    );
    this.setStatus("exited", label);
  }

  /** Redraw the whole terminal from the session's retained scrollback. */
  private async replay(): Promise<void> {
    if (this.disposed || this.reading || !this.terminal) return;
    this.replayPending = true;
    this.reading = true;
    let ok = false;

    try {
      const result = await this.options.rpc.call("read", {
        terminalId: this.options.terminalId,
        sinceSeq: 0,
        replay: true,
      });
      if (!this.disposed) {
        this.terminal?.write("\x1bc");
        for (const chunk of result.chunks) {
          this.writeOutput(base64ToBytes(chunk.dataBase64), true);
        }
        this.nextSeq = result.nextSeq;
        this.replayPending = false;
        this.interval = FAST_INTERVAL;
        this.setStatus("live");
        ok = true;
      }
    } catch (error) {
      if (!this.disposed) {
        this.setStatus(
          "error",
          error instanceof Error ? error.message : "Could not attach",
        );
        // Keep the loop alive on a transient failure so the tab self-heals
        // instead of sitting in an error state until the user restarts it.
        this.interval = SLOW_INTERVAL;
        ok = true;
      }
    } finally {
      this.reading = false;
    }

    if (ok) this.schedule(this.interval);
  }

  /** Replay existing scrollback and begin polling. Call once, after fit(). */
  start(): void {
    if (this.started || this.disposed || !this.terminal || !this.visible)
      return;
    this.started = true;
    void this.replay();
  }

  /** Visible drives polling: hidden tabs cost nothing. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) {
      this.fit();
      if (!this.started) this.start();
      this.interval = FAST_INTERVAL;
      this.schedule(0);
    } else {
      this.stopPolling();
    }
  }

  fit(): void {
    if (this.disposed || !this.visible || !this.terminal) return;
    const el = this.options.container;
    if (!el.clientWidth || !el.clientHeight) return;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    probe.textContent = "MMMMMMMMMM";
    el.append(probe);
    const charWidth = probe.getBoundingClientRect().width / 10;
    probe.remove();
    if (charWidth <= 0) return;
    const cols = Math.max(2, Math.floor(el.clientWidth / charWidth));
    const rows = Math.max(
      2,
      Math.floor(el.clientHeight / Math.ceil(this.fontSize * 1.2)),
    );
    this.terminal.resize(cols, rows);
  }
  setFocused(focused: boolean): void {
    this.wantsFocus = focused;
    if (focused) this.focus();
    else this.blur();
  }
  focus(): void {
    if (this.visible && this.wantsFocus) this.terminal?.focus();
  }
  cols(): number {
    return Math.max(this.terminal?.cols ?? 80, 2);
  }
  rows(): number {
    return Math.max(this.terminal?.rows ?? 24, 2);
  }
  setFontSize(size: number): void {
    this.fontSize = size;
    this.applyFont();
    this.fit();
  }
  refreshTheme(): void {
    // Default cells use these CSS variables, including already-rendered history.
    // Explicit ANSI/RGB colors remain under the terminal program's control.
    const el = this.options.container;
    el.style.setProperty("--term-bg", "var(--background)");
    el.style.setProperty("--term-fg", "var(--foreground)");
    el.style.setProperty("--term-cursor", "var(--foreground)");
    el.style.setProperty("--term-color-0", "var(--background)");
    el.style.setProperty("--term-color-7", "var(--foreground)");
  }
  paste(text: string): void {
    this.send(
      this.core?.bracketedPaste()
        ? `\x1b[200~${text.replace(/\x1b/g, "")}\x1b[201~`
        : text,
    );
  }
  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.stopPolling();
    this.resizeObserver.disconnect();
    if (this.fitFrame !== null) cancelAnimationFrame(this.fitFrame);
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    this.terminal?.destroy();
    this.core?.dispose();
    this.options.container.replaceChildren();
  }
}

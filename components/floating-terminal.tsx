// The floating terminal window.
//
// All React: one component owns open state (via the external controller),
// geometry (via the frame helpers), the tab list (via the tabs reducer), and
// renders the tab bar, one TerminalView per open tab, and a teaching empty
// state. The only imperative islands are Ghostty itself (inside TerminalView)
// and the pointer-capture drag/resize handlers, both behind refs.
//
// Nothing renders until the window is first opened; from then on it stays
// mounted even while hidden, which is what keeps every tab's scrollback alive.
// Show/hide is a CSS transition driven by data-state.
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { GhostMark } from "./ghost-mark";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { ShellPicker } from "@/components/shell-picker";
import type { ScopeOption } from "@/lib/scopes";
import { FindBar } from "@/components/find-bar";
import { KeyToolbar } from "@/components/key-toolbar";
import { TabBar } from "@/components/tab-bar";
import { TerminalView } from "@/components/terminal-view";
import { windowController } from "@/lib/controller";
import {
  clampFrame,
  installDrag,
  installResize,
  loadFrame,
  RESIZE_EDGES,
  saveFrame,
  type Frame,
} from "@/lib/frame";
import type { TerminalPump } from "@/lib/pump";
import { arrowSequence, type ToolbarKey } from "@/lib/keys";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { trackVisualViewport } from "@/lib/viewport";
import { emptyTabs, tabsReducer, type TabStatus } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import type { rpcContract } from "../server";

/** Edge hit areas, wide enough to grab without visually thickening the border. */
const EDGE_CLASS: Record<string, string> = {
  n: "absolute inset-x-3 top-0 h-1.5 cursor-ns-resize",
  s: "absolute inset-x-3 bottom-0 h-1.5 cursor-ns-resize",
  e: "absolute inset-y-3 right-0 w-1.5 cursor-ew-resize",
  w: "absolute inset-y-3 left-0 w-1.5 cursor-ew-resize",
  ne: "absolute right-0 top-0 size-3 cursor-nesw-resize",
  nw: "absolute left-0 top-0 size-3 cursor-nwse-resize",
  se: "absolute bottom-0 right-0 size-3 cursor-nwse-resize",
  sw: "absolute bottom-0 left-0 size-3 cursor-nesw-resize",
};

/** Long enough that a per-prompt title setter costs one rename, not dozens. */
const TITLE_RENAME_DEBOUNCE_MS = 500;

/** Maximized keeps a sliver of app visible, so it still reads as a window. */
const MAX_GUTTER = 16;

/** Geometry for openTab before any pump exists; the first fit corrects it. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * The window with nothing in it. Its job is to get you into a shell in one
 * click and to answer the one question that changes how you use it — whether
 * closing the window kills your work. Everything else stays quiet.
 */
function EmptyState({
  scopes,
  recentScopeKeys,
  showHosts,
  onPick,
}: {
  scopes: ScopeOption[];
  recentScopeKeys: string[];
  showHosts: boolean;
  onPick: (scopeKey: string) => void;
}) {
  return (
    // A column, not a row: `items-center` on a row container sizes the child
    // from its content, so a long directory list grew past the window and got
    // centre-clipped — the heading scrolled off the top edge and the list could
    // not scroll. As a column with `min-h-0` the child shrinks to the available
    // height instead, and the list inside it scrolls.
    <div className="flex size-full min-h-0 flex-col items-center justify-center overflow-hidden p-4">
      {/* Centred while it fits, filling and scrolling once it does not. */}
      <div className="flex min-h-0 w-full min-w-0 max-w-md flex-col gap-3">
        <div className="flex shrink-0 flex-col gap-1 px-1">
          <GhostMark className="bb-fg-ghost mb-2 size-9 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">
            Summon a shell
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Pick where it runs. Shells keep going while this window is hidden.
          </p>
        </div>
        <ShellPicker
          scopes={scopes}
          recentScopeKeys={recentScopeKeys}
          showHosts={showHosts}
          onPick={onPick}
          fill
          className="min-h-0 flex-1 rounded-lg border border-border bg-background/40"
        />
      </div>
    </div>
  );
}

export function FloatingTerminal({
  rpc,
}: {
  rpc: PluginRpcClient<typeof rpcContract>;
}) {
  const open = useSyncExternalStore(
    windowController.subscribe,
    windowController.isOpen,
  );

  /**
   * Below bb's own compact-viewport breakpoint the window becomes a sheet: it
   * fills the viewport minus one inset, styles.css owns the geometry, and drag
   * and resize are never installed. Everything else about it is unchanged.
   */
  const sheet = useIsCompactViewport();
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  const [state, dispatch] = useReducer(tabsReducer, emptyTabs);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [recentScopeKeys, setRecentScopeKeys] = useState<string[]>([]);
  const [fontSize, setFontSize] = useState(13);
  const [shortcutEnabled, setShortcutEnabled] = useState(true);
  const [themeVersion, setThemeVersion] = useState(0);
  const [fitVersion, setFitVersion] = useState(0);
  /**
   * BB appends the plugin stylesheet to <head> without awaiting its load, so
   * anything rendered before it arrives paints unstyled — a full-width block of
   * raw markup at the end of <body> that snaps away when the CSS lands. Staying
   * out of the DOM until the window is first opened removes that window
   * entirely, and costs nothing for a session where it is never used.
   */
  const [ctrlArmed, setCtrlArmed] = useState(false);
  /** Window mode only. Never persisted: a maximized session is a mood, not a layout. */
  const [maximized, setMaximized] = useState(false);
  /** Whether the active tab sits at the newest output; drives the pill. */
  const [atBottom, setAtBottom] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [findResults, setFindResults] = useState<{
    index: number;
    count: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  /** One frame behind `mounted`, so the first open still animates in. */
  const [armed, setArmed] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const edgeRefs = useRef(new Map<string, HTMLDivElement>());
  const pumps = useRef(new Map<string, TerminalPump>());
  /**
   * Restarts already in flight. The restart button and the Enter-at-a-dead-
   * prompt path can both fire for the same tab, and each extra call creates a
   * PTY that no tab strip will ever show.
   */
  const restarting = useRef(new Set<string>());
  const maximizedRef = useRef(false);
  maximizedRef.current = maximized;

  // Geometry lives in a ref (the drag handlers read and write it every pointer
  // move) and is mirrored onto the element directly — re-rendering React 60
  // times a second to move a window is the wrong tool.
  const frameRef = useRef<Frame>(loadFrame());

  const applyFrame = useCallback((next: Frame) => {
    const node = rootRef.current;
    if (sheetRef.current) {
      // Hand geometry back to the stylesheet. Inline styles outrank a class,
      // so leaving the last desktop frame here would pin the sheet to a
      // 760x460 box in the corner.
      //
      // And do not record the frame while the sheet owns layout. Every window
      // resize runs the stored frame through clampFrame, so at phone width the
      // remembered *desktop* geometry was being clamped to the phone's — a
      // window that came back 393px wide the moment the viewport widened again.
      if (node !== null) {
        node.style.removeProperty("left");
        node.style.removeProperty("top");
        node.style.removeProperty("width");
        node.style.removeProperty("height");
      }
      return;
    }
    frameRef.current = next;
    if (node === null) return;
    // Maximized paints its own geometry but must not overwrite the remembered
    // frame — restore has to put the window back exactly where it was.
    const rect = maximizedRef.current
      ? {
          x: MAX_GUTTER,
          y: MAX_GUTTER,
          width: window.innerWidth - 2 * MAX_GUTTER,
          height: window.innerHeight - 2 * MAX_GUTTER,
        }
      : next;
    node.style.left = `${rect.x}px`;
    node.style.top = `${rect.y}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }, []);

  const commitFrame = useCallback(
    (next: Frame) => {
      applyFrame(next);
      saveFrame(next);
      setFitVersion((version) => version + 1);
    },
    [applyFrame],
  );

  // ------------------------------------------------------------- server io

  // Mirrored into a ref so the stable useCallbacks below read the *current*
  // active tab rather than whichever render created them — otherwise a new
  // shell is always seeded at the 80x24 default instead of the window's real
  // size, and briefly mis-wraps until the first resize lands.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = state.activeId;

  const geometry = useCallback(() => {
    const activeId = activeIdRef.current;
    const pump = activeId === null ? null : pumps.current.get(activeId);
    return pump === undefined || pump === null
      ? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
      : { cols: pump.cols(), rows: pump.rows() };
  }, []);

  /**
   * Pull the server's view of the world. Its tab list is the only thing that
   * evicts a ghost — a tab whose shell died while the window was closed, or
   * that another bb client closed. Ordering is handled by the snapshot's
   * revision, so a slow reply simply loses to a newer one.
   */
  const sync = useCallback(async () => {
    try {
      const result = await rpc.call("init");
      setScopes(result.scopes);
      setRecentScopeKeys(result.recentScopeKeys);
      setFontSize(result.prefs.fontSize);
      setShortcutEnabled(result.prefs.shortcutEnabled);
      dispatch({ type: "synced", snapshot: result.snapshot });
    } catch {
      toast.error("Floating Ghostty could not reach its backend.");
    }
  }, [rpc]);

  const openTab = useCallback(
    async (scopeKey: string) => {
      try {
        const result = await rpc.call("openTab", { scopeKey, ...geometry() });
        dispatch({
          type: "synced",
          snapshot: result.snapshot,
          focusId: result.opened.terminalId,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not start a shell",
        );
        void sync();
      }
    },
    [rpc, sync, geometry],
  );

  const closeTab = useCallback(
    async (terminalId: string) => {
      try {
        const result = await rpc.call("closeTab", { terminalId });
        dispatch({ type: "synced", snapshot: result.snapshot });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not close the shell",
        );
        void sync();
      }
    },
    [rpc, sync],
  );

  const restartTab = useCallback(
    async (terminalId: string) => {
      if (restarting.current.has(terminalId)) return;
      restarting.current.add(terminalId);
      try {
        const result = await rpc.call("restartTab", {
          terminalId,
          ...geometry(),
        });
        dispatch({
          type: "synced",
          snapshot: result.snapshot,
          focusId: result.restarted.terminalId,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not restart the shell",
        );
        // The tab is unrecoverable if the server no longer knows it; a resync
        // removes it rather than leaving a dead row the user cannot revive.
        void sync();
      } finally {
        restarting.current.delete(terminalId);
      }
    },
    [rpc, sync, geometry],
  );

  useEffect(() => {
    if (sheet) setMaximized(false);
  }, [sheet]);

  useEffect(() => {
    setCtrlArmed(false);
  }, [state.activeId]);

  const selectTab = useCallback(
    (terminalId: string) => {
      dispatch({ type: "activated", terminalId });
      void rpc.call("setActiveTab", { terminalId }).catch(() => {
        // Persistence only; the client already switched.
      });
    },
    [rpc],
  );

  // ----------------------------------------------------------------- init

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // A freshly inserted element has no previous value to transition from, so
  // the entrance is painted in one step unless the closed state renders first.
  useEffect(() => {
    if (!mounted || armed) return;
    const raf = window.requestAnimationFrame(() => setArmed(true));
    return () => window.cancelAnimationFrame(raf);
  }, [mounted, armed]);

  // Every open re-syncs: directories change, and a shell can die while the
  // window is hidden.
  useEffect(() => {
    if (!open) return;
    void sync();
  }, [open, sync]);

  // ------------------------------------------------------------- gestures

  useEffect(() => {
    const header = headerRef.current;
    // A sheet is pinned to the viewport, and a drag handle across its top would
    // only compete with the scroll gesture underneath it. A maximized window
    // has nowhere to be dragged to.
    if (header === null || sheet || maximized) return;
    const aborter = new AbortController();
    const options = {
      getFrame: () => frameRef.current,
      onChange: applyFrame,
      onCommit: commitFrame,
    };
    installDrag(header, options, aborter.signal);
    for (const edge of RESIZE_EDGES) {
      const node = edgeRefs.current.get(edge);
      if (node !== undefined) {
        installResize(node, edge, options, aborter.signal);
      }
    }
    return () => aborter.abort();
  }, [applyFrame, commitFrame, mounted, sheet, maximized]);

  // ---------------------------------------------------------- environment

  useEffect(() => {
    // Coming back from the sheet, re-read the window's own geometry rather than
    // trusting memory: a frame first computed while the viewport was phone-sized
    // (a session that started narrow and was widened) would otherwise become a
    // 360px desktop window. Storage holds the last committed drag, or nothing,
    // in which case loadFrame derives the default for the viewport we are in now.
    applyFrame(sheet ? frameRef.current : loadFrame());
    setFitVersion((version) => version + 1);
  }, [applyFrame, mounted, sheet, maximized]);

  useEffect(() => {
    if (!open) return;
    applyFrame(clampFrame(frameRef.current));
    setFitVersion((version) => version + 1);
  }, [open, applyFrame]);

  useEffect(() => {
    const onResize = () => applyFrame(clampFrame(frameRef.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyFrame]);

  // Only the sheet needs this: a desktop window is never covered by a keyboard,
  // and writing the custom properties there would fight the inline geometry.
  useEffect(() => {
    const node = rootRef.current;
    if (!sheet || node === null) return;
    return trackVisualViewport(node, () => {
      // The box just changed under Ghostty; the pump's ResizeObserver catches the
      // height, this makes sure the active tab is scrolled back to the prompt.
      setFitVersion((version) => version + 1);
    });
  }, [sheet, mounted]);

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setThemeVersion((version) => version + 1),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shortcutEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.altKey &&
        event.code === "Backquote"
      ) {
        event.preventDefault();
        windowController.toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [shortcutEnabled]);

  // --------------------------------------------------------------- render

  const onStatus = useCallback(
    (terminalId: string, status: TabStatus, detail: string | null) => {
      dispatch({ type: "status", terminalId, status, detail });
    },
    [],
  );

  const onPumpReady = useCallback((terminalId: string, pump: TerminalPump) => {
    pumps.current.set(terminalId, pump);
  }, []);

  const onPumpGone = useCallback((terminalId: string) => {
    pumps.current.delete(terminalId);
  }, []);

  const onRequestRestart = useCallback(
    (terminalId: string) => void restartTab(terminalId),
    [restartTab],
  );

  // A shell that sets its title on every prompt would otherwise put a rename
  // round trip behind every command, so coalesce and drop no-ops. Keyed by
  // terminal so two busy tabs cannot cancel each other's pending rename.
  const titleTimers = useRef(new Map<string, number>());
  const lastTitles = useRef(new Map<string, string | null>());

  const onTitle = useCallback(
    (terminalId: string, title: string | null) => {
      if (lastTitles.current.get(terminalId) === title) return;
      lastTitles.current.set(terminalId, title);
      const pending = titleTimers.current.get(terminalId);
      if (pending !== undefined) window.clearTimeout(pending);
      titleTimers.current.set(
        terminalId,
        window.setTimeout(() => {
          titleTimers.current.delete(terminalId);
          void rpc
            .call("renameTab", { terminalId, title })
            .then((result) =>
              dispatch({ type: "synced", snapshot: result.snapshot }),
            )
            .catch(() => {
              // A name is cosmetic; let the next snapshot settle it.
            });
        }, TITLE_RENAME_DEBOUNCE_MS),
      );
    },
    [rpc],
  );

  useEffect(
    () => () => {
      for (const timer of titleTimers.current.values()) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  const hide = useCallback(() => windowController.hide(), []);

  const activePump = useCallback((): TerminalPump | null => {
    const activeId = activeIdRef.current;
    if (activeId === null) return null;
    return pumps.current.get(activeId) ?? null;
  }, []);

  // ----------------------------------------------------------- find in tab
  const [findQuery, setFindQuery] = useState("");
  const findQueryRef = useRef("");
  findQueryRef.current = findQuery;

  const openFind = useCallback(() => {
    if (activePump()?.searchAvailable() !== true) return;
    setFindOpen(true);
  }, [activePump]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindResults(null);
    const pump = activePump();
    pump?.clearSearch();
    pump?.focus();
  }, [activePump]);

  const onFindQueryChange = useCallback(
    (query: string) => {
      setFindQuery(query);
      const pump = activePump();
      if (pump === null) return;
      if (query === "") {
        pump.clearSearch();
        setFindResults(null);
        return;
      }
      pump.findNext(query, true);
    },
    [activePump],
  );

  const onFindNext = useCallback(() => {
    activePump()?.findNext(findQueryRef.current);
  }, [activePump]);

  const onFindPrevious = useCallback(() => {
    activePump()?.findPrevious(findQueryRef.current);
  }, [activePump]);

  const onSearchResults = useCallback(
    (_terminalId: string, results: { index: number; count: number } | null) => {
      setFindResults(results);
    },
    [],
  );

  // A search belongs to the buffer it ran in; switching tabs closes it rather
  // than replaying a stale query over a different shell.
  const lastActiveRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastActiveRef.current;
    lastActiveRef.current = state.activeId;
    if (previous !== null && previous !== state.activeId) {
      pumps.current.get(previous)?.clearSearch();
      setFindOpen(false);
      setFindResults(null);
    }
  }, [state.activeId]);

  const onScrollState = useCallback(
    (terminalId: string, tabAtBottom: boolean) => {
      if (terminalId === activeIdRef.current) setAtBottom(tabAtBottom);
    },
    [],
  );

  // Switching tabs: the pill state belongs to the new tab, and until its pump
  // reports otherwise the safe assumption is "at the prompt".
  useEffect(() => {
    setAtBottom(true);
  }, [state.activeId]);

  const onToolbarKey = useCallback(
    (key: ToolbarKey) => {
      const pump = activePump();
      if (pump === null) return;
      switch (key.kind) {
        case "send":
          pump.send(key.send ?? "");
          return;
        case "arrow":
          pump.send(
            arrowSequence(key.direction ?? "up", pump.applicationCursorKeys()),
          );
          return;
        case "modifier":
          pump.setCtrlArmed(!ctrlArmed);
          return;
        case "action":
          if (key.id === "dismiss") {
            pump.blur();
            return;
          }
          if (key.id === "find") {
            openFind();
            return;
          }
          if (key.id === "paste") {
            void navigator.clipboard
              ?.readText()
              .then((text) => {
                if (text !== "") pump.paste(text);
              })
              .catch(() => {
                toast.error("Clipboard is not available here.");
              });
          }
          return;
      }
    },
    [activePump, ctrlArmed, openFind],
  );

  const onCtrlArmed = useCallback((armed: boolean) => setCtrlArmed(armed), []);

  // A bare ~ means nothing once there is more than one machine.
  const showHosts = new Set(scopes.map((scope) => scope.hostName)).size > 1;

  if (!mounted) return null;

  return (
    <TooltipProvider delayDuration={400}>
      {/* Only the sheet gets a scrim. The desktop window is deliberately
          non-modal — bb stays usable behind it — but at this width the sheet
          covers nearly everything, so a blurred backdrop is what makes it read
          as one layer above the app rather than a panel welded to it. */}
      {sheet ? (
        <div
          className="bb-fg-backdrop"
          data-state={open && armed ? "open" : "closed"}
          aria-hidden="true"
          onPointerDown={hide}
        />
      ) : null}
      <div
        ref={rootRef}
        role="dialog"
        // Non-modal on purpose: the point of this window is that bb stays
        // usable behind it, so it must not read as a focus trap.
        aria-modal="false"
        aria-label="Floating Ghostty"
        aria-hidden={!open}
        data-state={open && armed ? "open" : "closed"}
        data-layout={sheet ? "sheet" : "window"}
        // Stacking lives in styles.css, where the backdrop and window are kept in
        // one place relative to bb's own layers.
        className="bb-fg-window fixed flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl"
      >
        <div
          ref={headerRef}
          data-bb-fg-handle=""
          // The title-bar convention from every desktop OS. Interactive
          // children (tabs, buttons, the picker) stop the double-click the
          // same way they stop the drag.
          onDoubleClick={(event) => {
            if (sheet) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("[data-no-drag]") != null) return;
            setMaximized((value) => !value);
          }}
        >
          <TabBar
            tabs={state.tabs}
            activeId={state.activeId}
            scopes={scopes}
            recentScopeKeys={recentScopeKeys}
            showHosts={showHosts}
            maximize={
              sheet
                ? null
                : {
                    on: maximized,
                    toggle: () => setMaximized((value) => !value),
                  }
            }
            onSelect={selectTab}
            onClose={(terminalId) => void closeTab(terminalId)}
            onNewTab={(scopeKey) => void openTab(scopeKey)}
            onRestart={() => {
              if (state.activeId !== null) void restartTab(state.activeId);
            }}
            onHide={hide}
          />
        </div>

        <div className="relative min-h-0 flex-1 bg-card px-2 py-1.5">
          {state.tabs.map((tab) => (
            <TerminalView
              key={tab.terminalId}
              rpc={rpc}
              terminalId={tab.terminalId}
              visible={open && tab.terminalId === state.activeId}
              fontSize={fontSize}
              themeVersion={themeVersion}
              fitVersion={fitVersion}
              onStatus={onStatus}
              onTitle={onTitle}
              onCtrlArmed={onCtrlArmed}
              onFindRequested={openFind}
              onScrollState={onScrollState}
              onSearchResults={onSearchResults}
              onRequestRestart={onRequestRestart}
              onToggleRequested={hide}
              onPumpReady={onPumpReady}
              onPumpGone={onPumpGone}
            />
          ))}
          {findOpen && state.tabs.length > 0 ? (
            <FindBar
              query={findQuery}
              results={findResults}
              onQueryChange={onFindQueryChange}
              onNext={onFindNext}
              onPrevious={onFindPrevious}
              onClose={closeFind}
            />
          ) : null}

          {/* Parked in history while output may still be arriving below. */}
          {!atBottom && state.tabs.length > 0 ? (
            <button
              type="button"
              className="bb-fg-pill"
              onClick={() => {
                activePump()?.scrollToBottom();
                activePump()?.focus();
              }}
            >
              <Icon
                name="ChevronsDown"
                className="size-3.5"
                aria-hidden="true"
              />
              Latest
            </button>
          ) : null}

          {state.tabs.length === 0 ? (
            <EmptyState
              scopes={scopes}
              recentScopeKeys={recentScopeKeys}
              showHosts={showHosts}
              onPick={(scopeKey) => void openTab(scopeKey)}
            />
          ) : null}
        </div>

        {/* Only where the keys are actually missing, and only once there is a
            shell to send them to. */}
        {sheet && state.tabs.length > 0 ? (
          <KeyToolbar ctrlArmed={ctrlArmed} onKey={onToolbarKey} />
        ) : null}

        {sheet || maximized
          ? null
          : RESIZE_EDGES.map((edge) => (
              <div
                key={edge}
                ref={(node) => {
                  if (node === null) edgeRefs.current.delete(edge);
                  else edgeRefs.current.set(edge, node);
                }}
                className={EDGE_CLASS[edge] ?? ""}
                aria-hidden="true"
              />
            ))}
      </div>
    </TooltipProvider>
  );
}

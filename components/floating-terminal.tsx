// One peekable terminal surface. Ownership comes from BB context; selection and
// visibility belong to this client. Visited terminals remain mounted across Back
// and navigation so hiding never tears down a process or discards scrollback.
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { TerminalSwitcher } from "./terminal-switcher";
import { TerminalHeader } from "./terminal-header";
import type { ScopeOption } from "@/lib/scopes";
import { FindBar } from "@/components/find-bar";
import { KeyToolbar } from "@/components/key-toolbar";
import {
  availableHere,
  contextKey,
  globalContext,
  preferredScope,
  preferredTerminal,
  readSelection,
  rememberSelection,
  scopeLabel,
  type TerminalContext,
} from "../lib/context";
import {
  isAlternativeToggle,
  isSwitcherShortcut,
  matchesShortcut,
  type Shortcut,
} from "../lib/shortcuts";
import { TerminalView } from "@/components/terminal-view";
import { isolateTerminalKey } from "../lib/keyboard";
import { nativeLauncherOverride } from "../lib/native-launcher";
import { windowController } from "@/lib/controller";
import {
  clampFrame,
  openingFrame,
  windowPreferences,
  needsFullscreen,
  installDrag,
  installResize,
  loadFrame,
  RESIZE_EDGES,
  saveFrame,
  type Frame,
} from "@/lib/frame";
import type { TerminalPump } from "@/lib/pump";
import { arrowSequence, type ToolbarKey } from "@/lib/keys";
import { useSettings, type PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { trackVisualViewport } from "@/lib/viewport";
import { emptyTabs, tabsReducer, type TabStatus } from "@/lib/tabs";
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

export function FloatingTerminal({
  rpc,
  selection,
}: {
  rpc: PluginRpcClient<typeof rpcContract>;
  selection: { projectId: string | null; threadId: string | null };
}) {
  const open = useSyncExternalStore(
    windowController.subscribe,
    windowController.isOpen,
  );

  /**
   * Use fullscreen below the requested size or BB's compact breakpoint.
   * CSS owns this geometry; drag and resize are disabled.
   */
  const { values: liveSettings } = useSettings();
  const preferences = windowPreferences(liveSettings);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const compact = useIsCompactViewport();
  const sheet = compact || needsFullscreen(viewport, preferences);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  const [state, dispatch] = useReducer(tabsReducer, emptyTabs);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [terminalContext, setTerminalContext] =
    useState<TerminalContext>(globalContext);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<"shell" | "switch">("shell");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvedRoute, setResolvedRoute] = useState<string | null>(null);
  const routeKey = `${selection.projectId}:${selection.threadId}`;
  const requestVersion = useRef(0);
  const launchShell = (scopeKey: string) =>
    rpc.call("openTab", { scopeKey, ...geometry() });
  const pendingLaunches = useRef(
    new Map<string, ReturnType<typeof launchShell>>(),
  );
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const contextRef = useRef(terminalContext);
  contextRef.current = terminalContext;
  const shortcutEnabled = liveSettings?.shortcutEnabled !== false;
  const overrideNativeShortcut = liveSettings?.overrideNativeShortcut === true;
  const [nativeShortcuts, setNativeShortcuts] = useState<Shortcut[]>([]);
  const [fontSize, setFontSize] = useState(13);
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
  activeIdRef.current = activeId;

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
    const version = ++requestVersion.current;
    const route = selectionRef.current;
    setLoading(true);
    setLoadError(null);
    setScopes([]);
    setResolvedRoute(null);
    try {
      const resolved = await rpc.call("resolveContext", route);
      const result = await rpc.call("init");
      if (version !== requestVersion.current) return;
      setResolvedRoute(`${route.projectId}:${route.threadId}`);
      setTerminalContext(resolved.context);
      contextRef.current = resolved.context;
      setScopes(resolved.scopes);
      setFontSize(result.prefs.fontSize);
      dispatch({ type: "synced", snapshot: result.snapshot });
      const memory = readSelection();
      const selected = preferredTerminal(
        result.snapshot.tabs,
        resolved.context,
        memory.selected[contextKey(resolved.context)],
        memory.recent,
      );
      if (selected) {
        setActiveId(selected.terminalId);
        rememberSelection(resolved.context, selected.terminalId);
      } else {
        setActiveId(null);
        const destination = preferredScope(resolved.scopes, resolved.context);
        if (!destination)
          throw new Error(
            "No machine is available. Connect a machine, then try again.",
          );
        if (!destination.online)
          throw new Error(
            `${destination.hostName} is offline. Reconnect it to start a shell here.`,
          );
        // Rapid toggle/route changes may leave a spawn in flight. Reuse it instead of leaking duplicate shells.
        let launch = pendingLaunches.current.get(destination.key);
        if (!launch) {
          launch = rpc.call("openTab", {
            scopeKey: destination.key,
            ...geometry(),
          });
          pendingLaunches.current.set(destination.key, launch);
          launch
            .finally(() => pendingLaunches.current.delete(destination.key))
            .catch(() => {});
        }
        const created = await launch;
        dispatch({ type: "synced", snapshot: created.snapshot });
        if (version !== requestVersion.current) return;
        setActiveId(created.opened.terminalId);
        rememberSelection(resolved.context, created.opened.terminalId);
      }
    } catch (error) {
      if (version !== requestVersion.current) return;
      setLoadError(
        error instanceof Error ? error.message : "Could not open the terminal.",
      );
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [rpc, geometry]);

  const openTab = useCallback(
    async (scopeKey: string) => {
      if (creatingRef.current || !availableHere(scopeKey, contextRef.current))
        return;
      creatingRef.current = true;
      const version = requestVersion.current;
      const context = contextRef.current;
      setCreating(true);
      try {
        let launch = pendingLaunches.current.get(scopeKey);
        if (!launch) {
          launch = rpc.call("openTab", { scopeKey, ...geometry() });
          pendingLaunches.current.set(scopeKey, launch);
          launch
            .finally(() => pendingLaunches.current.delete(scopeKey))
            .catch(() => {});
        }
        const result = await launch;
        dispatch({ type: "synced", snapshot: result.snapshot });
        if (version !== requestVersion.current) return;
        setActiveId(result.opened.terminalId);
        rememberSelection(context, result.opened.terminalId);
        setMode("shell");
        setLoadError(null);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not start a shell",
        );
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [rpc, geometry],
  );

  const createInContext = () => {
    if (loading || resolvedRoute !== routeKey) return;
    const scope = preferredScope(scopes, contextRef.current);
    if (!scope?.online) {
      toast.error(
        scope
          ? `${scope.hostName} is disconnected.`
          : "No shell destination is available in this context.",
      );
      return;
    }
    setFindOpen(false);
    setMode("shell");
    void openTab(scope.key);
  };

  const promoteTab = async (target: "project" | "global") => {
    if (!activeId) return;
    try {
      const result = await rpc.call("promoteTab", {
        terminalId: activeId,
        target,
      });
      dispatch({ type: "synced", snapshot: result.snapshot });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not promote terminal",
      );
    }
  };

  const closeTab = useCallback(
    async (terminalId: string) => {
      try {
        const result = await rpc.call("closeTab", { terminalId });
        dispatch({ type: "synced", snapshot: result.snapshot });
        if (activeIdRef.current === terminalId) {
          const memory = readSelection();
          const next = preferredTerminal(
            result.snapshot.tabs,
            contextRef.current,
            undefined,
            memory.recent,
          );
          setActiveId(next?.terminalId ?? null);
          if (next) rememberSelection(contextRef.current, next.terminalId);
          else windowController.hide();
        }
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
      const version = requestVersion.current;
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
        if (version === requestVersion.current) {
          setActiveId(result.restarted.terminalId);
          rememberSelection(contextRef.current, result.restarted.terminalId);
        }
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
  }, [activeId]);

  const selectTab = useCallback(
    (terminalId: string) => {
      const tab = state.tabs.find((tab) => tab.terminalId === terminalId);
      if (!tab || !availableHere(tab.scopeKey, contextRef.current)) return;
      setActiveId(terminalId);
      rememberSelection(contextRef.current, terminalId);
      setMode("shell");
      window.requestAnimationFrame(() =>
        pumps.current.get(terminalId)?.focus(),
      );
      dispatch({ type: "activated", terminalId });
      void rpc.call("setActiveTab", { terminalId }).catch(() => {
        // Persistence only; the client already switched.
      });
    },
    [rpc, state.tabs],
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
    if (!open) {
      requestVersion.current++;
      setMode("shell");
      setActionsOpen(false);
      setFindOpen(false);
      return;
    }
    void sync();
  }, [open, sync]);

  // Navigation returns attention to BB, but never terminates a shell.
  const previousRoute = useRef(`${selection.projectId}:${selection.threadId}`);
  useEffect(() => {
    const route = `${selection.projectId}:${selection.threadId}`;
    if (route === previousRoute.current) return;
    previousRoute.current = route;
    requestVersion.current++;
    setMode("shell");
    setActiveId(null);
    returnFocus.current = null;
    windowController.hide();
  }, [selection.projectId, selection.threadId]);

  // The same Back/toggle round trip restores the exact element the operator left.
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    } else {
      const target = returnFocus.current;
      if (target?.isConnected && !rootRef.current?.contains(target))
        target.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [open]);

  useEffect(() => {
    const root = rootRef.current;
    if (open && root && !root.contains(document.activeElement)) {
      // Own keyboard focus during loading too; the shell takes over when ready.
      root.focus({ preventScroll: true });
    }
  }, [mounted, open]);

  useEffect(
    () => () => {
      requestVersion.current++;
    },
    [],
  );

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
    nativeLauncherOverride.set(overrideNativeShortcut);
    return () => nativeLauncherOverride.set(false);
  }, [overrideNativeShortcut]);

  useEffect(() => {
    // Coming back from the sheet, re-read the window's own geometry rather than
    // trusting memory: a frame first computed while the viewport was phone-sized
    // (a session that started narrow and was widened) would otherwise become a
    // 360px desktop window. Storage holds the last committed drag, or nothing,
    // in which case loadFrame derives the default for the viewport we are in now.
    applyFrame(sheet ? frameRef.current : openingFrame(preferencesRef.current));
    setFitVersion((version) => version + 1);
  }, [applyFrame, mounted, sheet]);

  useEffect(() => {
    applyFrame(frameRef.current);
    setFitVersion((version) => version + 1);
  }, [applyFrame, maximized]);

  useEffect(() => {
    if (!open) return;
    if (
      preferencesRef.current.centerOnOpen ||
      preferencesRef.current.customWindowSize
    )
      setMaximized(false);
    applyFrame(openingFrame(preferencesRef.current));
    setFitVersion((version) => version + 1);
  }, [open, applyFrame]);

  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      // Do not clamp and lose the saved desktop geometry on a fullscreen viewport.
      if (
        !needsFullscreen(
          { width: window.innerWidth, height: window.innerHeight },
          preferencesRef.current,
        )
      ) {
        applyFrame(clampFrame(frameRef.current));
      }
    };
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
    if (!overrideNativeShortcut) {
      setNativeShortcuts([]);
      return;
    }
    let disposed = false;
    const refresh = () =>
      rpc
        .call("terminalShortcuts")
        .then((bindings) => {
          if (!disposed) setNativeShortcuts(bindings);
        })
        .catch(() => {});
    void refresh();
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 30000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [rpc, overrideNativeShortcut]);

  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const toggle =
        (!overrideNativeShortcut &&
          shortcutEnabled &&
          isAlternativeToggle(event)) ||
        (overrideNativeShortcut &&
          nativeShortcuts.some((shortcut) =>
            matchesShortcut(event, shortcut, mac),
          ));
      const switcher = open && isSwitcherShortcut(event, mac);
      if (!toggle && !switcher) return;
      // Independent BB dialogs keep their own keyboard handling.
      const foreignDialog = (event.target as Element | null)?.closest?.(
        '[role="dialog"]',
      );
      if (
        foreignDialog &&
        !rootRef.current?.contains(foreignDialog) &&
        !foreignDialog.querySelector(".bb-fg-actions-menu")
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || (!toggle && (loading || resolvedRoute !== routeKey)))
        return;
      if (toggle) windowController.toggle();
      else {
        setFindOpen(false);
        setMode((value) => (value === "switch" ? "shell" : "switch"));
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    shortcutEnabled,
    overrideNativeShortcut,
    nativeShortcuts,
    open,
    loading,
    resolvedRoute,
    routeKey,
  ]);

  useEffect(() => {
    if (
      open &&
      mode === "shell" &&
      !actionsOpen &&
      !findOpen &&
      !loading &&
      activeId
    ) {
      const raf = window.requestAnimationFrame(() =>
        pumps.current.get(activeId)?.focus(),
      );
      return () => window.cancelAnimationFrame(raf);
    }
  }, [open, mode, actionsOpen, findOpen, loading, activeId]);

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
    lastActiveRef.current = activeId;
    if (previous !== null && previous !== activeId) {
      pumps.current.get(previous)?.clearSearch();
      setFindOpen(false);
      setFindResults(null);
    }
  }, [activeId]);

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
  }, [activeId]);

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

  const availableTabs =
    resolvedRoute === routeKey
      ? state.tabs.filter((tab) => availableHere(tab.scopeKey, terminalContext))
      : [];
  const activeTab =
    availableTabs.find((tab) => tab.terminalId === activeId) ?? null;
  const visited = useRef(new Set<string>());
  if (activeTab && !loading) visited.current.add(activeTab.terminalId);
  const dismissPicker = () => setMode("shell");

  if (!mounted) return null;

  return (
    <TooltipProvider delayDuration={400}>
      {/* Clicking the surroundings means Back; every shell keeps running. */}
      {
        <div
          className="bb-fg-backdrop"
          data-state={open && armed ? "open" : "closed"}
          aria-hidden="true"
          onPointerDown={hide}
        />
      }
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={isolateTerminalKey}
        onKeyUp={isolateTerminalKey}
        onKeyPress={isolateTerminalKey}
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
          <TerminalHeader
            tab={activeTab}
            owner={
              activeTab
                ? scopeLabel(activeTab.scopeKey, scopes)
                : "Floating Ghostty"
            }
            onSwitch={() => {
              setFindOpen(false);
              setMode("switch");
            }}
            onCreate={createInContext}
            onPromote={(target) => void promoteTab(target)}
            onHide={hide}
            onFind={openFind}
            onRestart={() => {
              if (activeId) void restartTab(activeId);
            }}
            onEnd={() => {
              if (activeId) void closeTab(activeId);
            }}
            maximize={
              sheet
                ? null
                : {
                    on: maximized,
                    toggle: () => setMaximized((value) => !value),
                  }
            }
            busy={loading || creating}
            visible={open}
            onMenuChange={setActionsOpen}
          />
        </div>

        <div className="bb-fg-terminal-body relative min-h-0 flex-1">
          {state.tabs
            .filter((tab) => visited.current.has(tab.terminalId))
            .map((tab) => (
              <TerminalView
                key={tab.terminalId}
                rpc={rpc}
                terminalId={tab.terminalId}
                visible={
                  open && !loading && activeTab?.terminalId === tab.terminalId
                }
                focused={
                  open &&
                  !loading &&
                  mode === "shell" &&
                  !actionsOpen &&
                  !findOpen &&
                  activeTab?.terminalId === tab.terminalId
                }
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
          {findOpen && activeTab !== null ? (
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
          {!atBottom && activeTab !== null && mode === "shell" ? (
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

          {loading ? (
            <div className="bb-fg-state" role="status">
              <span className="bb-fg-loading-dot" />
              Opening terminal…
            </div>
          ) : null}
          {!loading && loadError ? (
            <div className="bb-fg-state" role="alert">
              <p>{loadError}</p>
              <div>
                <button onClick={() => void sync()}>Try again</button>
              </div>
            </div>
          ) : null}
          {!loading && !loadError && !activeTab ? (
            <div className="bb-fg-state">
              <p>No terminal selected.</p>
              <button onClick={createInContext} disabled={creating}>
                Start a shell
              </button>
            </div>
          ) : null}
          {mode === "shell" && activeTab?.status === "exited" ? (
            <div className="bb-fg-exit-state" role="status">
              {activeTab.statusDetail ?? "Shell exited"}
              <button onClick={() => void restartTab(activeTab.terminalId)}>
                Restart shell
              </button>
            </div>
          ) : null}
          {mode === "switch" ? (
            <TerminalSwitcher
              tabs={availableTabs}
              scopes={scopes}
              context={terminalContext}
              activeId={activeId}
              onSelect={selectTab}
              onDismiss={dismissPicker}
            />
          ) : null}
        </div>

        {/* Only where the keys are actually missing, and only once there is a
            shell to send them to. */}
        {sheet && !loading && activeTab !== null && mode === "shell" ? (
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

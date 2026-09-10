// Pure state for the tab strip.
//
// The server owns the tab list and stamps every snapshot with a monotonic
// revision. This reducer's whole job is to apply snapshots in order and keep
// the two things the server does not know: each tab's live status (which the
// pump discovers by polling) and which tab the user is looking at.
//
// Applying strictly-newer revisions is what makes concurrent mutations safe.
// A slow `init` that started before an `openTab` committed carries an older
// revision, so it can no longer drop the tab that open just created.

export type TabStatus = "connecting" | "live" | "exited" | "error";

export interface TabState {
  terminalId: string;
  scopeKey: string;
  label: string;
  hostName: string;
  cwd: string;
  status: TabStatus;
  statusDetail: string | null;
  /** An OSC title the shell set; the tab strip prefers it over `label`. */
  shellTitle: string | null;
}

/** What the tab strip shows, qualified when another machine could be mistaken for this one. */
export function tabName(tab: TabState, showHost = false): string {
  const name = tab.shellTitle ?? tab.label;
  return showHost && tab.hostName !== "" ? `${name} · ${tab.hostName}` : name;
}

export interface TabsState {
  tabs: TabState[];
  activeId: string | null;
  /** Highest snapshot revision applied; 0 means nothing has loaded yet. */
  revision: number;
}

/** The server's tab DTO; status arrives as the raw session status string. */
export interface ServerTab {
  terminalId: string;
  scopeKey: string;
  label: string;
  hostName: string;
  cwd: string;
  status: string;
  shellTitle: string | null;
}

export interface Snapshot {
  revision: number;
  tabs: ServerTab[];
  activeTabId: string | null;
}

export type TabsAction =
  | {
      type: "synced";
      snapshot: Snapshot;
      /** A tab this client just created or restarted; it takes focus. */
      focusId?: string;
    }
  | { type: "activated"; terminalId: string }
  | {
      type: "status";
      terminalId: string;
      status: TabStatus;
      detail: string | null;
    };

function fromServer(tab: ServerTab): TabState {
  return {
    terminalId: tab.terminalId,
    scopeKey: tab.scopeKey,
    label: tab.label,
    hostName: tab.hostName,
    cwd: tab.cwd,
    status:
      tab.status === "running" || tab.status === "starting"
        ? "connecting" // live once the pump's first read confirms it
        : "exited",
    statusDetail: null,
    shellTitle: tab.shellTitle,
  };
}

export const emptyTabs: TabsState = { tabs: [], activeId: null, revision: 0 };

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "synced": {
      // Stale reply from a request that started before a newer one landed.
      if (action.snapshot.revision <= state.revision) return state;

      const previous = new Map(
        state.tabs.map((tab) => [tab.terminalId, tab] as const),
      );
      // The server is authoritative for which tabs exist — that is what evicts
      // a ghost whose shell died while the window was closed. Status is the
      // client's to keep: a surviving tab must not flash back to "connecting"
      // just because something else changed.
      const tabs = action.snapshot.tabs.map((tab) => {
        const existing = previous.get(tab.terminalId);
        if (existing === undefined) return fromServer(tab);
        // Naming is the server's half of the split, so it has to flow through
        // to a tab the client already knows; status stays the client's. Reuse
        // the existing object when neither changed, or every snapshot would
        // re-render the whole strip.
        if (existing.shellTitle === tab.shellTitle && existing.label === tab.label) {
          return existing;
        }
        return { ...existing, label: tab.label, shellTitle: tab.shellTitle };
      });

      const has = (id: string | null | undefined) =>
        id != null && tabs.some((tab) => tab.terminalId === id);

      const activeId = has(action.focusId)
        ? action.focusId!
        : has(state.activeId)
          ? state.activeId
          : has(action.snapshot.activeTabId)
            ? action.snapshot.activeTabId
            : (tabs[0]?.terminalId ?? null);

      return { tabs, activeId, revision: action.snapshot.revision };
    }

    case "activated":
      if (!state.tabs.some((tab) => tab.terminalId === action.terminalId)) {
        return state;
      }
      return { ...state, activeId: action.terminalId };

    case "status": {
      // Bail when unchanged: a failing poll re-reports the same error every
      // 320ms, and without this check that re-rendered the whole window at
      // ~3Hz for as long as the backend stayed unreachable.
      const tab = state.tabs.find((entry) => entry.terminalId === action.terminalId);
      if (
        !tab ||
        (tab.status === action.status && tab.statusDetail === action.detail)
      ) {
        return state;
      }
      return {
        ...state,
        tabs: state.tabs.map((entry) =>
          entry.terminalId === action.terminalId
            ? { ...entry, status: action.status, statusDetail: action.detail }
            : entry,
        ),
      };
    }
  }
}

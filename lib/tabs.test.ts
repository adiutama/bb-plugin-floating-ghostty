// The tab-strip reducer.
//
// The transitions worth guarding are the ones that fail silently in the UI: a
// stale reply must not resurrect a closed tab or drop a freshly opened one, a
// restart must keep its position, and a live tab must not flash back to
// "connecting" every time something else changes.
import { describe, expect, it } from "vitest";
import {
  emptyTabs,
  tabName,
  tabsReducer,
  type ServerTab,
  type Snapshot,
  type TabState,
  type TabsState,
} from "./tabs";

function serverTab(id: string, overrides: Partial<ServerTab> = {}): ServerTab {
  return {
    terminalId: id,
    scopeKey: `scope:${id}`,
    label: id,
    hostName: "mac",
    cwd: `/home/${id}`,
    status: "running",
    shellTitle: null,
    ...overrides,
  };
}

function snapshot(revision: number, ids: string[], activeTabId?: string | null): Snapshot {
  return {
    revision,
    tabs: ids.map((id) => serverTab(id)),
    activeTabId: activeTabId === undefined ? (ids[0] ?? null) : activeTabId,
  };
}

function synced(state: TabsState, revision: number, ids: string[], focusId?: string) {
  return tabsReducer(state, {
    type: "synced",
    snapshot: snapshot(revision, ids),
    ...(focusId === undefined ? {} : { focusId }),
  });
}

const ids = (state: TabsState) => state.tabs.map((tab) => tab.terminalId);

describe("tabsReducer", () => {
  it("marks freshly loaded live sessions as connecting until a read confirms", () => {
    expect(synced(emptyTabs, 1, ["a"]).tabs[0]!.status).toBe("connecting");
  });

  it("marks a loaded dead session as exited", () => {
    const state = tabsReducer(emptyTabs, {
      type: "synced",
      snapshot: { revision: 1, tabs: [serverTab("a", { status: "exited" })], activeTabId: "a" },
    });
    expect(state.tabs[0]!.status).toBe("exited");
  });

  it("focuses a tab this client just opened", () => {
    const state = synced(synced(emptyTabs, 1, ["a"]), 2, ["a", "b"], "b");
    expect(ids(state)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("b");
  });

  it("keeps a restarted tab in place under its new identity", () => {
    const before = synced(emptyTabs, 1, ["a", "b", "c"]);
    const state = synced(before, 2, ["a", "b2", "c"], "b2");
    expect(ids(state)).toEqual(["a", "b2", "c"]);
    expect(state.activeId).toBe("b2");
  });

  it("closing an inactive tab never steals focus", () => {
    const before = { ...synced(emptyTabs, 1, ["a", "b", "c"]), activeId: "a" };
    const state = synced(before, 2, ["a", "b"]);
    expect(state.activeId).toBe("a");
  });

  it("closing the active tab falls back to the server's pick", () => {
    const before = { ...synced(emptyTabs, 1, ["a", "b"]), activeId: "b" };
    const state = tabsReducer(before, {
      type: "synced",
      snapshot: snapshot(2, ["a"], "a"),
    });
    expect(state.activeId).toBe("a");
  });

  it("closing the last tab leaves no active tab", () => {
    const before = { ...synced(emptyTabs, 1, ["a"]), activeId: "a" };
    const state = tabsReducer(before, {
      type: "synced",
      snapshot: { revision: 2, tabs: [], activeTabId: null },
    });
    expect(state.tabs).toHaveLength(0);
    expect(state.activeId).toBeNull();
  });

  it("ignores activation of a tab that no longer exists", () => {
    const before = synced(emptyTabs, 1, ["a", "b"]);
    expect(tabsReducer(before, { type: "activated", terminalId: "ghost" })).toBe(
      before,
    );
  });

  it("routes a status update to exactly its tab", () => {
    const state = tabsReducer(synced(emptyTabs, 1, ["a", "b"]), {
      type: "status",
      terminalId: "b",
      status: "error",
      detail: "Read failed",
    });
    expect(state.tabs[0]!.status).toBe("connecting");
    expect(state.tabs[1]!.status).toBe("error");
    expect(state.tabs[1]!.statusDetail).toBe("Read failed");
  });
});

describe("tabsReducer — snapshot ordering", () => {
  it("evicts a ghost tab the server no longer reports", () => {
    const before = { ...synced(emptyTabs, 1, ["a", "ghost"]), activeId: "ghost" };
    const state = synced(before, 2, ["a"]);
    expect(ids(state)).toEqual(["a"]);
    expect(state.activeId).toBe("a");
  });

  it("keeps a surviving tab's status instead of resetting it to connecting", () => {
    const live = tabsReducer(synced(emptyTabs, 1, ["a"]), {
      type: "status",
      terminalId: "a",
      status: "live",
      detail: null,
    });
    expect(synced(live, 2, ["a"]).tabs[0]!.status).toBe("live");
  });

  it("keeps the user's current tab focused across a resync", () => {
    const before = { ...synced(emptyTabs, 1, ["a", "b"]), activeId: "b" };
    expect(synced(before, 2, ["a", "b"]).activeId).toBe("b");
  });

  it("adopts a tab opened by another bb client", () => {
    const state = synced(synced(emptyTabs, 1, ["a"]), 2, ["a", "elsewhere"]);
    expect(ids(state)).toEqual(["a", "elsewhere"]);
  });

  // The three orderings that used to corrupt state before revisions existed.
  it("a slow init cannot drop a tab that a later open created", () => {
    const opened = synced(emptyTabs, 5, ["a"], "a");
    // init started first, so it carries an older revision and loses.
    const state = synced(opened, 4, []);
    expect(ids(state)).toEqual(["a"]);
    expect(state.revision).toBe(5);
  });

  it("a slow init cannot resurrect a tab that a later close removed", () => {
    const closed = synced(synced(emptyTabs, 1, ["a", "b"]), 6, ["a"]);
    const state = synced(closed, 3, ["a", "b"]);
    expect(ids(state)).toEqual(["a"]);
  });

  it("ignores a replayed snapshot at the same revision", () => {
    const before = synced(emptyTabs, 4, ["a"]);
    expect(synced(before, 4, ["a", "b"])).toBe(before);
  });
});

describe("shell titles", () => {
  it("keeps the machine visible when several hosts are available", () => {
    const tab: TabState = {
      ...serverTab("a", {
        hostName: "scw-mini",
        shellTitle: "m1",
      }),
      status: "live",
      statusDetail: null,
    };

    expect(tabName(tab, true)).toBe("m1 · scw-mini");
  });

  it("flows a new server title onto a tab the client already knows", () => {
    let state = tabsReducer(emptyTabs, {
      type: "synced",
      snapshot: snapshot(1, ["a"]),
    });
    state = tabsReducer(state, {
      type: "status",
      terminalId: "a",
      status: "live",
      detail: null,
    });

    const renamed: Snapshot = {
      revision: 2,
      tabs: [serverTab("a", { shellTitle: "npm run dev" })],
      activeTabId: "a",
    };
    const next = tabsReducer(state, { type: "synced", snapshot: renamed });

    expect(next.tabs[0]!.shellTitle).toBe("npm run dev");
    // Naming is the server's half of the split; status stays the client's.
    expect(next.tabs[0]!.status).toBe("live");
  });

  it("keeps the same tab object when nothing about it changed", () => {
    const state = tabsReducer(emptyTabs, {
      type: "synced",
      snapshot: snapshot(1, ["a"]),
    });
    const next = tabsReducer(state, {
      type: "synced",
      snapshot: snapshot(2, ["a"]),
    });
    expect(next.tabs[0]).toBe(state.tabs[0]);
  });

  it("falls back to the directory label once a title is cleared", () => {
    let state = tabsReducer(emptyTabs, {
      type: "synced",
      snapshot: {
        revision: 1,
        tabs: [serverTab("a", { label: "Acme", shellTitle: "vim README.md" })],
        activeTabId: "a",
      },
    });
    expect(tabName(state.tabs[0]!)).toBe("vim README.md");

    state = tabsReducer(state, {
      type: "synced",
      snapshot: {
        revision: 2,
        tabs: [serverTab("a", { label: "Acme", shellTitle: null })],
        activeTabId: "a",
      },
    });
    expect(tabName(state.tabs[0]!)).toBe("Acme");
  });
});

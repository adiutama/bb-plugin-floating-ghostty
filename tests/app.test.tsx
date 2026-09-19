// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { windowController } from "../lib/controller";
import type { ServerTab } from "../lib/tabs";

// Exercise the complete overlay/navigation UI; Ghostty itself has real-WASM pump tests.
vi.mock("../components/terminal-view", async () => {
  const React = await import("react");
  return {
    TerminalView: ({
      terminalId,
      visible,
      focused,
      onPumpReady,
      onPumpGone,
      onStatus,
    }: any) => {
      const ref = React.useRef<HTMLTextAreaElement>(null);
      React.useEffect(() => {
        const shell = ref.current;
        const exit = () =>
          onStatus(terminalId, "exited", "Shell exited with code 0");
        const ready = () => onStatus(terminalId, "live", null);
        shell?.addEventListener("shell-exit", exit);
        shell?.addEventListener("shell-ready", ready);
        return () => {
          shell?.removeEventListener("shell-exit", exit);
          shell?.removeEventListener("shell-ready", ready);
        };
      }, [terminalId, onStatus]);
      React.useEffect(() => {
        onPumpReady(terminalId, {
          focus: () => ref.current?.focus(),
          cols: () => 80,
          rows: () => 24,
          clearSearch() {},
          searchAvailable: () => true,
        });
        return () => onPumpGone(terminalId);
      }, [terminalId]);
      React.useEffect(() => {
        if (focused) ref.current?.focus();
      }, [focused]);
      return (
        <textarea
          ref={ref}
          aria-label={`Shell ${terminalId}`}
          style={{ display: visible ? "block" : "none" }}
        />
      );
    },
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
});
afterEach(() => {
  windowController.hide();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const context = { projectId: "A", environmentId: "one", hostId: "local" };
const scopes = [
  {
    key: "home:local",
    kind: "home",
    label: "Home",
    detail: "~",
    hostName: "Local",
    hostId: "local",
    online: true,
  },
  {
    key: "project:A",
    kind: "project",
    label: "Project A",
    detail: "/a",
    hostName: "Local",
    hostId: "local",
    online: true,
  },
  {
    key: "worktree:A:one",
    kind: "worktree",
    label: "one",
    detail: "/a/one",
    hostName: "Local",
    hostId: "local",
    online: true,
  },
  {
    key: "worktree:A:two",
    kind: "worktree",
    label: "two",
    detail: "/a/two",
    hostName: "Local",
    hostId: "local",
    online: true,
  },
  {
    key: "project:B",
    kind: "project",
    label: "Project B",
    detail: "/b",
    hostName: "Local",
    hostId: "local",
    online: true,
  },
];
function tab(id: string, scopeKey: string): ServerTab {
  return {
    terminalId: id,
    scopeKey,
    label: id,
    hostName: "Local",
    cwd: "/tmp",
    status: "running",
    shellTitle: null,
  };
}
async function setup(
  initial: ServerTab[] = [],
  options: {
    override?: boolean;
    pending?: Promise<void>;
    pendingRead?: Promise<void>;
    pendingContext?: Promise<void>;
    pendingSelection?: Promise<void>;
    settings?: Record<string, unknown>;
    projectless?: boolean;
  } = {},
) {
  const app = await loadPluginApp(() => import("../app"));
  let tabs = initial;
  const exited = new Set<string>();
  let revision = 1;
  let projectEnvironment = { text: "TOKEN=existing", revision: 2 };
  const snapshot = () => ({
    revision,
    tabs,
    activeTabId: tabs[0]?.terminalId ?? null,
  });
  const React = await import("react");
  const { useRpc } = await import("@get-bb/plugin-sdk/app");
  const { FloatingTerminal } = await import("../components/floating-terminal");
  let navigate!: (selection: { projectId: string; threadId: string }) => void;
  function Surface() {
    const [selection, setSelection] = React.useState<{
      projectId: string | null;
      threadId: string | null;
    }>({
      projectId: options.projectless ? null : "A",
      threadId: options.projectless ? null : "thread-one",
    });
    navigate = setSelection;
    const rpc = useRpc<typeof import("../server").rpcContract>();
    return <FloatingTerminal rpc={rpc} selection={selection} />;
  }
  expect(app.appOverlays).toHaveLength(1);
  const slot = renderSlot(
    { component: Surface },
    {},
    {
      context: { projectId: "A", threadId: "thread-one" },
      settings: {
        shortcutEnabled: true,
        overrideNativeShortcut: options.override ?? false,
        ...options.settings,
      },
      rpc: {
        resolveContext: async (input: unknown) => {
          await options.pendingContext;
          const route = input as { projectId: string | null; threadId: string | null };
          return route.projectId === "A"
            ? { context: { ...context, environmentId: route.threadId === "thread-two" ? "two" : "one" }, scopes }
            : {
                context: {
                  projectId: route.projectId,
                  environmentId: null,
                  hostId: "local",
                },
                scopes,
              };
        },
        init: () => ({
          snapshot: snapshot(),
          scopes,
          recentScopeKeys: [],
          prefs: {
            fontSize: 13,
            shortcutEnabled: true,
            overrideNativeShortcut: false,
          },
        }),
        openTab: async (input: unknown) => {
          const { scopeKey } = input as { scopeKey: string };
          await options.pending;
          const opened = tab(`created-${revision}`, scopeKey);
          tabs = [...tabs, opened];
          revision++;
          return { snapshot: snapshot(), opened };
        },
        setTabName: (input: unknown) => {
          const { terminalId, name } = input as {
            terminalId: string;
            name: string | null;
          };
          tabs = tabs.map((tab) =>
            tab.terminalId === terminalId ? { ...tab, customTitle: name } : tab,
          );
          revision++;
          return { snapshot: snapshot() };
        },
        closeTab: (input: unknown) => {
          tabs = tabs.filter(
            (tab) =>
              tab.terminalId !== (input as { terminalId: string }).terminalId,
          );
          revision++;
          return { snapshot: snapshot() };
        },
        restartTab: (input: unknown) => {
          const restarted = tabs.find(
            (tab) =>
              tab.terminalId === (input as { terminalId: string }).terminalId,
          )!;
          revision++;
          return { snapshot: snapshot(), restarted };
        },
        setActiveTab: async () => {
          await options.pendingSelection;
          return { ok: true };
        },
        read: async (input: unknown) => {
          await options.pendingRead;
          return ({
          chunks: [],
          nextSeq: 0,
          truncated: false,
          status: exited.has((input as { terminalId: string }).terminalId)
            ? "exited"
            : "running",
          exitCode: null,
        });
        },
        terminalShortcuts: () => [
          {
            key: "Enter",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
        ],
        getProjectEnvironment: () => projectEnvironment,
        saveEnvironmentDefinitions: (input: unknown) => {
          const value = (input as { layers: { text: string; expectedRevision: number }[] }).layers[0]!;
          projectEnvironment = {
            text: value.text,
            revision: value.text === "" ? 0 : value.expectedRevision + 1,
          };
          return {
            revision: projectEnvironment.revision,
            keyCount: value.text === "" ? 0 : 1,
          };
        },
      },
    },
  );
  return Object.assign(slot, {
    exitTerminal: (terminalId: string, notify = true) => {
      exited.add(terminalId);
      tabs = tabs.map((tab) => tab.terminalId === terminalId ? { ...tab, status: "exited" } : tab);
      revision++;
      if (notify)
        slot
          .getByRole("textbox", { name: `Shell ${terminalId}` })
          .dispatchEvent(new Event("shell-exit"));
    },
    navigate: (selection: { projectId: string; threadId: string }) =>
      navigate(selection),
  });
}
function toggle(target: Element | Window = window) {
  fireEvent.keyDown(target, { key: "`", code: "Backquote", ctrlKey: true });
}
function switcher(target: Element | Window = window) {
  fireEvent.keyDown(target, { key: "k", metaKey: true });
}

it.each(["worktree:A:one", "home:local"])(
  "silently closes the exited shell in %s and selects a live sibling",
  async (scopeKey) => {
    const slot = await setup(
      [
        tab("first", scopeKey),
        tab("second", scopeKey),
        tab("foreign", "project:B"),
      ],
      { projectless: scopeKey === "home:local" },
    );
    try {
      await act(async () => toggle());
      await slot.findByRole("textbox", { name: "Shell first" });
      await act(async () => slot.exitTerminal("first"));
      await waitFor(() => expect(slot.queryByRole("textbox", { name: "Shell first" })).toBeNull());
      expect(slot.getByRole("textbox", { name: "Shell second" })).toBeTruthy();
      expect(slot.queryByText("Shell exited with code 0")).toBeNull();
      expect(windowController.isOpen()).toBe(true);
      expect(
        slot.inspection.rpcCalls.some((call) =>
          ["openTab", "restartTab"].includes(call.method),
        ),
      ).toBe(false);
    } finally {
      slot.lifecycle.unmount();
    }
  },
);

it("closes an unvisited exited shell when search discovers it without changing the active shell", async () => {
  const slot = await setup([
    tab("first", "worktree:A:one"),
    tab("hidden", "worktree:A:one"),
  ]);
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell first" });
    slot.exitTerminal("hidden", false);
    await act(async () => switcher());
    await slot.findByPlaceholderText("Search terminals");
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.some((call) => call.method === "closeTab" && (call.input as any).terminalId === "hidden")).toBe(true),
    );
    expect(slot.getByRole("option", { name: /^first/ })).toBeTruthy();
    expect(windowController.isOpen()).toBe(true);
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "init"),
    ).toHaveLength(1);
  } finally {
    slot.lifecycle.unmount();
  }
}, 20000);

it("opens directly into a newly created worktree shell, and toggles back without ending it", async () => {
  const prompt = document.createElement("textarea");
  document.body.append(prompt);
  prompt.focus();
  const slot = await setup();
  try {
    await act(async () => toggle(prompt));
    const shell = await slot.findByRole("textbox", { name: "Shell created-1" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
    expect(slot.queryByPlaceholderText("Search terminals")).toBeNull();
    expect(
      slot.inspection.rpcCalls.find((call) => call.method === "openTab")?.input,
    ).toMatchObject({ scopeKey: "worktree:A:one" });
    await act(async () => toggle(shell));
    expect(windowController.isOpen()).toBe(false);
    expect(document.activeElement).toBe(prompt);
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "closeTab"),
    ).toBe(false);
    await act(async () => toggle(prompt));
    await waitFor(() => expect(document.activeElement).toBe(shell));
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "openTab"),
    ).toHaveLength(1);
  } finally {
    slot.lifecycle.unmount();
    prompt.remove();
  }
});

it("defaults projectless conversations to No project and keeps project shells out of that list", async () => {
  const slot = await setup(
    [tab("project-shell", "worktree:A:one"), tab("home-shell", "home:local")],
    { projectless: true },
  );
  try {
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", {
      name: "Shell home-shell",
    });
    await act(async () => switcher(shell));
    expect(
      slot.getByRole("button", { name: "Filter terminals: No project" }),
    ).not.toBeNull();
    expect(slot.queryByRole("option", { name: /project-shell/ })).toBeNull();
    expect(slot.getByRole("option", { name: /home-shell/ })).not.toBeNull();
    expect(
      slot.getByRole("button", { name: "New terminal" }).getAttribute("title"),
    ).toContain("No project");
  } finally {
    slot.lifecycle.unmount();
  }
});

it("defaults to the thread project, opens project filters with Cmd+P, and switches across projects through All", async () => {
  const slot = await setup([
    tab("global", "home:local"),
    tab("current", "worktree:A:one"),
    tab("sibling", "worktree:A:two"),
    tab("foreign", "project:B"),
  ]);
  try {
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher(shell));
    const search = slot.getByPlaceholderText("Search terminals");
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(
      slot.getByRole("button", { name: "Filter terminals: Project A" }),
    ).not.toBeNull();
    expect(slot.queryByRole("option", { name: /foreign/ })).toBeNull();
    expect(slot.queryByRole("option", { name: /global/ })).toBeNull();
    expect(slot.getAllByRole("option")).toHaveLength(2); // Creation is a separate, always-visible action.
    const hostKey = vi.fn();
    document.addEventListener("keydown", hostKey);
    try {
      await act(async () =>
        fireEvent.keyDown(search, { key: "p", metaKey: true }),
      );
      expect(hostKey).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", hostKey);
    }
    const menu = within(
      document.querySelector(
        '[role="dialog"][aria-label="Filter by project"]',
      ) as HTMLElement,
    );
    expect(menu.getAllByRole("option").map((item) => item.textContent)).toEqual(
      ["All", "No project", "Project A", "Project B"],
    );
    await act(async () =>
      fireEvent.click(menu.getByRole("option", { name: "No project" })),
    );
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(slot.getByRole("option", { name: /global/ })).not.toBeNull();
    expect(slot.queryByRole("option", { name: /sibling/ })).toBeNull();
    await act(async () =>
      fireEvent.keyDown(search, { key: "p", metaKey: true }),
    );
    await act(async () =>
      fireEvent.click(
        within(
          document.querySelector(
            '[role="dialog"][aria-label="Filter by project"]',
          ) as HTMLElement,
        ).getByRole("option", { name: "All" }),
      ),
    );
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(slot.getAllByRole("option")).toHaveLength(4);
    fireEvent.click(slot.getByRole("option", { name: /foreign/ }));
    const foreign = slot.getByRole("textbox", { name: "Shell foreign" });
    await waitFor(() => expect(document.activeElement).toBe(foreign));
    await act(async () => slot.exitTerminal("foreign"));
    expect(windowController.isOpen()).toBe(true);
    expect(slot.queryByText("Shell exited with code 0")).toBeNull();
    expect(
      slot.inspection.rpcCalls.some((call) =>
        ["openTab"].includes(call.method),
      ),
    ).toBe(false);
  } finally {
    slot.lifecycle.unmount();
  }
}, 60000);

it("leaves BB's native shortcut alone by default and supports opt-in toggling from the switcher", async () => {
  let slot = await setup([tab("current", "worktree:A:one")]);
  try {
    fireEvent.keyDown(window, { key: "Enter", metaKey: true, shiftKey: true });
    expect(windowController.isOpen()).toBe(false);
    expect(
      slot.inspection.rpcCalls.some(
        (call) => call.method === "terminalShortcuts",
      ),
    ).toBe(false);
  } finally {
    slot.lifecycle.unmount();
  }
  slot = await setup([tab("current", "worktree:A:one")], { override: true });
  try {
    await act(async () => {});
    const alternative = new KeyboardEvent("keydown", {
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(alternative);
    });
    expect(windowController.isOpen()).toBe(false);
    expect(alternative.defaultPrevented).toBe(false);

    await act(async () =>
      fireEvent.keyDown(window, {
        key: "Enter",
        metaKey: true,
        shiftKey: true,
      }),
    );
    await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => toggle());
    expect(windowController.isOpen()).toBe(true);
    await act(async () => switcher());
    const search = slot.getByPlaceholderText("Search terminals");
    await act(async () =>
      fireEvent.keyDown(search, {
        key: "Enter",
        metaKey: true,
        shiftKey: true,
      }),
    );
    expect(windowController.isOpen()).toBe(false);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("does not duplicate a shell when toggled closed and reopened during creation", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const slot = await setup([], { pending });
  try {
    await act(async () => toggle());
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter((call) => call.method === "openTab"),
      ).toHaveLength(1),
    );
    await act(async () => toggle());
    await act(async () => toggle());
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter((call) => call.method === "init"),
      ).toHaveLength(2),
    );
    await act(async () => finish());
    await slot.findByRole("textbox", { name: "Shell created-1" });
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "openTab"),
    ).toHaveLength(1);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("hides on navigation and ignores the old context's in-flight result", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const slot = await setup([], { pending });
  try {
    await act(async () => toggle());
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.some((call) => call.method === "openTab"),
      ).toBe(true),
    );
    await act(async () =>
      slot.navigate({ projectId: "B", threadId: "thread-b" }),
    );
    expect(windowController.isOpen()).toBe(false);
    await act(async () => finish());
    expect(windowController.isOpen()).toBe(false);
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell created-2" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "openTab")[1]
        ?.input,
    ).toMatchObject({ scopeKey: "project:B" });
    await act(async () => switcher(shell));
    expect(slot.queryByRole("option", { name: /created-1/ })).toBeNull();
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "closeTab"),
    ).toBe(false);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("recenters on each opening with custom dimensions, and uses an accessible icon to hide the overlay", async () => {
  const { saveFrame } = await import("../lib/frame");
  saveFrame({ x: 40, y: 50, width: 1000, height: 700 });
  const slot = await setup([tab("current", "worktree:A:one")], {
    settings: {
      centerOnOpen: true,
      customWindowSize: true,
      windowWidth: 800,
      windowHeight: 500,
    },
  });
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell current" });
    const overlay = document.querySelector<HTMLElement>(".bb-fg-window")!;
    expect(overlay.dataset.layout).toBe("window");
    expect(overlay.style.left).toBe("320px");
    expect(overlay.style.top).toBe("200px");
    expect(overlay.style.width).toBe("800px");
    expect(overlay.style.height).toBe("500px");
    const back = slot.getByRole("button", { name: "Hide terminal" });
    expect(back.textContent).toBe("");
    expect(back.querySelector("svg")).not.toBeNull();
    fireEvent.click(back);
    expect(windowController.isOpen()).toBe(false);
    saveFrame({ x: 20, y: 60, width: 900, height: 600 });
    await act(async () => toggle());
    expect(overlay.style.left).toBe("320px");
    expect(overlay.style.top).toBe("200px");
    expect(overlay.style.width).toBe("800px");
  } finally {
    slot.lifecycle.unmount();
  }
});

it("uses fullscreen below the opening size without overwriting desktop geometry", async () => {
  const { saveFrame, loadFrame } = await import("../lib/frame");
  const remembered = { x: 40, y: 50, width: 850, height: 550 };
  saveFrame(remembered);
  const slot = await setup([tab("current", "worktree:A:one")], {
    settings: { customWindowSize: true, windowWidth: 900, windowHeight: 600 },
  });
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell current" });
    const overlay = document.querySelector<HTMLElement>(".bb-fg-window")!;
    await act(async () => {
      vi.stubGlobal("innerWidth", 800);
      fireEvent(window, new Event("resize"));
    });
    expect(overlay.dataset.layout).toBe("sheet");
    expect(overlay.style.width).toBe("");
    await act(async () => toggle());
    await act(async () => toggle());
    await act(async () => {
      vi.stubGlobal("innerWidth", 1440);
      fireEvent(window, new Event("resize"));
    });
    expect(overlay.dataset.layout).toBe("window");
    expect(overlay.style.left).toBe("40px");
    expect(overlay.style.width).toBe("900px");
    expect(loadFrame()).toEqual(remembered);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("creates immediately in the current context even while viewing a sibling shell", async () => {
  const slot = await setup([
    tab("current", "worktree:A:one"),
    tab("sibling", "worktree:A:two"),
  ]);
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher());
    fireEvent.click(slot.getByRole("option", { name: /sibling/ }));
    expect(slot.getByRole("complementary", { name: "Terminal sidebar" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "New terminal" }));
    expect(slot.queryByRole("dialog", { name: "New terminal" })).toBeNull();
    const shell = await slot.findByRole("textbox", { name: "Shell created-1" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "openTab")
        .map((call) => call.input),
    ).toEqual([{ scopeKey: "worktree:A:one", cols: 80, rows: 24 }]);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("creates in the selected project with Cmd+N and offers no ownership transfer", async () => {
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher());
    await act(async () =>
      fireEvent.keyDown(
        slot.getByRole("button", { name: "Actions for current" }),
        { key: "Enter" },
      ),
    );
    const menu = within(document.querySelector('[role="menu"]') as HTMLElement);
    expect(menu.queryByText("Change ownership…")).toBeNull();
    await act(async () =>
      fireEvent.keyDown(document.querySelector('[role="menu"]')!, {
        key: "Escape",
      }),
    );
    await waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
    const search = slot.getByPlaceholderText("Search terminals");
    await act(async () =>
      fireEvent.keyDown(search, { key: "p", metaKey: true }),
    );
    await act(async () =>
      fireEvent.click(
        within(
          document.querySelector(
            '[role="dialog"][aria-label="Filter by project"]',
          ) as HTMLElement,
        ).getByRole("option", { name: "Project B" }),
      ),
    );
    await waitFor(() => expect(document.activeElement).toBe(search));
    const create = slot.getByRole("button", { name: "New terminal" });
    expect(create.getAttribute("title")).toContain("Project B");
    // Cmd+N invokes the same selected-project action as the visible button.
    await act(async () => fireEvent.keyDown(search, { key: "n", metaKey: true }));
    await slot.findByRole("textbox", { name: "Shell created-1" });
    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "openTab")
        .map((call) => call.input),
    ).toEqual([{ scopeKey: "project:B", cols: 80, rows: 24 }]);
  } finally {
    slot.lifecycle.unmount();
  }
}, 60000);

it("isolates shell and switcher keys from BB while preserving text, clipboard, and composition", async () => {
  const hostKey = vi.fn();
  document.addEventListener("keydown", hostKey);
  document.addEventListener("keyup", hostKey);
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    const shellKey = vi.fn();
    shell.addEventListener("keydown", shellKey);
    const press = (
      target: Element,
      key: string,
      options: KeyboardEventInit = {},
    ) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      fireEvent(target, event);
      return event;
    };
    expect(press(shell, "a").defaultPrevented).toBe(false);
    expect(press(shell, "c", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(shell, "v", { metaKey: true }).defaultPrevented).toBe(false);
    expect(
      press(shell, "Process", { isComposing: true }).defaultPrevented,
    ).toBe(false);
    expect(press(shell, "t", { metaKey: true }).defaultPrevented).toBe(true);
    expect(press(shell, "r", { metaKey: true }).defaultPrevented).toBe(true);
    expect(shellKey).toHaveBeenCalledTimes(6);
    fireEvent.keyUp(shell, { key: "Meta" });
    expect(hostKey).not.toHaveBeenCalled();
    await act(async () => switcher(shell));
    const search = slot.getByPlaceholderText("Search terminals");
    expect(press(search, "n", { metaKey: true }).defaultPrevented).toBe(true);
    fireEvent.change(search, { target: { value: "current" } });
    expect((search as HTMLInputElement).value).toBe("current");
    expect(hostKey).not.toHaveBeenCalled();
    await act(async () => toggle(search));
    expect(windowController.isOpen()).toBe(false);
    fireEvent.keyDown(document.body, { key: "t", metaKey: true });
    expect(hostKey).toHaveBeenCalledTimes(1);
  } finally {
    slot.lifecycle.unmount();
    document.removeEventListener("keydown", hostKey);
    document.removeEventListener("keyup", hostKey);
  }
});

it("keeps keyboard focus inside terminal mode while the first shell is loading", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const slot = await setup([], { pending });
  try {
    await act(async () => toggle());
    const overlay = document.querySelector<HTMLElement>(".bb-fg-window")!;
    expect(document.activeElement).toBe(overlay);
    const hostKey = vi.fn();
    window.addEventListener("keydown", hostKey);
    try {
      fireEvent.keyDown(overlay, { key: "n", metaKey: true });
      expect(hostKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", hostKey);
    }
    await act(async () => finish());
    const shell = await slot.findByRole("textbox", { name: "Shell created-1" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
  } finally {
    finish();
    slot.lifecycle.unmount();
  }
});

it("renames from the actions menu and explicitly deletes the last shell without creating another", async () => {
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher());
    const actions = slot.getByRole("button", { name: "Actions for current" });
    await act(async () => {
      fireEvent.keyDown(actions, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(
        within(
          document.querySelector('[role="menu"]') as HTMLElement,
        ).getByText("Rename…"),
      );
    });
    const field = slot.getByLabelText("Terminal name");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: "Dev server" } });
    await act(async () => {
      fireEvent.click(slot.getByRole("button", { name: "Save" }));
    });
    expect(
      slot.container.querySelector(".bb-fg-header-name")?.textContent,
    ).toBe("Dev server");
    await act(async () => {
      fireEvent.keyDown(actions, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(
        within(
          document.querySelector('[role="menu"]') as HTMLElement,
        ).getByText("Delete terminal…"),
      );
    });
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "closeTab"),
    ).toBe(false);
    await act(async () => {
      fireEvent.click(slot.getByRole("button", { name: "Delete" }));
    });
    expect(windowController.isOpen()).toBe(false);
    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "closeTab")
        .map((call) => call.input),
    ).toEqual([{ terminalId: "current" }]);
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "openTab"),
    ).toBe(false);
  } finally {
    slot.lifecycle.unmount();
  }
}, 40000);

it("edits the environment belonging to a worktree terminal", async () => {
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher());
    await act(async () =>
      fireEvent.keyDown(
        slot.getByRole("button", { name: "Actions for current" }),
        { key: "Enter" },
      ),
    );
    await act(async () =>
      fireEvent.click(
        within(
          document.querySelector('[role="menu"]') as HTMLElement,
        ).getByText("Environment variables…"),
      ),
    );
    await act(async () => fireEvent.keyDown(await slot.findByRole("button", { name: "Variable actions" }), { key: "Enter" }));
    await act(async () => fireEvent.click(within(document.body).getByRole("menuitem", { name: "Edit as .env" })));
    const editor = await slot.findByRole("textbox", {
      name: "Environment variables for Project A / one",
    });
    expect((editor as HTMLTextAreaElement).value).toBe("TOKEN=existing");
    fireEvent.change(editor, { target: { value: "TOKEN=updated" } });
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Save" })),
    );
    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "saveEnvironmentDefinitions")
        .map((call) => call.input),
    ).toEqual([
      {
        projectId: "A",
        environmentId: "one",
        layers: [{ scope: "worktree", text: "TOKEN=updated", expectedRevision: 2 }],
      },
    ]);
  } finally {
    slot.lifecycle.unmount();
  }
}, 40000);

it("opens the current worktree environment from the attached sidebar", async () => {
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    expect(slot.queryByRole("button", { name: "Edit environment variables" })).toBeNull();
    await act(async () => fireEvent.click(slot.getByRole("button", { name: "Show terminal sidebar" })));
    const sidebar = slot.getByRole("complementary", { name: "Terminal sidebar" });
    expect(sidebar.parentElement?.classList.contains("bb-fg-workspace")).toBe(true);
    expect(slot.container.querySelector(".bb-fg-thread-search-scrim")).toBeNull();
    await act(async () => fireEvent.click(within(sidebar).getByRole("button", { name: "Edit environment variables" })));
    await slot.findByRole("textbox", { name: "Key 1" });
    const panel = slot.getByRole("region", { name: "Environment variables" });
    expect(panel.closest(".bb-fg-terminal-body")).not.toBeNull();
    expect(within(panel).queryByRole("button", { name: "Back to terminal" })).toBeNull();
    expect(slot.queryByRole("dialog", { name: "Environment variables" })).toBeNull();
    expect(slot.queryByRole("textbox", { name: "Shell current" })).toBeNull();
    expect(shell.isConnected).toBe(true);
    expect(slot.getByRole("complementary", { name: "Terminal sidebar" })).toBe(sidebar);
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Cancel" })));
    expect(slot.getByRole("textbox", { name: "Shell current" })).toBe(shell);
    await act(async () => fireEvent.click(within(sidebar).getByRole("button", { name: "Edit environment variables" })));
    await slot.findByRole("region", { name: "Environment variables" });
    await act(async () => fireEvent.click(within(sidebar).getByRole("option", { name: /current.*Current terminal/ })));
    expect(slot.queryByRole("region", { name: "Environment variables" })).toBeNull();
    expect(slot.getByRole("textbox", { name: "Shell current" })).toBe(shell);
  } finally { slot.lifecycle.unmount(); }
}, 30000);

it("manages a filtered inactive terminal without changing shells and preserves the selector on return", async () => {
  const slot = await setup([
    tab("current", "worktree:A:one"),
    tab("sibling", "worktree:A:two"),
  ]);
  try {
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    const header = slot.container.querySelector(".bb-fg-header")!;
    expect(within(header as HTMLElement).getAllByRole("button")).toHaveLength(
      2,
    );
    await act(async () => switcher(shell));
    const search = slot.getByPlaceholderText("Search terminals");
    fireEvent.change(search, { target: { value: "sib" } });
    expect(
      slot.queryByRole("button", { name: "Actions for current" }),
    ).toBeNull();
    const action = slot.getByRole("button", { name: "Actions for sibling" });
    await act(async () => fireEvent.keyDown(action, { key: "Enter" }));
    expect(
      slot.container.querySelector(".bb-fg-header-name")?.textContent,
    ).toBe("current");
    await act(async () =>
      fireEvent.keyDown(document.querySelector('[role="menu"]')!, {
        key: "Escape",
      }),
    );
    await waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
    expect(
      slot.getByRole("complementary", { name: "Terminal sidebar" }),
    ).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(action));
    await act(async () => fireEvent.keyDown(action, { key: "Enter" }));
    await act(async () =>
      fireEvent.click(
        within(
          document.querySelector('[role="menu"]') as HTMLElement,
        ).getByText("Rename…"),
      ),
    );
    fireEvent.change(slot.getByLabelText("Terminal name"), {
      target: { value: "Sibling build" },
    });
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Save" })),
    );
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect((search as HTMLInputElement).value).toBe("sib");
    expect(slot.getByRole("option", { name: /Sibling build/ })).not.toBeNull();
    expect(
      slot.container.querySelector(".bb-fg-header-name")?.textContent,
    ).toBe("current");
    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "setTabName")
        .map((call) => call.input),
    ).toEqual([{ terminalId: "sibling", name: "Sibling build" }]);
    const renamedAction = slot.getByRole("button", {
      name: "Actions for Sibling build",
    });
    await act(async () => fireEvent.keyDown(renamedAction, { key: "Enter" }));
    await act(async () =>
      fireEvent.click(
        within(
          document.querySelector('[role="menu"]') as HTMLElement,
        ).getByText("Restart shell"),
      ),
    );
    expect(
      slot.container.querySelector(".bb-fg-header-name")?.textContent,
    ).toBe("current");
    expect(slot.inspection.rpcCalls.some(call => call.method === "restartTab")).toBe(false);
    const confirmation = slot.getByRole("dialog", { name: "Restart terminal" });
    await act(async () => fireEvent.click(within(confirmation).getByRole("button", { name: "Restart" })));
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "restartTab")
        .map((call) => call.input),
    ).toEqual([{ terminalId: "sibling", cols: 80, rows: 24 }]);
    await act(async () => fireEvent.keyDown(renamedAction, { key: "Enter" }));
    await act(async () =>
      fireEvent.click(
        within(
          document.querySelector('[role="menu"]') as HTMLElement,
        ).getByText("Delete terminal…"),
      ),
    );
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "closeTab"),
    ).toBe(false);
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Delete" })),
    );
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(slot.getByText("No matches")).not.toBeNull();
    expect(windowController.isOpen()).toBe(true);
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
  } finally {
    slot.lifecycle.unmount();
  }
}, 90000);

it("uses Cmd+K only in terminal mode and releases it to BB when hidden", async () => {
  const hostKey = vi.fn();
  document.addEventListener("keydown", hostKey);
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => switcher(document.body));
    expect(windowController.isOpen()).toBe(false);
    expect(hostKey).toHaveBeenCalledTimes(1);
    hostKey.mockClear();
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () =>
      fireEvent.keyDown(shell, { key: "p", metaKey: true }),
    );
    expect(slot.queryByRole("complementary", { name: "Terminal sidebar" })).toBeNull();
    await act(async () => switcher(shell));
    const search = slot.getByPlaceholderText("Search terminals");
    await waitFor(() => expect(document.activeElement).toBe(search));
    await act(async () =>
      fireEvent.keyDown(search, { key: "k", metaKey: true, repeat: true }),
    );
    expect(
      slot.getByRole("complementary", { name: "Terminal sidebar" }),
    ).not.toBeNull();
    await act(async () => switcher(search));
    await waitFor(() => expect(document.activeElement).toBe(shell));
    expect(hostKey).not.toHaveBeenCalled();
    await act(async () => toggle(shell));
    await act(async () => switcher(document.body));
    expect(windowController.isOpen()).toBe(false);
    expect(hostKey).toHaveBeenCalledTimes(1);
  } finally {
    slot.lifecycle.unmount();
    document.removeEventListener("keydown", hostKey);
  }
});

it("uses thread-search rows and treats a leading > as terminal search text", async () => {
  const slot = await setup([
    tab("current", "worktree:A:one"),
    tab("older", "worktree:A:two"),
    { ...tab("literal", "worktree:A:one"), customTitle: ">find output" },
  ]);
  try {
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher(shell));
    const search = slot.getByRole("combobox", { name: "Search terminals" });
    expect(
      slot
        .getAllByRole("option")
        .filter((node) => node.hasAttribute("cmdk-item"))[0].textContent,
    ).toContain("current");
    expect(
      slot.queryByRole("button", { name: "Terminal mode actions" }),
    ).toBeNull();
    expect(slot.container.querySelector(".bb-fg-palette-footer")).toBeNull();
    const create = slot.getByRole("button", { name: "New terminal" });
    expect(create.closest("[cmdk-list]")).toBeNull();
    fireEvent.change(search, { target: { value: ">find" } });
    expect(slot.queryByRole("button", { name: "New terminal" })).not.toBeNull();
    expect(slot.queryByRole("combobox", { name: "Search actions" })).toBeNull();
    expect(slot.getByRole("option", { name: />find output/ })).not.toBeNull();
    expect(slot.container.querySelector("mark")?.textContent).toBe(">find");
    fireEvent.change(search, { target: { value: "no-such-shell" } });
    expect(slot.queryByRole("button", { name: "New terminal" })).not.toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    expect(slot.getByRole("button", { name: "New terminal" })).not.toBeNull();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
  } finally {
    slot.lifecycle.unmount();
  }
});

it("keeps window and find controls in session menus without changing search mode", async () => {
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher(shell));
    const search = slot.getByRole("combobox", { name: "Search terminals" });
    const actions = slot.getByRole("button", { name: "Actions for current" });
    await act(async () => fireEvent.keyDown(actions, { key: "Enter" }));
    await act(async () =>
      fireEvent.click(
        within(
          document.querySelector('[role="menu"]') as HTMLElement,
        ).getByText("Maximize"),
      ),
    );
    expect(
      slot.container.querySelector<HTMLElement>(".bb-fg-window")?.style.width,
    ).toBe("1408px");
    expect(slot.getByRole("combobox", { name: "Search terminals" })).toBe(
      search,
    );
    await act(async () => fireEvent.keyDown(actions, { key: "Enter" }));
    await act(async () =>
      fireEvent.click(
        within(
          document.querySelector('[role="menu"]') as HTMLElement,
        ).getByText("Find in terminal"),
      ),
    );
    const find = await slot.findByPlaceholderText("Find");
    await waitFor(() => expect(document.activeElement).toBe(find));
    fireEvent.keyDown(find, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
  } finally {
    slot.lifecycle.unmount();
  }
}, 60000);


it("locks a landscape phone fullscreen and opens the picker without raising the keyboard", async () => {
  vi.stubGlobal("innerWidth", 844);
  vi.stubGlobal("innerHeight", 390);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: coarse"),
    addEventListener() {},
    removeEventListener() {},
  }));
  const slot = await setup([tab("current", "worktree:A:one")], {
    settings: { customWindowSize: true, windowWidth: 360, windowHeight: 240 },
  });
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell current" });
    const overlay = slot.container.querySelector<HTMLElement>(".bb-fg-window")!;
    expect(overlay.dataset.layout).toBe("sheet");
    await act(async () => fireEvent.doubleClick(overlay.querySelector("[data-bb-fg-handle]")!));
    expect(overlay.dataset.layout).toBe("sheet");
    expect(overlay.style.width).toBe("");
    await act(async () => switcher());
    const picker = slot.getByRole("complementary", { name: "Terminal sidebar" });
    await waitFor(() => expect(document.activeElement).toBe(picker));
    slot.getByRole("combobox", { name: "Search terminals" }).focus();
    fireEvent.click(slot.getByRole("button", { name: "Hide search keyboard" }));
    expect(document.activeElement).toBe(picker);
    expect(slot.getByRole("button", { name: "New terminal" })).not.toBeNull();
    expect(slot.queryByText("Restore size")).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});


it("opens the selector and switches sessions while background network requests remain pending", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const slot = await setup([tab("first", "worktree:A:one"), tab("second", "worktree:A:one")], {
    pendingRead: pending,
    pendingSelection: pending,
  });
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell first" });
    await act(async () => switcher());
    expect(slot.getByRole("complementary", { name: "Terminal sidebar" })).not.toBeNull();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "read")).toBe(true);
    fireEvent.click(slot.getByRole("option", { name: /^second/ }));
    const second = await slot.findByRole("textbox", { name: "Shell second" });
    await waitFor(() => expect(document.activeElement).toBe(second));
    expect(slot.getByRole("complementary", { name: "Terminal sidebar" })).not.toBeNull();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "setActiveTab")).toBe(true);
  } finally {
    release();
    slot.lifecycle.unmount();
  }
});


it("loads the terminal snapshot while context resolution is still pending", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const slot = await setup([tab("current", "worktree:A:one")], { pendingContext: pending });
  try {
    await act(async () => toggle());
    expect(slot.inspection.rpcCalls.some((call) => call.method === "init")).toBe(true);
    release();
    await slot.findByRole("textbox", { name: "Shell current" });
  } finally {
    release();
    slot.lifecycle.unmount();
  }
});


it("keeps the loading indicator until the terminal confirms its first output is loaded", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const slot = await setup([tab("current", "worktree:A:one")], { pendingContext: pending });
  try {
    await act(async () => toggle());
    expect(slot.getByRole("status").textContent).toContain("Opening terminal");
    const body = slot.container.querySelector(".bb-fg-terminal-body")!;
    expect(body.getAttribute("aria-busy")).toBe("true");
    await act(async () => release());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    expect(slot.getByRole("status").textContent).toContain("Loading terminal");
    await act(async () => shell.dispatchEvent(new Event("shell-ready")));
    expect(slot.queryByRole("status")).toBeNull();
    expect(body.getAttribute("aria-busy")).toBe("false");
  } finally {
    release();
    slot.lifecycle.unmount();
  }
});

it("opens one new terminal with Cmd+N and leaves the shortcut alone when hidden", async () => {
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => fireEvent.keyDown(window, { key: "n", metaKey: true }));
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "openTab")).toHaveLength(0);
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => fireEvent.keyDown(shell, { key: "n", metaKey: true }));
    await slot.findByRole("textbox", { name: "Shell created-1" });
    await act(async () => fireEvent.keyDown(window, { key: "n", metaKey: true, repeat: true }));
    const creates = slot.inspection.rpcCalls.filter((call) => call.method === "openTab");
    expect(creates).toHaveLength(1);
    expect(creates[0]?.input).toMatchObject({ scopeKey: "worktree:A:one" });
  } finally { slot.lifecycle.unmount(); }
});

it("hides the window silently when the last shell exits", async () => {
  const slot = await setup([tab("last", "worktree:A:one"), tab("foreign", "project:B")]);
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell last" });
    await act(async () => slot.exitTerminal("last"));
    await waitFor(() => expect(windowController.isOpen()).toBe(false));
    expect(slot.queryByText("Shell exited with code 0")).toBeNull();
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "closeTab").map((call) => call.input))
      .toEqual([{ terminalId: "last" }]);
  } finally { slot.lifecycle.unmount(); }
});

it("creates for a worktree with no shell, then reuses each worktree's own shell", async () => {
  const slot = await setup([tab("sibling", "worktree:A:two"), tab("default", "project:A")]);
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell created-1" });
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "openTab").map((call) => call.input))
      .toEqual([{ scopeKey: "worktree:A:one", reuseExisting: true, cols: 80, rows: 24 }]);
    await act(async () => slot.navigate({ projectId: "A", threadId: "thread-two" }));
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell sibling" });
    await act(async () => slot.navigate({ projectId: "A", threadId: "thread-one" }));
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell created-1" });
    await act(async () => slot.navigate({ projectId: "A", threadId: "another-thread-in-one" }));
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell created-1" });
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "openTab")).toHaveLength(1);
  } finally { slot.lifecycle.unmount(); }
});


it("collapses the sidebar after selection in a narrow terminal window", async () => {
  const slot = await setup([tab("first", "worktree:A:one"), tab("second", "worktree:A:one")], {
    settings: { customWindowSize: true, windowWidth: 400, windowHeight: 400 },
  });
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell first" });
    await act(async () => switcher());
    expect(slot.getByRole("complementary", { name: "Terminal sidebar" })).toBeTruthy();
    await act(async () => fireEvent.click(slot.getByRole("option", { name: /^second/ })));
    const shell = await slot.findByRole("textbox", { name: "Shell second" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
    expect(slot.queryByRole("complementary", { name: "Terminal sidebar" })).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

it("closes sidebar menus when the terminal window is hidden", async () => {
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => toggle());
    await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher());
    await act(async () => fireEvent.keyDown(slot.getByRole("button", { name: "Actions for current" }), { key: "Enter" }));
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    await act(async () => toggle(menu));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    expect(windowController.isOpen()).toBe(false);
    await act(async () => toggle());
    expect(await slot.findByRole("complementary", { name: "Terminal sidebar" })).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
}, 30000);

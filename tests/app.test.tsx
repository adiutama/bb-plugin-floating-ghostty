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
    }: any) => {
      const ref = React.useRef<HTMLTextAreaElement>(null);
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
    settings?: Record<string, unknown>;
  } = {},
) {
  const app = await loadPluginApp(() => import("../app"));
  let tabs = initial;
  let revision = 1;
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
    const [selection, setSelection] = React.useState({
      projectId: "A",
      threadId: "thread-one",
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
        resolveContext: (input: unknown) => {
          const route = input as { projectId: string };
          return route.projectId === "A"
            ? { context, scopes }
            : {
                context: {
                  projectId: "B",
                  environmentId: null,
                  hostId: "local",
                },
                scopes: [
                  scopes[0],
                  { ...scopes[1], key: "project:B", label: "Project B" },
                ],
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
        setTabOwner: (input: unknown) => {
          const { terminalId, scopeKey } = input as {
            terminalId: string;
            scopeKey: string;
          };
          tabs = tabs.map((tab) =>
            tab.terminalId === terminalId
              ? {
                  ...tab,
                  scopeKey: scopeKey === "global" ? "home:local" : scopeKey,
                }
              : tab,
          );
          revision++;
          return { snapshot: snapshot() };
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
        setActiveTab: () => ({ ok: true }),
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
      },
    },
  );
  return Object.assign(slot, {
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

it("keeps the switcher flat and project-bounded, filters without changing the shell, and restores focus", async () => {
  const slot = await setup([
    tab("global", "home:local"),
    tab("current", "worktree:A:one"),
    tab("sibling", "worktree:A:two"),
    tab("foreign", "project:B"),
  ]);
  try {
    await act(async () => windowController.show());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
    await act(async () => switcher(shell));
    const search = slot.getByPlaceholderText("Search terminals");
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(
      slot
        .getAllByRole("option")
        .filter((node) => node.hasAttribute("cmdk-item")),
    ).toHaveLength(3);
    expect(slot.queryByRole("option", { name: /foreign/ })).toBeNull();
    const category = slot.getByLabelText("Filter terminals");
    fireEvent.keyDown(search, { key: "Tab" });
    expect(document.activeElement).toBe(category);
    // Native select navigation must not activate cmdk's highlighted terminal.
    fireEvent.keyDown(category, { key: "ArrowDown" });
    expect(
      slot.getByRole("dialog", { name: "Switch terminal" }),
    ).not.toBeNull();
    fireEvent.change(category, { target: { value: "global" } });
    await waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Actions for global" }).tabIndex,
      ).toBe(0),
    );
    fireEvent.keyDown(category, { key: "Tab" });
    const create = slot.getByRole("button", { name: "New terminal" });
    expect(document.activeElement).toBe(create);
    fireEvent.keyDown(create, { key: "Tab" });
    expect(document.activeElement).toBe(
      slot.getByRole("button", { name: "Actions for global" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(create);
    fireEvent.keyDown(create, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(category);
    fireEvent.keyDown(category, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(slot.queryByRole("option", { name: /sibling/ })).toBeNull();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
    await act(async () => switcher(shell));
    fireEvent.click(slot.getByRole("option", { name: /sibling/ }));
    const sibling = slot.getByRole("textbox", { name: "Shell sibling" });
    await waitFor(() => expect(document.activeElement).toBe(sibling));
    await act(async () => toggle(sibling));
    await act(async () => toggle());
    await waitFor(() => expect(document.activeElement).toBe(sibling));
  } finally {
    slot.lifecycle.unmount();
  }
});

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
    await act(async () => switcher());
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

it("changes ownership from the actions menu and makes it available in another project", async () => {
  const slot = await setup([tab("current", "worktree:A:one")]);
  try {
    await act(async () => toggle());
    const shell = await slot.findByRole("textbox", { name: "Shell current" });
    await act(async () => switcher());
    const actions = slot.getByRole("button", { name: "Actions for current" });
    await act(async () => {
      fireEvent.keyDown(actions, { key: "Enter" });
    });
    const menu = within(document.querySelector('[role="menu"]') as HTMLElement);
    const hostKey = vi.fn();
    document.addEventListener("keydown", hostKey);
    try {
      fireEvent.keyDown(menu.getByText("Change ownership…"), {
        key: "p",
        metaKey: true,
      });
      expect(hostKey).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", hostKey);
    }
    expect(menu.getByText("Change ownership…")).not.toBeNull();
    await act(async () => {
      fireEvent.click(menu.getByText("Change ownership…"));
    });
    const ownership = within(
      slot.getByRole("dialog", { name: "Change ownership" }),
    );
    await act(async () => {
      fireEvent.click(ownership.getByRole("button", { name: /Global/ }));
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        slot.getByPlaceholderText("Search terminals"),
      ),
    );
    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "setTabOwner")
        .map((call) => call.input),
    ).toEqual([{ terminalId: "current", scopeKey: "global" }]);
    expect(slot.getByRole("option", { name: /current/ }).textContent).toContain(
      "Global",
    );
    await act(async () =>
      slot.navigate({ projectId: "B", threadId: "thread-b" }),
    );
    await act(async () => toggle());
    await waitFor(() => expect(document.activeElement === shell).toBe(true));
    expect(
      slot.inspection.rpcCalls.some((call) =>
        ["openTab", "closeTab", "restartTab"].includes(call.method),
      ),
    ).toBe(false);
  } finally {
    slot.lifecycle.unmount();
  }
  // The real Radix menu's focus/layout pass is slow in jsdom.
}, 20000);

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
      slot.container.querySelector(".bb-fg-session-trigger")?.textContent,
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
      slot.container.querySelector(".bb-fg-session-trigger")?.textContent,
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
      slot.getByRole("dialog", { name: "Switch terminal" }),
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
      slot.container.querySelector(".bb-fg-session-trigger")?.textContent,
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
      slot.container.querySelector(".bb-fg-session-trigger")?.textContent,
    ).toBe("current");
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
    expect(slot.queryByRole("dialog", { name: "Switch terminal" })).toBeNull();
    await act(async () => switcher(shell));
    const search = slot.getByPlaceholderText("Search terminals");
    await waitFor(() => expect(document.activeElement).toBe(search));
    await act(async () =>
      fireEvent.keyDown(search, { key: "k", metaKey: true, repeat: true }),
    );
    expect(
      slot.getByRole("dialog", { name: "Switch terminal" }),
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
    tab("older", "worktree:A:two"),
    tab("current", "worktree:A:one"),
    { ...tab("literal", "home:local"), customTitle: ">find output" },
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
    fireEvent.change(search, { target: { value: ">find" } });
    expect(slot.queryByRole("combobox", { name: "Search actions" })).toBeNull();
    expect(slot.getByRole("option", { name: />find output/ })).not.toBeNull();
    expect(slot.container.querySelector("mark")?.textContent).toBe(">find");
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
    const find = slot.getByPlaceholderText("Find");
    await waitFor(() => expect(document.activeElement).toBe(find));
    fireEvent.keyDown(find, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(shell));
  } finally {
    slot.lifecycle.unmount();
  }
}, 60000);

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { windowController } from "../lib/controller";

beforeEach(() => {
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
});
afterEach(() => {
  windowController.hide();
  vi.unstubAllGlobals();
});
it("registers the BB overlay and shows its empty state without creating a shell", async () => {
  const app = await loadPluginApp(() => import("../app"));
  expect(app.appOverlays).toHaveLength(1);
  expect(app.sidebarFooterActions[0]?.title).toContain("Floating Ghostty");
  const slot = renderSlot(
    app.appOverlays[0]!,
    {},
    {
      rpc: {
        init: () => ({
          snapshot: { revision: 0, tabs: [], activeTabId: null },
          scopes: [],
          recentScopeKeys: [],
          prefs: { fontSize: 13, shortcutEnabled: true },
        }),
      },
    },
  );
  try {
    await act(async () => windowController.show());
    expect(await slot.findByText("Summon a shell")).toBeTruthy();
    expect(slot.getByRole("dialog", { name: "Floating Ghostty" })).toBeTruthy();
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "openTab"),
    ).toBe(false);
    await act(async () => windowController.hide());
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "closeTab"),
    ).toBe(false);
  } finally {
    slot.lifecycle.unmount();
  }
});

import { describe, expect, it } from "vitest";
import {
  availableHere,
  preferredTerminal,
  preferredScope,
  contextKey,
  scopeLabel,
  type TerminalContext,
} from "./context";
const context: TerminalContext = {
  projectId: "A",
  environmentId: "one",
  hostId: "local",
};
const tabs = [
  { terminalId: "b", scopeKey: "project:B" },
  { terminalId: "other", scopeKey: "worktree:B:three" },
  { terminalId: "sibling", scopeKey: "worktree:A:two" },
  { terminalId: "global", scopeKey: "home:local" },
  { terminalId: "project", scopeKey: "project:A" },
  { terminalId: "current", scopeKey: "worktree:A:one" },
];
describe("terminal context", () => {
  it("makes only the current worktree available", () => {
    expect(
      tabs
        .filter((tab) => availableHere(tab.scopeKey, context))
        .map((tab) => tab.terminalId),
    ).toEqual(["current"]);
    expect(
      tabs
        .filter((tab) =>
          availableHere(tab.scopeKey, {
            ...context,
            projectId: null,
            environmentId: null,
          }),
        )
        .map((tab) => tab.terminalId),
    ).toEqual(["global"]);
  });
  it("ignores remembered or recent terminals from other worktrees", () => {
    const pick = (list: typeof tabs) =>
      preferredTerminal(list, context, undefined, ["global", "sibling"]);
    expect(pick(tabs)?.terminalId).toBe("current");
    expect(pick(tabs.slice(0, 2))).toBeUndefined();
    expect(preferredTerminal(tabs, context, "project", [])?.terminalId).toBe(
      "current",
    );
    expect(
      preferredTerminal(tabs, context, "global", ["current"])?.terminalId,
    ).toBe("current");
    expect(preferredTerminal(tabs, context, "b", ["current"])?.terminalId).toBe(
      "current",
    );
  });
  it("keeps selection separate across worktrees and labels projectless shells", () => {
    expect(contextKey(context)).not.toBe(
      contextKey({ ...context, environmentId: "two" }),
    );
    expect(scopeLabel("home:local", [])).toBe("No project");
  });
  it("does not silently create somewhere else when the current worktree is offline", () => {
    const scopes = [
      {
        key: "worktree:A:one",
        kind: "worktree" as const,
        label: "one",
        detail: "/one",
        online: false,
        hostName: "Remote",
        hostId: "remote",
      },
      {
        key: "home:local",
        kind: "home" as const,
        label: "Global",
        detail: "~",
        online: true,
        hostName: "Local",
        hostId: "local",
      },
    ];
    expect(preferredScope(scopes, context)?.key).toBe("worktree:A:one");
  });
});

it("does not reuse a default-checkout or sibling terminal when the worktree is empty", () => {
  const otherTabs = tabs.filter((tab) => tab.terminalId !== "current");
  expect(preferredTerminal(otherTabs, context, "sibling", ["project", "sibling"])).toBeUndefined();
  expect(availableHere("project:A", { ...context, environmentId: null })).toBe(true);
  expect(availableHere("worktree:A:one", { ...context, environmentId: null })).toBe(false);
});

it("never falls back to the default checkout when the worktree scope is missing", () => {
  expect(preferredScope([{
    key: "project:A", kind: "project", label: "Alpha", detail: "/a",
    hostId: "local", hostName: "Local", online: true,
  }], context)).toBeUndefined();
});

import { describe, expect, it } from "vitest";
import {
  availableHere,
  preferredTerminal,
  preferredScope,
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
  it("makes every worktree in this project available, but excludes another project", () => {
    expect(
      tabs
        .filter((tab) => availableHere(tab.scopeKey, context))
        .map((tab) => tab.terminalId),
    ).toEqual(["sibling", "global", "project", "current"]);
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
  it("defaults to worktree, then project, then global, never a sibling", () => {
    const pick = (list: typeof tabs) =>
      preferredTerminal(list, context, undefined, ["global", "sibling"]);
    expect(pick(tabs)?.terminalId).toBe("current");
    expect(
      pick(tabs.filter((tab) => tab.terminalId !== "current"))?.terminalId,
    ).toBe("project");
    expect(pick(tabs.slice(0, 4))?.terminalId).toBe("global");
    expect(pick(tabs.slice(0, 3))).toBeUndefined();
  });
  it("honors an explicit remembered choice without crossing a project boundary", () => {
    expect(preferredTerminal(tabs, context, "sibling", [])?.terminalId).toBe(
      "sibling",
    );
    expect(preferredTerminal(tabs, context, "global", [])?.terminalId).toBe(
      "global",
    );
    expect(preferredTerminal(tabs, context, "b", [])?.terminalId).toBe(
      "current",
    );
  });
  it("uses recency only within the most specific scope", () => {
    const list = [...tabs, { terminalId: "newer", scopeKey: "worktree:A:one" }];
    expect(
      preferredTerminal(list, context, undefined, [
        "global",
        "newer",
        "current",
      ])?.terminalId,
    ).toBe("newer");
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

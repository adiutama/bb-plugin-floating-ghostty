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
  it("makes every worktree in this project available, but excludes another project", () => {
    expect(
      tabs
        .filter((tab) => availableHere(tab.scopeKey, context))
        .map((tab) => tab.terminalId),
    ).toEqual(["sibling", "project", "current"]);
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
  it("selects recent terminals across worktrees within the same project", () => {
    const pick = (list: typeof tabs) =>
      preferredTerminal(list, context, undefined, ["global", "sibling"]);
    expect(pick(tabs)?.terminalId).toBe("sibling");
    expect(pick(tabs.slice(0, 2))).toBeUndefined();
    expect(preferredTerminal(tabs, context, "project", [])?.terminalId).toBe(
      "project",
    );
    expect(
      preferredTerminal(tabs, context, "global", ["current"])?.terminalId,
    ).toBe("current");
    expect(preferredTerminal(tabs, context, "b", ["current"])?.terminalId).toBe(
      "current",
    );
  });
  it("shares selection across a project's worktrees and labels projectless shells", () => {
    expect(contextKey(context)).toBe(
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

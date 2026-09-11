import type { ScopeOption } from "./scopes";

/** Ownership is stable even when a shell changes directory or a branch is renamed. */
export interface TerminalContext {
  projectId: string | null;
  environmentId: string | null;
  hostId: string | null;
}

export const globalContext: TerminalContext = {
  projectId: null,
  environmentId: null,
  hostId: null,
};

export function ownerOf(key: string) {
  const [kind, id, environmentId] = key.split(":");
  return {
    kind,
    projectId: kind === "project" || kind === "worktree" ? id : null,
    environmentId: kind === "worktree" ? environmentId : null,
  };
}

/** Legacy worktree keys still resolve to their project. Home keys have no project. */
export function projectScopeKey(key: string): string {
  const owner = ownerOf(key);
  return owner.projectId === null ? key : `project:${owner.projectId}`;
}

export function availableHere(key: string, context: TerminalContext): boolean {
  return ownerOf(key).projectId === context.projectId;
}

export function contextKey(context: TerminalContext): string {
  return context.projectId === null
    ? "no-project"
    : `project:${context.projectId}`;
}

/** Creation prefers the thread's environment, while ownership stays with its project. */
export function scopePriority(key: string, context: TerminalContext): number {
  const owner = ownerOf(key);
  if (!availableHere(key, context)) return 99;
  if (owner.kind === "worktree")
    return owner.environmentId === context.environmentId ? 0 : 99;
  return 1;
}

export function preferredTerminal<
  T extends { terminalId: string; scopeKey: string },
>(
  tabs: T[],
  context: TerminalContext,
  remembered: string | undefined,
  recent: string[],
): T | undefined {
  const available = tabs.filter((tab) => availableHere(tab.scopeKey, context));
  const previous = available.find((tab) => tab.terminalId === remembered);
  if (previous) return previous;
  const rank = (id: string) => {
    const index = recent.indexOf(id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return available.sort((a, b) => rank(a.terminalId) - rank(b.terminalId))[0];
}

export function preferredScope(
  scopes: ScopeOption[],
  context: TerminalContext,
) {
  // Never silently fall back to a different machine when the intended one is offline.
  return scopes
    .filter((scope) => scopePriority(scope.key, context) < 99)
    .sort(
      (a, b) =>
        scopePriority(a.key, context) - scopePriority(b.key, context) ||
        Number(b.hostId === context.hostId) -
          Number(a.hostId === context.hostId) ||
        (context.hostId === null ? Number(b.online) - Number(a.online) : 0),
    )[0];
}

export function scopeLabel(key: string, scopes: ScopeOption[]): string {
  const owner = ownerOf(key);
  if (owner.projectId === null) return "No project";
  const project = scopes.find(
    (item) => item.key === `project:${owner.projectId}`,
  );
  return project?.label ?? "Project unavailable";
}

interface SelectionMemory {
  selected: Record<string, string>;
  recent: string[];
}
const MEMORY_KEY = "bb-plugin-floating-ghostty:selection:v1";
export function readSelection(): SelectionMemory {
  try {
    const value = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "null");
    if (
      value &&
      typeof value.selected === "object" &&
      value.selected !== null &&
      Object.values(value.selected).every((id) => typeof id === "string") &&
      Array.isArray(value.recent) &&
      value.recent.every((id: unknown) => typeof id === "string")
    )
      return value;
  } catch {
    /* Storage may be unavailable. */
  }
  return { selected: {}, recent: [] };
}
export function rememberSelection(
  context: TerminalContext,
  terminalId: string,
): void {
  const memory = readSelection();
  memory.selected[contextKey(context)] = terminalId;
  memory.recent = [
    terminalId,
    ...memory.recent.filter((id) => id !== terminalId),
  ].slice(0, 200);
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    /* Optional persistence. */
  }
}

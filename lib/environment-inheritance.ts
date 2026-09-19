import { parseProjectEnvironment } from "./project-environment";

// A JSON singleton cannot collide with project ids or [project, worktree] keys.
export const GLOBAL_ENVIRONMENT_KEY = '["global"]';
export function environmentAncestors(key: string): string[] {
  if (key === GLOBAL_ENVIRONMENT_KEY) return [key];
  try {
    const tuple: unknown = JSON.parse(key);
    if (Array.isArray(tuple) && tuple.length === 2 && typeof tuple[0] === "string")
      return [GLOBAL_ENVIRONMENT_KEY, tuple[0], key];
  } catch { /* Project ids are plain strings. */ }
  return [GLOBAL_ENVIRONMENT_KEY, key];
}
export function resolveEnvironment(key: string, read: (key: string) => { text: string; revision: number } | undefined) {
  const entries = new Map<string, { key: string; value: string; source: "global" | "project" | "worktree" }>();
  const revisions: number[] = [];
  for (const ancestor of environmentAncestors(key)) {
    const stored = read(ancestor);
    revisions.push(stored?.revision ?? 0);
    const source = ancestor === GLOBAL_ENVIRONMENT_KEY ? "global" : ancestor.startsWith("[") ? "worktree" : "project";
    for (const entry of parseProjectEnvironment(stored?.text ?? "")) {
      if (entry.enabled !== false) entries.set(entry.key, { key: entry.key, value: entry.value, source });
    }
  }
  return { entries: [...entries.values()], revision: revisions.join(":") };
}

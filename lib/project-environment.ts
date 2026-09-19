import { z } from "zod";
import {
  PROJECT_ENVIRONMENT_MAX_BYTES,
  PROJECT_ENVIRONMENT_MAX_KEYS,
} from "./project-environment-limits";
export {
  PROJECT_ENVIRONMENT_MAX_BYTES,
  PROJECT_ENVIRONMENT_MAX_KEYS,
  PROJECT_ENVIRONMENT_VAULT_MAX_BYTES,
} from "./project-environment-limits";

export const DISABLED_VARIABLE_PREFIX = "# @bb-disabled ";

export interface ProjectEnvironmentEntry {
  key: string;
  value: string;
  enabled?: boolean;
}

export interface StoredProjectEnvironment {
  text: string;
  revision: number;
  updatedAt: string;
}

export interface ProjectEnvironmentVault {
  version: 1;
  projects: Record<string, StoredProjectEnvironment>;
}

const storedEnvironmentSchema = z
  .object({
    text: z.string().max(PROJECT_ENVIRONMENT_MAX_BYTES),
    revision: z.number().int().positive(),
    updatedAt: z.string(),
  })
  .strict();

const vaultSchema = z
  .object({
    version: z.literal(1),
    projects: z.record(z.string(), storedEnvironmentSchema),
  })
  .strict();

export function emptyProjectEnvironmentVault(): ProjectEnvironmentVault {
  return { version: 1, projects: {} };
}

export function parseProjectEnvironmentVault(
  value: string | undefined,
): ProjectEnvironmentVault {
  if (!value) return emptyProjectEnvironmentVault();
  try {
    return vaultSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("The stored project environment vault is invalid.");
  }
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

function syntaxError(source: string, offset: number, message: string): never {
  throw new Error(`Line ${lineAt(source, offset)}: ${message}`);
}

/**
 * Strict dotenv data, deliberately not shell syntax. Quoted values may span
 * lines; interpolation, commands, and arbitrary statements are never run.
 */
export function parseProjectEnvironment(text: string): ProjectEnvironmentEntry[] {
  if (new TextEncoder().encode(text).byteLength > PROJECT_ENVIRONMENT_MAX_BYTES)
    throw new Error("Project environment must be at most 64 KiB.");
  if (text.includes("\0")) throw new Error("Project environment cannot contain NUL bytes.");

  const source = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const entries: ProjectEnvironmentEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;

  const skipHorizontal = () => {
    while (source[offset] === " " || source[offset] === "\t") offset += 1;
  };
  const skipLine = () => {
    while (offset < source.length && source[offset] !== "\n") offset += 1;
    if (source[offset] === "\n") offset += 1;
  };

  while (offset < source.length) {
    skipHorizontal();
    if (source[offset] === "\n") {
      offset += 1;
      continue;
    }
    const disabled = source.startsWith(DISABLED_VARIABLE_PREFIX, offset);
    if (disabled) {
      offset += DISABLED_VARIABLE_PREFIX.length;
      skipHorizontal();
    } else if (source[offset] === "#") {
      skipLine();
      continue;
    }

    const statementStart = offset;
    if (source.slice(offset, offset + 6) === "export" && /[ \t]/.test(source[offset + 6] ?? "")) {
      offset += 6;
      skipHorizontal();
    }
    const keyStart = offset;
    const first = source[offset] ?? "";
    if (!/[A-Za-z_]/.test(first)) syntaxError(source, offset, "expected an environment variable name.");
    offset += 1;
    while (/[A-Za-z0-9_]/.test(source[offset] ?? "")) offset += 1;
    const key = source.slice(keyStart, offset);
    if (key.startsWith("BB_FLOATING_GHOSTTY_"))
      syntaxError(source, keyStart, `${key} is reserved by Floating Ghostty.`);
    skipHorizontal();
    if (source[offset] !== "=") syntaxError(source, offset, `expected '=' after ${key}.`);
    offset += 1;
    skipHorizontal();

    let value = "";
    const quote = source[offset];
    if (quote === "'" || quote === '"') {
      offset += 1;
      let closed = false;
      while (offset < source.length) {
        const character = source[offset]!;
        if (character === quote) {
          offset += 1;
          closed = true;
          break;
        }
        if (quote === '"' && character === "\\") {
          const escaped = source[offset + 1];
          if (escaped === undefined) syntaxError(source, offset, "unfinished escape sequence.");
          const escapes: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            '"': '"',
            "\\": "\\",
          };
          value += escapes[escaped] ?? `\\${escaped}`;
          offset += 2;
          continue;
        }
        value += character;
        offset += 1;
      }
      if (!closed) syntaxError(source, statementStart, `unterminated quoted value for ${key}.`);
      skipHorizontal();
      if (source[offset] === "#") skipLine();
      else if (source[offset] === "\n") offset += 1;
      else if (offset < source.length)
        syntaxError(source, offset, `unexpected text after ${key}.`);
    } else {
      const valueStart = offset;
      while (offset < source.length && source[offset] !== "\n" && source[offset] !== "#") offset += 1;
      value = source.slice(valueStart, offset).trimEnd();
      if (source[offset] === "#") skipLine();
      else if (source[offset] === "\n") offset += 1;
    }

    if (seen.has(key)) syntaxError(source, keyStart, `${key} is assigned more than once.`);
    seen.add(key);
    entries.push({ key, value, ...(disabled ? { enabled: false } : {}) });
    if (entries.length > PROJECT_ENVIRONMENT_MAX_KEYS)
      throw new Error(`Project environment may contain at most ${PROJECT_ENVIRONMENT_MAX_KEYS} variables.`);
  }

  return entries;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function environmentExportScript(entries: ProjectEnvironmentEntry[]): string {
  return entries.filter(entry => entry.enabled !== false).map(({ key, value }) => `export ${key}=${shellQuote(value)}`).join("\n") + "\n";
}

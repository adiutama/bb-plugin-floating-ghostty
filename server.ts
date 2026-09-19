import { chmod, readFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
// bb-plugin-floating-ghostty — backend.
//
// Persistent terminal inventory in front of `bb.sdk.terminals`. Each record maps
// to one real PTY owned by its launch worktree, default checkout, or host home.
// The open-tab list and active tab are kv-persisted, so closing the
// window, reloading the app, or restarting bb reattaches every surviving shell
// instead of losing them.
//
// Two rules make the client/server dance safe, and both matter much more on a
// remote host where a round trip is ~100ms rather than ~2ms:
//
//  1. Every read-modify-write of the kv tab list runs inside `serialize`, so
//     overlapping mutations cannot read the same snapshot and silently drop
//     each other's session — leaking a live PTY that no longer appears in any
//     list. The slow SDK calls (close, and above all create, which spawns a
//     PTY) run *outside* the mutex: plugins share one process, and holding it
//     across a slow host queued every other handler behind one open.
//  2. Every response that carries tab state carries a monotonic `revision`.
//     The client applies a snapshot only if it is newer than the last one it
//     applied, so a slow `init` can never resurrect a closed tab or drop a
//     freshly opened one just because it started earlier.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { GLOBAL_ENVIRONMENT_KEY, environmentAncestors, resolveEnvironment } from "./lib/environment-inheritance";
import { ownerOf } from "./lib/context";
import { shellStartCommand } from "./lib/shell-integration";
import { BB_TERMINAL_FONT_SIZE } from "./lib/theme";
import { hostContract } from "./lib/host-contract";
import {
  parseProjectEnvironment,
  parseProjectEnvironmentVault,
  PROJECT_ENVIRONMENT_MAX_BYTES,
  PROJECT_ENVIRONMENT_VAULT_MAX_BYTES,
} from "./lib/project-environment";
import {
  meaningfulShellTitle,
  normalizeTerminalTitle,
} from "./lib/terminal-io";
import { z } from "zod";

/** Cap on the scrollback replayed when the window (re)attaches to a session. */
const REPLAY_TAIL_BYTES = 256_000;

const scopeSchema = z.object({
  /** Stable id: `worktree:<projectId>:<environmentId>`, `project:<projectId>`, or `home:<hostId>`. */
  key: z.string(),
  label: z.string(),
  /** Absolute path, or "~" for the host's home directory. */
  detail: z.string(),
  hostId: z.string(),
  hostName: z.string(),
  /** Null means "start in the host's home directory". */
  cwd: z.string().nullable(),
  online: z.boolean(),
  kind: z.enum(["project", "home", "worktree"]),
});

const tabSchema = z.object({
  terminalId: z.string(),
  scopeKey: z.string(),
  launchScopeKey: z.string().optional(),
  label: z.string(),
  hostName: z.string(),
  cwd: z.string(),
  status: z.string(),
  exitCode: z.number().int().nullable(),
  /** Automatic title and pinned user name are independent plugin metadata. */
  shellTitle: z.string().nullable(),
  customTitle: z.string().nullable(),
});

/** The authoritative tab state, versioned so stale replies can be discarded. */
const snapshotSchema = z.object({
  revision: z.number().int(),
  tabs: z.array(tabSchema),
  activeTabId: z.string().nullable(),
});

const geometrySchema = z.object({
  cols: z.number().int().min(1).max(2000),
  rows: z.number().int().min(1).max(2000),
});

const contextInput = z
  .object({ projectId: z.string().nullable(), threadId: z.string().nullable() })
  .strict();
const projectIdSchema = z.string().min(1).max(256);
const shortcutSchema = z.object({
  key: z.string(),
  mod: z.boolean(),
  meta: z.boolean(),
  control: z.boolean(),
  alt: z.boolean(),
  shift: z.boolean(),
});

export const rpcContract = defineRpcContract({
  resolveContext: {
    input: contextInput,
    output: z.object({
      context: z.object({
        projectId: z.string().nullable(),
        environmentId: z.string().nullable(),
        hostId: z.string().nullable(),
      }),
      scopes: z.array(scopeSchema),
    }),
  },
  terminalShortcuts: {
    input: z.null(),
    output: z.array(shortcutSchema),
  },
  getProjectEnvironment: {
    input: z.object({ projectId: projectIdSchema, environmentId: projectIdSchema.optional(), scope: z.literal("global").optional() }).strict(),
    output: z
      .object({ text: z.string(), revision: z.number().int().min(0), inherited: z.array(z.object({ key: z.string(), value: z.string(), source: z.enum(["global", "project", "worktree"]) })).optional() })
      .strict(),
  },
  listProjectEnvironments: {
    input: z.object({ includeUnconfigured: z.boolean() }).strict().nullable(),
    output: z.object({
      projects: z.array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            environmentId: z.string().optional(),
            projectId: z.string().optional(),
            configured: z.boolean(),
            keyCount: z.number().int().min(0),
            updatedAt: z.string().nullable(),
          })
          .strict(),
      ),
    }),
  },
  saveEnvironmentDefinitions: {
    input: z.object({
      projectId: projectIdSchema,
      environmentId: projectIdSchema.optional(),
      layers: z.array(z.object({
        scope: z.enum(["global", "project", "worktree"]),
        text: z.string().max(PROJECT_ENVIRONMENT_MAX_BYTES),
        expectedRevision: z.number().int().min(0),
      }).strict()).min(1).max(3),
    }).strict(),
    output: z.object({ keyCount: z.number(), pendingHosts: z.number().optional() }).strict(),
  },
  saveProjectEnvironment: {
    input: z
      .object({
        projectId: projectIdSchema,
        environmentId: projectIdSchema.optional(),
        scope: z.literal("global").optional(),
        text: z.string().max(PROJECT_ENVIRONMENT_MAX_BYTES),
        expectedRevision: z.number().int().min(0),
      })
      .strict(),
    output: z
      .object({
        revision: z.number().int().min(0),
        keyCount: z.number().int().min(0),
        pendingHosts: z.number().int().min(0).optional(),
      })
      .strict(),
  },
  /** Everything the window needs on open: directories, surviving tabs, prefs. */
  init: {
    input: z.null(),
    output: z.object({
      snapshot: snapshotSchema,
      scopes: z.array(scopeSchema),
      /** Scope keys, most recently opened first. Drives the suggestion order. */
      recentScopeKeys: z.array(z.string()),
      prefs: z.object({
        fontSize: z.number().int(),
        shortcutEnabled: z.boolean(),
        overrideNativeShortcut: z.boolean(),
      }),
    }),
  },
  openTab: {
    input: z
      .object({ scopeKey: z.string(), reuseExisting: z.boolean().optional() })
      .extend(geometrySchema.shape)
      .strict(),
    output: z.object({ snapshot: snapshotSchema, opened: tabSchema }),
  },
  setTabCwd: {
    input: z
      .object({
        terminalId: z.string(),
        cwd: z
          .string()
          .max(4096)
          .regex(/^\/[^\x00-\x1f\x7f]*$/),
      })
      .strict(),
    output: z.object({ snapshot: snapshotSchema }),
  },
  setTabName: {
    input: z
      .object({
        terminalId: z.string(),
        name: z.string().trim().max(80).nullable(),
      })
      .strict(),
    output: z.object({ snapshot: snapshotSchema }),
  },
  closeTab: {
    input: z.object({ terminalId: z.string() }).strict(),
    output: z.object({ snapshot: snapshotSchema }),
  },
  setActiveTab: {
    input: z.object({ terminalId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  /** Adopt an OSC title the shell set. Null restores the default name. */
  renameTab: {
    input: z
      .object({ terminalId: z.string(), title: z.string().nullable() })
      .strict(),
    output: z.object({ snapshot: snapshotSchema }),
  },
  /** Kill this tab's shell and start a fresh one in the same directory. */
  restartTab: {
    input: z
      .object({ terminalId: z.string() })
      .extend(geometrySchema.shape)
      .strict(),
    output: z.object({ snapshot: snapshotSchema, restarted: tabSchema }),
  },
  /**
   * Pull output written after `sinceSeq`. Session status is resolved only on an
   * idle read: while bytes are flowing the shell is alive by definition, and
   * this keeps the hot polling path to a single call.
   */
  read: {
    input: z
      .object({
        terminalId: z.string(),
        sinceSeq: z.number().int().min(0),
        replay: z.boolean().optional(),
        attach: z.boolean().optional(),
      })
      .strict(),
    output: z.object({
      chunks: z.array(
        z.object({ seq: z.number().int(), dataBase64: z.string() }),
      ),
      nextSeq: z.number().int(),
      /** True when the ring buffer dropped bytes before `sinceSeq`. */
      truncated: z.boolean(),
      /** First renderer attachment: startup queries still need replies. */
      respondToQueries: z.boolean().optional(),
      /** Present on idle reads and when the session is gone. */
      status: z.string().nullable(),
      exitCode: z.number().int().nullable(),
    }),
  },
  write: {
    input: z
      .object({
        terminalId: z.string(),
        dataBase64: z
          .string()
          .max(87384)
          .regex(
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
          ),
      })
      .strict(),
    output: z.object({ ok: z.boolean() }),
  },
  resize: {
    input: z
      .object({ terminalId: z.string() })
      .extend(geometrySchema.shape)
      .strict(),
    output: z.object({ ok: z.boolean() }),
  },
});

type Scope = z.infer<typeof scopeSchema>;
type Tab = z.infer<typeof tabSchema>;
type Snapshot = z.infer<typeof snapshotSchema>;

interface StoredTab {
  terminalId: string;
  scopeKey: string;
  /** Ownership can widen without moving the process or its restart destination. */
  launchScopeKey?: string;
  hostId?: string;
  name?: string | null;
  shellName?: string;
  autoTitle?: string | null;
  cwd?: string;
}

/**
 * Hard ceiling on any single SDK round trip made from an RPC handler. Plugins
 * run in-process: a hung call to a flaky remote host used to hold a handler
 * (and the serialize queue behind it) for 7+ seconds. On timeout we answer
 * from cached state instead of waiting.
 */
const SDK_TIMEOUT_MS = 1500;
/** Session creation legitimately takes longer on a remote host. */
const CREATE_TIMEOUT_MS = 5000;
/** How long a scopes listing may be served from cache. */
const SCOPES_TTL_MS = 3000;
/**
 * How long a session status from the last `terminals.get` may answer idle
 * reads. The pump polls every 320ms when quiet, and resolving status live on
 * each of those put a second remote round trip behind every poll — against a
 * remote host that alone held the handler for hundreds of milliseconds.
 */
const STATUS_TTL_MS = 2500;
/** How long a verified tab snapshot may be composed from cache. */
const SNAPSHOT_TTL_MS = 4000;

class SdkTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "SdkTimeoutError";
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  // The underlying call keeps running; make sure its eventual rejection is
  // never an unhandled one.
  promise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SdkTimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const TABS_KEY = "open-tabs";
const RECENT_KEY = "recent-scopes";
/** Enough to be useful as suggestions without becoming a second history UI. */
const RECENT_LIMIT = 6;
const ACTIVE_TAB_KEY = "active-tab";
const REVISION_KEY = "revision";

function isLiveStatus(status: string): boolean {
  return status === "running" || status === "starting";
}

export default async function plugin(bb: BbPluginApi) {
  // Resolve the WASM from the pinned engine package in both source and dist
  // installs. There is no second checked-in binary that can drift out of sync.
  const wasmPath = createRequire(import.meta.url).resolve(
    "@wterm/ghostty/ghostty-vt.wasm",
  );
  bb.http.route(
    "GET",
    "/ghostty-vt.wasm",
    async () =>
      new Response(new Uint8Array(await readFile(wasmPath)), {
        headers: {
          "content-type": "application/wasm",
          "cache-control": "private, max-age=3600",
          "x-content-type-options": "nosniff",
        },
      }),
    { auth: "token" },
  );

  const environmentDatabasePath = join(
    bb.server.experimental_dataDir,
    "plugins",
    bb.pluginId,
    "data.db",
  );
  async function secureEnvironmentDatabaseFiles() {
    await Promise.all(
      ["", "-wal", "-shm"].map(async (suffix) => {
        try {
          await chmod(`${environmentDatabasePath}${suffix}`, 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }),
    );
  }

  const environmentDatabase = bb.storage.database();
  bb.storage.migrate(environmentDatabase, [
    `CREATE TABLE IF NOT EXISTS project_environments (
      project_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS floating_ghostty_migrations (
      key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    )`,
  ]);
  await secureEnvironmentDatabaseFiles();

  interface ProjectEnvironmentRow {
    project_id: string;
    text: string;
    revision: number;
    updated_at: string;
  }

  const environmentByProject = environmentDatabase.prepare(
    `SELECT project_id, text, revision, updated_at
     FROM project_environments WHERE project_id = ?`,
  );
  const allEnvironments = environmentDatabase.prepare(
    `SELECT project_id, text, revision, updated_at FROM project_environments`,
  );
  const upsertEnvironment = environmentDatabase.prepare(
    `INSERT INTO project_environments (project_id, text, revision, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       text = excluded.text,
       revision = excluded.revision,
       updated_at = excluded.updated_at`,
  );

  function getStoredEnvironment(projectId: string) {
    const row = environmentByProject.get(projectId) as
      | ProjectEnvironmentRow
      | undefined;
    return row
      ? { text: row.text, revision: row.revision, updatedAt: row.updated_at }
      : undefined;
  }

  function getStoredEnvironments() {
    return Object.fromEntries(
      (allEnvironments.all() as ProjectEnvironmentRow[]).map((row) => [
        row.project_id,
        { text: row.text, revision: row.revision, updatedAt: row.updated_at },
      ]),
    );
  }

  const legacyMigrationKey = "project-environment-vault-v1";
  const legacyPath = join(
    bb.server.experimental_dataDir,
    "plugins",
    bb.pluginId,
    "secrets",
    "projectEnvironmentVault",
  );
  const legacyMigrated = environmentDatabase
    .prepare(`SELECT 1 FROM floating_ghostty_migrations WHERE key = ?`)
    .get(legacyMigrationKey);
  if (!legacyMigrated) {
    let legacyValue: string | undefined;
    try {
      legacyValue = await readFile(legacyPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const migrate = environmentDatabase.transaction(() => {
      if (legacyValue !== undefined) {
        const legacy = parseProjectEnvironmentVault(legacyValue);
        for (const [projectId, environment] of Object.entries(
          legacy.projects,
        )) {
          upsertEnvironment.run(
            projectId,
            environment.text,
            environment.revision,
            environment.updatedAt,
          );
        }
      }
      environmentDatabase
        .prepare(
          `INSERT INTO floating_ghostty_migrations (key, completed_at)
           VALUES (?, ?)`,
        )
        .run(legacyMigrationKey, new Date().toISOString());
    });
    migrate();
    await secureEnvironmentDatabaseFiles();
  }
  try {
    await unlink(legacyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const settings = bb.settings.define({
    // Keep the stored master key so existing opt-ins survive this UI change.
    overrideNativeShortcut: {
      type: "boolean",
      label: "App-wide terminal override",
      description:
        "Use Floating Ghostty for the BB entry points enabled below.",
      default: false,
    },
    overrideLaunchActions: {
      type: "boolean",
      label: "Replace terminal launch actions",
      description:
        "Open Floating Ghostty from Start terminal and the command palette.",
      default: true,
    },
    overrideKeyboard: {
      type: "boolean",
      label: "Use BB terminal shortcut",
      description: "Follow BB’s configured terminal shortcut.",
      default: true,
    },
    shortcutEnabled: {
      type: "boolean",
      label: "Toggle with Ctrl+backtick",
      description: "Available when app-wide terminal override is off.",
      default: true,
    },
    centerOnOpen: {
      type: "boolean",
      label: "Center on open",
      description:
        "Return to the center each time, keeping the terminal’s size.",
      default: false,
    },
    customWindowSize: {
      type: "boolean",
      label: "Custom opening size",
      description:
        "Use the dimensions below when opening. Smaller screens use fullscreen.",
      default: false,
    },
    windowWidth: {
      type: "number",
      label: "Width (px)",
      default: 1100,
      experimental_schema: z.number().int().min(360).max(3840),
    },
    windowHeight: {
      type: "number",
      label: "Height (px)",
      default: 720,
      experimental_schema: z.number().int().min(240).max(2160),
    },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });

  // Serializes every read-modify-write of the tab list. Plugin handlers share
  // one Node process, so a promise chain is a sufficient mutex.
  let mutations: Promise<unknown> = Promise.resolve();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = mutations.then(work, work);
    // Swallow rejections on the chain itself, or one failed mutation would
    // reject every subsequent one.
    mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Every directory a tab can open in: each project's default checkout, plus
   * one home entry per machine. Labels stay short — the picker and the tab
   * strip both group or qualify by machine themselves.
   */
  let scopesCache: { at: number; scopes: Scope[] } | null = null;

  async function listScopes(): Promise<Scope[]> {
    if (scopesCache !== null && Date.now() - scopesCache.at < SCOPES_TTL_MS) {
      return scopesCache.scopes;
    }
    let hosts, projects;
    try {
      [hosts, projects] = await Promise.all([
        withTimeout(bb.sdk.hosts.list(), SDK_TIMEOUT_MS, "hosts.list"),
        withTimeout(bb.sdk.projects.list(), SDK_TIMEOUT_MS, "projects.list"),
      ]);
    } catch (error) {
      // Serve stale scopes rather than block the handler behind a slow call.
      if (scopesCache !== null) return scopesCache.scopes;
      throw error;
    }
    const hostsById = new Map(hosts.map((host) => [host.id, host]));
    const scopes: Scope[] = [];

    for (const project of projects) {
      const source =
        project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
      if (source === undefined) continue;
      const host = hostsById.get(source.hostId);
      scopes.push({
        key: `project:${project.id}`,
        label: project.name,
        detail: source.path,
        hostId: source.hostId,
        hostName: host?.name ?? source.hostId,
        cwd: source.path,
        online: host?.status === "connected",
        kind: "project",
      });
    }

    for (const host of hosts) {
      scopes.push({
        key: `home:${host.id}`,
        label: "Home",
        detail: "~",
        hostId: host.id,
        hostName: host.name,
        cwd: null,
        online: host.status === "connected",
        kind: "home",
      });
    }

    scopesCache = { at: Date.now(), scopes };
    return scopes;
  }

  async function readStoredTabs(): Promise<StoredTab[]> {
    const result = z
      .array(
        z.object({
          terminalId: z.string(),
          scopeKey: z.string(),
          launchScopeKey: z.string().optional(),
          hostId: z.string().optional(),
          name: z.string().nullable().optional(),
          shellName: z.string().optional(),
          autoTitle: z.string().nullable().optional(),
          cwd: z.string().optional(),
        }),
      )
      .safeParse(await bb.storage.kv.get(TABS_KEY));
    // Recover worktree ownership from records written while tabs were grouped by project.
    return result.success
      ? result.data.map((entry) => ({
          ...entry,
          launchScopeKey: entry.launchScopeKey ?? entry.scopeKey,
          scopeKey: entry.launchScopeKey ?? entry.scopeKey,
        }))
      : [];
  }

  async function requireOwnedTab(terminalId: string): Promise<StoredTab> {
    const tab = (await readStoredTabs()).find((tab) => tab.terminalId === terminalId);
    if (!tab) throw new Error("That terminal does not belong to Floating Ghostty.");
    return tab;
  }

  async function confirmedAbsent(entry: StoredTab): Promise<boolean> {
    try {
      const launchKey = entry.launchScopeKey ?? entry.scopeKey;
      const owner = ownerOf(launchKey);
      const hostId =
        entry.hostId ??
        (owner.kind === "home"
          ? launchKey.slice(5)
          : (await requireScope(launchKey)).hostId);
      const result = await withTimeout(
        bb.sdk.terminals.list({
          scope:
            owner.kind === "worktree" && owner.environmentId
              ? { kind: "environment", environmentId: owner.environmentId }
              : { kind: "host_path", hostId },
        }),
        SDK_TIMEOUT_MS,
        "terminals.list",
      );
      return !result.sessions.some(
        (session) => session.id === entry.terminalId,
      );
    } catch {
      return false;
    }
  }

  async function terminateOwned(terminalId: string): Promise<void> {
    const entry = (await readStoredTabs()).find(
      (entry) => entry.terminalId === terminalId,
    );
    if (!entry)
      throw new Error("That terminal does not belong to Floating Ghostty.");
    try {
      await withTimeout(
        bb.sdk.terminals.close({ terminalId, mode: "force" }),
        SDK_TIMEOUT_MS,
        "terminals.close",
      );
    } catch (error) {
      if (!(await confirmedAbsent(entry))) throw error;
    }
  }

  async function readRecent(): Promise<string[]> {
    return (await bb.storage.kv.get<string[]>(RECENT_KEY)) ?? [];
  }

  /** Most recent first, no duplicates. */
  async function rememberRecent(scopeKey: string): Promise<void> {
    const next = [
      scopeKey,
      ...(await readRecent()).filter((k) => k !== scopeKey),
    ];
    await bb.storage.kv.set(RECENT_KEY, next.slice(0, RECENT_LIMIT));
  }

  async function bumpRevision(): Promise<number> {
    const next = ((await bb.storage.kv.get<number>(REVISION_KEY)) ?? 0) + 1;
    await bb.storage.kv.set(REVISION_KEY, next);
    return next;
  }

  /** Fallback naming for a tab whose scope has since disappeared. */
  function labelFromCwd(cwd: string): string {
    const segments = cwd.split("/").filter((part) => part !== "");
    return segments[segments.length - 1] ?? cwd;
  }

  /**
   * The name `createSession` stamps on a new session. A session still wearing
   * it has no shell title of its own, which is how the tab strip knows to keep
   * showing the directory instead.
   */
  function defaultTitle(label: string, hostName: string): string {
    return hostName === "" ? label : `${label} \u00b7 ${hostName}`;
  }

  /** Last tab state we successfully resolved, per terminal id. */
  const lastKnownTabs = new Map<string, Tab>();
  /** Last status `terminals.get` reported, per terminal id, for idle reads. */
  const statusCache = new Map<
    string,
    { at: number; status: string; exitCode: number | null }
  >();
  /** When the tab list was last verified against the live sessions. */
  let lastVerifiedAt = 0;

  function rememberStatus(
    terminalId: string,
    status: string,
    exitCode: number | null,
  ): void {
    statusCache.set(terminalId, { at: Date.now(), status, exitCode });
  }

  const unattachedSessions = new Set<string>();

  function forgetTab(terminalId: string): void {
    unattachedSessions.delete(terminalId);
    lastKnownTabs.delete(terminalId);
    statusCache.delete(terminalId);
  }

  function finishSnapshot(
    tabs: Tab[],
    revision: number,
    storedActive: string | null | undefined,
  ): Snapshot {
    const activeTabId =
      tabs.find((tab) => tab.terminalId === storedActive)?.terminalId ??
      tabs[0]?.terminalId ??
      null;
    return { revision, tabs, activeTabId };
  }

  /**
   * Build the authoritative snapshot. In steady state this composes from the
   * in-memory tab cache and kv alone — no SDK round trips — because every
   * mutation keeps the cache current. The live verification (which is also
   * what drops tabs whose session no longer exists) runs only when the cache
   * is stale, incomplete after a reload, or invalidated by a read that saw a
   * session die. Always call inside `serialize` — a verification writes back
   * the pruned list.
   */
  async function snapshot(): Promise<Snapshot> {
    const stored = await readStoredTabs();
    if (
      Date.now() - lastVerifiedAt < SNAPSHOT_TTL_MS &&
      stored.every((entry) => lastKnownTabs.has(entry.terminalId))
    ) {
      const [revision, storedActive] = await Promise.all([
        bb.storage.kv.get<number>(REVISION_KEY),
        bb.storage.kv.get<string>(ACTIVE_TAB_KEY),
      ]);
      return finishSnapshot(
        stored.map((entry) => lastKnownTabs.get(entry.terminalId)!),
        revision ?? 0,
        storedActive,
      );
    }
    return verifiedSnapshot(stored);
  }

  async function verifiedSnapshot(stored: StoredTab[]): Promise<Snapshot> {
    const [scopes, storedActive] = await Promise.all([
      listScopes(),
      bb.storage.kv.get<string>(ACTIVE_TAB_KEY),
    ]);

    // One parallel, timeout-guarded round instead of a sequential get per tab:
    // the old loop held the handler for (tab count × round trip) — seconds
    // against a slow remote host — and everything queued behind it.
    const resolved = await Promise.all(
      stored.map(async (entry) => {
        try {
          const session = await withTimeout(
            bb.sdk.terminals.get({ terminalId: entry.terminalId }),
            SDK_TIMEOUT_MS,
            "terminals.get",
          );
          rememberStatus(session.id, session.status, session.exitCode);
          const scope =
            scopes.find(
              (item) => item.key === (entry.launchScopeKey ?? entry.scopeKey),
            ) ??
            worktreeScopes.get(entry.launchScopeKey ?? entry.scopeKey) ??
            null;
          const label = entry.shellName ?? "Shell";
          const hostName =
            scope?.hostName ??
            scopes.find(
              (item) => item.kind === "home" && item.hostId === entry.hostId,
            )?.hostName ??
            "";
          const tab: Tab = {
            terminalId: session.id,
            scopeKey: entry.scopeKey,
            launchScopeKey: entry.launchScopeKey ?? entry.scopeKey,
            label,
            hostName,
            cwd: entry.cwd ?? session.initialCwd,
            status: session.status,
            exitCode: session.exitCode,
            customTitle: entry.name ?? null,
            shellTitle:
              entry.autoTitle !== undefined
                ? entry.autoTitle
                : meaningfulShellTitle(session.title, {
                    label: scope?.label ?? labelFromCwd(session.initialCwd),
                    defaultTitle: defaultTitle(
                      scope?.label ?? labelFromCwd(session.initialCwd),
                      hostName,
                    ),
                    cwd: entry.cwd ?? session.initialCwd,
                  }),
          };
          lastKnownTabs.set(tab.terminalId, tab);
          return tab;
        } catch {
          if (await confirmedAbsent(entry)) {
            forgetTab(entry.terminalId);
            return null;
          }
          return (
            lastKnownTabs.get(entry.terminalId) ?? {
              terminalId: entry.terminalId,
              scopeKey: entry.scopeKey,
              launchScopeKey: entry.launchScopeKey ?? entry.scopeKey,
              label: entry.shellName ?? "Shell",
              hostName:
                scopes.find((scope) => scope.hostId === entry.hostId)
                  ?.hostName ?? "",
              cwd: entry.cwd ?? "",
              status: "disconnected",
              exitCode: null,
              shellTitle: entry.autoTitle ?? null,
              customTitle: entry.name ?? null,
            }
          );
        }
      }),
    );
    const tabs: Tab[] = resolved.filter((tab): tab is Tab => tab !== null);

    let revision = (await bb.storage.kv.get<number>(REVISION_KEY)) ?? 0;
    if (tabs.length !== stored.length) {
      // Pruning is itself a change, so it earns a new revision.
      await bb.storage.kv.set(
        TABS_KEY,
        stored.filter((entry) =>
          tabs.some((tab) => tab.terminalId === entry.terminalId),
        ),
      );
      revision = await bumpRevision();
    }

    // A timed-out host answered from last-known state; retrying inside the
    // TTL would only re-block on the same slow host, so stamp either way.
    lastVerifiedAt = Date.now();
    return finishSnapshot(tabs, revision, storedActive);
  }

  const worktreeScopes = new Map<string, Scope>();

  async function worktreeScope(
    projectId: string,
    environmentId: string,
  ): Promise<Scope> {
    const environment = await withTimeout(
      bb.sdk.environments.get({ environmentId }),
      SDK_TIMEOUT_MS,
      "environments.get",
    );
    if (
      environment.projectId !== projectId ||
      !environment.path ||
      environment.status === "destroyed" ||
      environment.status === "destroying"
    ) {
      throw new Error("That worktree is no longer available.");
    }
    const scopes = await listScopes();
    const host = scopes.find(
      (scope) => scope.key === `home:${environment.hostId}`,
    );
    const scope: Scope = {
      key: `worktree:${projectId}:${environmentId}`,
      kind: "worktree",
      label:
        environment.name ||
        environment.branchName ||
        labelFromCwd(environment.path),
      detail: environment.path,
      cwd: environment.path,
      hostId: environment.hostId,
      hostName: host?.hostName ?? environment.hostId,
      online: environment.status === "ready" && host?.online === true,
    };
    worktreeScopes.set(scope.key, scope);
    return scope;
  }

  async function requireScope(scopeKey: string): Promise<Scope> {
    const owner = ownerOf(scopeKey);
    const scope =
      owner.kind === "worktree" && owner.projectId && owner.environmentId
        ? await worktreeScope(owner.projectId, owner.environmentId)
        : (await listScopes()).find((entry) => entry.key === scopeKey);
    if (scope === undefined) {
      throw new Error("That directory is no longer available.");
    }
    if (!scope.online) {
      throw new Error(`${scope.hostName} is disconnected.`);
    }
    return scope;
  }

  // Keep project records and host paths stable. Worktree records contain only
  // overrides; their private host files contain the resolved inherited values.
  function environmentKey(projectId: string, environmentId?: string | null): string {
    return environmentId ? JSON.stringify([projectId, environmentId]) : projectId;
  }
  function tabEnvironmentKey(tab: StoredTab): string | null {
    const owner = ownerOf(tab.launchScopeKey ?? tab.scopeKey);
    return owner.projectId ? environmentKey(owner.projectId, owner.environmentId) : GLOBAL_ENVIRONMENT_KEY;
  }
  async function validateEnvironment(projectId: string, environmentId?: string) {
    if (environmentId) await worktreeScope(projectId, environmentId);
  }

  const environmentHosts = new Map<string, Set<string>>();
  const appliedEnvironments = new Map<string, string>();
  const environmentRetries = new Map<string, number>();
  const environmentInFlight = new Set<string>();
  const environmentHostKey = (projectId: string, hostId: string) => JSON.stringify([projectId, hostId]);

  // Retry after reconnect (and after a plugin reload) without holding output
  // polling behind host RPC. Saves and retries share the revision ordering.
  function refreshSessionEnvironment(tab: StoredTab): void {
    const projectId = tabEnvironmentKey(tab);
    const hostId = tab.hostId;
    if (!projectId || !hostId) return;
    const key = environmentHostKey(projectId, hostId);
    const revision = resolveEnvironment(projectId, getStoredEnvironment).revision;
    if (appliedEnvironments.get(key) === revision || environmentInFlight.has(key) ||
        Date.now() < (environmentRetries.get(key) ?? 0)) return;
    environmentInFlight.add(key);
    void serializeEnvironment(async () => {
      const effective = resolveEnvironment(projectId, getStoredEnvironment);
      await host.call("prepareProjectEnvironment", {
        projectId, entries: effective.entries.map(({ key, value }) => ({ key, value })),
      }, { hostId });
      appliedEnvironments.set(key, effective.revision);
      environmentRetries.delete(key);
    }).catch(() => {
      environmentRetries.set(key, Date.now() + 5000);
    }).finally(() => environmentInFlight.delete(key));
  }
  // Order saves and startup file preparation without blocking terminal reads,
  // closes, or snapshots behind a disconnected host.
  let environmentTail: Promise<unknown> = Promise.resolve();
  function serializeEnvironment<T>(action: () => Promise<T>): Promise<T> {
    const result = environmentTail.then(action);
    environmentTail = result.catch(() => {});
    return result;
  }

  async function createSession(
    scope: Scope,
    cols: number,
    rows: number,
  ): Promise<Tab> {
    let environmentFile: string | null = null;
    const owner = ownerOf(scope.key);
    const projectId = owner.projectId ? environmentKey(owner.projectId, owner.environmentId) : GLOBAL_ENVIRONMENT_KEY;
    if (projectId !== null) {
      const prepared = await serializeEnvironment(async () => {
        const hosts = environmentHosts.get(projectId) ?? new Set<string>();
        hosts.add(scope.hostId);
        environmentHosts.set(projectId, hosts);
        const effective = resolveEnvironment(projectId, getStoredEnvironment);
        const prepared = await host.call(
          "prepareProjectEnvironment",
          { projectId, entries: effective.entries.map(({ key, value }) => ({ key, value })) },
          { hostId: scope.hostId },
        );
        appliedEnvironments.set(environmentHostKey(projectId, scope.hostId), effective.revision);
        return prepared;
      });
      environmentFile = prepared.path;
    }
    const created = await withTimeout(
      bb.sdk.terminals.create({
        cols,
        rows,
        scope:
          scope.kind === "worktree"
            ? {
                kind: "environment",
                environmentId: ownerOf(scope.key).environmentId!,
              }
            : { kind: "host_path", hostId: scope.hostId, cwd: scope.cwd },
        start: { mode: "command", command: shellStartCommand(environmentFile) },
        title: "Shell",
      }),
      CREATE_TIMEOUT_MS,
      "terminals.create",
    );
    unattachedSessions.add(created.id);
    bb.log.info(`opened ${created.id} in ${created.initialCwd}`);
    return {
      terminalId: created.id,
      scopeKey: scope.key,
      launchScopeKey: scope.key,
      label: "Shell",
      hostName: scope.hostName,
      cwd: created.initialCwd,
      status: created.status,
      exitCode: created.exitCode,
      shellTitle: null,
      customTitle: null,
    };
  }

  async function openSession(scopeKey: string, cols: number, rows: number) {
    // The slow parts — resolving the scope and spawning the PTY — run
    // outside the mutation mutex. Held across a create they queued every
    // other handler (init from another window, closes, the read polls)
    // behind one slow host for up to the whole create timeout.
    const scope = await requireScope(scopeKey);
    const opened = await createSession(scope, cols, rows);
    return serialize(async () => {
      const stored = await readStoredTabs();
      stored.push({
        terminalId: opened.terminalId,
        scopeKey: opened.scopeKey,
        launchScopeKey: scope.key,
        hostId: scope.hostId,
        autoTitle: null,
      });
      await bb.storage.kv.set(TABS_KEY, stored);
      await bb.storage.kv.set(ACTIVE_TAB_KEY, opened.terminalId);
      await rememberRecent(opened.scopeKey);
      await bumpRevision();
      lastKnownTabs.set(opened.terminalId, opened);
      rememberStatus(opened.terminalId, opened.status, opened.exitCode);
      return { snapshot: await snapshot(), opened };
    });
  }

  const pendingWorktreeOpens = new Map<string, ReturnType<typeof openSession>>();

  async function saveEnvironmentLayers(changes: { key: string; text: string; expectedRevision: number }[]) {
    if (new Set(changes.map(change => change.key)).size !== changes.length) throw new Error("Each scope may only be saved once.");
    const keyCount = changes.reduce((count, change) => count + parseProjectEnvironment(change.text).length, 0);
    return serializeEnvironment(async () => {
      const stored = getStoredEnvironments();
      for (const change of changes) {
        const revision = stored[change.key]?.revision ?? 0;
        if (revision !== change.expectedRevision) throw new Error("This environment changed in another window. Reopen it and try again.");
        if (change.text === "" && revision === 0) continue;
        stored[change.key] = { text: change.text, revision: revision + 1, updatedAt: new Date().toISOString() };
      }
      if (new TextEncoder().encode(JSON.stringify({ version: 1, projects: stored })).byteLength > PROJECT_ENVIRONMENT_VAULT_MAX_BYTES) throw new Error("The project environment vault is full.");
      environmentDatabase.transaction(() => {
        for (const change of changes) {
          const next = stored[change.key];
          if (next) upsertEnvironment.run(change.key, next.text, next.revision, next.updatedAt);
        }
      })();
      await secureEnvironmentDatabaseFiles();
      const affected = new Map<string, Set<string>>();
      for (const [key, hosts] of environmentHosts) {
        if (changes.some(change => environmentAncestors(key).includes(change.key))) affected.set(key, new Set(hosts));
      }
      for (const tab of await readStoredTabs()) {
        const key = tabEnvironmentKey(tab);
        if (!key || !tab.hostId || !changes.some(change => environmentAncestors(key).includes(change.key))) continue;
        const hosts = affected.get(key) ?? new Set<string>();
        hosts.add(tab.hostId);
        affected.set(key, hosts);
      }
      const updates = await Promise.allSettled([...affected].flatMap(([scopeKey, hosts]) => {
        const effective = resolveEnvironment(scopeKey, getStoredEnvironment);
        return [...hosts].map(async (hostId) => {
          await host.call("prepareProjectEnvironment", {
            projectId: scopeKey, entries: effective.entries.map(({ key, value }) => ({ key, value })),
          }, { hostId });
          const key = environmentHostKey(scopeKey, hostId);
          appliedEnvironments.set(key, effective.revision);
          environmentRetries.delete(key);
        });
      }));
      return { keyCount, pendingHosts: updates.filter(update => update.status === "rejected").length,
        revisions: changes.map(change => stored[change.key]?.revision ?? 0) };
    });
  }

  bb.rpc.register(rpcContract, {
    async resolveContext({ projectId, threadId }) {
      let environmentId: string | null = null;
      if (threadId !== null) {
        const thread = await withTimeout(
          bb.sdk.threads.get({ threadId }),
          SDK_TIMEOUT_MS,
          "threads.get",
        );
        projectId = thread.projectId;
        environmentId = thread.environmentId;
      }
      const scopes = await listScopes();
      // Projectless conversations use machine-home shells.
      if (!scopes.some((scope) => scope.key === `project:${projectId}`)) {
        projectId = null;
        environmentId = null;
      }
      const current =
        projectId !== null && environmentId !== null
          ? await worktreeScope(projectId, environmentId).catch(() => undefined)
          : undefined;
      if (environmentId !== null && !current)
        throw new Error(
          "The current worktree is unavailable. Try again when it reconnects.",
        );
      const project = scopes.find(
        (scope) => scope.key === `project:${projectId}`,
      );
      const context = {
        projectId,
        environmentId,
        hostId: current?.hostId ?? project?.hostId ?? null,
      };
      return {
        context,
        scopes: [...scopes, ...(current ? [current] : [])],
      };
    },

    async terminalShortcuts() {
      const values = await settings.get();
      if (!values.overrideNativeShortcut || !values.overrideKeyboard) return [];
      const config = await withTimeout(
        bb.sdk.system.config(),
        SDK_TIMEOUT_MS,
        "system.config",
      );
      const override = config.keybindingOverrides.find(
        (binding) => binding.command === "terminal.open",
      );
      if (override) return override.shortcut ? [override.shortcut] : [];
      return config.keybindings
        .filter((binding) => binding.command === "terminal.open")
        .map((binding) => binding.shortcut);
    },

    async getProjectEnvironment({ projectId, environmentId, scope }) {
      if (!scope) await validateEnvironment(projectId, environmentId);
      const key = scope === "global" ? GLOBAL_ENVIRONMENT_KEY : environmentKey(projectId, environmentId);
      const stored = getStoredEnvironment(key);
      const parent = environmentAncestors(key).at(-2);
      const inherited = parent ? resolveEnvironment(parent, getStoredEnvironment).entries : [];
      return { text: stored?.text ?? "", revision: stored?.revision ?? 0,
        ...(inherited.length ? { inherited } : {}) };
    },

    async listProjectEnvironments(input) {
      const projects = await withTimeout(
        bb.sdk.projects.list({ includePersonal: true, ...(input?.includeUnconfigured ? { include: "threads" as const } : {}) }),
        SDK_TIMEOUT_MS, "projects.list",
      );
      const tabs = await readStoredTabs();
      const storedKeys = Object.keys(getStoredEnvironments());
      const targets: { id: string; projectId: string; name: string; environmentId?: string }[] = [];
      for (const project of projects) {
        targets.push({ id: project.id, projectId: project.id, name: project.name });
        const ids = new Set<string>();
        if ("threads" in project) for (const thread of project.threads) {
          if (thread.environmentId) ids.add(thread.environmentId);
        }
        for (const key of storedKeys) {
          try {
            const value: unknown = JSON.parse(key);
            if (Array.isArray(value) && value.length === 2 && value[0] === project.id && typeof value[1] === "string") ids.add(value[1]);
          } catch { /* Legacy project keys are not JSON tuples. */ }
        }
        for (const tab of tabs) {
          const owner = ownerOf(tab.launchScopeKey ?? tab.scopeKey);
          if (owner.projectId === project.id && owner.environmentId) ids.add(owner.environmentId);
        }
        const worktrees = await Promise.all([...ids].map(async (environmentId) => {
          const scope = await worktreeScope(project.id, environmentId).catch(() => null);
          return scope ? {
            id: environmentKey(project.id, environmentId), projectId: project.id,
            environmentId, name: `${project.name} / ${scope.label}`,
          } : null;
        }));
        for (const target of worktrees) if (target) targets.push(target);
      }
      return { projects: targets.map((target) => {
        const stored = getStoredEnvironment(target.id);
        const keyCount = parseProjectEnvironment(stored?.text ?? "").length;
        return { ...target, configured: keyCount > 0, keyCount, updatedAt: stored?.updatedAt ?? null };
      }).filter((target) => input?.includeUnconfigured || target.configured)
        .sort((a, b) => a.name.localeCompare(b.name)) };
    },

    async saveEnvironmentDefinitions({ projectId, environmentId, layers }) {
      if (layers.some(layer => layer.scope === "worktree")) {
        if (!environmentId) throw new Error("A worktree is required for worktree variables.");
        await validateEnvironment(projectId, environmentId);
      }
      const result = await saveEnvironmentLayers(layers.map(layer => ({
        key: layer.scope === "global" ? GLOBAL_ENVIRONMENT_KEY : environmentKey(projectId, layer.scope === "worktree" ? environmentId : undefined),
        text: layer.text, expectedRevision: layer.expectedRevision,
      })));
      return { keyCount: result.keyCount, ...(result.pendingHosts ? { pendingHosts: result.pendingHosts } : {}) };
    },
    async saveProjectEnvironment({ projectId, environmentId, scope, text, expectedRevision }) {
      if (!scope) await validateEnvironment(projectId, environmentId);
      const result = await saveEnvironmentLayers([{ key: scope === "global" ? GLOBAL_ENVIRONMENT_KEY : environmentKey(projectId, environmentId), text, expectedRevision }]);
      return { revision: result.revisions[0]!, keyCount: result.keyCount, ...(result.pendingHosts ? { pendingHosts: result.pendingHosts } : {}) };
    },

    async init() {
      const [snap, scopes, recentScopeKeys, values] = await Promise.all([
        serialize(snapshot),
        listScopes(),
        readRecent(),
        settings.get(),
      ]);
      return {
        snapshot: snap,
        scopes,
        recentScopeKeys,
        prefs: {
          fontSize: BB_TERMINAL_FONT_SIZE,
          shortcutEnabled: values.shortcutEnabled,
          overrideNativeShortcut: values.overrideNativeShortcut,
        },
      };
    },

    async openTab({ scopeKey, cols, rows, reuseExisting }) {
      if (!reuseExisting) return openSession(scopeKey, cols, rows);
      const pending = pendingWorktreeOpens.get(scopeKey);
      if (pending) return pending;
      const opening = (async () => {
        const current = await serialize(async () => verifiedSnapshot(await readStoredTabs()));
        const existing = current.tabs.find((tab) =>
          tab.scopeKey === scopeKey && tab.status !== "exited" && tab.status !== "gone");
        return existing ? { snapshot: current, opened: existing } : openSession(scopeKey, cols, rows);
      })();
      pendingWorktreeOpens.set(scopeKey, opening);
      try { return await opening; }
      finally { pendingWorktreeOpens.delete(scopeKey); }
    },

    async setTabCwd({ terminalId, cwd }) {
      return serialize(async () => {
        const stored = await readStoredTabs();
        const entry = stored.find((tab) => tab.terminalId === terminalId);
        if (!entry)
          throw new Error("That terminal does not belong to Floating Ghostty.");
        if (entry.cwd === cwd) return { snapshot: await snapshot() };
        entry.cwd = cwd;
        await bb.storage.kv.set(TABS_KEY, stored);
        const known = lastKnownTabs.get(terminalId);
        if (known) lastKnownTabs.set(terminalId, { ...known, cwd });
        await bumpRevision();
        return { snapshot: await snapshot() };
      });
    },

    async setTabName({ terminalId, name }) {
      const clean = name?.replace(/[\x00-\x1f\x7f]/g, "").trim() || null;
      const result = await serialize(async () => {
        const stored = await readStoredTabs();
        const entry = stored.find((item) => item.terminalId === terminalId);
        if (!entry)
          throw new Error("That terminal does not belong to Floating Ghostty.");
        entry.name = clean;
        await bb.storage.kv.set(TABS_KEY, stored);
        const known = lastKnownTabs.get(terminalId);
        if (known)
          lastKnownTabs.set(terminalId, { ...known, customTitle: clean });
        await bumpRevision();
        return { snapshot: await snapshot() };
      });
      return result;
    },

    async closeTab({ terminalId }) {
      await requireOwnedTab(terminalId);
      // Never discard the ownership record until the host confirms termination.
      await terminateOwned(terminalId);
      return serialize(async () => {
        const remaining = (await readStoredTabs()).filter(
          (entry) => entry.terminalId !== terminalId,
        );
        await bb.storage.kv.set(TABS_KEY, remaining);

        const storedActive = await bb.storage.kv.get<string>(ACTIVE_TAB_KEY);
        if (storedActive === terminalId) {
          const next = remaining[remaining.length - 1]?.terminalId;
          if (next === undefined) await bb.storage.kv.delete(ACTIVE_TAB_KEY);
          else await bb.storage.kv.set(ACTIVE_TAB_KEY, next);
        }
        forgetTab(terminalId);
        await bumpRevision();
        return { snapshot: await snapshot() };
      });
    },

    async setActiveTab({ terminalId }) {
      await requireOwnedTab(terminalId);
      await bb.storage.kv.set(ACTIVE_TAB_KEY, terminalId);
      return { ok: true };
    },

    async renameTab({ terminalId, title }) {
      return serialize(async () => {
        const stored = await readStoredTabs();
        const entry = stored.find((item) => item.terminalId === terminalId);
        if (!entry) return { snapshot: await snapshot() };
        const known = lastKnownTabs.get(terminalId);
        const shell = title?.match(/^bb-fg:shell:([a-zA-Z0-9_.+-]+)$/)?.[1];
        const command = title?.startsWith("bb-fg:command:")
          ? normalizeTerminalTitle(title.slice(14).split("/").pop() ?? "")
          : undefined;
        if (shell) entry.shellName = shell;
        const launchKey = entry.launchScopeKey ?? entry.scopeKey;
        const scope =
          (await listScopes()).find((scope) => scope.key === launchKey) ??
          worktreeScopes.get(launchKey);
        entry.autoTitle =
          shell || title === null
            ? null
            : command !== undefined
              ? command
              : meaningfulShellTitle(title, {
                  label: scope?.label ?? "Shell",
                  defaultTitle: defaultTitle(
                    scope?.label ?? "Shell",
                    scope?.hostName ?? "",
                  ),
                  cwd: known?.cwd ?? "",
                });
        await bb.storage.kv.set(TABS_KEY, stored);
        if (known)
          lastKnownTabs.set(terminalId, {
            ...known,
            label: entry.shellName ?? known.label,
            shellTitle: entry.autoTitle,
            customTitle: entry.name ?? null,
          });
        await bumpRevision();
        return { snapshot: await snapshot() };
      });
    },

    async restartTab({ terminalId, cols, rows }) {
      // Close + create are the two slowest calls this plugin makes, so they
      // run between two short serialized sections instead of holding the
      // mutex for their combined timeouts.
      const found = (await readStoredTabs()).find(
        (entry) => entry.terminalId === terminalId,
      );
      if (found === undefined) throw new Error("That tab is no longer open.");

      const scope = await requireScope(found.launchScopeKey ?? found.scopeKey);
      await terminateOwned(terminalId);

      const restarted = await createSession(scope, cols, rows);
      return serialize(async () => {
        const stored = await readStoredTabs();
        const index = stored.findIndex(
          (entry) => entry.terminalId === terminalId,
        );
        if (index === -1) {
          // The tab was closed while the new shell was spawning. Do not leak
          // the session a strip will never show; best-effort, detached.
          withTimeout(
            bb.sdk.terminals.close({
              terminalId: restarted.terminalId,
              mode: "force",
            }),
            SDK_TIMEOUT_MS,
            "terminals.close",
          ).catch(() => {});
          throw new Error("That tab is no longer open.");
        }
        // Replace in place so the tab keeps its position in the strip.
        // Preserve the project and custom name while replacing the PTY.
        restarted.scopeKey = stored[index]!.scopeKey;
        restarted.customTitle = stored[index]!.name ?? null;
        restarted.label = stored[index]!.shellName ?? "Shell";
        stored[index] = {
          ...stored[index]!,
          terminalId: restarted.terminalId,
          autoTitle: null,
          cwd: restarted.cwd,
        };
        await bb.storage.kv.set(TABS_KEY, stored);
        const storedActive = await bb.storage.kv.get<string>(ACTIVE_TAB_KEY);
        if (storedActive === terminalId) {
          await bb.storage.kv.set(ACTIVE_TAB_KEY, restarted.terminalId);
        }
        forgetTab(terminalId);
        lastKnownTabs.set(restarted.terminalId, restarted);
        rememberStatus(
          restarted.terminalId,
          restarted.status,
          restarted.exitCode,
        );
        await bumpRevision();
        return { snapshot: await snapshot(), restarted };
      });
    },

    async read({ terminalId, sinceSeq, replay, attach }) {
      const tab = await requireOwnedTab(terminalId);
      refreshSessionEnvironment(tab);
      try {
        const output = await withTimeout(
          bb.sdk.terminals.output({
            terminalId,
            sinceSeq,
            ...(replay === true ? { tailBytes: REPLAY_TAIL_BYTES } : {}),
          }),
          SDK_TIMEOUT_MS,
          "terminals.output",
        );
        // Title-only observers must not consume the renderer’s first attachment.
        const respondToQueries = attach === true && unattachedSessions.delete(terminalId);
        if (output.chunks.length > 0) {
          // Bytes are flowing, so the shell is alive by definition.
          rememberStatus(terminalId, "running", null);
          return { ...output, respondToQueries, status: null, exitCode: null };
        }
        // This is the hot polling path — every idle window polls it at up to
        // ~3Hz — so the status round trip runs at most once per TTL rather
        // than doubling every poll against a possibly-remote host.
        const cached = statusCache.get(terminalId);
        if (cached !== undefined && Date.now() - cached.at < STATUS_TTL_MS) {
          return {
            ...output,
            status: cached.status,
            exitCode: cached.exitCode,
          };
        }
        const session = await withTimeout(
          bb.sdk.terminals.get({ terminalId }),
          SDK_TIMEOUT_MS,
          "terminals.get",
        );
        rememberStatus(terminalId, session.status, session.exitCode);
        if (!isLiveStatus(session.status)) {
          // Refresh the next snapshot with the retained shell’s exit status.
          lastVerifiedAt = 0;
        }
        return {
          ...output,
          status: session.status,
          exitCode: session.exitCode,
        };
      } catch (error) {
        if (error instanceof SdkTimeoutError) {
          // Slow host, not a dead session. Report no progress; the client
          // polls again rather than treating the tab as gone.
          return {
            chunks: [],
            nextSeq: sinceSeq,
            truncated: false,
            status: null,
            exitCode: null,
          };
        }
        // BB rejects output reads after process exit. Verify the lifecycle state
        // so the UI can show its exit status without treating a network error as exit.
        try {
          const session = await withTimeout(
            bb.sdk.terminals.get({ terminalId }),
            SDK_TIMEOUT_MS,
            "terminals.get",
          );
          if (!isLiveStatus(session.status)) {
            rememberStatus(terminalId, session.status, session.exitCode);
            lastVerifiedAt = 0;
            return {
              chunks: [],
              nextSeq: sinceSeq,
              truncated: false,
              status: session.status,
              exitCode: session.exitCode,
            };
          }
        } catch {
          // No authoritative exit state: retain the shell and allow retry.
        }
        throw error; // Let the renderer show a recoverable transport error.
      }
    },

    async write({ terminalId, dataBase64 }) {
      await requireOwnedTab(terminalId);
      await withTimeout(
        bb.sdk.terminals.input({ terminalId, dataBase64 }),
        SDK_TIMEOUT_MS,
        "terminals.input",
      );
      return { ok: true };
    },

    async resize({ terminalId, cols, rows }) {
      await requireOwnedTab(terminalId);
      await withTimeout(
        bb.sdk.terminals.resize({ terminalId, cols, rows }),
        SDK_TIMEOUT_MS,
        "terminals.resize",
      );
      return { ok: true };
    },
  });
}

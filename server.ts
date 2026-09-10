import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
// bb-plugin-floating-ghostty — backend.
//
// A tab manager in front of `bb.sdk.terminals`. The floating window's
// navigation is a tab strip; each tab maps to one real PTY session on some
// host. The open-tab list and the active tab are kv-persisted, so closing the
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
import { meaningfulShellTitle } from "./lib/terminal-io";
import { z } from "zod";

/** Cap on the scrollback replayed when the window (re)attaches to a session. */
const REPLAY_TAIL_BYTES = 256_000;

const scopeSchema = z.object({
  /** Stable id: `home:<hostId>` or `project:<projectId>`. */
  key: z.string(),
  label: z.string(),
  /** Absolute path, or "~" for the host's home directory. */
  detail: z.string(),
  hostId: z.string(),
  hostName: z.string(),
  /** Null means "start in the host's home directory". */
  cwd: z.string().nullable(),
  online: z.boolean(),
  kind: z.enum(["project", "home"]),
});

const tabSchema = z.object({
  terminalId: z.string(),
  scopeKey: z.string(),
  label: z.string(),
  hostName: z.string(),
  cwd: z.string(),
  status: z.string(),
  exitCode: z.number().int().nullable(),
  /**
   * A title the shell set over OSC, or null while the session still wears the
   * one `createSession` stamped. Lives on the bb session rather than in plugin
   * storage, so `bb terminal list` and bb's own UI show the same name.
   */
  shellTitle: z.string().nullable(),
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

export const rpcContract = defineRpcContract({
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
      }),
    }),
  },
  openTab: {
    input: z
      .object({ scopeKey: z.string() })
      .extend(geometrySchema.shape)
      .strict(),
    output: z.object({ snapshot: snapshotSchema, opened: tabSchema }),
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
      })
      .strict(),
    output: z.object({
      chunks: z.array(
        z.object({ seq: z.number().int(), dataBase64: z.string() }),
      ),
      nextSeq: z.number().int(),
      /** True when the ring buffer dropped bytes before `sinceSeq`. */
      truncated: z.boolean(),
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

  const settings = bb.settings.define({
    fontSize: {
      type: "select",
      label: "Font size",
      options: ["11", "12", "13", "14", "16", "18"],
      default: "13",
    },
    shortcutEnabled: {
      type: "boolean",
      label: "Toggle with Ctrl+Shift+`",
      default: true,
    },
  });

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
      .array(z.object({ terminalId: z.string(), scopeKey: z.string() }))
      .safeParse(await bb.storage.kv.get(TABS_KEY));
    return result.success ? result.data : [];
  }

  async function requireOwnedTab(terminalId: string): Promise<void> {
    if (
      !(await readStoredTabs()).some((tab) => tab.terminalId === terminalId)
    ) {
      throw new Error("That terminal does not belong to Floating Ghostty.");
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

  function forgetTab(terminalId: string): void {
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

    let sawTimeout = false;
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
          if (!isLiveStatus(session.status)) return null;
          const scope =
            scopes.find((item) => item.key === entry.scopeKey) ?? null;
          const label = scope?.label ?? labelFromCwd(session.initialCwd);
          const hostName = scope?.hostName ?? "";
          const tab: Tab = {
            terminalId: session.id,
            scopeKey: entry.scopeKey,
            label,
            hostName,
            cwd: session.initialCwd,
            status: session.status,
            exitCode: session.exitCode,
            shellTitle: meaningfulShellTitle(session.title, {
              label,
              defaultTitle: defaultTitle(label, hostName),
              cwd: session.initialCwd,
            }),
          };
          lastKnownTabs.set(tab.terminalId, tab);
          return tab;
        } catch (error) {
          if (error instanceof SdkTimeoutError) {
            // Slow, not gone: keep the tab on its last known state rather
            // than pruning a live session just because the host is laggy.
            sawTimeout = true;
            return lastKnownTabs.get(entry.terminalId) ?? null;
          }
          // Session is gone entirely; drop the tab.
          forgetTab(entry.terminalId);
          return null;
        }
      }),
    );
    const tabs: Tab[] = resolved.filter((tab): tab is Tab => tab !== null);

    let revision = (await bb.storage.kv.get<number>(REVISION_KEY)) ?? 0;
    if (tabs.length !== stored.length && !sawTimeout) {
      // Pruning is itself a change, so it earns a new revision.
      await bb.storage.kv.set(
        TABS_KEY,
        tabs.map(({ terminalId, scopeKey }) => ({ terminalId, scopeKey })),
      );
      revision = await bumpRevision();
    }

    // A timed-out host answered from last-known state; retrying inside the
    // TTL would only re-block on the same slow host, so stamp either way.
    lastVerifiedAt = Date.now();
    return finishSnapshot(tabs, revision, storedActive);
  }

  async function requireScope(scopeKey: string): Promise<Scope> {
    const scope = (await listScopes()).find((entry) => entry.key === scopeKey);
    if (scope === undefined) {
      throw new Error("That directory is no longer available.");
    }
    if (!scope.online) {
      throw new Error(`${scope.hostName} is disconnected.`);
    }
    return scope;
  }

  async function createSession(
    scope: Scope,
    cols: number,
    rows: number,
  ): Promise<Tab> {
    const created = await withTimeout(
      bb.sdk.terminals.create({
        cols,
        rows,
        scope: { kind: "host_path", hostId: scope.hostId, cwd: scope.cwd },
        // `bb terminal list` has no grouping to lean on, so name the machine here.
        title: defaultTitle(scope.label, scope.hostName),
      }),
      CREATE_TIMEOUT_MS,
      "terminals.create",
    );
    bb.log.info(`opened ${created.id} in ${created.initialCwd}`);
    return {
      terminalId: created.id,
      scopeKey: scope.key,
      label: scope.label,
      hostName: scope.hostName,
      cwd: created.initialCwd,
      status: created.status,
      exitCode: created.exitCode,
      shellTitle: null,
    };
  }

  bb.rpc.register(rpcContract, {
    async init() {
      const [snap, scopes, recentScopeKeys, values] = await Promise.all([
        serialize(snapshot),
        listScopes(),
        readRecent(),
        settings.get(),
      ]);
      const parsedFontSize = Number.parseInt(values.fontSize, 10);
      return {
        snapshot: snap,
        scopes,
        recentScopeKeys,
        prefs: {
          fontSize: Number.isFinite(parsedFontSize) ? parsedFontSize : 13,
          shortcutEnabled: values.shortcutEnabled,
        },
      };
    },

    async openTab({ scopeKey, cols, rows }) {
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
        });
        await bb.storage.kv.set(TABS_KEY, stored);
        await bb.storage.kv.set(ACTIVE_TAB_KEY, opened.terminalId);
        await rememberRecent(opened.scopeKey);
        await bumpRevision();
        lastKnownTabs.set(opened.terminalId, opened);
        rememberStatus(opened.terminalId, opened.status, opened.exitCode);
        return { snapshot: await snapshot(), opened };
      });
    },

    async closeTab({ terminalId }) {
      await requireOwnedTab(terminalId);
      // Best-effort, outside the mutex: waiting under it for a slow host to
      // confirm the close blocked every other handler for the full timeout.
      try {
        await withTimeout(
          bb.sdk.terminals.close({ terminalId, mode: "force" }),
          SDK_TIMEOUT_MS,
          "terminals.close",
        );
      } catch {
        // Already gone (or the host is slow to confirm); removing the tab
        // is still the right outcome.
      }
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
      // The rename round trip happens before taking the mutex; it touches no
      // plugin state, and a concurrent close simply makes it fail like a
      // dead session always could.
      const stored = await readStoredTabs();
      const entry = stored.find((tab) => tab.terminalId === terminalId);
      // Renaming a tab this window does not own would let a stale client
      // rename somebody else's session out from under them.
      if (entry === undefined) {
        return serialize(async () => ({ snapshot: await snapshot() }));
      }

      // Null means "go back to the name the tab was opened with", which is
      // what the tab strip falls back to showing.
      const scope = (await listScopes()).find(
        (item) => item.key === entry.scopeKey,
      );
      const restored =
        scope === undefined ? null : defaultTitle(scope.label, scope.hostName);
      const next = title ?? restored;
      if (next === null) {
        return serialize(async () => ({ snapshot: await snapshot() }));
      }

      try {
        await withTimeout(
          bb.sdk.terminals.rename({ terminalId, title: next }),
          SDK_TIMEOUT_MS,
          "terminals.rename",
        );
      } catch {
        // A name is not worth failing a turn over; the next snapshot still
        // carries whatever the session actually holds.
        return serialize(async () => ({ snapshot: await snapshot() }));
      }
      return serialize(async () => {
        const known = lastKnownTabs.get(terminalId);
        if (known !== undefined) {
          lastKnownTabs.set(terminalId, {
            ...known,
            shellTitle: meaningfulShellTitle(next, {
              label: known.label,
              defaultTitle: defaultTitle(known.label, known.hostName),
              cwd: known.cwd,
            }),
          });
        }
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

      const scope = await requireScope(found.scopeKey);
      try {
        await withTimeout(
          bb.sdk.terminals.close({ terminalId, mode: "force" }),
          SDK_TIMEOUT_MS,
          "terminals.close",
        );
      } catch {
        // Already dead — that is why we are restarting.
      }

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
        stored[index] = {
          terminalId: restarted.terminalId,
          scopeKey: restarted.scopeKey,
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

    async read({ terminalId, sinceSeq, replay }) {
      await requireOwnedTab(terminalId);
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
        if (output.chunks.length > 0) {
          // Bytes are flowing, so the shell is alive by definition.
          rememberStatus(terminalId, "running", null);
          return { ...output, status: null, exitCode: null };
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
          // The next snapshot must see this die and prune the tab.
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
        // The session was closed out from under us. Report it instead of
        // throwing so the window can offer a restart.
        rememberStatus(terminalId, "gone", null);
        lastVerifiedAt = 0;
        return {
          chunks: [],
          nextSeq: sinceSeq,
          truncated: false,
          status: "gone",
          exitCode: null,
        };
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

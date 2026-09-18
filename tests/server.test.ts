import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../server";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(settings: Record<string, boolean | string> = {}, beforeHostCall: () => void = () => {}) {
  const { projectEnvironmentVault, ...declaredSettings } = settings;
  const dataDir = await mkdtemp(join(tmpdir(), "floating-ghostty-test-"));
  const host = createFakePluginHost({
    pluginId: "floating-ghostty",
    dataDir,
    settings: declaredSettings,
    experimental_callHostRpc: async ({ method }) => {
      beforeHostCall();
      if (method === "prepareProjectEnvironment")
        return { path: "/private/tmp/floating-ghostty/environment.sh" };
      throw new Error(`Unexpected host method ${method}`);
    },
  });
  if (typeof projectEnvironmentVault === "string") {
    const secretsDirectory = join(
      host.bb.server.experimental_dataDir,
      "plugins",
      "floating-ghostty",
      "secrets",
    );
    await mkdir(secretsDirectory, { recursive: true });
    await writeFile(
      join(secretsDirectory, "projectEnvironmentVault"),
      projectEnvironmentVault,
      { mode: 0o600 },
    );
  }
  cleanups.push(() => host.harness.lifecycle.dispose());
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const sessions = new Map<string, Record<string, unknown>>();
  let next = 0;
  host.harness.inspection.sdk.stub("hosts.list", async () => [
    { id: "local", name: "Local", status: "connected" },
  ]);
  host.harness.inspection.sdk.stub("projects.list", async () => []);
  host.harness.inspection.sdk.stub("terminals.create", async () => {
    const session = {
      id: `term-${++next}`,
      initialCwd: "/tmp",
      status: "running",
      exitCode: null,
      title: "Home · Local",
    };
    sessions.set(session.id, session);
    return session;
  });
  host.harness.inspection.sdk.stub(
    "terminals.get",
    async ({ terminalId }: { terminalId: string }) => {
      const session = sessions.get(terminalId);
      if (!session) throw new Error("not found");
      return session;
    },
  );
  host.harness.inspection.sdk.stub(
    "terminals.close",
    async ({ terminalId }: { terminalId: string }) => {
      sessions.delete(terminalId);
      return {};
    },
  );
  host.harness.inspection.sdk.stub("terminals.input", async () => ({}));
  host.harness.inspection.sdk.stub("terminals.resize", async () => ({}));
  host.harness.inspection.sdk.stub("terminals.output", async () => ({
    chunks: [],
    nextSeq: 0,
    truncated: false,
  }));
  await plugin(host.bb);
  const call = host.harness.behavior.callRpc;
  const open = () =>
    call("openTab", { scopeKey: "home:local", cols: 80, rows: 24 }) as Promise<{
      opened: { terminalId: string };
      snapshot: { revision: number; tabs: unknown[] };
    }>;
  return { ...host, call, open, sessions };
}

describe("Floating Ghostty backend", () => {
  it("keeps the raw project environment vault out of plugin settings", async () => {
    const { harness } = await setup();
    expect(harness.registrations.settingsDescriptors).not.toHaveProperty(
      "projectEnvironmentVault",
    );
  });
  it("matches BB's native terminal font size", async () => {
    const { call } = await setup();
    expect(((await call("init", null)) as any).prefs.fontSize).toBe(12);
  });
  it("keeps both shells when tabs are opened concurrently", async () => {
    const { open, call, sessions } = await setup();
    await Promise.all([open(), open()]);
    const result = (await call("init", null)) as {
      snapshot: { tabs: unknown[] };
    };
    expect(result.snapshot.tabs).toHaveLength(2);
    expect(sessions.size).toBe(2);
  });
  it("reloads persisted tabs without creating replacement shells", async () => {
    const { open, call, harness, sessions } = await setup();
    await open();
    const reloaded = await harness.lifecycle.reload(plugin);
    cleanups.push(() => reloaded.harness.lifecycle.dispose());
    reloaded.harness.inspection.sdk.stub("hosts.list", async () => [
      { id: "local", name: "Local", status: "connected" },
    ]);
    reloaded.harness.inspection.sdk.stub("projects.list", async () => []);
    reloaded.harness.inspection.sdk.stub(
      "terminals.get",
      async ({ terminalId }: { terminalId: string }) =>
        sessions.get(terminalId),
    );
    const result = (await reloaded.harness.behavior.callRpc("init", null)) as {
      snapshot: { tabs: unknown[] };
    };
    expect(result.snapshot.tabs).toHaveLength(1);
    expect(harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(1);
  });
  it("only closes the requested owned shell", async () => {
    const { open, call, sessions } = await setup();
    const first = await open();
    const second = await open();
    await call("closeTab", { terminalId: first.opened.terminalId });
    expect([...sessions.keys()]).toEqual([second.opened.terminalId]);
  });
  it("rejects access to sessions owned by other plugins", async () => {
    const { call, harness } = await setup();
    for (const [method, input] of [
      ["closeTab", { terminalId: "someone-elses-shell" }],
      ["write", { terminalId: "someone-elses-shell", dataBase64: "Ym9v" }],
      ["resize", { terminalId: "someone-elses-shell", cols: 80, rows: 24 }],
      ["read", { terminalId: "someone-elses-shell", sinceSeq: 0 }],
    ] as const)
      await expect(call(method, input)).rejects.toThrow(/does not belong/);
    expect(harness.inspection.sdk.callsTo("terminals.close")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("terminals.input")).toHaveLength(0);
  });
  it("validates geometry and encoded input at the RPC boundary", async () => {
    const { call } = await setup();
    await expect(
      call("openTab", { scopeKey: "home:local", cols: 0, rows: 24 }),
    ).rejects.toThrow();
    await expect(
      call("write", { terminalId: "x", dataBase64: "not base64!" }),
    ).rejects.toThrow();
  });
  it("accepts a full 64 KiB input chunk after base64 encoding", async () => {
    const { open, call } = await setup();
    const { opened } = await open();
    await expect(
      call("write", {
        terminalId: opened.terminalId,
        dataBase64: Buffer.alloc(65536, 65).toString("base64"),
      }),
    ).resolves.toEqual({ ok: true });
  });
  it("persists project environments with conflict detection", async () => {
    const { call, harness } = await setup();
    await expect(
      call("saveProjectEnvironment", {
        projectId: "A",
        text: "TOKEN=secret",
        expectedRevision: 0,
      }),
    ).resolves.toEqual({ revision: 1, keyCount: 1 });
    await expect(
      call("getProjectEnvironment", { projectId: "A" }),
    ).resolves.toEqual({ text: "TOKEN=secret", revision: 1 });
    await expect(
      call("saveProjectEnvironment", {
        projectId: "A",
        text: "TOKEN=stale",
        expectedRevision: 0,
      }),
    ).rejects.toThrow(/another window/);
    await expect(
      call("saveProjectEnvironment", {
        projectId: "A",
        text: "",
        expectedRevision: 1,
      }),
    ).resolves.toEqual({ revision: 2, keyCount: 0 });
    await expect(
      call("saveProjectEnvironment", {
        projectId: "A",
        text: "TOKEN=stale-after-clear",
        expectedRevision: 1,
      }),
    ).rejects.toThrow(/another window/);
    const reloaded = await harness.lifecycle.reload(plugin);
    cleanups.push(() => reloaded.harness.lifecycle.dispose());
    await expect(
      reloaded.harness.behavior.callRpc("getProjectEnvironment", {
        projectId: "A",
      }),
    ).resolves.toEqual({ text: "", revision: 2 });
  });
  it("migrates the legacy secret vault into private plugin storage", async () => {
    const legacyVault = JSON.stringify({
      version: 1,
      projects: {
        A: {
          text: "TOKEN=legacy",
          revision: 4,
          updatedAt: "2026-09-13T08:00:00.000Z",
        },
      },
    });
    const { call, harness } = await setup({
      projectEnvironmentVault: legacyVault,
    });

    await expect(
      call("getProjectEnvironment", { projectId: "A" }),
    ).resolves.toEqual({ text: "TOKEN=legacy", revision: 4 });
    await call("saveProjectEnvironment", {
      projectId: "A",
      text: "TOKEN=migrated",
      expectedRevision: 4,
    });

    const reloaded = await harness.lifecycle.reload(plugin);
    cleanups.push(() => reloaded.harness.lifecycle.dispose());
    await expect(
      reloaded.harness.behavior.callRpc("getProjectEnvironment", {
        projectId: "A",
      }),
    ).resolves.toEqual({ text: "TOKEN=migrated", revision: 5 });
  });
  it("lists only projects with configured environments", async () => {
    const { call, harness } = await setup();
    harness.inspection.sdk.stub("projects.list", async () => [
      { id: "B", name: "Beta" },
      { id: "A", name: "Alpha" },
    ]);
    await call("saveProjectEnvironment", {
      projectId: "B",
      text: "TOKEN=secret\nREGION=local",
      expectedRevision: 0,
    });

    await expect(call("listProjectEnvironments", null)).resolves.toMatchObject({
      projects: [
        {
          id: "B",
          name: "Beta",
          configured: true,
          keyCount: 2,
        },
      ],
    });
    expect(harness.inspection.sdk.callsTo("projects.list").at(-1)?.[0]).toEqual({
      includePersonal: true,
    });
  });
  it("prepares project values on the target host without putting them in terminal metadata", async () => {
    const { call, harness } = await setup();
    harness.inspection.sdk.stub("projects.list", async () => [
      {
        id: "A",
        name: "Project A",
        sources: [{ hostId: "local", path: "/a", isDefault: true }],
      },
    ]);
    await call("saveProjectEnvironment", {
      projectId: "A",
      text: "TOKEN=super-secret",
      expectedRevision: 0,
    });
    await call("openTab", {
      scopeKey: "project:A",
      cols: 80,
      rows: 24,
    });
    expect(harness.experimental_hostRpcCalls).toHaveLength(1);
    expect(harness.experimental_hostRpcCalls[0]).toMatchObject({
      method: "prepareProjectEnvironment",
      hostId: "local",
      input: { entries: [{ key: "TOKEN", value: "super-secret" }] },
    });
    const create = harness.inspection.sdk.callsTo("terminals.create")[0]?.[0] as {
      start: { command: string };
    };
    expect(create.start.command).toContain(
      "/private/tmp/floating-ghostty/environment.sh",
    );
    expect(create.start.command).not.toContain("super-secret");
  });
  it("serves the exact pinned WASM behind token authentication", async () => {
    const { harness } = await setup();
    const response = await harness.behavior.fetchHttp(
      "GET",
      "/ghostty-vt.wasm",
    );
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect([
      ...new Uint8Array(await response.arrayBuffer()).slice(0, 4),
    ]).toEqual([0, 97, 115, 109]);
    expect(
      harness.registrations.httpRoutes.find(
        (route) => route.path === "/ghostty-vt.wasm",
      )?.auth,
    ).toBe("token");
  });
  it("uses public BB SDK imports only", async () => {
    const scan = await experimental_scanPublicSdkOnly(
      fileURLToPath(new URL("..", import.meta.url)),
      {
        allow: [
          /^@\/(?:components|lib)\//,
          /^@testing-library\/react$/,
          /^react(?:-dom)?(?:\/.*)?$/,
          /^@wterm\/(?:dom|ghostty)(?:\/css)?$/,
          /^@radix-ui\/react-[a-z-]+$/,
          /^@hugeicons\/(?:react|core-free-icons)$/,
          /^(?:sonner|vaul|cmdk|clsx|tailwind-merge|class-variance-authority|vitest\/config)$/,
        ],
      },
    );
    expect(scan.violations).toEqual([]);
    expect(scan.privateDependencies).toEqual([]);
  });
});

it("resolves the thread project and offers every project plus its current launch environment", async () => {
  const { call, harness } = await setup();
  harness.inspection.sdk.stub("projects.list", async () => [
    {
      id: "A",
      name: "Project A",
      sources: [{ hostId: "local", path: "/a", isDefault: true }],
    },
    {
      id: "B",
      name: "Project B",
      sources: [{ hostId: "local", path: "/b", isDefault: true }],
    },
  ]);
  harness.inspection.sdk.stub("threads.get", async () => ({
    projectId: "A",
    environmentId: "one",
  }));
  harness.inspection.sdk.stub("threads.list", async () => [
    { environmentId: "one" },
    { environmentId: "two" },
    { environmentId: "one" },
  ]);
  harness.inspection.sdk.stub(
    "environments.get",
    async ({ environmentId }: { environmentId: string }) => ({
      id: environmentId,
      projectId: "A",
      name: environmentId,
      path: `/a/${environmentId}`,
      hostId: "local",
      status: "ready",
    }),
  );
  const result = (await call("resolveContext", {
    projectId: "B",
    threadId: "thread-one",
  })) as {
    context: { projectId: string; environmentId: string };
    scopes: { key: string }[];
  };
  expect(result.context).toMatchObject({
    projectId: "A",
    environmentId: "one",
  });
  expect(result.scopes.map((scope) => scope.key)).toEqual([
    "project:A",
    "project:B",
    "home:local",
    "worktree:A:one",
  ]);
  expect(harness.inspection.sdk.callsTo("environments.get")).toHaveLength(1);
  const global = (await call("resolveContext", {
    projectId: null,
    threadId: null,
  })) as { scopes: { key: string }[] };
  expect(global.scopes.map((scope) => scope.key)).toEqual([
    "project:A",
    "project:B",
    "home:local",
  ]);
});

it("creates a worktree terminal through its environment identity and rejects a forged project owner", async () => {
  const { call, harness } = await setup();
  harness.inspection.sdk.stub("environments.get", async () => ({
    id: "one",
    projectId: "A",
    name: "feature",
    path: "/a/feature",
    hostId: "local",
    status: "ready",
  }));
  await call("openTab", { scopeKey: "worktree:A:one", cols: 80, rows: 24 });
  expect(
    harness.inspection.sdk.callsTo("terminals.create")[0]?.[0],
  ).toMatchObject({ scope: { kind: "environment", environmentId: "one" } });
  await expect(
    call("openTab", { scopeKey: "worktree:B:one", cols: 80, rows: 24 }),
  ).rejects.toThrow(/no longer available/);
});

it("never falls back to a project shell when the current environment cannot be resolved", async () => {
  const { call, harness } = await setup();
  harness.inspection.sdk.stub("projects.list", async () => [
    {
      id: "A",
      name: "A",
      sources: [{ hostId: "local", path: "/a", isDefault: true }],
    },
  ]);
  harness.inspection.sdk.stub("threads.get", async () => ({
    projectId: "A",
    environmentId: "missing",
  }));
  harness.inspection.sdk.stub("threads.list", async () => []);
  harness.inspection.sdk.stub("environments.get", async () => {
    throw new Error("Disconnected");
  });
  await expect(
    call("resolveContext", { projectId: "A", threadId: "thread" }),
  ).rejects.toThrow(/current worktree is unavailable/);
  expect(harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(0);
});

it("keeps native shortcut override off by default and follows BB's configured shortcut when opted in", async () => {
  const disabled = await setup();
  expect(await disabled.call("terminalShortcuts", null)).toEqual([]);
  expect(disabled.harness.inspection.sdk.callsTo("system.config")).toHaveLength(
    0,
  );
  const enabled = await setup({ overrideNativeShortcut: true });
  const custom = {
    key: "j",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  };
  enabled.harness.inspection.sdk.stub("system.config", async () => ({
    keybindingOverrides: [{ command: "terminal.open", shortcut: custom }],
    keybindings: [],
  }));
  expect(await enabled.call("terminalShortcuts", null)).toEqual([custom]);
  enabled.harness.inspection.sdk.stub("system.config", async () => ({
    keybindingOverrides: [{ command: "terminal.open", shortcut: null }],
    keybindings: [],
  }));
  expect(await enabled.call("terminalShortcuts", null)).toEqual([]);
});

it("binds shells to their worktree across reload and restart", async () => {
  const { call, harness, sessions } = await setup();
  const environment = {
    id: "one",
    projectId: "A",
    name: "feature",
    path: "/a/feature",
    hostId: "local",
    status: "ready",
  };
  harness.inspection.sdk.stub("environments.get", async () => environment);
  const { opened } = (await call("openTab", {
    scopeKey: "worktree:A:one",
    cols: 80,
    rows: 24,
  })) as any;
  expect(opened.scopeKey).toBe("worktree:A:one");
  expect(harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(1);
  expect(harness.inspection.sdk.callsTo("terminals.close")).toHaveLength(0);
  const reloaded = await harness.lifecycle.reload(plugin);
  cleanups.push(() => reloaded.harness.lifecycle.dispose());
  const sdk = reloaded.harness.inspection.sdk;
  sdk.stub("hosts.list", async () => [
    { id: "local", name: "Local", status: "connected" },
  ]);
  sdk.stub("projects.list", async () => []);
  sdk.stub("environments.get", async () => environment);
  sdk.stub("terminals.get", async ({ terminalId }: { terminalId: string }) =>
    sessions.get(terminalId),
  );
  sdk.stub("terminals.close", async () => ({}));
  sdk.stub("terminals.create", async () => {
    const session = { ...sessions.get(opened.terminalId), id: "restarted" };
    sessions.set("restarted", session);
    return session;
  });
  const afterReload = (await reloaded.harness.behavior.callRpc(
    "init",
    null,
  )) as any;
  expect(afterReload.snapshot.tabs[0]).toMatchObject({
    terminalId: opened.terminalId,
    scopeKey: "worktree:A:one",
    cwd: opened.cwd,
    hostName: "Local",
  });
  const { restarted } = (await reloaded.harness.behavior.callRpc("restartTab", {
    terminalId: opened.terminalId,
    cols: 80,
    rows: 24,
  })) as any;
  expect(restarted.scopeKey).toBe("worktree:A:one");
  expect(sdk.callsTo("terminals.create")[0]?.[0]).toMatchObject({
    scope: { kind: "environment", environmentId: "one" },
  });
});

it("verifies exit after output becomes unavailable without treating a transport failure as exit", async () => {
  const { open, call, harness, sessions } = await setup();
  const { opened } = await open();
  harness.inspection.sdk.stub("terminals.output", async () => {
    throw new Error("output unavailable");
  });
  await expect(
    call("read", { terminalId: opened.terminalId, sinceSeq: 7 }),
  ).rejects.toThrow("output unavailable");
  sessions.get(opened.terminalId)!.status = "exited";
  sessions.get(opened.terminalId)!.exitCode = 3;
  await expect(
    call("read", { terminalId: opened.terminalId, sinceSeq: 7 }),
  ).resolves.toMatchObject({
    chunks: [],
    nextSeq: 7,
    status: "exited",
    exitCode: 3,
  });
  expect(((await call("init", null)) as any).snapshot.tabs).toHaveLength(1);
});

it("retains exited and disconnected shells until explicitly closed", async () => {
  const { open, call, harness, sessions } = await setup();
  const first = await open();
  const second = await open();
  sessions.get(first.opened.terminalId)!.status = "exited";
  harness.inspection.sdk.stub(
    "terminals.get",
    async ({ terminalId }: { terminalId: string }) => {
      if (terminalId === second.opened.terminalId)
        throw new Error("host disconnected");
      return sessions.get(terminalId);
    },
  );
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
  const result = (await call("init", null)) as any;
  expect(result.snapshot.tabs.map((tab: any) => tab.terminalId)).toEqual([
    first.opened.terminalId,
    second.opened.terminalId,
  ]);
  expect(result.snapshot.tabs[0].status).toBe("exited");
  expect(((await call("init", null)) as any).snapshot.tabs).toHaveLength(2);
  await expect(call("setActiveTab", { terminalId: first.opened.terminalId })).resolves.toBeDefined();
});

it("separates pinned names from automatic shell/command titles and persists both across reload", async () => {
  const { call, open, harness, sessions } = await setup();
  const { opened } = await open();
  const id = opened.terminalId;
  await call("renameTab", { terminalId: id, title: "bb-fg:shell:zsh" });
  await call("setTabName", { terminalId: id, name: "Dev server" });
  let result = (await call("renameTab", {
    terminalId: id,
    title: "bb-fg:command:npm",
  })) as any;
  expect(result.snapshot.tabs[0]).toMatchObject({
    label: "zsh",
    shellTitle: "npm",
    customTitle: "Dev server",
  });
  const reloaded = await harness.lifecycle.reload(plugin);
  cleanups.push(() => reloaded.harness.lifecycle.dispose());
  reloaded.harness.inspection.sdk.stub("hosts.list", async () => [
    { id: "local", name: "Local", status: "connected" },
  ]);
  reloaded.harness.inspection.sdk.stub("projects.list", async () => []);
  reloaded.harness.inspection.sdk.stub("terminals.get", async () =>
    sessions.get(id),
  );
  result = (await reloaded.harness.behavior.callRpc("init", null)) as any;
  expect(result.snapshot.tabs[0]).toMatchObject({
    label: "zsh",
    shellTitle: "npm",
    customTitle: "Dev server",
  });
  result = (await reloaded.harness.behavior.callRpc("setTabName", {
    terminalId: id,
    name: null,
  })) as any;
  expect(result.snapshot.tabs[0]).toMatchObject({
    label: "zsh",
    shellTitle: "npm",
    customTitle: null,
  });
  result = (await reloaded.harness.behavior.callRpc("renameTab", {
    terminalId: id,
    title: "bb-fg:shell:zsh",
  })) as any;
  expect(result.snapshot.tabs[0]).toMatchObject({
    label: "zsh",
    shellTitle: null,
    customTitle: null,
  });
  await expect(
    call("setTabName", { terminalId: "foreign", name: "Name" }),
  ).rejects.toThrow();
});

it.each([false, true])("recovers worktree ownership and restart destination (project-grouped: %s)", async (projectGrouped) => {
  const { call, open, harness, bb } = await setup();
  const { opened } = await open();
  const stored = (await bb.storage.kv.get("open-tabs")) as any[];
  stored[0].scopeKey = projectGrouped ? "project:A" : "worktree:A:one";
  if (projectGrouped) stored[0].launchScopeKey = "worktree:A:one";
  else delete stored[0].launchScopeKey;
  await bb.storage.kv.set("open-tabs", stored);
  harness.inspection.sdk.stub("environments.get", async () => ({
    id: "one",
    projectId: "A",
    name: "feature",
    path: "/a/feature",
    hostId: "local",
    status: "ready",
  }));
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
  const result = (await call("init", null)) as any;
  expect(result.snapshot.tabs[0].scopeKey).toBe("worktree:A:one");
  expect(harness.inspection.sdk.callsTo("terminals.close")).toHaveLength(0);
  const { restarted } = (await call("restartTab", {
    terminalId: opened.terminalId,
    cols: 80,
    rows: 24,
  })) as any;
  expect(restarted.scopeKey).toBe("worktree:A:one");
  expect(
    harness.inspection.sdk.callsTo("terminals.create")[1]?.[0],
  ).toMatchObject({
    scope: { kind: "environment", environmentId: "one" },
  });
});

it("retains a live terminal when deletion or restart fails", async () => {
  const { call, open, harness, sessions } = await setup();
  const { opened } = await open();
  harness.inspection.sdk.stub("terminals.close", async () => {
    throw new Error("Host unavailable");
  });
  harness.inspection.sdk.stub("terminals.list", async () => ({
    sessions: [...sessions.values()],
  }));
  await expect(
    call("closeTab", { terminalId: opened.terminalId }),
  ).rejects.toThrow("Host unavailable");
  await expect(
    call("restartTab", { terminalId: opened.terminalId, cols: 80, rows: 24 }),
  ).rejects.toThrow("Host unavailable");
  expect(((await call("init", null)) as any).snapshot.tabs).toHaveLength(1);
  expect(harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(1);
});

it("retains metadata on transient inspection errors and only deletes after authoritative absence", async () => {
  const { call, open, harness, sessions } = await setup();
  const { opened } = await open();
  await call("setTabName", { terminalId: opened.terminalId, name: "Keep me" });
  harness.inspection.sdk.stub("terminals.get", async () => {
    throw new Error("Connection reset");
  });
  harness.inspection.sdk.stub("terminals.list", async () => {
    throw new Error("Connection reset");
  });
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 60000);
  expect(((await call("init", null)) as any).snapshot.tabs[0]).toMatchObject({
    terminalId: opened.terminalId,
    customTitle: "Keep me",
  });
  sessions.delete(opened.terminalId);
  harness.inspection.sdk.stub("terminals.close", async () => {
    throw new Error("Missing");
  });
  harness.inspection.sdk.stub("terminals.list", async () => ({ sessions: [] }));
  expect(
    ((await call("closeTab", { terminalId: opened.terminalId })) as any)
      .snapshot.tabs,
  ).toEqual([]);
});

it("updates the displayed working directory without moving scope ownership or the restart location", async () => {
  const { call, open, harness } = await setup();
  const { opened } = await open();
  const result = (await call("setTabCwd", {
    terminalId: opened.terminalId,
    cwd: "/tmp/changed",
  })) as any;
  expect(result.snapshot.tabs[0]).toMatchObject({
    cwd: "/tmp/changed",
    scopeKey: "home:local",
  });
  const { restarted } = (await call("restartTab", {
    terminalId: opened.terminalId,
    cols: 80,
    rows: 24,
  })) as any;
  expect(restarted.cwd).not.toBe("/tmp/changed");
  expect(
    harness.inspection.sdk.callsTo("terminals.create")[1]?.[0],
  ).toMatchObject({ scope: { kind: "host_path", cwd: null } });
  await expect(
    call("setTabCwd", { terminalId: restarted.terminalId, cwd: "relative" }),
  ).rejects.toThrow();
});

it("answers only a new terminal's initial replay queries", async () => {
  const { call, open, harness } = await setup();
  const { opened } = await open();
  harness.inspection.sdk.stub("terminals.output", async () => ({
    chunks: [{ seq: 1, dataBase64: Buffer.from("\x1b[6n").toString("base64") }],
    nextSeq: 1, truncated: false,
  }));
  const input = { terminalId: opened.terminalId, sinceSeq: 0, replay: true, attach: true };
  expect(await call("read", { ...input, attach: false })).toMatchObject({ respondToQueries: false });
  expect(await call("read", input)).toMatchObject({ respondToQueries: true });
  expect(await call("read", input)).toMatchObject({ respondToQueries: false });
});

it("pushes saved values to existing project hosts, including shells created before any values", async () => {
  const { call, harness } = await setup();
  harness.inspection.sdk.stub("projects.list", async () => [{
    id: "A", name: "Project A", sources: [{ hostId: "local", path: "/a", isDefault: true }],
  }]);
  await call("openTab", { scopeKey: "project:A", cols: 80, rows: 24 });
  expect(harness.experimental_hostRpcCalls.at(-1)).toMatchObject({
    input: { projectId: "A", entries: [] },
  });
  await call("saveProjectEnvironment", { projectId: "A", text: "NEW=value", expectedRevision: 0 });
  expect(harness.experimental_hostRpcCalls.at(-1)).toMatchObject({
    hostId: "local", input: { projectId: "A", entries: [{ key: "NEW", value: "value" }] },
  });
  expect(harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(1);
  expect(harness.inspection.sdk.callsTo("terminals.input")).toHaveLength(0);
});


it("retries saved environment values after a host reconnects without injecting terminal input", async () => {
  let disconnected = false;
  const { call, harness } = await setup({}, () => {
    if (disconnected) throw new Error("host disconnected");
  });
  harness.inspection.sdk.stub("projects.list", async () => [{
    id: "A", name: "Project A", sources: [{ hostId: "local", path: "/a", isDefault: true }],
  }]);
  const { opened } = await call("openTab", { scopeKey: "project:A", cols: 80, rows: 24 }) as any;
  disconnected = true;
  expect(await call("saveProjectEnvironment", { projectId: "A", text: "RECONNECT=latest", expectedRevision: 0 })).toMatchObject({ pendingHosts: 1 });
  disconnected = false;
  const before = harness.experimental_hostRpcCalls.length;
  await call("read", { terminalId: opened.terminalId, sinceSeq: 0 });
  await vi.waitFor(() => expect(harness.experimental_hostRpcCalls.length).toBeGreaterThan(before));
  expect(harness.experimental_hostRpcCalls.at(-1)).toMatchObject({
    input: { projectId: "A", entries: [{ key: "RECONNECT", value: "latest" }] },
  });
  expect(harness.inspection.sdk.callsTo("terminals.input")).toHaveLength(0);
});

it("isolates worktree variables, host refreshes, and revisions from the project", async () => {
  const { call, harness, sessions } = await setup();
  harness.inspection.sdk.stub("environments.get", async ({ environmentId }: { environmentId: string }) => ({
    id: environmentId, projectId: "A", name: environmentId,
    path: `/a/${environmentId}`, hostId: "local", status: "ready",
  }));
  await call("saveProjectEnvironment", { projectId: "A", text: "TOKEN=project", expectedRevision: 0 });
  expect(await call("getProjectEnvironment", { projectId: "A", environmentId: "one" }))
    .toEqual({ text: "", revision: 0 });
  await call("saveProjectEnvironment", { projectId: "A", environmentId: "one", text: "TOKEN=one", expectedRevision: 0 });
  const opened = await call("openTab", { scopeKey: "worktree:A:one", cols: 80, rows: 24 }) as any;
  await call("openTab", { scopeKey: "worktree:A:two", cols: 80, rows: 24 });
  expect(opened.opened.launchScopeKey).toBe("worktree:A:one");
  const prepared = harness.inspection.experimental_hostRpcCalls.filter((call) => call.method === "prepareProjectEnvironment");
  expect(prepared.slice(-2).map((call) => call.input)).toEqual([
    { projectId: JSON.stringify(["A", "one"]), entries: [{ key: "TOKEN", value: "one" }] },
    { projectId: JSON.stringify(["A", "two"]), entries: [] },
  ]);
  const before = prepared.length;
  await call("saveProjectEnvironment", { projectId: "A", text: "TOKEN=updated", expectedRevision: 1 });
  expect(harness.inspection.experimental_hostRpcCalls.filter((call) => call.method === "prepareProjectEnvironment")).toHaveLength(before);
  await expect(call("saveProjectEnvironment", { projectId: "A", environmentId: "one", text: "TOKEN=stale", expectedRevision: 0 })).rejects.toThrow(/changed/);
  await expect(call("getProjectEnvironment", { projectId: "B", environmentId: "one" })).rejects.toThrow(/no longer available/);
  const reloaded = await harness.lifecycle.reload(plugin);
  cleanups.push(() => reloaded.harness.lifecycle.dispose());
  const sdk = reloaded.harness.inspection.sdk;
  sdk.stub("hosts.list", async () => [{ id: "local", name: "Local", status: "connected" }]);
  sdk.stub("projects.list", async () => []);
  sdk.stub("environments.get", async ({ environmentId }: { environmentId: string }) => ({
    id: environmentId, projectId: "A", name: environmentId,
    path: `/a/${environmentId}`, hostId: "local", status: "ready",
  }));
  sdk.stub("terminals.get", async ({ terminalId }: { terminalId: string }) => sessions.get(terminalId));
  const reloadedCall = reloaded.harness.behavior.callRpc;
  expect(await reloadedCall("getProjectEnvironment", { projectId: "A", environmentId: "one" })).toEqual({ text: "TOKEN=one", revision: 1 });
  const snapshot = await reloadedCall("init", null) as any;
  expect(snapshot.snapshot.tabs.find((tab: any) => tab.terminalId === opened.opened.terminalId).launchScopeKey).toBe("worktree:A:one");
});

it("lists empty worktrees as copy destinations and keeps configured worktrees discoverable", async () => {
  const { call, harness } = await setup();
  harness.inspection.sdk.stub("projects.list", async () => [
    { id: "A", name: "Alpha", sources: [], threads: [{ environmentId: "one" }] },
    { id: "B", name: "Beta", sources: [], threads: [] },
  ]);
  harness.inspection.sdk.stub("environments.get", async ({ environmentId }: { environmentId: string }) => ({
    id: environmentId, projectId: "A", name: environmentId,
    path: `/a/${environmentId}`, hostId: "local", status: "ready",
  }));
  await call("saveProjectEnvironment", { projectId: "A", environmentId: "saved", text: "TOKEN=saved", expectedRevision: 0 });
  const result = await call("listProjectEnvironments", { includeUnconfigured: true }) as any;
  expect(result.projects.map(({ projectId, environmentId, keyCount }: any) => ({ projectId, environmentId, keyCount }))).toEqual([
    { projectId: "A", environmentId: undefined, keyCount: 0 },
    { projectId: "A", environmentId: "one", keyCount: 0 },
    { projectId: "A", environmentId: "saved", keyCount: 1 },
    { projectId: "B", environmentId: undefined, keyCount: 0 },
  ]);
  expect(JSON.stringify(result)).not.toContain("TOKEN=saved");
});

it("reuses an existing worktree shell and coalesces simultaneous automatic opens", async () => {
  const { call, harness } = await setup();
  harness.inspection.sdk.stub("environments.get", async ({ environmentId }: { environmentId: string }) => ({
    id: environmentId, projectId: "A", name: environmentId,
    path: `/a/${environmentId}`, hostId: "local", status: "ready",
  }));
  const input = { scopeKey: "worktree:A:one", reuseExisting: true, cols: 80, rows: 24 };
  const results = await Promise.all([call("openTab", input), call("openTab", input)]) as any[];
  expect(results[0].opened.terminalId).toBe(results[1].opened.terminalId);
  expect((await call("openTab", input) as any).opened.terminalId).toBe(results[0].opened.terminalId);
  expect(harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(1);
  const sibling = await call("openTab", { ...input, scopeKey: "worktree:A:two" }) as any;
  expect(sibling.opened.terminalId).not.toBe(results[0].opened.terminalId);
  await call("openTab", { ...input, reuseExisting: false });
  expect(harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(3);
});

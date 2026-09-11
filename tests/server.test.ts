import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";
import plugin from "../server";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(settings: Record<string, boolean> = {}) {
  const host = createFakePluginHost({ pluginId: "floating-ghostty", settings });
  cleanups.push(() => host.harness.lifecycle.dispose());
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

it("resolves context from the thread and offers only Global plus its project and worktrees", async () => {
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
    "home:local",
    "worktree:A:one",
    "worktree:A:two",
  ]);
  expect(harness.inspection.sdk.callsTo("environments.get")).toHaveLength(2);
  const global = (await call("resolveContext", {
    projectId: null,
    threadId: null,
  })) as { scopes: { key: string }[] };
  expect(global.scopes.map((scope) => scope.key)).toEqual(["home:local"]);
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

it("promotes ownership without replacing the process and preserves its launch context across reload and restart", async () => {
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
  const before = ((await call("init", null)) as any).snapshot.tabs[0];
  const project = (await call("promoteTab", {
    terminalId: opened.terminalId,
    target: "project",
  })) as any;
  expect(project.snapshot.tabs[0]).toEqual({
    ...before,
    scopeKey: "project:A",
  });
  const global = (await call("promoteTab", {
    terminalId: opened.terminalId,
    target: "global",
  })) as any;
  expect(global.snapshot.tabs[0]).toEqual({
    ...before,
    scopeKey: "home:local",
  });
  expect(harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(1);
  expect(harness.inspection.sdk.callsTo("terminals.close")).toHaveLength(0);
  await expect(
    call("promoteTab", { terminalId: opened.terminalId, target: "project" }),
  ).rejects.toThrow(/cannot be promoted/);
  await expect(
    call("promoteTab", { terminalId: "foreign", target: "global" }),
  ).rejects.toThrow(/does not belong/);
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
    scopeKey: "home:local",
    cwd: opened.cwd,
    hostName: "Local",
  });
  const { restarted } = (await reloaded.harness.behavior.callRpc("restartTab", {
    terminalId: opened.terminalId,
    cols: 80,
    rows: 24,
  })) as any;
  expect(restarted.scopeKey).toBe("home:local");
  expect(sdk.callsTo("terminals.create")[0]?.[0]).toMatchObject({
    scope: { kind: "environment", environmentId: "one" },
  });
});

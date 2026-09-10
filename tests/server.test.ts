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
async function setup() {
  const host = createFakePluginHost({ pluginId: "floating-ghostty" });
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

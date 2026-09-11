// Creates temporary shells in the selected BB host's home and closes only those
// shells in finally. Run against a BB instance with Floating Ghostty installed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { GhosttyCore } from "@wterm/ghostty";

const base = process.env.BB_SERVER_URL ?? "http://127.0.0.1:38886";
const plugin = `${base}/api/v1/plugins/floating-ghostty`;
async function rpc(method, input) {
  const response = await fetch(`${plugin}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new Error(`${method}: ${result.error?.message ?? response.status}`);
  return result.result;
}
const owned = new Set();
let core;
let previousActive;
try {
  const initial = await rpc("init", null);
  previousActive = initial.snapshot.activeTabId;
  const scope = initial.scopes.find(
    (scope) =>
      scope.online &&
      scope.kind === "home" &&
      (!process.env.BB_SMOKE_HOST_ID ||
        scope.hostId === process.env.BB_SMOKE_HOST_ID),
  );
  assert(scope, "No connected home directory available");
  // Exercise the real context adapter and environment-scoped PTY creation too.
  const global = await rpc("resolveContext", {
    projectId: null,
    threadId: null,
  });
  assert(global.scopes.every((scope) => scope.kind === "home"));
  if (!initial.prefs.overrideNativeShortcut) {
    assert.deepEqual(await rpc("terminalShortcuts", null), []);
  }
  if (process.env.BB_THREAD_ID) {
    const resolved = await rpc("resolveContext", {
      projectId: process.env.BB_PROJECT_ID ?? null,
      threadId: process.env.BB_THREAD_ID,
    });
    const current = resolved.scopes.find(
      (scope) =>
        scope.key ===
        `worktree:${resolved.context.projectId}:${resolved.context.environmentId}`,
    );
    if (current?.online) {
      const worktree = await rpc("openTab", {
        scopeKey: current.key,
        cols: 80,
        rows: 24,
      });
      owned.add(worktree.opened.terminalId);
      assert.equal(
        worktree.opened.cwd,
        current.cwd,
        "Worktree terminal started in the wrong checkout",
      );
      assert.equal(worktree.opened.scopeKey, current.key);
      const promoted = await rpc("promoteTab", {
        terminalId: worktree.opened.terminalId,
        target: "global",
      });
      const promotedTab = promoted.snapshot.tabs.find(
        (tab) => tab.terminalId === worktree.opened.terminalId,
      );
      assert.equal(promotedTab.scopeKey, `home:${current.hostId}`);
      assert.equal(promotedTab.cwd, worktree.opened.cwd);
      const { restarted } = await rpc("restartTab", {
        terminalId: worktree.opened.terminalId,
        cols: 80,
        rows: 24,
      });
      owned.delete(worktree.opened.terminalId);
      owned.add(restarted.terminalId);
      assert.equal(restarted.scopeKey, promotedTab.scopeKey);
      assert.equal(restarted.cwd, current.cwd);
      console.log(
        "PASS: Global visibility, opt-in shortcut default, current worktree launch, Global promotion, and original restart directory",
      );
    }
  }
  const tokenResponse = await fetch(`${plugin}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert(tokenResponse.ok);
  const { token } = await tokenResponse.json();
  const wasm = await fetch(`${plugin}/http/ghostty-vt.wasm`, {
    headers: { "x-bb-plugin-token": token },
  });
  assert(wasm.ok);
  const bytes = Buffer.from(await wasm.arrayBuffer());
  const installed = await readFile(
    createRequire(import.meta.url).resolve("@wterm/ghostty/ghostty-vt.wasm"),
  );
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(
    hash(bytes),
    hash(installed),
    "Served WASM does not match the pinned engine",
  );
  core = await GhosttyCore.load({
    wasmPath: `data:application/wasm;base64,${bytes.toString("base64")}`,
  });
  core.init(100, 32);
  const { opened } = await rpc("openTab", {
    scopeKey: scope.key,
    cols: 100,
    rows: 32,
  });
  owned.add(opened.terminalId);
  await rpc("resize", { terminalId: opened.terminalId, cols: 100, rows: 32 });
  await rpc("write", {
    terminalId: opened.terminalId,
    dataBase64: Buffer.from("printf 'FG_%s_%s\\n' LIVE OK\r").toString(
      "base64",
    ),
  });
  let seq = 0;
  let found = false;
  for (let attempt = 0; attempt < 50 && !found; attempt++) {
    const output = await rpc("read", {
      terminalId: opened.terminalId,
      sinceSeq: seq,
    });
    seq = output.nextSeq;
    for (const chunk of output.chunks)
      core.writeRaw(Buffer.from(chunk.dataBase64, "base64"));
    let screen = "";
    for (let row = 0; row < core.getRows(); row++) {
      for (let col = 0; col < core.getCols(); col++)
        screen += String.fromCodePoint(core.getCell(row, col).char || 32);
      screen += "\n";
    }
    found = screen.includes("FG_LIVE_OK");
    if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(found, "Shell output did not reach the real Ghostty cell grid");
  const reopened = await rpc("init", null);
  assert(
    reopened.snapshot.tabs.some((tab) => tab.terminalId === opened.terminalId),
  );
  const replay = await rpc("read", {
    terminalId: opened.terminalId,
    sinceSeq: 0,
    replay: true,
  });
  assert(replay.chunks.length > 0);
  const { restarted } = await rpc("restartTab", {
    terminalId: opened.terminalId,
    cols: 100,
    rows: 32,
  });
  owned.delete(opened.terminalId);
  owned.add(restarted.terminalId);
  assert.notEqual(restarted.terminalId, opened.terminalId);
  console.log(
    "PASS: authenticated WASM, real shell input/output, Ghostty rendering, resize, tab persistence, replay, restart",
  );
} finally {
  core?.dispose();
  const cleanup = await Promise.allSettled(
    [...owned].map((terminalId) => rpc("closeTab", { terminalId })),
  );
  if (previousActive)
    await rpc("setActiveTab", { terminalId: previousActive }).catch(() => {});
  if (cleanup.some((result) => result.status === "rejected"))
    throw new Error("Smoke-test shell cleanup failed");
  console.log("PASS: temporary shells cleaned up");
}

import { afterEach, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentRefreshScripts } from "../lib/environment-files";
import hostEntry from "../host";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it("updates private environment files at a stable project path", async () => {
  const root = await mkdtemp(join(tmpdir(), "fg-host-test-"));
  directories.push(root);
  const harness = experimental_createHostEntryHarness(hostEntry, {
    experimental_paths: {
      dataDir: join(root, "data"),
      tempDir: join(root, "temp"),
    },
  });
  try {
    const result = await harness.experimental_call(
      "prepareProjectEnvironment",
      {
        projectId: "A",
        entries: [
          { key: "TOKEN", value: "secret value" },
          { key: "QUOTED", value: "it's safe" },
        ],
      },
    );
    const updated = await harness.experimental_call("prepareProjectEnvironment", {
      projectId: "A", entries: [{ key: "NEW", value: "updated" }],
    });
    expect(updated.path).toBe(result.path);
    const scripts = environmentRefreshScripts([{ key: "NEW", value: "updated" }]);
    expect(await readFile(result.path, "utf8")).toBe(scripts.sh);
    expect(await readFile(`${result.path}.fish`, "utf8")).toBe(scripts.fish);
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  } finally {
    await harness.experimental_dispose();
  }
});

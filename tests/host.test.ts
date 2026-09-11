import { afterEach, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import hostEntry from "../host";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it("writes a private one-use environment file on the terminal host", async () => {
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
        entries: [
          { key: "TOKEN", value: "secret value" },
          { key: "QUOTED", value: "it's safe" },
        ],
      },
    );
    expect(await readFile(result.path, "utf8")).toBe(
      "export TOKEN='secret value'\nexport QUOTED='it'\"'\"'s safe'\n",
    );
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  } finally {
    await harness.experimental_dispose();
  }
});

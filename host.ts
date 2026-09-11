import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./lib/host-contract";
import { environmentExportScript } from "./lib/project-environment";

const CLEANUP_AFTER_MS = 60_000;

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async prepareProjectEnvironment({ entries }, context) {
      if (context.signal.aborted) throw context.signal.reason;
      await mkdir(context.experimental_paths.tempDir, { recursive: true, mode: 0o700 });
      const directory = await mkdtemp(
        join(context.experimental_paths.tempDir, "project-environment-"),
      );
      const path = join(directory, "environment.sh");
      try {
        await writeFile(path, environmentExportScript(entries), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      const cleanup = setTimeout(() => {
        void rm(directory, { recursive: true, force: true });
      }, CLEANUP_AFTER_MS);
      cleanup.unref();
      return { path };
    },
  },
});

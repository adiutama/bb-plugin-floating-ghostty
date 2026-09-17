import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./lib/host-contract";
import { createHash } from "node:crypto";
import { environmentRefreshScripts } from "./lib/environment-files";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async prepareProjectEnvironment({ projectId, entries }, context) {
      if (context.signal.aborted) throw context.signal.reason;
      const root = join(context.experimental_paths.dataDir, "project-environments");
      await mkdir(root, { recursive: true, mode: 0o700 });
      const id = createHash("sha256").update(projectId).digest("hex");
      const path = join(root, `${id}.sh`);
      const staging = await mkdtemp(join(root, ".update-"));
      const scripts = environmentRefreshScripts(entries);
      try {
        for (const shell of ["sh", "fish"] as const) {
          const temporary = join(staging, shell);
          await writeFile(temporary, scripts[shell], { encoding: "utf8", mode: 0o600 });
          await rename(temporary, shell === "sh" ? path : `${path}.fish`);
        }
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      return { path };
    },
  },
});

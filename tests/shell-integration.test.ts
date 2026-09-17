import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { environmentRefreshScripts } from "../lib/environment-files";
import { shellStartCommand } from "../lib/shell-integration";

for (const shell of ["zsh", "bash", "fish"]) {
  const executable = ["/bin", "/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"]
    .map((directory) => join(directory, shell))
    .find(existsSync);
  it.skipIf(!executable)(
    `${shell} reports its idle shell and running command, refreshes project values without restarting, then removes private startup files`,
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "fg-shell-test-"));
      try {
        await writeFile(
          join(directory, ".zshrc"),
          "export BB_FG_TEST_CONFIG=loaded\n",
        );
        const environmentPath = join(directory, "project-environment.sh");
        const scripts = environmentRefreshScripts([{ key: "BB_FG_TEST_CONFIG", value: "injected" }]);
        await writeFile(environmentPath, scripts.sh, { mode: 0o600 });
        await writeFile(`${environmentPath}.fish`, scripts.fish, { mode: 0o600 });
        const command = shellStartCommand(environmentPath);
        const needsTty = shell === "fish";
        // Node's "pipe" is a socket on macOS; script requires a real pipe or tty.
        const child = spawn(
          needsTty ? "/bin/sh" : executable!,
          needsTty
            ? process.platform === "darwin"
              ? [
                  "-c",
                  'cat | /usr/bin/script -q /dev/null "$2" -lc "$1"',
                  "fg-shell-test",
                  command,
                  executable!,
                ]
              : [
                  "-c",
                  'cat | /usr/bin/script -q -c "$1" /dev/null',
                  "fg-shell-test",
                  command,
                ]
            : ["-lc", command],
          {
            env: {
              ...process.env,
              SHELL: executable!,
              ZDOTDIR: directory,
              TMPDIR: directory,
              TERM: "xterm-256color",
              XDG_CONFIG_HOME: directory,
              XDG_DATA_HOME: directory,
            },
            stdio: ["pipe", "pipe", "pipe"],
            detached: needsTty,
          },
        );
        let output = "";
        let sentCommands = false;
        let stage = 0;
        const commands =
          "sleep 0.01\nprintf 'config=%s\\n' \"$BB_FG_TEST_CONFIG\"\n";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (
            needsTty &&
            !child.stdin.writableEnded &&
            chunk.toString().includes("\x1b[0c")
          ) {
            child.stdin.write("\x1b[?1;2c");
          }
          if (
            needsTty &&
            !child.stdin.writableEnded &&
            chunk.toString().includes("\x1b[6n")
          )
            child.stdin.write("\x1b[1;1R");
          if (
            needsTty &&
            !sentCommands &&
            output.split("bb-fg:shell:fish").length > 2
          ) {
            sentCommands = true;
            child.stdin.write(commands.replaceAll("\n", "\r"));
          }
          if (stage === 0 && output.includes("config=injected")) {
            stage = 1;
            const changed = environmentRefreshScripts([
              { key: "BB_FG_TEST_CONFIG", value: "updated" },
              { key: "BB_FG_TEST_ADDED", value: "added" },
              { key: "BB_FG_LITERAL", value: "quotes ' \\ $HOME $(printf unsafe) `printf unsafe`" },
            ]);
            void Promise.all([
              writeFile(environmentPath, changed.sh),
              writeFile(`${environmentPath}.fish`, changed.fish),
            ]).then(() => child.stdin.write(
              "\nprintf 'literal=%s\\n' \"$BB_FG_LITERAL\"\nprintf 'updated=%s added=%s\\n' \"$BB_FG_TEST_CONFIG\" \"$BB_FG_TEST_ADDED\"\n".replaceAll("\n", needsTty ? "\r" : "\n"),
            ));
          } else if (stage === 1 && output.includes("updated=updated added=added")) {
            stage = 2;
            const cleared = environmentRefreshScripts([]);
            void Promise.all([
              writeFile(environmentPath, cleared.sh),
              writeFile(`${environmentPath}.fish`, cleared.fish),
            ]).then(() => child.stdin.write(
              "\nprintf 'cleared=[%s][%s]\\n' \"$BB_FG_TEST_CONFIG\" \"$BB_FG_TEST_ADDED\"\nexit\n".replaceAll("\n", needsTty ? "\r" : "\n"),
            ));
          }
          if (needsTty && output.includes("bb-fg:command:exit"))
            child.stdin.end();
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        const timer = setTimeout(() => {
          if (needsTty && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        }, 6000);
        const exit = new Promise<number | null>((resolve, reject) => {
          child.on("error", reject);
          child.on("exit", resolve);
        });
        if (!needsTty) child.stdin.write(commands);
        try {
          expect(await exit, output.slice(-1200)).toBe(0);
        } finally {
          clearTimeout(timer);
        }
        const titles = [
          ...output.matchAll(/\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g),
        ].map((match) => match[1]);
        expect(output).toContain("1337;CurrentDir=/");
        expect(titles).toContain(`bb-fg:shell:${shell}`);
        expect(titles).toContain("bb-fg:command:sleep");
        expect(
          titles.filter((title) => title === `bb-fg:shell:${shell}`).length,
        ).toBeGreaterThan(1);
        expect(output).toContain("config=injected");
        expect(output).toContain("updated=updated added=added");
        expect(output).toContain("literal=quotes ' \\ $HOME $(printf unsafe) `printf unsafe`");
        expect(output).toContain("cleared=[][]");
        expect(existsSync(environmentPath)).toBe(true);
        expect(
          (await readdir(directory)).filter((name) =>
            name.startsWith("bb-ghostty."),
          ),
        ).toEqual([]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    10000,
  );
}

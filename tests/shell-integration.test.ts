import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { SHELL_START_COMMAND } from "../lib/shell-integration";

for (const shell of ["zsh", "bash", "fish"]) {
  const executable = ["/bin", "/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"]
    .map((directory) => join(directory, shell))
    .find(existsSync);
  it.skipIf(!executable)(
    `${shell} reports its idle shell and running command, then removes private startup files`,
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "fg-shell-test-"));
      try {
        await writeFile(
          join(directory, ".zshrc"),
          "export BB_FG_TEST_CONFIG=loaded\n",
        );
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
                  SHELL_START_COMMAND,
                  executable!,
                ]
              : [
                  "-c",
                  'cat | /usr/bin/script -q -c "$1" /dev/null',
                  "fg-shell-test",
                  SHELL_START_COMMAND,
                ]
            : ["-lc", SHELL_START_COMMAND],
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
        const commands =
          "sleep 0.01\nprintf 'config=%s\\n' \"$BB_FG_TEST_CONFIG\"\nexit\n";
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
        if (!needsTty) child.stdin.end(commands);
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
        if (shell === "zsh")
          expect(output.includes("config=loaded")).toBe(true);
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

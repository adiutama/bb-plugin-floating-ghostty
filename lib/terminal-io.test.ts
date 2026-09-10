// Input chunking and shell-title normalisation.
//
// Both fail quietly in the UI: an oversized write is refused by the server and
// the paste just never appears, and a bad title rule replaces a useful tab name
// with the path the tab already shows.
import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  encodeInputChunks,
  INPUT_MAX_BYTES,
  meaningfulShellTitle,
  normalizeTerminalTitle,
} from "./terminal-io";

function decodeAll(chunks: string[]): Uint8Array {
  const parts = chunks.map(base64ToBytes);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

describe("encodeInputChunks", () => {
  it("sends an ordinary keystroke as one chunk", () => {
    expect(encodeInputChunks("ls\r")).toHaveLength(1);
  });

  it("returns nothing for an empty string", () => {
    expect(encodeInputChunks("")).toEqual([]);
  });

  it("splits a paste that exceeds the transport ceiling", () => {
    const paste = "x".repeat(INPUT_MAX_BYTES * 2 + 10);
    const chunks = encodeInputChunks(paste);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(base64ToBytes(chunk).byteLength).toBeLessThanOrEqual(
        INPUT_MAX_BYTES,
      );
    }
  });

  it("round-trips the exact bytes, multi-byte characters included", () => {
    // Padded past the ceiling so the split lands inside the emoji run rather
    // than politely between characters.
    const paste = `${"a".repeat(INPUT_MAX_BYTES - 2)}🙂🙂🙂 done`;
    const expected = new TextEncoder().encode(paste);
    expect(encodeInputChunks(paste).length).toBeGreaterThan(1);
    expect(decodeAll(encodeInputChunks(paste))).toEqual(expected);
  });

  it("round-trips through base64 without corrupting high bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe("normalizeTerminalTitle", () => {
  it("keeps a title the shell actually meant", () => {
    expect(normalizeTerminalTitle("vim README.md")).toBe("vim README.md");
    expect(normalizeTerminalTitle("  npm run dev  ")).toBe("npm run dev");
  });

  it("drops the user@host:path a stock prompt sets every line", () => {
    expect(normalizeTerminalTitle("alex@laptop:~")).toBeNull();
    expect(normalizeTerminalTitle("alex@laptop:~/Git/acme-storefront")).toBeNull();
    expect(normalizeTerminalTitle("alex@laptop:/var/log")).toBeNull();
    expect(normalizeTerminalTitle("alex@laptop:./relative")).toBeNull();
  });

  it("keeps a user@host title whose tail is not a path", () => {
    // `git@github.com:owner/repo` is a remote, not a prompt.
    expect(normalizeTerminalTitle("git@github.com:owner/repo")).toBe(
      "git@github.com:owner/repo",
    );
  });

  it("treats a blank title as no title", () => {
    expect(normalizeTerminalTitle("")).toBeNull();
    expect(normalizeTerminalTitle("   ")).toBeNull();
  });

  it("caps a runaway title rather than letting it into the tab strip", () => {
    expect(normalizeTerminalTitle("z".repeat(500))).toHaveLength(200);
  });
});

describe("meaningfulShellTitle", () => {
  const at = (label: string, cwd: string, defaultTitle = `${label} · mac`) => ({
    label,
    defaultTitle,
    cwd,
  });

  it("keeps a title that says something the tab cannot", () => {
    expect(
      meaningfulShellTitle("vim README.md", at("Acme", "/tmp/acme-storefront")),
    ).toBe("vim README.md");
    expect(
      meaningfulShellTitle("npm run dev", at("Acme", "/tmp/acme-storefront")),
    ).toBe("npm run dev");
  });

  it("drops a title that only restates the directory", () => {
    const scope = at("Acme Storefront", "/tmp/bb-demo/acme-storefront");
    expect(meaningfulShellTitle("acme-storefront", scope)).toBeNull();
    // The shape this shell actually produces: directory and branch.
    expect(
      meaningfulShellTitle("acme-storefront:docs/idempotency-summary", scope),
    ).toBeNull();
    expect(meaningfulShellTitle("acme-storefront:main", scope)).toBeNull();
    expect(meaningfulShellTitle("Acme Storefront — main", scope)).toBeNull();
  });

  it("drops the name the tab was opened with", () => {
    expect(
      meaningfulShellTitle("Acme · mac", at("Acme", "/tmp/acme")),
    ).toBeNull();
  });

  it("still drops a user@host prompt title", () => {
    expect(
      meaningfulShellTitle("alex@laptop:~/Git/acme", at("Acme", "/tmp/acme")),
    ).toBeNull();
  });

  it("treats an empty or whitespace title as no title", () => {
    expect(meaningfulShellTitle("   ", at("Acme", "/tmp/acme"))).toBeNull();
  });
});

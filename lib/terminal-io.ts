// Byte and title plumbing between Ghostty and bb's terminal contract.
//
// Kept out of pump.ts so it is testable without a DOM or an Ghostty instance:
// everything here is a pure function over strings and bytes.

/**
 * bb's terminal contract rejects any write that decodes to more than this, so a
 * large paste has to be split rather than sent as one blob and refused whole.
 */
export const INPUT_MAX_BYTES = 64 * 1024;

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Chunked so a large paste cannot blow the argument limit of fromCharCode.
  let binary = "";
  const step = 8192;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

/**
 * Split at the transport's byte ceiling. Splitting mid-codepoint is fine — the
 * pty reads a byte stream and the write chain preserves order — whereas one
 * oversized write is rejected outright and the paste is silently lost.
 */
export function encodeInputChunks(value: string): string[] {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += INPUT_MAX_BYTES) {
    chunks.push(
      bytesToBase64(
        bytes.subarray(
          offset,
          Math.min(offset + INPUT_MAX_BYTES, bytes.byteLength),
        ),
      ),
    );
  }
  return chunks;
}

const TITLE_MAX_LENGTH = 200;
/** `user@host:/some/path` — what a stock zsh/bash sets on every prompt. */
const SHELL_PATH_TITLE = /^[^@\s:]+@[^:\s]+:(.+)$/u;

function isPathLike(path: string): boolean {
  return (
    path === "~" ||
    path === "." ||
    path.startsWith("~/") ||
    path.startsWith("/") ||
    path.startsWith("./")
  );
}

/**
 * The same rule bb's terminal applies: keep a title the shell meant as a title
 * (`vim README.md`, `npm run dev`), drop the `user@host:path` one every prompt
 * emits. Here that matters twice over — the tab already says where it runs, so
 * echoing the path back would replace a useful label with a redundant one.
 */
export function normalizeTerminalTitle(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed === "") return null;
  const path = SHELL_PATH_TITLE.exec(trimmed)?.[1]?.trimStart();
  if (path !== undefined && path !== "" && isPathLike(path)) return null;
  return trimmed.slice(0, TITLE_MAX_LENGTH);
}

/**
 * The second half of the same question, asked where the directory is known.
 *
 * bb's terminal panel has no label of its own, so any title beats none. This
 * window already says where every tab runs, which makes a whole class of titles
 * worse than the label they would replace: shells routinely retitle on every
 * prompt with the directory, or the directory and the branch, so an unfiltered
 * `vim README.md` rule turns "Acme Storefront" into "acme-storefront:main".
 * Keep what the tab cannot already tell you; drop what only restates it.
 */
export function meaningfulShellTitle(
  title: string,
  { label, defaultTitle, cwd }: { label: string; defaultTitle: string; cwd: string },
): string | null {
  const normalized = normalizeTerminalTitle(title);
  if (normalized === null || normalized === defaultTitle) return null;

  // `dir`, `dir:branch`, `dir — anything`: judge it by what comes first.
  const head = normalized.split(/[:—]/u)[0]!.trim();
  const base = cwd.split("/").filter((part) => part !== "").pop() ?? cwd;
  if (head === base || head === label || head === "") return null;
  return normalized;
}

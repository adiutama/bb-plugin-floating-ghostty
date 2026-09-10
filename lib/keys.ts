// The keys a phone keyboard does not have.
//
// A software keyboard has no Esc, no Tab, no Ctrl and no arrows, which is most
// of what using a shell consists of. This is the bar that puts them back, kept
// as data so the sequences are testable without a terminal attached.

export type ToolbarKeyKind = "send" | "modifier" | "arrow" | "action";

export interface ToolbarKey {
  id: string;
  /** What the button shows. Short, because the bar scrolls. */
  label: string;
  /** Spoken label, when the glyph alone would not say it. */
  title: string;
  kind: ToolbarKeyKind;
  /** The bytes to write, for `send` keys. */
  send?: string;
  /** Which way, for `arrow` keys. */
  direction?: "up" | "down" | "left" | "right";
  /** Set the button apart from the plain character keys. */
  emphasis?: boolean;
}

/**
 * `Ctrl` + a letter is the C0 control code 64 below it: Ctrl+C is 3, Ctrl+[ is
 * 27 (which is why Esc and Ctrl+[ are the same key). Ctrl+? is the odd one out
 * and maps to DEL.
 */
export function controlCode(key: string): string | null {
  if (key.length !== 1) return null;
  if (key === "?") return "\x7f";
  if (key === " ") return "\x00";
  const code = key.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  return null;
}

const ARROW_FINAL = {
  up: "A",
  down: "B",
  right: "C",
  left: "D",
} as const;

/**
 * Arrows are the one sequence that depends on terminal state: in application
 * cursor mode — which vim, less and most full-screen programs turn on — the
 * introducer is SS3 rather than CSI. Sending CSI unconditionally mostly works
 * and then mysteriously does not, so ask the terminal which mode it is in.
 */
export function arrowSequence(
  direction: NonNullable<ToolbarKey["direction"]>,
  applicationCursorKeys: boolean,
): string {
  return `\x1b${applicationCursorKeys ? "O" : "["}${ARROW_FINAL[direction]}`;
}

/**
 * Ordered by how often a thumb reaches for it, because the bar scrolls and only
 * the first handful are visible without a swipe.
 */
export const TOOLBAR_KEYS: readonly ToolbarKey[] = [
  { id: "esc", label: "esc", title: "Escape", kind: "send", send: "\x1b", emphasis: true },
  { id: "tab", label: "tab", title: "Tab", kind: "send", send: "\t", emphasis: true },
  { id: "ctrl", label: "ctrl", title: "Control", kind: "modifier", emphasis: true },
  { id: "left", label: "←", title: "Left", kind: "arrow", direction: "left" },
  { id: "up", label: "↑", title: "Up", kind: "arrow", direction: "up" },
  { id: "down", label: "↓", title: "Down", kind: "arrow", direction: "down" },
  { id: "right", label: "→", title: "Right", kind: "arrow", direction: "right" },
  { id: "ctrl-c", label: "^C", title: "Interrupt (Ctrl+C)", kind: "send", send: "\x03", emphasis: true },
  { id: "ctrl-d", label: "^D", title: "End of file (Ctrl+D)", kind: "send", send: "\x04" },
  { id: "ctrl-z", label: "^Z", title: "Suspend (Ctrl+Z)", kind: "send", send: "\x1a" },
  { id: "ctrl-r", label: "^R", title: "History search (Ctrl+R)", kind: "send", send: "\x12" },
  { id: "home", label: "home", title: "Start of line", kind: "send", send: "\x01" },
  { id: "end", label: "end", title: "End of line", kind: "send", send: "\x05" },
  { id: "pipe", label: "|", title: "Pipe", kind: "send", send: "|" },
  { id: "tilde", label: "~", title: "Tilde", kind: "send", send: "~" },
  { id: "slash", label: "/", title: "Slash", kind: "send", send: "/" },
  { id: "dash", label: "-", title: "Dash", kind: "send", send: "-" },
  { id: "underscore", label: "_", title: "Underscore", kind: "send", send: "_" },
  { id: "find", label: "find", title: "Find in scrollback", kind: "action" },
  { id: "paste", label: "paste", title: "Paste from clipboard", kind: "action" },
  { id: "dismiss", label: "⌄", title: "Hide keyboard", kind: "action", emphasis: true },
];

import type { KeyboardEvent } from "react";

/** Explicit cycling also works when macOS skips selects during native Tab navigation. */
export function containTab(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const root = event.currentTarget;
  // A portaled menu has its own focus management.
  if (!(event.target instanceof Node) || !root.contains(event.target)) return;
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), [tabindex]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest('[inert], [hidden], [aria-hidden="true"]'),
  );
  event.preventDefault();
  const index = elements.indexOf(document.activeElement as HTMLElement);
  const next =
    index === -1
      ? event.shiftKey
        ? elements.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
  (elements[next] ?? root).focus();
}

/** Runs after the shell/control has handled the key, before BB's bubbling shortcuts. */
export function isolateTerminalKey(event: KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
  if (
    event.type !== "keydown" ||
    event.defaultPrevented ||
    event.nativeEvent.isComposing
  )
    return;
  containTab(event);
  const key = event.key.toLowerCase();
  // Preserve browser editing/clipboard defaults. Shell control codes and terminal
  // shortcuts have already been handled at the target by Ghostty's input layer.
  const editing = [
    "a",
    "c",
    "v",
    "x",
    "z",
    "y",
    "arrowleft",
    "arrowright",
    "arrowup",
    "arrowdown",
    "backspace",
    "delete",
    "home",
    "end",
  ];
  const command = (event.metaKey || event.ctrlKey) && !event.altKey;
  if (
    (command && !editing.includes(key)) ||
    /^f\d{1,2}$/.test(key) ||
    (event.altKey &&
      !event.ctrlKey &&
      ["arrowleft", "arrowright"].includes(key))
  ) {
    event.preventDefault();
  }
}

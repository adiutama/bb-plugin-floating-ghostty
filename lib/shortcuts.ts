export interface Shortcut {
  key: string;
  mod: boolean;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: Shortcut,
  mac: boolean,
): boolean {
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    event.metaKey === (shortcut.meta || (shortcut.mod && mac)) &&
    event.ctrlKey === (shortcut.control || (shortcut.mod && !mac)) &&
    event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift
  );
}

export function isAlternativeToggle(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey &&
    (event.code === "Backquote" || event.key === "`")
  );
}

export function isSwitcherShortcut(
  event: KeyboardEvent,
  mac: boolean,
): boolean {
  return matchesShortcut(
    event,
    {
      key: "p",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    mac,
  );
}

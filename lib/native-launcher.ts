import { windowController } from "./controller";

// BB has no public command-replacement slot. Scope the trusted DOM adapter to
// the host's terminal launcher and command palette, and dispose it on unload.
const launcher = "#file-search-result-start-terminal";
const paletteSelector = '[data-testid="command-palette"]';
let enabled = false;

export const nativeLauncherOverride = {
  set(value: boolean) {
    enabled = value;
  },
};

export function mountNativeLauncherOverride(): () => void {
  const abort = new AbortController();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const redirect = (event: Event, palette: Element | null) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (palette) {
      // Let the host dismiss its palette and release its focus scope first.
      palette.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      clearTimeout(pending);
      pending = setTimeout(() => windowController.show(), 200);
    } else windowController.show();
  };
  const paletteTerminal = (row: Element | null) =>
    row?.firstElementChild?.textContent?.trim() === "Open terminal";
  document.addEventListener(
    "click",
    (event) => {
      if (!enabled || !(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>(launcher);
      if (button && !button.disabled) {
        redirect(event, null);
        return;
      }
      const palette = event.target.closest(paletteSelector);
      if (palette && paletteTerminal(event.target.closest('[role="option"]')))
        redirect(event, palette);
    },
    { capture: true, signal: abort.signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !enabled ||
        event.isComposing ||
        event.repeat ||
        event.key !== "Enter" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        !(event.target instanceof Element)
      )
        return;
      const palette = event.target.closest(paletteSelector);
      if (
        palette &&
        paletteTerminal(
          palette.querySelector('[role="option"][aria-selected="true"]'),
        )
      )
        redirect(event, palette);
    },
    { capture: true, signal: abort.signal },
  );
  return () => {
    abort.abort();
    clearTimeout(pending);
  };
}

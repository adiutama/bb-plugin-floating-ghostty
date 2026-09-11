import { arrowSequence } from "./keys";
import { consumeScrollPixels } from "./scroll";

/** Wterm handles SGR mouse reports and browser-native history scrolling. Fill
 * its alternate-screen wheel gap and provide the usual Shift history override.
 */
export function installTerminalScrolling({
  element,
  mode,
  rowHeight,
  send,
  signal,
}: {
  element: HTMLElement;
  mode: () => {
    alternate: boolean;
    reportsMouse: boolean;
    applicationCursor: boolean;
  };
  rowHeight: () => number;
  send: (input: string) => void;
  signal: AbortSignal;
}): void {
  let residual = 0;
  element.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return;
      const height = rowHeight();
      const pixels =
        event.deltaY *
        (event.deltaMode === 1
          ? height
          : event.deltaMode === 2
            ? element.clientHeight
            : 1);
      const current = mode();
      if (event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        residual = 0;
        element.scrollTop += pixels;
      } else if (current.alternate && !current.reportsMouse) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const step = consumeScrollPixels(residual, pixels, height);
        residual = step.residual;
        if (step.lines !== 0)
          send(
            arrowSequence(
              step.lines < 0 ? "up" : "down",
              current.applicationCursor,
            ).repeat(Math.min(Math.abs(step.lines), 40)),
          );
      } else {
        residual = 0;
      }
    },
    { capture: true, passive: false, signal },
  );
  // Preserve target handlers and browser scrolling, but do not bubble to BB's
  // document-level wheel handlers. This also contains trackpad gestures.
  element.addEventListener("wheel", (event) => event.stopPropagation(), {
    passive: true,
    signal,
  });
}

// Window geometry: persistence, viewport clamping, dragging, and resizing.
//
// Pointer gestures update DOM geometry directly; React receives the settled frame.

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

// v2: the default position changed from a magic offset to a real anchor, so
// previously saved geometry is deliberately discarded once.
const STORAGE_KEY = "bb-plugin-floating-ghostty:frame:v5";
const MIN_WIDTH = 360;
const MIN_HEIGHT = 180;
/** Keep this much of the window reachable so it can never be dragged away. */
const KEEP_VISIBLE = 140;
/** One inset for every edge, so the corner reads as a corner. */
const GUTTER = 40;

/**
 * Rest in the bottom-left corner with the same gap on the leading edge as
 * underneath. That corner is also the transform origin of the open animation,
 * so the window grows out of the side the trigger button lives on.
 */
export function defaultFrame(): Frame {
  const width = Math.min(760, Math.max(MIN_WIDTH, window.innerWidth - 2 * GUTTER));
  const height = Math.min(
    460,
    Math.max(MIN_HEIGHT, window.innerHeight - 2 * GUTTER),
  );
  return clampFrame({
    x: GUTTER,
    y: window.innerHeight - height - GUTTER,
    width,
    height,
  });
}

export function clampFrame(frame: Frame): Frame {
  const width = Math.max(MIN_WIDTH, Math.min(frame.width, window.innerWidth));
  const height = Math.max(
    MIN_HEIGHT,
    Math.min(frame.height, window.innerHeight),
  );
  return {
    width,
    height,
    x: Math.round(
      Math.min(Math.max(frame.x, KEEP_VISIBLE - width), window.innerWidth - KEEP_VISIBLE),
    ),
    // Never let the header (the only drag handle) go above the viewport.
    y: Math.round(Math.min(Math.max(frame.y, 0), window.innerHeight - 40)),
  };
}

export function loadFrame(): Frame {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultFrame();
    const parsed = JSON.parse(raw) as Partial<Frame>;
    const numbers = [parsed.x, parsed.y, parsed.width, parsed.height];
    if (numbers.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      return defaultFrame();
    }
    return clampFrame(parsed as Frame);
  } catch {
    return defaultFrame();
  }
}

export function saveFrame(frame: Frame): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(frame));
  } catch {
    // Private mode or a full quota: geometry just falls back to the default.
  }
}

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_EDGES: readonly Edge[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

interface GestureOptions {
  getFrame: () => Frame;
  /** Called on every pointer move with the in-progress geometry. */
  onChange: (frame: Frame) => void;
  /** Called once on release, for persistence and a final terminal refit. */
  onCommit: (frame: Frame) => void;
}

function trackPointer(
  element: HTMLElement,
  compute: (dx: number, dy: number, start: Frame) => Frame,
  { getFrame, onChange, onCommit }: GestureOptions,
  signal: AbortSignal,
): void {
  element.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      // Controls inside the drag handle (the directory picker, the buttons)
      // must stay clickable.
      if ((event.target as HTMLElement | null)?.closest("[data-no-drag]") != null) {
        return;
      }
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startFrame = getFrame();
      let latest = startFrame;
      element.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        latest = clampFrame(
          compute(moveEvent.clientX - startX, moveEvent.clientY - startY, startFrame),
        );
        onChange(latest);
      };
      const done = () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", done);
        element.removeEventListener("pointercancel", done);
        onCommit(latest);
      };

      element.addEventListener("pointermove", move, { signal });
      element.addEventListener("pointerup", done, { signal });
      element.addEventListener("pointercancel", done, { signal });
    },
    { signal },
  );
}

export function installDrag(
  handle: HTMLElement,
  options: GestureOptions,
  signal: AbortSignal,
): void {
  trackPointer(
    handle,
    (dx, dy, start) => ({ ...start, x: start.x + dx, y: start.y + dy }),
    options,
    signal,
  );
}

export function installResize(
  handle: HTMLElement,
  edge: Edge,
  options: GestureOptions,
  signal: AbortSignal,
): void {
  trackPointer(
    handle,
    (dx, dy, start) => {
      const next = { ...start };
      if (edge.includes("e")) next.width = start.width + dx;
      if (edge.includes("s")) next.height = start.height + dy;
      if (edge.includes("w")) {
        // Growing leftwards moves the origin and the size in opposite directions.
        next.width = Math.max(MIN_WIDTH, start.width - dx);
        next.x = start.x + (start.width - next.width);
      }
      if (edge.includes("n")) {
        next.height = Math.max(MIN_HEIGHT, start.height - dy);
        next.y = start.y + (start.height - next.height);
      }
      return next;
    },
    options,
    signal,
  );
}

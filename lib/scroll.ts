// Turning finger travel into terminal lines.
//
// Kept pure and separate from the pump because it is the part with a real
// off-by-one in it: a drag has to carry its sub-line remainder from one move
// event to the next, or a slow scroll rounds every 8px step to zero lines and
// the terminal never moves at all — which looks exactly like touch scrolling
// being broken, the bug this whole path exists to fix.

export interface ScrollStep {
  /** Whole lines to scroll. Positive moves towards the newest output. */
  lines: number;
  /** Sub-line travel to carry into the next event. */
  residual: number;
}

/**
 * `dy` is finger travel in CSS pixels, already signed so that a positive value
 * means "towards newer output" — the opposite of the finger's direction, since
 * dragging the content down walks back through history.
 */
export function consumeScrollPixels(
  residual: number,
  dy: number,
  cellHeight: number,
): ScrollStep {
  // A zero or nonsense cell height would divide the drag into infinite lines.
  if (!Number.isFinite(cellHeight) || cellHeight <= 0) {
    return { lines: 0, residual };
  }
  const total = residual + dy;
  // Truncate towards zero, so the remainder keeps the sign of the travel and a
  // reversal does not have to pay off a debt from the other direction first.
  // `|| 0` normalises the -0 that trunc yields for a small upward drag; it is
  // harmless arithmetically but leaks out of a pure function into Object.is.
  const lines = Math.trunc(total / cellHeight) || 0;
  return { lines, residual: total - lines * cellHeight };
}

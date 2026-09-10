import type { GhosttyCore } from "@wterm/ghostty";

/** Search retained cells, including wide glyphs, without scraping virtual DOM. */
export function searchTerminal(
  core: Pick<
    GhosttyCore,
    | "getScrollbackCount"
    | "getScrollbackLineLen"
    | "getScrollbackCell"
    | "getCols"
    | "getRows"
    | "getCell"
  >,
  query: string,
): { row: number; column: number }[] {
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  const history = core.getScrollbackCount();
  const matches: { row: number; column: number }[] = [];
  for (let row = 0; row < history + core.getRows(); row++) {
    let text = "";
    const width =
      row < history ? core.getScrollbackLineLen(row) : core.getCols();
    for (let col = 0; col < width; col++) {
      const cell =
        row < history
          ? core.getScrollbackCell(row, col)
          : core.getCell(row - history, col);
      if (cell.width === 0) continue;
      text += cell.chars ?? String.fromCodePoint(cell.char || 32);
    }
    const line = text.toLocaleLowerCase();
    for (
      let at = line.indexOf(needle);
      at !== -1;
      at = line.indexOf(needle, at + needle.length)
    ) {
      matches.push({ row, column: at });
      if (matches.length >= 1000) return matches;
    }
  }
  return matches;
}

import type { GhosttyCore } from "@wterm/ghostty";

/** Read retained cells, independently of Wterm's virtualized DOM. */
export function terminalText(core: GhosttyCore): string {
  const lines: string[] = [];
  const history = core.usingAltScreen() ? 0 : core.getScrollbackCount();
  for (let row = 0; row < history + core.getRows(); row++) {
    let line = "";
    const width = row < history ? core.getScrollbackLineLen(row) : core.getCols();
    for (let col = 0; col < width; col++) {
      const cell = row < history ? core.getScrollbackCell(row, col) : core.getCell(row - history, col);
      if (cell.width !== 0) line += cell.chars ?? String.fromCodePoint(cell.char || 32);
    }
    lines.push(line.trimEnd());
  }
  return lines.join("\n").trimEnd();
}

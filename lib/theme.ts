const NERD_FONTS =
  '"JetBrainsMono Nerd Font Mono", "MesloLGS NF", "Symbols Nerd Font Mono"';
const GENERIC_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
/**
 * Last resort, and deliberately last: the bundled symbol font in
 * fonts/nerd-symbols.css. Fallback is resolved per character, so an installed
 * Nerd Font above still supplies its own glyphs and this only draws the
 * codepoints nothing else can — which on a device where no Nerd Font can be
 * installed is every icon a shell prints.
 */
const BUNDLED_SYMBOLS = '"BB FG Nerd Symbols"';

export function resolveMonoFont(scope: HTMLElement): string {
  const declared = getComputedStyle(scope).getPropertyValue("--font-mono").trim();
  // Ghostty applies this as a literal font-family, so an unresolved var() would
  // invalidate the whole declaration rather than falling through the list.
  const host = declared === "" || declared.includes("var(") ? null : declared;
  return [NERD_FONTS, host, GENERIC_MONO, BUNDLED_SYMBOLS]
    .filter((part) => part !== null)
    .join(", ");
}

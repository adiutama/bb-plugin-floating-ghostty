// The keys a software keyboard does not have.
//
// Sits at the bottom of the sheet, which is where the iOS keyboard pushes it —
// so it lands directly above the keys, the way every native terminal app on the
// platform puts it. Rendered only in sheet mode; a desktop keyboard has all of
// these already.
//
// Ctrl is a latch rather than a chord: there is no way to hold two keys at once
// on a touch screen, so tapping it arms the modifier and the next character
// typed on the software keyboard becomes its control code.
import { TOOLBAR_KEYS, type ToolbarKey } from "@/lib/keys";
import { cn } from "@/lib/utils";

export interface KeyToolbarProps {
  ctrlArmed: boolean;
  onKey: (key: ToolbarKey) => void;
}

export function KeyToolbar({ ctrlArmed, onKey }: KeyToolbarProps) {
  return (
    <div
      className="bb-fg-keybar flex shrink-0 items-center gap-1 border-t border-border bg-muted/40"
      role="toolbar"
      aria-label="Terminal keys"
      data-no-drag=""
    >
      {TOOLBAR_KEYS.map((key) => {
        const armed = key.id === "ctrl" && ctrlArmed;
        return (
          <button
            key={key.id}
            type="button"
            title={key.title}
            aria-label={key.title}
            aria-pressed={key.kind === "modifier" ? armed : undefined}
            // Pointer-down, not click: a tap that lands on a button steals focus
            // from the terminal, and on iOS losing focus dismisses the keyboard.
            // Preventing the default keeps focus where it is, so the bar can be
            // used mid-command without the keyboard flapping open and shut.
            onPointerDown={(event) => {
              event.preventDefault();
              onKey(key);
            }}
            className={cn(
              "bb-fg-key",
              key.emphasis ? "bb-fg-key-strong" : null,
              armed ? "bb-fg-key-armed" : null,
            )}
          >
            {key.label}
          </button>
        );
      })}
    </div>
  );
}

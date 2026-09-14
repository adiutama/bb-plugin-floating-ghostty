import { useId, useRef, useState } from "react";
import { TOOLBAR_KEYS, type ToolbarKey } from "@/lib/keys";
import { cn } from "@/lib/utils";

export interface KeyToolbarProps {
  ctrlArmed: boolean;
  onKey: (key: ToolbarKey) => void;
}

const QUICK_KEYS = ["esc", "tab", "ctrl-c"];
const GROUPS = [
  { label: "Navigate", ids: ["left", "up", "down", "right", "home", "end"] },
  { label: "Shortcuts", ids: ["ctrl", "shift-tab", "ctrl-r", "ctrl-d", "ctrl-z", "find", "paste"] },
  { label: "Symbols", ids: ["pipe", "tilde", "slash", "dash", "underscore"] },
];

/** An inline tray preserves terminal focus, including the iOS software keyboard. */
export function KeyToolbar({ ctrlArmed, onKey }: KeyToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const trayId = useId();
  const tray = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const closeTray = () => {
    if (tray.current?.contains(document.activeElement))
      more.current?.focus({ preventScroll: true });
    setExpanded(false);
  };
  const keyButton = (id: string) => {
    const key = TOOLBAR_KEYS.find((key) => key.id === id)!;
    return (
      <button
        key={id}
        type="button"
        title={key.title}
        aria-label={key.title}
        aria-pressed={key.kind === "modifier" ? ctrlArmed : undefined}
        // Keep the input focused, but activate on click so sliding a finger
        // off a button can cancel it. Click also supports keyboard and AT.
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          onKey(key);
          if (key.kind === "modifier" || key.kind === "action") closeTray();
        }}
        className={cn("bb-fg-key", id === "ctrl" && ctrlArmed ? "bb-fg-key-armed" : null)}
      >
        {id === "ctrl-c" ? "Stop" : key.label}
      </button>
    );
  };
  return (
    <div className="bb-fg-shortcuts" data-no-drag="">
      {expanded ? (
        <div ref={tray} id={trayId} className="bb-fg-shortcut-tray" role="group" aria-label="More terminal shortcuts"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeTray();
            }
          }}>
          {GROUPS.map((group) => (
            <div className="bb-fg-shortcut-group" key={group.label}>
              <span>{group.label}</span>
              <div>{group.ids.map(keyButton)}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="bb-fg-keybar" role="toolbar" aria-label="Terminal shortcuts">
        {QUICK_KEYS.map(keyButton)}
        <button ref={more} type="button" className={cn("bb-fg-key", ctrlArmed ? "bb-fg-key-armed" : null)}
          aria-expanded={expanded} aria-controls={expanded ? trayId : undefined} aria-label="More terminal shortcuts"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setExpanded((value) => !value)}>
          {ctrlArmed ? "Ctrl on" : "More"}
        </button>
        <button type="button" className="bb-fg-key bb-fg-show-keyboard" aria-label="Show keyboard"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onKey({ id: "keyboard", label: "Type", title: "Show keyboard", kind: "action" })}>Type</button>
        <button type="button" className="bb-fg-key bb-fg-hide-keyboard" aria-label="Hide keyboard"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => { setExpanded(false); onKey(TOOLBAR_KEYS.find((key) => key.id === "dismiss")!); }}>Hide</button>
      </div>
    </div>
  );
}

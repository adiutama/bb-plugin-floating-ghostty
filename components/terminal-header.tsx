import { GhostMark } from "./ghost-mark";
import { Icon } from "./ui/icon";
import { tabName, type TabState } from "../lib/tabs";

export function TerminalHeader({
  tab,
  onSwitch,
  onHide,
  busy,
  expanded,
}: {
  tab: TabState | null;
  onSwitch: () => void;
  onHide: () => void;
  busy: boolean;
  expanded: boolean;
}) {
  return (
    <div className="bb-fg-header">
      <GhostMark className="bb-fg-header-ghost size-4 shrink-0" />
      <button
        className="bb-fg-session-trigger"
        type="button"
        data-no-drag=""
        aria-label="Switch terminal"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        title="Terminals (⌘K / Ctrl+K)"
        onClick={onSwitch}
        disabled={busy}
      >
        <span>{tab ? tabName(tab) : "Terminal"}</span>
        <Icon name="ChevronDown" className="size-3.5 shrink-0" />
      </button>
      <span className="bb-fg-header-space" />
      <button
        className="bb-fg-header-icon"
        type="button"
        data-no-drag=""
        onClick={onHide}
        title="Back to BB · shells keep running"
        aria-label="Hide terminal"
      >
        <Icon name="X" className="size-4" />
      </button>
    </div>
  );
}

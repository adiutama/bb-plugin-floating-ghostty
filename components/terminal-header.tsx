import { GhostMark } from "./ghost-mark";
import { Icon } from "./ui/icon";
import { tabName, type TabState } from "../lib/tabs";

export function TerminalHeader({
  tab,
  onSwitch,
  onEnvironment,
  onHide,
  busy,
  expanded,
  environmentOpen,
}: {
  tab: TabState | null;
  onSwitch: () => void;
  onEnvironment?: () => void;
  onHide: () => void;
  busy: boolean;
  expanded: boolean;
  environmentOpen: boolean;
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
      {onEnvironment ? (
        <button
          className="bb-fg-header-icon"
          type="button"
          data-no-drag=""
          data-active={environmentOpen ? "true" : undefined}
          onClick={onEnvironment}
          title="Project environment"
          aria-label="Edit project environment"
          aria-pressed={environmentOpen}
        >
          <Icon name="Variable" className="size-4" />
        </button>
      ) : null}
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

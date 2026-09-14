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
  const directory = tab?.cwd ?? "";
  const segments = directory.replace(/\\/g, "/").split("/").filter(Boolean);
  const shortDirectory = segments.length > 2
    ? `…/${segments.slice(-2).join("/")}`
    : directory;
  return (
    <div className="bb-fg-header">
      <GhostMark className="bb-fg-header-ghost size-4 shrink-0" />
      <div className="bb-fg-session-title">
        <span className="bb-fg-header-name" title={tab ? tabName(tab) : "Terminal"}>
          {tab ? tabName(tab) : "Terminal"}
        </span>
        {directory ? <span className="bb-fg-header-path" title={directory}>{shortDirectory}</span> : null}
      </div>
      <button
        className="bb-fg-header-icon"
        type="button"
        data-no-drag=""
        aria-label="Switch terminal"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        data-active={expanded ? "true" : undefined}
        title="Search terminals (⌘K / Ctrl+K)"
        onClick={onSwitch}
        disabled={busy}
      >
        <Icon name="Search" className="size-4" />
      </button>
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

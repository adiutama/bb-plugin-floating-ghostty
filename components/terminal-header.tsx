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
  const directory = tab?.cwd ?? "";
  const segments = directory.replace(/\\/g, "/").split("/").filter(Boolean);
  const shortDirectory = segments.length > 2
    ? `…/${segments.slice(-2).join("/")}`
    : directory;
  return (
    <div className="bb-fg-header">
      <button
        className="bb-fg-header-icon"
        type="button"
        data-no-drag=""
        aria-label={expanded ? "Hide terminal sidebar" : "Show terminal sidebar"}
        aria-controls="bb-fg-terminal-sidebar"
        aria-expanded={expanded}
        data-active={expanded ? "true" : undefined}
        title="Terminal sidebar (⌘K / Ctrl+K)"
        onClick={onSwitch}
        disabled={busy}
      >
        <Icon name="PanelLeft" className="size-4" />
      </button>
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
        onClick={onHide}
        title="Back to BB · shells keep running"
        aria-label="Hide terminal"
      >
        <Icon name="X" className="size-4" />
      </button>
    </div>
  );
}

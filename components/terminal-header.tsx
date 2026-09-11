import { useEffect, useState } from "react";
import { GhostMark } from "./ghost-mark";
import { Icon } from "./ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ownerOf } from "../lib/context";
import { tabName, type TabState } from "../lib/tabs";

export function TerminalHeader({
  tab,
  owner,
  onSwitch,
  onCreate,
  onPromote,
  onHide,
  onRestart,
  onEnd,
  onFind,
  maximize,
  busy,
  visible,
  onMenuChange,
}: {
  tab: TabState | null;
  owner: string;
  onSwitch: () => void;
  onCreate: () => void;
  onPromote: (target: "project" | "global") => void;
  onHide: () => void;
  onRestart: () => void;
  onEnd: () => void;
  onFind: () => void;
  maximize: { on: boolean; toggle: () => void } | null;
  busy: boolean;
  visible: boolean;
  onMenuChange: (open: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);
  return (
    <div className="bb-fg-header">
      <GhostMark className="bb-fg-header-ghost size-4 shrink-0 text-muted-foreground" />
      <button
        className="bb-fg-session-trigger"
        type="button"
        data-no-drag=""
        aria-label="Switch terminal"
        title="Switch terminal (⌘P / Ctrl+P)"
        onClick={onSwitch}
        disabled={busy}
      >
        <span>{tab ? tabName(tab) : "Terminal"}</span>
        <Icon name="ChevronDown" className="size-3.5 shrink-0" />
      </button>
      <span
        className="bb-fg-owner"
        title={tab ? `${owner} · ${tab.hostName}\n${tab.cwd}` : owner}
      >
        {owner}
        {tab?.hostName ? ` · ${tab.hostName}` : ""}
      </span>
      <span className="bb-fg-header-space" />
      <button
        className="bb-fg-header-icon"
        type="button"
        data-no-drag=""
        aria-label="New terminal"
        title="New terminal"
        onClick={onCreate}
        disabled={busy}
      >
        <Icon name="Plus" className="size-4" />
      </button>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          onMenuChange(open);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            className="bb-fg-header-icon"
            type="button"
            data-no-drag=""
            aria-label="Terminal actions"
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="bb-fg-actions-menu"
          align="end"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {maximize ? (
            <DropdownMenuItem onSelect={maximize.toggle}>
              {maximize.on ? "Restore size" : "Maximize"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled={!tab || busy} onSelect={onFind}>
            Find in terminal
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!tab || busy} onSelect={onRestart}>
            Restart shell
          </DropdownMenuItem>
          {tab && ownerOf(tab.scopeKey).kind !== "home" ? (
            <>
              <DropdownMenuSeparator />
              {ownerOf(tab.scopeKey).kind === "worktree" ? (
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() => onPromote("project")}
                >
                  Promote to Project
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => onPromote("global")}
              >
                Promote to Global
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!tab || busy}
            className="text-destructive"
            onSelect={onEnd}
          >
            End terminal
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        className="bb-fg-header-icon"
        type="button"
        data-no-drag=""
        onClick={onHide}
        title="Hide terminal"
        aria-label="Hide terminal"
      >
        <Icon name="X" className="size-4" />
      </button>
    </div>
  );
}

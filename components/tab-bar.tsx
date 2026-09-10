// The window's navigation: a browser-style tab strip in the title bar.
//
// Each tab is one shell session. A tab is a div with tab semantics rather than
// a <button> because it contains the close control, and nesting buttons is an
// accessibility violation; Enter/Space activation is wired by hand instead.
// Everything interactive carries data-no-drag; the bar itself is the window's
// drag handle.
import { GhostMark } from "./ghost-mark";
import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShellPicker } from "@/components/shell-picker";
import type { ScopeOption } from "@/lib/scopes";
import { tabName, type TabState } from "@/lib/tabs";
import { cn } from "@/lib/utils";

export interface TabBarProps {
  tabs: TabState[];
  activeId: string | null;
  scopes: ScopeOption[];
  recentScopeKeys: string[];
  showHosts: boolean;
  /** Window mode only; a sheet already fills the screen. */
  maximize: { on: boolean; toggle: () => void } | null;
  onSelect: (terminalId: string) => void;
  onClose: (terminalId: string) => void;
  onNewTab: (scopeKey: string) => void;
  onRestart: () => void;
  onHide: () => void;
}

/** A live shell needs no announcement; only the exceptions get a dot. */
function statusDotClass(tab: TabState): string | null {
  switch (tab.status) {
    case "connecting":
      return "bg-muted-foreground/70 animate-pulse";
    case "exited":
      return "bg-muted-foreground/50";
    case "error":
      return "bg-destructive";
    default:
      return null;
  }
}

export function NewTabMenu({
  scopes,
  recentScopeKeys,
  showHosts,
  onNewTab,
  children,
}: {
  scopes: ScopeOption[];
  recentScopeKeys: string[];
  showHosts: boolean;
  onNewTab: (scopeKey: string) => void;
  children: React.ReactNode;
}) {
  // Controlled, because the rows are cmdk items rather than DropdownMenuItems:
  // Radix never sees a select event, so picking a directory would open the tab
  // and leave the menu sitting on top of the shell it just started.
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-0">
        <ShellPicker
          scopes={scopes}
          recentScopeKeys={recentScopeKeys}
          showHosts={showHosts}
          onPick={(scopeKey) => {
            setOpen(false);
            onNewTab(scopeKey);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabItem({
  tab,
  active,
  showHost,
  onSelect,
  onClose,
}: {
  tab: TabState;
  active: boolean;
  showHost: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const dot = statusDotClass(tab);
  const name = tabName(tab, showHost);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="tab"
          tabIndex={0}
          aria-selected={active}
          // Explicit, or the name is computed from contents and the nested
          // close button folds in: "Home Close Home".
          aria-label={name}
          data-no-drag=""
          onClick={onSelect}
          // The convention every browser and editor tab strip shares.
          onAuxClick={(event) => {
            if (event.button === 1) onClose();
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "group flex h-6 max-w-40 shrink-0 cursor-default select-none items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
        >
          {dot === null ? null : (
            <span
              className={cn("size-1.5 shrink-0 rounded-full", dot)}
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 truncate">{name}</span>
          <button
            type="button"
            aria-label={`Close ${name}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className={cn(
              "grid size-3.5 shrink-0 place-items-center rounded-sm text-muted-foreground transition-opacity",
              "hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <Icon name="X" className="size-3" aria-hidden="true" />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {tab.shellTitle === null ? null : (
          <span className="block text-xs">{tab.label}</span>
        )}
        <span className="font-mono text-xs">
          {tab.hostName === "" ? tab.cwd : `${tab.hostName}:${tab.cwd}`}
        </span>
        {tab.statusDetail === null ? null : (
          <span className="block text-xs text-muted-foreground">
            {tab.statusDetail}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function TabBar({
  tabs,
  activeId,
  scopes,
  recentScopeKeys,
  showHosts,
  maximize,
  onSelect,
  onClose,
  onNewTab,
  onRestart,
  onHide,
}: TabBarProps) {
  const activeTab = tabs.find((tab) => tab.terminalId === activeId) ?? null;

  return (
    <div
      data-bb-fg-tabbar=""
      className="flex h-9 shrink-0 cursor-grab select-none items-center gap-1 border-b border-border bg-muted/40 pl-2 pr-1 active:cursor-grabbing"
    >
      {/* Hidden in sheet mode from styles.css: nothing there is draggable, and
          a grip that does nothing is worse than no grip. */}
      <span data-bb-fg-grip="" className="flex shrink-0 items-center">
        <GhostMark className="size-4 text-muted-foreground" />
      </span>

      {tabs.length === 0 ? null : (
        <div
          role="tablist"
          aria-label="Open shells"
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
        >
          {tabs.map((tab) => (
            <TabItem
              key={tab.terminalId}
              tab={tab}
              active={tab.terminalId === activeId}
              showHost={showHosts}
              onSelect={() => onSelect(tab.terminalId)}
              onClose={() => onClose(tab.terminalId)}
            />
          ))}
        </div>
      )}

      <NewTabMenu
        scopes={scopes}
        recentScopeKeys={recentScopeKeys}
        showHosts={showHosts}
        onNewTab={onNewTab}
      >
        <Button
          variant="ghost"
          size="icon"
          data-no-drag=""
          className="size-6 shrink-0 text-muted-foreground"
          aria-label="New shell"
        >
          <Icon name="Plus" aria-hidden="true" />
        </Button>
      </NewTabMenu>

      {/* Everything left of here scrolls or wraps; this is the guaranteed
          drag surface. */}
      <span className="h-full min-w-4 flex-1" />

      {maximize === null ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-no-drag=""
              data-bb-fg-action=""
              className="size-6 shrink-0 text-muted-foreground"
              onClick={maximize.toggle}
              aria-label={
                maximize.on ? "Restore window size" : "Maximize window"
              }
            >
              <Icon
                name={maximize.on ? "Minimize2" : "Maximize2"}
                aria-hidden="true"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {maximize.on ? "Restore" : "Maximize"}
          </TooltipContent>
        </Tooltip>
      )}

      {activeTab === null ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-no-drag=""
              data-bb-fg-action=""
              className="size-6 shrink-0 text-muted-foreground"
              onClick={onRestart}
              aria-label="Restart shell"
            >
              <Icon name="ArrowReloadHorizontal" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Restart shell</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-no-drag=""
            data-bb-fg-action=""
            className="size-6 shrink-0 text-muted-foreground"
            onClick={onHide}
            aria-label="Hide terminal"
          >
            <Icon name="X" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Hide terminal{" "}
          <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">
            Ctrl+`
          </kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

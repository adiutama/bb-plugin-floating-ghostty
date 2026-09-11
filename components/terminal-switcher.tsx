import { useEffect, useRef, useState } from "react";
import { Command, CommandInput, CommandItem, CommandList } from "./ui/command";
import { defaultFilter, useCommandState } from "cmdk";
import { containTab, isolateTerminalKey } from "../lib/keyboard";
import { ProjectFilter } from "./project-filter";
import type { ManagementMode } from "./terminal-management";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";
import {
  scopeLabel,
  ownerOf,
  readSelection,
  contextKey,
  type TerminalContext,
} from "../lib/context";
import type { ScopeOption } from "../lib/scopes";
import { tabName, type TabState } from "../lib/tabs";

export function TerminalSwitcher({
  tabs,
  scopes,
  context,
  activeId,
  onSelect,
  onDismiss,
  visible,
  busy,
  onCreate,
  onManage,
  onRestart,
  onFind,
  maximize,
}: {
  tabs: TabState[];
  scopes: ScopeOption[];
  context: TerminalContext;
  activeId: string | null;
  onSelect: (id: string) => void;
  onDismiss: () => void;
  visible: boolean;
  busy: boolean;
  onCreate: (projectId: string | null) => void;
  onManage: (id: string, mode: ManagementMode) => void;
  onRestart: (id: string) => void;
  onFind?: () => void;
  maximize: { on: boolean; toggle: () => void } | null;
}) {
  const [filter, setFilter] = useState(() => contextKey(context));
  const [filterOpen, setFilterOpen] = useState(false);
  const projects = new Map(
    scopes
      .filter((scope) => scope.kind === "project")
      .map((scope) => [scope.key, scope.label]),
  );
  // Keep orphaned projects discoverable while their sessions still exist.
  for (const tab of tabs) {
    const projectId = ownerOf(tab.scopeKey).projectId;
    if (projectId !== null && !projects.has(`project:${projectId}`))
      projects.set(`project:${projectId}`, "Project unavailable");
  }
  const filters = [
    { key: "all", label: "All" },
    { key: "no-project", label: "No project" },
    ...Array.from(projects, ([key, label]) => ({ key, label })),
  ];
  const creationProject =
    filter === "all"
      ? context.projectId
      : filter === "no-project"
        ? null
        : ownerOf(filter).projectId;
  const creationLabel =
    creationProject === null
      ? "No project"
      : (projects.get(`project:${creationProject}`) ?? "Project unavailable");
  useEffect(() => {
    setFilter(contextKey(context));
  }, [context.projectId]);
  useEffect(() => {
    if (!visible) setFilterOpen(false);
  }, [visible]);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(activeId ?? "");
  const input = useRef<HTMLInputElement>(null);
  const [recentIds] = useState(() => readSelection().recent);
  const recentRank = (id: string) => {
    const index = recentIds.indexOf(id);
    return index < 0 ? recentIds.length : index;
  };
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  const shown = tabs
    .filter(
      (tab) =>
        filter === "all" ||
        (filter === "no-project"
          ? ownerOf(tab.scopeKey).projectId === null
          : `project:${ownerOf(tab.scopeKey).projectId}` === filter),
    )
    .map((tab) => ({
      tab,
      score: query.trim()
        ? defaultFilter(tabName(tab), query.trim(), [
            tab.shellTitle ?? tab.label,
            scopeLabel(tab.scopeKey, scopes),
            tab.hostName,
            tab.cwd,
          ])
        : 1,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        recentRank(a.tab.terminalId) - recentRank(b.tab.terminalId),
    );
  useEffect(() => {
    const ids = shown.map(({ tab }) => tab.terminalId);
    if (!query.trim() && !busy) ids.push("new-terminal");
    if (!ids.includes(highlighted)) setHighlighted(ids[0] ?? "");
  }, [shown, highlighted, query, busy]);
  return (
    <div
      className="bb-fg-switcher-scrim bb-fg-thread-search-scrim"
      hidden={!visible}
      inert={!visible}
      onPointerDown={onDismiss}
    >
      <section
        className="bb-fg-switcher bb-fg-thread-search"
        role="dialog"
        aria-label="Switch terminal"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDownCapture={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return;
          if (
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === "p" &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.stopPropagation();
            setFilterOpen((open) => !open);
            return;
          }
        }}
        onKeyDown={(event) => {
          // Portaled menus own their Escape and arrow keys.
          if (!event.currentTarget.contains(event.target as Node)) return;
          containTab(event);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          }
        }}
      >
        <Command
          label="Search terminals"
          shouldFilter={false}
          loop
          value={highlighted}
          onValueChange={setHighlighted}
        >
          <div className="bb-fg-switcher-search">
            <CommandInput
              ref={input}
              value={query}
              onValueChange={setQuery}
              aria-label="Search terminals"
              placeholder="Search terminals"
            />
            <ProjectFilter
              open={filterOpen}
              onOpenChange={setFilterOpen}
              value={filter}
              options={filters}
              onChange={setFilter}
              onClose={() => {
                if (input.current?.closest("[hidden], [inert]") == null)
                  input.current?.focus();
              }}
            />
          </div>
          <div className="bb-fg-search-context">
            <span>
              Terminals{" "}
              <span className="bb-fg-result-count">{shown.length}</span>
            </span>
          </div>
          <CommandList aria-label="Terminals">
            {shown.length === 0 ? (
              <div className="bb-fg-search-empty" role="status">
                <Icon name="Search" className="size-4" />
                {query.trim() ? "No matches" : "No terminals here yet"}
              </div>
            ) : null}
            {shown.map(({ tab }) => (
              <SessionRow
                key={tab.terminalId}
                tab={tab}
                owner={scopeLabel(tab.scopeKey, scopes)}
                active={tab.terminalId === activeId}
                visible={visible}
                busy={busy}
                query={query.trim()}
                onSelect={onSelect}
                onManage={onManage}
                onRestart={onRestart}
                onFind={tab.terminalId === activeId ? onFind : undefined}
                maximize={maximize}
              />
            ))}
            {!query.trim() ? (
              <CommandItem
                value="new-terminal"
                aria-label="New terminal"
                className="bb-fg-new-terminal"
                disabled={busy}
                onSelect={() => {
                  if (!busy) onCreate(creationProject);
                }}
              >
                <Icon name="Plus" className="size-4" />
                <span>{busy ? "Starting…" : "New terminal"}</span>
                <small title={creationLabel}>{creationLabel}</small>
              </CommandItem>
            ) : null}
          </CommandList>
        </Command>
      </section>
    </div>
  );
}

/** The action button is a sibling of the option, so the listbox has no nested controls. */
function SessionRow({
  tab,
  owner,
  active,
  visible,
  busy,
  onSelect,
  onManage,
  onRestart,
  onFind,
  maximize,
  query,
}: {
  tab: TabState;
  owner: string;
  active: boolean;
  visible: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onManage: (id: string, mode: ManagementMode) => void;
  onRestart: (id: string) => void;
  onFind?: () => void;
  maximize: { on: boolean; toggle: () => void } | null;
  query: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const highlighted = useCommandState(
    (state) => state.value === tab.terminalId,
  );
  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);
  return (
    <div className="bb-fg-session-row" data-highlighted={highlighted}>
      <CommandItem
        aria-label={`${tabName(tab)} · ${tab.cwd || "Directory unavailable"} · ${owner} · ${tab.hostName}${active ? " · Current terminal" : ""}${tab.status === "exited" ? " · Exited" : tab.status === "error" ? " · Error" : ""}`}
        value={tab.terminalId}
        keywords={[
          tabName(tab),
          tab.shellTitle ?? tab.label,
          owner,
          tab.hostName,
          tab.cwd,
        ]}
        onSelect={() => onSelect(tab.terminalId)}
      >
        <span className="bb-fg-session-copy">
          <span className="bb-fg-session-name">
            <SearchTitle title={tabName(tab)} query={query} />
          </span>
          <span
            className="bb-fg-session-scope"
            title={tab.cwd || "Directory unavailable"}
          >
            <Icon name="Folder" className="size-3.5 shrink-0" />
            <span>{tab.cwd || "Directory unavailable"}</span>
          </span>
        </span>
        {tab.status === "exited" || tab.status === "error" ? (
          <small>{tab.status === "exited" ? "Exited" : "Error"}</small>
        ) : null}
        <span
          className="bb-fg-session-current"
          aria-label={active ? "Current terminal" : undefined}
        >
          {active ? <Icon name="Check" className="size-4" /> : null}
        </span>
      </CommandItem>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            ref={trigger}
            type="button"
            className="bb-fg-row-action"
            aria-label={`Actions for ${tabName(tab)}`}
            title={`Actions for ${tabName(tab)}`}
            tabIndex={highlighted ? 0 : -1}
            disabled={busy}
            onKeyDown={(event) => {
              // Enter opens this menu without activating cmdk's current option.
              if (event.key !== "Tab") isolateTerminalKey(event);
            }}
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="bb-fg-actions-menu"
          mobileTitle={tabName(tab)}
          align="end"
          onKeyDown={isolateTerminalKey}
          onKeyUp={isolateTerminalKey}
          onKeyPress={isolateTerminalKey}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.closest("[hidden], [inert]") == null)
              trigger.current?.focus();
          }}
        >
          {onFind ? (
            <DropdownMenuItem onSelect={onFind}>
              Find in terminal
            </DropdownMenuItem>
          ) : null}
          {maximize ? (
            <DropdownMenuItem onSelect={maximize.toggle}>
              {maximize.on ? "Restore size" : "Maximize"}
            </DropdownMenuItem>
          ) : null}
          {onFind || maximize ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => onManage(tab.terminalId, "rename")}>
            Rename…
          </DropdownMenuItem>
          {ownerOf(tab.scopeKey).projectId !== null ? (
            <DropdownMenuItem
              onSelect={() => onManage(tab.terminalId, "environment")}
            >
              Project environment…
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onRestart(tab.terminalId)}>
            Restart shell
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onManage(tab.terminalId, "delete")}
          >
            Delete terminal…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Match emphasis follows the thread-search row; fuzzy-only matches keep their plain title. */
function SearchTitle({ title, query }: { title: string; query: string }) {
  const index = query
    ? title.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    : -1;
  if (index < 0) return <>{title}</>;
  return (
    <>
      {title.slice(0, index)}
      <mark className="bb-fg-search-match">
        {title.slice(index, index + query.length)}
      </mark>
      {title.slice(index + query.length)}
    </>
  );
}

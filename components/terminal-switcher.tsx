import { useEffect, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { containTab } from "../lib/keyboard";
import { Icon } from "./ui/icon";
import { scopeLabel, ownerOf, type TerminalContext } from "../lib/context";
import type { ScopeOption } from "../lib/scopes";
import { tabName, type TabState } from "../lib/tabs";

export function TerminalSwitcher({
  tabs,
  scopes,
  context,
  activeId,
  onSelect,
  onDismiss,
}: {
  tabs: TabState[];
  scopes: ScopeOption[];
  context: TerminalContext;
  activeId: string | null;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}) {
  const [filter, setFilter] = useState("default");
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(activeId ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const showHost = new Set(tabs.map((tab) => tab.hostName)).size > 1;
  const shown = tabs.filter(
    (tab) =>
      filter === "default" ||
      (filter === "global"
        ? ownerOf(tab.scopeKey).kind === "home"
        : tab.scopeKey === filter),
  );
  return (
    <div className="bb-fg-switcher-scrim" onPointerDown={onDismiss}>
      <section
        className="bb-fg-switcher"
        role="dialog"
        aria-label="Switch terminal"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          containTab(event);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          }
        }}
      >
        <Command
          label="Terminals"
          loop
          value={highlighted}
          onValueChange={setHighlighted}
        >
          <div className="bb-fg-switcher-search">
            <CommandInput
              ref={input}
              value={query}
              onValueChange={setQuery}
              placeholder="Search…"
            />
            <select
              aria-label="Filter terminals"
              title="Category (Tab to focus)"
              aria-keyshortcuts="Tab"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                // Arrow/Enter belong to the select while it has focus, not cmdk.
                if (
                  [
                    "ArrowUp",
                    "ArrowDown",
                    "ArrowLeft",
                    "ArrowRight",
                    "Enter",
                    " ",
                  ].includes(event.key)
                ) {
                  // Keep cmdk from choosing a terminal while navigating categories.
                  event.stopPropagation();
                }
              }}
            >
              <option value="default">All</option>
              <option value="global">Global</option>
              {scopes
                .filter((scope) => scope.kind !== "home")
                .map((scope) => (
                  <option key={scope.key} value={scope.key}>
                    {scope.label}
                    {ownerOf(scope.key).environmentId ===
                      context.environmentId && scope.kind === "worktree"
                      ? " · Current"
                      : ""}
                  </option>
                ))}
            </select>
          </div>
          <CommandList>
            <CommandEmpty>
              {tabs.length === 0 ? "No terminals yet" : "No matches"}
            </CommandEmpty>
            {shown.map((tab) => {
              const label = scopeLabel(tab.scopeKey, scopes);
              const scope = scopes.find((scope) => scope.key === tab.scopeKey);
              return (
                <CommandItem
                  key={tab.terminalId}
                  value={tab.terminalId}
                  keywords={[tabName(tab), label, tab.hostName, tab.cwd]}
                  onSelect={() => onSelect(tab.terminalId)}
                >
                  <Icon
                    name="Terminal"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="bb-fg-session-name">{tabName(tab)}</span>
                  <span
                    className="bb-fg-session-scope"
                    title={`${label} · ${tab.hostName}`}
                  >
                    {scope?.kind === "home"
                      ? "Global"
                      : (scope?.label ?? label)}
                    {showHost ? ` · ${tab.hostName}` : ""}
                  </span>
                  {tab.status === "exited" || tab.status === "error" ? (
                    <small>
                      {tab.status === "exited" ? "Exited" : "Error"}
                    </small>
                  ) : null}
                  {tab.terminalId === activeId ? (
                    <Icon name="Check" className="size-4 shrink-0" />
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </section>
    </div>
  );
}

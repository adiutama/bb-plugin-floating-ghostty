// Choosing where a shell runs.
//
// Both places the user picks a directory share this list, so the vocabulary is
// the same whether the window is empty or they are adding a tab: the same
// order, the same grouping, the same rows. The ranking itself lives in
// lib/scopes.ts.
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Icon } from "@/components/ui/icon";
import { buildSections, shortenPath, type ScopeOption } from "@/lib/scopes";
import { cn } from "@/lib/utils";

export interface ShellPickerProps {
  scopes: ScopeOption[];
  recentScopeKeys: string[];
  /** True when more than one machine is connected, so paths need qualifying. */
  showHosts: boolean;
  onPick: (scopeKey: string) => void;
  /**
   * Take the height offered instead of the menu-sized default. The empty window
   * has a whole pane to fill; the `+` dropdown must stay a dropdown.
   */
  fill?: boolean;
  className?: string;
}

/** Search earns its place only once scanning the list stops being instant. */
const SEARCHABLE_FROM = 7;

export function ShellPicker({
  scopes,
  recentScopeKeys,
  showHosts,
  onPick,
  fill = false,
  className,
}: ShellPickerProps) {
  const sections = buildSections(scopes, recentScopeKeys);
  const searchable = scopes.length >= SEARCHABLE_FROM;

  return (
    <Command
      // cmdk filters on the value; include the path and machine so searching
      // "scw" or "Git/Type" finds the right row, not just its display name.
      className={cn("flex min-h-0 flex-col bg-transparent", className)}
    >
      {searchable ? <CommandInput placeholder="Find a directory" /> : null}
      {/* Fill mode is bounded by the flex parent, so it has to shed the
          vendored 300px menu cap; the dropdown keeps it. The cap is lifted from
          styles.css rather than with `max-h-none`, because this plugin's
          Tailwind utility layer loses to bb's own app CSS in the host page —
          `min-h-0` lands, `max-h-*` does not. */}
      <CommandList data-bb-fg-fill={fill ? "" : undefined} className={cn(fill && "min-h-0 flex-1")}>
        <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
          No directory matches that.
        </CommandEmpty>
        {sections.map((section) => (
          <CommandGroup key={section.id} heading={section.heading}>
            {section.scopes.map((scope) => (
              <CommandItem
                key={scope.key}
                value={`${scope.label} ${scope.detail} ${scope.hostName}`}
                disabled={!scope.online}
                onSelect={() => onPick(scope.key)}
                className="gap-2.5"
              >
                <Icon
                  name={section.icon}
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{scope.label}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {shortenPath(scope.detail)}
                  </span>
                </span>
                {/* The machine is metadata, not part of the path. Inline, it
                    put the same 19 characters in front of every row and made
                    the list unscannable. */}
                {showHosts || !scope.online ? (
                  // The width cap lives in styles.css for the same reason as
                  // the list cap above. At sheet width a long machine name took
                  // half the row and truncated every project to
                  // "bb-plugin-co…"; the row never overflows, so the label just
                  // got whatever was left and flex shrinking never kicked in.
                  <span
                    data-bb-fg-host=""
                    className="shrink-0 self-center truncate text-xs text-muted-foreground"
                  >
                    {showHosts ? scope.hostName : null}
                    {!scope.online ? (showHosts ? " · offline" : "offline") : null}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

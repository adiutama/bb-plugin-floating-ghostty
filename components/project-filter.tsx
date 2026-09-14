import { useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Icon } from "./ui/icon";
import { isolateTerminalKey } from "../lib/keyboard";
import { usePortalScopeProps } from "../lib/portal-scope";

export function ProjectFilter({
  open,
  onOpenChange,
  value,
  options,
  onChange,
  onClose,
  focusSearch = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  options: { key: string; label: string }[];
  onChange: (value: string) => void;
  onClose: () => void;
  focusSearch?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const label =
    options.find((option) => option.key === value)?.label ??
    "Project unavailable";
  const scope = usePortalScopeProps();
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="bb-fg-project-filter"
          aria-label={`Filter terminals: ${label}`}
          aria-keyshortcuts="Meta+p Control+p"
          title="Filter by project (Cmd/Ctrl+P)"
          onKeyDown={(event) => {
            if (event.key !== "Tab") isolateTerminalKey(event);
          }}
        >
          <span>{label}</span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...scope}
          ref={panel}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            if (!focusSearch) {
              event.preventDefault();
              panel.current?.focus({ preventScroll: true });
            }
          }}
          className="bb-fg-project-menu"
          align="end"
          sideOffset={6}
          aria-label="Filter by project"
          onKeyDown={isolateTerminalKey}
          onKeyUp={isolateTerminalKey}
          onKeyPress={isolateTerminalKey}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClose();
          }}
        >
          <Command label="Search projects" loop defaultValue={value}>
            <CommandInput
              autoFocus={focusSearch}
              aria-label="Search projects"
              placeholder="Search projects…"
            />
            <CommandList aria-label="Projects">
              <CommandEmpty>No projects found</CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.key}
                  value={option.key}
                  keywords={[option.label]}
                  onSelect={() => {
                    onChange(option.key);
                    onOpenChange(false);
                  }}
                >
                  <Icon
                    name="Check"
                    className={
                      value === option.key ? "size-3.5" : "size-3.5 invisible"
                    }
                  />
                  <span>{option.label}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

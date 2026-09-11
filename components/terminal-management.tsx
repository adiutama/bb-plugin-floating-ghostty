import { useEffect, useRef, useState } from "react";
import { containTab } from "../lib/keyboard";
import { tabName, type TabState } from "../lib/tabs";
import { ownerOf } from "../lib/context";
import type { ScopeOption } from "../lib/scopes";
import { Icon } from "./ui/icon";

export type ManagementMode = "rename" | "ownership" | "delete";
export function TerminalManagement({
  mode,
  tab,
  scopes,
  onName,
  onOwner,
  onDelete,
  onDismiss,
}: {
  mode: ManagementMode;
  tab: TabState;
  scopes: ScopeOption[];
  onName: (name: string | null) => Promise<void>;
  onOwner: (scopeKey: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [name, setName] = useState(tab.customTitle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    // Radix releases the action menu's focus scope after selection. Focus the
    // dialog once that scope has unmounted, including when opened by keyboard.
    const frame = requestAnimationFrame(() => {
      dialog.current
        ?.querySelector<HTMLElement>("[data-initial-focus]")
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const save = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onDismiss();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save changes.",
      );
    } finally {
      setBusy(false);
    }
  };
  const title =
    mode === "rename"
      ? "Rename terminal"
      : mode === "ownership"
        ? "Change ownership"
        : "Delete terminal";
  const owners = [
    { key: "global", label: "Global", kind: "All projects" },
    ...scopes
      .filter((scope) => scope.kind !== "home")
      .map((scope) => ({
        key: scope.key,
        label: scope.label,
        kind: scope.kind === "project" ? "Project" : "Worktree",
      })),
  ];
  const currentOwner =
    ownerOf(tab.scopeKey).kind === "home" ? "global" : tab.scopeKey;
  return (
    <div
      className="bb-fg-switcher-scrim"
      onPointerDown={() => {
        if (!busy) onDismiss();
      }}
    >
      <section
        ref={dialog}
        className="bb-fg-switcher bb-fg-management"
        role="dialog"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          containTab(event);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onDismiss();
          }
        }}
      >
        <div className="bb-fg-management-heading">
          <span>{title}</span>
          <button aria-label="Cancel" disabled={busy} onClick={onDismiss}>
            <Icon name="X" className="size-4" />
          </button>
        </div>
        {mode === "ownership" ? (
          <>
            <p className="bb-fg-management-note">
              Changes where this terminal appears. Its shell stays in place.
            </p>
            <div className="bb-fg-owner-choices">
              {owners.map((owner, index) => (
                <button
                  key={owner.key}
                  autoFocus={index === 0}
                  data-initial-focus={index === 0 ? "" : undefined}
                  disabled={busy}
                  aria-pressed={owner.key === currentOwner}
                  onClick={() => void save(() => onOwner(owner.key))}
                >
                  <span>{owner.label}</span>
                  <small>{owner.kind}</small>
                  {owner.key === currentOwner ? (
                    <Icon name="Check" className="size-4" />
                  ) : null}
                </button>
              ))}
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(
                mode === "rename"
                  ? () => onName(name.trim() || null)
                  : onDelete,
              );
            }}
          >
            {mode === "rename" ? (
              <>
                <input
                  autoFocus
                  data-initial-focus=""
                  aria-label="Terminal name"
                  maxLength={80}
                  value={name}
                  placeholder={tab.shellTitle ?? tab.label}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
                <p className="bb-fg-management-note">
                  Leave blank to follow the shell or running command.
                </p>
              </>
            ) : (
              <p className="bb-fg-management-note">
                Delete <strong>{tabName(tab)}</strong>? This stops its shell and
                running commands.
              </p>
            )}
            <div className="bb-fg-management-actions">
              <button
                type="button"
                autoFocus={mode === "delete"}
                data-initial-focus={mode === "delete" ? "" : undefined}
                onClick={onDismiss}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={mode === "delete" ? "bb-fg-danger" : "bb-fg-primary"}
                disabled={busy}
              >
                {busy ? "Saving…" : mode === "delete" ? "Delete" : "Save"}
              </button>
            </div>
          </form>
        )}
        {error ? (
          <p className="bb-fg-management-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { containTab } from "../lib/keyboard";
import { PROJECT_ENVIRONMENT_MAX_BYTES } from "../lib/project-environment-limits";
import type { rpcContract } from "../server";
import { Icon } from "./ui/icon";

export function ProjectEnvironmentManagement({
  rpc,
  projectId,
  projectLabel,
  onDismiss,
}: {
  rpc: PluginRpcClient<typeof rpcContract>;
  projectId: string;
  projectLabel: string;
  onDismiss: () => void;
}) {
  const [text, setText] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    void rpc
      .call("getProjectEnvironment", { projectId })
      .then((environment) => {
        if (!active) return;
        setText(environment.text);
        setRevision(environment.revision);
        setLoading(false);
        requestAnimationFrame(() => {
          dialog.current
            ?.querySelector<HTMLElement>("[data-initial-focus]")
            ?.focus();
        });
      })
      .catch((error) => {
        if (!active) return;
        setError(
          error instanceof Error
            ? error.message
            : "Could not load the project environment.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, rpc]);

  const save = async () => {
    if (busy || loading) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("saveProjectEnvironment", {
        projectId,
        text,
        expectedRevision: revision,
      });
      toast.success(
        text === ""
          ? `Cleared environment for ${projectLabel}`
          : `Saved ${result.keyCount} variable${result.keyCount === 1 ? "" : "s"} for ${projectLabel}`,
      );
      onDismiss();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save the project environment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="bb-fg-switcher-scrim bb-fg-management-scrim"
      onPointerDown={() => {
        if (!busy) onDismiss();
      }}
    >
      <section
        ref={dialog}
        className="bb-fg-switcher bb-fg-management bb-fg-environment"
        role="dialog"
        aria-label="Project environment"
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
          <span>Project environment</span>
          <button aria-label="Cancel" disabled={busy} onClick={onDismiss}>
            <Icon name="X" className="size-4" />
          </button>
        </div>
        {loading ? (
          <div className="bb-fg-environment-loading" role="status">
            <span className="bb-fg-loading-dot" /> Loading environment…
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label
              className="bb-fg-environment-label"
              htmlFor="bb-fg-project-environment"
            >
              {projectLabel}
            </label>
            <textarea
              id="bb-fg-project-environment"
              data-initial-focus=""
              aria-label={`Environment variables for ${projectLabel}`}
              value={text}
              maxLength={PROJECT_ENVIRONMENT_MAX_BYTES}
              placeholder={'DATABASE_URL="postgres://localhost/app"\nAPI_TOKEN=secret-value'}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="bb-fg-management-note">
              Applied to new and restarted shells in every worktree for this
              project.
            </p>
            <div className="bb-fg-management-actions">
              <button
                type="button"
                onClick={() => setText("")}
                disabled={busy || text === ""}
              >
                Clear
              </button>
              <span className="bb-fg-management-action-space" />
              <button type="button" onClick={onDismiss} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="bb-fg-primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
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

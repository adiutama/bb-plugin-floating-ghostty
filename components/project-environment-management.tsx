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
  environmentId,
  initialText,
  onDismiss,
}: {
  rpc: PluginRpcClient<typeof rpcContract>;
  projectId: string;
  projectLabel: string;
  environmentId?: string;
  initialText?: string;
  onDismiss: () => void;
}) {
  const [targets, setTargets] = useState<{ id: string; projectId?: string; environmentId?: string; name: string }[]>([]);
  const [destination, setDestination] = useState("");
  const [copyTarget, setCopyTarget] = useState<(typeof targets)[number] | null>(null);
  const [choosingCopy, setChoosingCopy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void rpc
      .call("getProjectEnvironment", { projectId, ...(environmentId ? { environmentId } : {}) })
      .then((environment) => {
        if (!active) return;
        setText(initialText ?? environment.text);
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
        setLoadFailed(true);
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
  }, [projectId, environmentId, initialText, rpc]);

  const save = async () => {
    if (busy || loading || loadFailed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("saveProjectEnvironment", {
        projectId,
        ...(environmentId ? { environmentId } : {}),
        text,
        expectedRevision: revision,
      });
      toast.success(
        text === ""
          ? `Cleared environment for ${projectLabel}`
          : `Saved ${result.keyCount} variable${result.keyCount === 1 ? "" : "s"} for ${projectLabel}`,
      );
      if (result.pendingHosts) toast.warning("Saved, but some terminal hosts could not be updated. They will retry automatically when their terminals reconnect.");
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

  const chooseCopy = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("listProjectEnvironments", { includeUnconfigured: true });
      setTargets(result.projects.filter((target) =>
        (target.projectId ?? target.id) !== projectId || target.environmentId !== environmentId));
      setChoosingCopy(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load destinations.");
    } finally { setBusy(false); }
  };

  if (copyTarget) return <ProjectEnvironmentManagement
    key={copyTarget.id} rpc={rpc}
    projectId={copyTarget.projectId ?? copyTarget.id}
    environmentId={copyTarget.environmentId} projectLabel={copyTarget.name}
    initialText={text} onDismiss={() => setCopyTarget(null)}
  />;

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
        aria-label="Environment variables"
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
          <span>Environment variables</span>
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
            {initialText !== undefined ? <p className="bb-fg-management-note">Review the copied variables below. Saving replaces the destination’s variables.</p> : null}
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
              disabled={busy || loadFailed}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="bb-fg-management-note">
              Applied at the next prompt only in this {environmentId ? "worktree" : "project’s default checkout"}.
              Copies are independent.
            </p>
            {choosingCopy ? <div className="bb-fg-environment-copy-panel">
              <label htmlFor="bb-fg-copy-destination">Copy to project or worktree</label>
              <select id="bb-fg-copy-destination" value={destination} disabled={busy}
                onChange={(event) => setDestination(event.target.value)}>
                <option value="">Choose destination…</option>
                {targets.map((target) => <option key={target.id} value={target.id}>
                  {target.name}{target.environmentId ? " · Worktree" : " · Default checkout"}
                </option>)}
              </select>
              <p className="bb-fg-management-note">Review the destination before saving. Its existing variables will be replaced.</p>
              <button type="button" disabled={!destination || busy} onClick={() => {
                setCopyTarget(targets.find((target) => target.id === destination) ?? null);
              }}>Review copy</button>
            </div> : null}
            <div className="bb-fg-management-actions">
              <button type="button" disabled={busy || loadFailed || !text} onClick={() => void chooseCopy()}>Copy to…</button>
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
              <button type="submit" className="bb-fg-primary" disabled={busy || loadFailed}>
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

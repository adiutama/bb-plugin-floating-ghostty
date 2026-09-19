import { useEffect, useRef, useState } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { containTab } from "../lib/keyboard";
import { parseProjectEnvironment } from "../lib/project-environment";
import { EnvironmentVariableEditor, type VariableScope, type VariableTexts } from "./environment-variable-editor";
import type { rpcContract } from "../server";
import { Icon } from "./ui/icon";

export function ProjectEnvironmentManagement({
  rpc,
  projectId,
  projectLabel,
  environmentId,
  initialText,
  onDismiss,
  initialScope,
  embedded = false,
}: {
  rpc: PluginRpcClient<typeof rpcContract>;
  projectId: string;
  projectLabel: string;
  environmentId?: string;
  initialText?: string;
  initialScope?: "global";
  embedded?: boolean;
  onDismiss: () => void;
}) {
  const defaultScope: VariableScope = initialScope ?? (environmentId ? "worktree" : "project");
  const scopes: VariableScope[] = initialScope === "global" ? ["global"] : environmentId ? ["global", "project", "worktree"] : ["global", "project"];
  const emptyTexts: VariableTexts = { global: "", project: "", worktree: "" };
  const [loadedTexts, setLoadedTexts] = useState<VariableTexts>(emptyTexts);
  const [texts, setTexts] = useState<VariableTexts>(emptyTexts);
  const [copyScope, setCopyScope] = useState(defaultScope);
  const scopeLabel = initialScope === "global" ? "Global" : projectLabel;
  const [targets, setTargets] = useState<{ id: string; projectId?: string; environmentId?: string; name: string }[]>([]);
  const [destination, setDestination] = useState("");
  const [copyTarget, setCopyTarget] = useState<(typeof targets)[number] | null>(null);
  const [choosingCopy, setChoosingCopy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revisions, setRevisions] = useState<Record<VariableScope, number>>({ global: 0, project: 0, worktree: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    setChoosingCopy(false);
    void Promise.all(scopes.map(async scope => ({ scope, ...await rpc.call("getProjectEnvironment", {
      projectId, ...(scope === "global" ? { scope: "global" as const } : {}), ...(scope === "worktree" ? { environmentId } : {}),
    }) })))
      .then((environments) => {
        if (!active) return;
        const loaded: VariableTexts = { global: "", project: "", worktree: "" };
        const versions = { global: 0, project: 0, worktree: 0 };
        for (const environment of environments) { loaded[environment.scope] = environment.text; versions[environment.scope] = environment.revision; }
        setLoadedTexts(loaded);
        setTexts(initialText !== undefined ? { ...loaded, [defaultScope]: initialText } : loaded);
        setRevisions(versions);
        setLoading(false);
        requestAnimationFrame(() => {
          if (embedded) dialog.current?.focus({ preventScroll: true });
          else dialog.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
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
  }, [projectId, environmentId, initialScope, initialText, rpc]);

  const save = async () => {
    if (busy || loading || loadFailed) return;
    setBusy(true);
    setError(null);
    try {
      for (const scope of scopes) {
        try { parseProjectEnvironment(texts[scope]); }
        catch (error) { throw new Error(`${scope[0]!.toUpperCase() + scope.slice(1)}: ${(error as Error).message}`); }
      }
      const layers = scopes.filter(scope => texts[scope] !== loadedTexts[scope]).map(scope => ({ scope, text: texts[scope], expectedRevision: revisions[scope] }));
      if (!layers.length) { onDismiss(); return; }
      const result = await rpc.call("saveEnvironmentDefinitions", { projectId, ...(environmentId ? { environmentId } : {}), layers });
      toast.success(`Saved environment variables for ${scopeLabel}`);
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
        (target.projectId ?? target.id) !== projectId || target.environmentId !== environmentId || initialScope === "global"));
      setChoosingCopy(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load destinations.");
    } finally { setBusy(false); }
  };

  if (copyTarget) return <ProjectEnvironmentManagement
    key={copyTarget.id} rpc={rpc}
    projectId={copyTarget.projectId ?? copyTarget.id}
    environmentId={copyTarget.environmentId} projectLabel={copyTarget.name}
    initialText={texts[copyScope]} embedded={embedded} onDismiss={() => setCopyTarget(null)}
  />;

  return (
    <div
      className={embedded ? "bb-fg-environment-pane" : "bb-fg-switcher-scrim bb-fg-management-scrim"}
      onPointerDown={() => {
        if (!embedded && !busy) onDismiss();
      }}
    >
      <section
        ref={dialog}
        tabIndex={embedded ? -1 : undefined}
        className="bb-fg-switcher bb-fg-management bb-fg-environment"
        role={embedded ? "region" : "dialog"}
        aria-label="Environment variables"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return;
          if (!embedded) containTab(event);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onDismiss();
          }
        }}
      >
        <div className="bb-fg-management-heading">
          <span>Environment variables</span>
          {!embedded ? <button aria-label="Cancel" disabled={busy} onClick={onDismiss}>
            <Icon name="X" className="size-4" />
          </button> : null}
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
            <div className="bb-fg-environment-label">
              {scopeLabel}
            </div>
            {initialText !== undefined ? <p className="bb-fg-management-note">Review the copied variables below. Saving replaces the destination’s {defaultScope} variables.</p> : null}
            <EnvironmentVariableEditor texts={texts} onChange={setTexts} scopes={scopes} defaultScope={defaultScope}
              disabled={busy || loadFailed} label={scopeLabel} onCopy={() => void chooseCopy()}
              onDiscard={JSON.stringify(texts) !== JSON.stringify(loadedTexts) ? () => setTexts(loadedTexts) : undefined} />
            {choosingCopy ? <div className="bb-fg-environment-copy-panel">
              <label htmlFor="bb-fg-copy-source">Copy definitions from</label>
              <select id="bb-fg-copy-source" value={copyScope} onChange={event => setCopyScope(event.target.value as VariableScope)}>
                {scopes.map(scope => <option key={scope} value={scope}>{scope[0]!.toUpperCase() + scope.slice(1)}</option>)}
              </select>
              <label htmlFor="bb-fg-copy-destination">Copy to project or worktree</label>
              <select id="bb-fg-copy-destination" value={destination} disabled={busy}
                onChange={(event) => setDestination(event.target.value)}>
                <option value="">Choose destination…</option>
                {targets.map((target) => <option key={target.id} value={target.id}>
                  {target.name}{target.environmentId ? " · Worktree" : " · Project"}
                </option>)}
              </select>
              <p className="bb-fg-management-note">Review the destination before saving. Its existing variables will be replaced.</p>
              <button type="button" disabled={!destination || busy} onClick={() => {
                setCopyTarget(targets.find((target) => target.id === destination) ?? null);
              }}>Review copy</button>
            </div> : null}
            <div className="bb-fg-management-actions">
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

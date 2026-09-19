import { useEffect, useState } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { parseProjectEnvironment, type ProjectEnvironmentEntry } from "../lib/project-environment";

export type EnvironmentTarget = { id: string; projectId?: string; environmentId?: string; name: string };
export function mergeVariables(existing: ProjectEnvironmentEntry[], incoming: ProjectEnvironmentEntry[]) {
  const merged = new Map(existing.map(entry => [entry.key, entry]));
  for (const entry of incoming) merged.set(entry.key, entry);
  return [...merged.values()];
}

function copyableVariables(target: EnvironmentTarget, projectId: string, environment: { text: string; inherited?: (ProjectEnvironmentEntry & { source: string })[] }) {
  const effective = new Map((environment.inherited ?? []).map(item => [item.key, item]));
  for (const item of parseProjectEnvironment(environment.text)) if (item.enabled !== false)
    effective.set(item.key, { ...item, source: target.environmentId ? "worktree" : "project" });
  const sameProject = (target.projectId ?? target.id) === projectId;
  return [...effective.values()].filter(item => item.source === "worktree" || (!sameProject && item.source === "project"));
}

export function EnvironmentCopyPicker({ rpc, projectId, environmentId, entry, localText, onClose, onImport, onExport }: {
  rpc: PluginRpcClient<typeof rpcContract>; projectId: string; environmentId?: string;
  entry?: ProjectEnvironmentEntry; localText: string; onClose: () => void;
  onImport: (entries: ProjectEnvironmentEntry[]) => void;
  onExport: (target: EnvironmentTarget, entries: ProjectEnvironmentEntry[]) => void;
}) {
  const [targets, setTargets] = useState<EnvironmentTarget[]>([]);
  const [project, setProject] = useState(projectId);
  const [eligible, setEligible] = useState<{ project: string; ids: string[] } | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [candidates, setCandidates] = useState<(ProjectEnvironmentEntry & { source?: string })[]>([]);
  const [existing, setExisting] = useState<ProjectEnvironmentEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [replace, setReplace] = useState<string[]>([]);
  const [listing, setListing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find(item => item.id === targetId);
  useEffect(() => {
    let active = true;
    rpc.call("listProjectEnvironments", { includeUnconfigured: true }).then(result => {
      if (!active) return;
      setTargets(result.projects);
      setListing(false);
    }).catch(error => { if (active) { setError(String(error)); setListing(false); } });
    return () => { active = false; };
  }, [rpc]);
  useEffect(() => {
    setCandidates([]); setSelected([]); setReplace([]); setError(null);
    if (!target) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    rpc.call("getProjectEnvironment", { projectId: target.projectId ?? target.id, ...(target.environmentId ? { environmentId: target.environmentId } : {}) }).then(result => {
      if (!active) return;
      const local = parseProjectEnvironment(result.text);
      if (entry) {
        setCandidates([entry]); setSelected([entry.key]); setExisting(local);
      } else {
        setCandidates(copyableVariables(target, projectId, result));
        setExisting(parseProjectEnvironment(localText));
      }
      setLoading(false);
    }).catch(error => { if (active) { setError(String(error)); setLoading(false); } });
    return () => { active = false; };
  }, [target, entry, localText, projectId, rpc]);
  useEffect(() => {
    if (entry || listing) return;
    let active = true;
    setEligible(null);
    setSourceError(null);
    const sources = targets.filter(item => (item.projectId ?? item.id) === project && (project !== projectId || !!item.environmentId) && !((item.projectId ?? item.id) === projectId && item.environmentId === environmentId));
    void Promise.allSettled(sources.map(async source => {
      const result = await rpc.call("getProjectEnvironment", { projectId: source.projectId ?? source.id, ...(source.environmentId ? { environmentId: source.environmentId } : {}) });
      // A worktree must contribute a definition of its own. Inherited
      // project values are available once via the project-scope source.
      const available = source.environmentId
        ? parseProjectEnvironment(result.text).some(item => item.enabled !== false)
        : copyableVariables(source, projectId, result).length > 0;
      return available ? source.id : null;
    })).then(results => {
      if (!active) return;
      setEligible({ project, ids: results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []) });
      if (results.some(result => result.status === "rejected")) setSourceError("Some sources could not be checked. Reopen Copy from to retry.");
    });
    return () => { active = false; };
  }, [targets, project, projectId, environmentId, entry, listing, rpc]);
  const checkingSources = !entry && (listing || eligible?.project !== project);
  const projects = new Map(targets.filter(item => !item.environmentId).map(item => [item.projectId ?? item.id, item.name]));
  if (!projects.has(projectId)) projects.set(projectId, "Current project");
  const choices = targets.filter(item => (item.projectId ?? item.id) === project && (entry || eligible?.project === project && eligible.ids.includes(item.id)) && (entry || project !== projectId || !!item.environmentId) && !((item.projectId ?? item.id) === projectId && item.environmentId === environmentId));
  const additions = candidates.filter(item => selected.includes(item.key) && (!existing.some(old => old.key === item.key) || replace.includes(item.key)));
  return <div className="bb-fg-copy-picker" role="region" aria-label={entry ? "Copy variable to" : "Copy variables from"}>
    <div className="bb-fg-env-toolbar"><strong>{entry ? `Copy ${entry.key} to…` : "Copy from…"}</strong><button type="button" onClick={onClose}>Cancel copy</button></div>
    <div className="bb-fg-copy-selectors">
      <label>Project<select aria-label="Copy project" value={project} onChange={event => { setProject(event.target.value); setTargetId(""); }}>
        {[...projects].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>{entry ? "Destination" : "Source"}<select aria-label={entry ? "Copy destination" : "Copy source"} value={targetId} disabled={checkingSources || !choices.length} onChange={event => setTargetId(event.target.value)}>
        <option value="">{checkingSources ? "Checking sources…" : !choices.length ? "No available worktrees" : "Choose worktree…"}</option>
        {choices.map(item => <option key={item.id} value={item.id}>{item.name}{item.environmentId ? "" : " · Project scope"}</option>)}
      </select></label>
    </div>
    {sourceError ? <p role="alert">{sourceError}</p> : null}
    {listing || loading || checkingSources ? <p role="status">Loading variables…</p> : error ? <p role="alert">{error}</p> : target ? <>
      <div className="bb-fg-copy-variables">
        {candidates.length ? candidates.map(item => {
          const conflict = existing.some(old => old.key === item.key);
          return <div className="bb-fg-copy-variable" key={item.key}>
            <label><input type="checkbox" aria-label={`Copy ${item.key}`} checked={selected.includes(item.key)} onChange={event => setSelected(event.target.checked ? [...selected, item.key] : selected.filter(key => key !== item.key))} /><code>{item.key}</code></label>
            <span className="bb-fg-copy-value">{item.value || "(empty)"}{conflict ? <small className="bb-fg-copy-existing">Existing: {existing.find(old => old.key === item.key)?.value || "(empty)"}</small> : null}</span>
            {conflict ? <select aria-label={`Conflict for ${item.key}`} value={replace.includes(item.key) ? "replace" : "keep"} onChange={event => setReplace(event.target.value === "replace" ? [...replace, item.key] : replace.filter(key => key !== item.key))}>
              <option value="keep">Keep existing</option><option value="replace">Replace</option>
            </select> : <small>{item.enabled === false ? "Disabled" : item.source ?? "New variable"}</small>}
          </div>;
        }) : <p>No eligible variables to copy from this source.</p>}
      </div>
      <p className="bb-fg-env-hint">Unrelated variables stay unchanged. Copies are independent and only apply after Save.</p>
      <button type="button" className="bb-fg-copy-apply" disabled={!additions.length} onClick={() => {
        const definitions = additions.map(({ key, value, enabled }) => ({ key, value, ...(enabled === false ? { enabled: false } : {}) }));
        if (entry) onExport(target, definitions); else onImport(definitions);
      }}>{entry ? "Review destination" : "Add selected"}</button>
    </> : <p className="bb-fg-env-hint">{!entry && !choices.length ? "No worktrees in this project have variables available to copy." : `Choose a ${entry ? "destination" : "source"} to review its variables.`}</p>}
  </div>;
}

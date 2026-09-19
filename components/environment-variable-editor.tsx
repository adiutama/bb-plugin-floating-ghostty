import { useEffect, useRef, useState } from "react";
import { DISABLED_VARIABLE_PREFIX, parseProjectEnvironment, type ProjectEnvironmentEntry } from "../lib/project-environment";
import { PROJECT_ENVIRONMENT_MAX_BYTES } from "../lib/project-environment-limits";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

export type VariableScope = "global" | "project" | "worktree";
export type VariableTexts = Record<VariableScope, string>;
type Row = ProjectEnvironmentEntry & { scope: VariableScope; id: number; revealed: boolean };
let nextId = 0;
const row = (entry: ProjectEnvironmentEntry = { key: "", value: "" }, scope: VariableScope = "worktree"): Row => ({ ...entry, scope, id: nextId++, revealed: false });
export const serializeVariables = (rows: ProjectEnvironmentEntry[]) => rows
  .filter(({ key, value }) => key !== "" || value !== "")
  .map(({ key, value, enabled }) => `${enabled === false ? DISABLED_VARIABLE_PREFIX : ""}${key}=${('"' + value.replace(/[\\"\n\r\t]/g, character => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[character]!) + '"')}`).join("\n");

export function EnvironmentVariableEditor({ texts, onChange, scopes, defaultScope, disabled, label, onCopy, onDiscard }: {
  texts: VariableTexts; onChange: (texts: VariableTexts) => void; scopes: VariableScope[]; defaultScope: VariableScope;
  disabled: boolean; label: string; onCopy?: () => void; onDiscard?: () => void;
}) {
  const [rawScope, setRawScope] = useState(defaultScope);
  const text = texts[rawScope];
  const fingerprint = JSON.stringify(texts);
  const [rows, setRows] = useState<Row[]>([]);
  const [help, setHelp] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownText = useRef<string | null>(null);
  useEffect(() => {
    if (ownText.current === fingerprint) return;
    try {
      setRows(scopes.flatMap(scope => parseProjectEnvironment(texts[scope]).map(entry => row(entry, scope))));
      setError(null);
    } catch { setRaw(true); }
  }, [fingerprint]);
  const update = (next: Row[]) => {
    setRows(next);
    const value = Object.fromEntries((["global", "project", "worktree"] as const).map(scope => {
      const serialized = serializeVariables(next.filter(item => item.scope === scope));
      try {
        if (JSON.stringify(parseProjectEnvironment(serialized)) === JSON.stringify(parseProjectEnvironment(texts[scope]))) return [scope, texts[scope]];
      } catch { /* Keep incomplete edits for validation on Save. */ }
      return [scope, serialized];
    })) as VariableTexts;
    ownText.current = JSON.stringify(value);
    onChange(value);
    setError(null);
  };
  const toggleMode = () => {
    if (raw) {
      try {
        setRows(scopes.flatMap(scope => parseProjectEnvironment(texts[scope]).map(entry => row(entry, scope))));
        setError(null);
      } catch (error) { setError((error as Error).message); return; }
    }
    setRaw(!raw);
  };
  const priority = { global: 0, project: 1, worktree: 2 };
  return <div className="bb-fg-env-editor" ref={container}>
    <div className="bb-fg-env-toolbar">
      <span>{raw ? ".env" : "Variables"}</span>
      <div className="bb-fg-env-tools">
        <button type="button" aria-label="Environment help" aria-expanded={help} onClick={() => setHelp(!help)}><Icon name="Info" className="size-3.5" /></button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" aria-label="Variable actions" disabled={disabled}><Icon name="MoreHorizontal" className="size-4" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onKeyDown={event => event.stopPropagation()}>
            <DropdownMenuItem onSelect={toggleMode}>{raw ? "Key / value editor" : "Edit as .env"}</DropdownMenuItem>
            {onCopy ? <DropdownMenuItem disabled={!Object.values(texts).some(Boolean)} onSelect={onCopy}>Copy to…</DropdownMenuItem> : null}
            <DropdownMenuItem disabled={!Object.values(texts).some(Boolean)} onSelect={() => { update([]); }}>Clear</DropdownMenuItem>
            {onDiscard ? <DropdownMenuItem onSelect={onDiscard}>Discard edits</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    {help ? <p className="bb-fg-env-hint">The same key can exist in different scopes. Worktree wins over project, then global. Changing scope moves the definition. Disabled variables stay saved but do not apply; an enabled parent value can take effect. Changes apply at the next shell prompt. Paste .env contents into a key field to add multiple variables.</p> : null}
    {raw ? <><select className="bb-fg-env-raw-scope" aria-label="Scope for .env editor" value={rawScope} onChange={event => setRawScope(event.target.value as VariableScope)} disabled={disabled}>{scopes.map(scope => <option key={scope} value={scope}>{scope}</option>)}</select><textarea data-initial-focus="" aria-label={`Environment variables for ${label}`}
      value={text} maxLength={PROJECT_ENVIRONMENT_MAX_BYTES} disabled={disabled}
      spellCheck={false} autoCapitalize="off" autoComplete="off"
      placeholder={'API_KEY=your-value\nDATABASE_URL=postgres://…'}
      onChange={event => { ownText.current = null; onChange({ ...texts, [rawScope]: event.target.value }); }} /></> : <>
      {rows.length ? <div className="bb-fg-env-columns" aria-hidden="true"><span /><span>Key</span><span>Value</span><span>Scope</span><span /></div> : <p className="bb-fg-env-empty">No variables yet.</p>}
      <div className="bb-fg-env-rows">
        {rows.map((item, index) => <div className="bb-fg-env-row" key={item.id} data-disabled={item.enabled === false} data-shadowed={rows.some(other => other.enabled !== false && other.key === item.key && priority[other.scope] > priority[item.scope])} title={item.enabled === false ? "Disabled — saved but not applied" : rows.some(other => other.enabled !== false && other.key === item.key && priority[other.scope] > priority[item.scope]) ? "Overridden by a more specific scope" : "Applies here"}>
          <input type="checkbox" role="switch" className="bb-fg-env-toggle" aria-label={`Variable ${index + 1} enabled`}
            checked={item.enabled !== false} disabled={disabled}
            onChange={event => update(rows.map(r => r.id === item.id ? { ...r, enabled: event.target.checked ? undefined : false } : r))} />
          <input data-initial-focus={index === 0 ? "" : undefined} aria-label={`Key ${index + 1}`}
            pattern="[A-Za-z_][A-Za-z0-9_]*" title="Use letters, numbers, and underscores; start with a letter or underscore." required={Boolean(item.value)} placeholder="VARIABLE_NAME" value={item.key} disabled={disabled} autoCapitalize="off" autoComplete="off" spellCheck={false}
            onChange={event => update(rows.map(r => r.id === item.id ? { ...r, key: event.target.value } : r))}
            onPaste={event => {
              const pasted = event.clipboardData.getData("text");
              if (!pasted.includes("=")) return;
              event.preventDefault();
              try {
                const imported = parseProjectEnvironment(pasted);
                const next = rows.flatMap(r => r.id === item.id && !r.key && !r.value ? [] : [r]).concat(imported.map(entry => row(entry, item.scope)));
                for (const scope of scopes) parseProjectEnvironment(serializeVariables(next.filter(item => item.scope === scope)));
                update(next);
              } catch (error) { setError((error as Error).message); }
            }} />
          <div className="bb-fg-env-value">
            {item.revealed ? <textarea aria-label={`Value ${index + 1}`} value={item.value} disabled={disabled} rows={1}
              autoComplete="off" spellCheck={false} onChange={event => update(rows.map(r => r.id === item.id ? { ...r, value: event.target.value } : r))} /> :
              <input type="password" aria-label={`Value ${index + 1}`} placeholder="Enter value" value={item.value}
                disabled={disabled} autoComplete="new-password" onChange={event => update(rows.map(r => r.id === item.id ? { ...r, value: event.target.value } : r))} />}
            <button type="button" aria-label={`${item.revealed ? "Hide" : "Show"} value ${index + 1}`} disabled={disabled}
              onClick={() => setRows(rows.map(r => r.id === item.id ? { ...r, revealed: !r.revealed } : r))}>
              <Icon name={item.revealed ? "EyeOff" : "Eye"} className="size-4" />
            </button>
          </div>
          <select aria-label={`Scope ${index + 1}`} value={item.scope} disabled={disabled} onChange={event => update(rows.map(r => r.id === item.id ? { ...r, scope: event.target.value as VariableScope } : r))}>
            {scopes.map(scope => <option key={scope} value={scope}>{scope[0]!.toUpperCase() + scope.slice(1)}</option>)}
          </select>
          <button type="button" className="bb-fg-env-remove" aria-label={`Remove variable ${index + 1}`} disabled={disabled}
            onClick={() => update(rows.filter(r => r.id !== item.id))}><Icon name="Trash2" className="size-4" /></button>
        </div>)}
      </div>
      <button type="button" data-initial-focus={rows.length === 0 ? "" : undefined} className="bb-fg-env-add" disabled={disabled} onClick={() => { setRows([...rows, row(undefined, defaultScope)]); requestAnimationFrame(() => container.current?.querySelector<HTMLInputElement>(`input[aria-label="Key ${rows.length + 1}"]`)?.focus()); }}><Icon name="Plus" className="size-3.5" /> Add variable</button>
    </>}
    {error ? <p role="alert" className="bb-fg-management-error">{error}</p> : null}
  </div>;
}

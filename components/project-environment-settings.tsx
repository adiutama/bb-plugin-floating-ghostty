import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { ProjectEnvironmentManagement } from "./project-environment-management";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface ProjectEnvironmentSummary {
  id: string;
  name: string;
  configured: boolean;
  keyCount: number;
  updatedAt: string | null;
}

function updatedLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ProjectEnvironmentSettings({
  rpc,
}: {
  rpc: PluginRpcClient<typeof rpcContract>;
}) {
  const [projects, setProjects] = useState<ProjectEnvironmentSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProjectEnvironmentSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await rpc.call("listProjectEnvironments", null);
      setProjects(result.projects);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load project environments.",
      );
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects.filter((project) => {
      if (!project.configured) return false;
      if (needle && !project.name.toLocaleLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [projects, query]);

  return (
    <div className="bb-fg-project-environment-settings">
      <div className="bb-fg-project-environment-tools">
        <Input
          aria-label="Search projects"
          placeholder="Search projects…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="bb-fg-settings-status" role="status">
          <span className="bb-fg-loading-dot" /> Loading projects…
        </div>
      ) : error ? (
        <div className="bb-fg-settings-error" role="alert">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : visibleProjects.length === 0 ? (
        <p className="bb-fg-settings-status">
          {projects.length === 0
            ? "No configured project environments."
            : "No configured environments match your search."}
        </p>
      ) : (
        <div className="bb-fg-project-environment-list">
          {visibleProjects.map((project) => {
            const lastUpdated = updatedLabel(project.updatedAt);
            return (
              <div className="bb-fg-project-environment-row" key={project.id}>
                <div className="bb-fg-project-environment-copy">
                  <div className="bb-fg-project-environment-name">
                    <span>{project.name}</span>
                    <Badge variant="secondary">
                      {`${project.keyCount} variable${project.keyCount === 1 ? "" : "s"}`}
                    </Badge>
                  </div>
                  {lastUpdated ? (
                    <span className="bb-fg-project-environment-updated">
                      Updated {lastUpdated}
                    </span>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Edit environment for ${project.name}`}
                  onClick={() => setSelected(project)}
                >
                  Edit
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {selected ? (
        <ProjectEnvironmentManagement
          rpc={rpc}
          projectId={selected.id}
          projectLabel={selected.name}
          onDismiss={() => {
            setSelected(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

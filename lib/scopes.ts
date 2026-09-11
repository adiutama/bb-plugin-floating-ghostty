// A creation destination combines stable ownership with an explicit execution location.
export interface ScopeOption {
  key: string;
  label: string;
  detail: string;
  hostName: string;
  online: boolean;
  kind: "project" | "home" | "worktree";
  hostId?: string;
}

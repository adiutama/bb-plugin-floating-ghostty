// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EnvironmentCopyPicker, mergeVariables } from "../components/environment-copy-picker";
afterEach(cleanup);
const projects = [
  { id: "A", projectId: "A", name: "Alpha" },
  { id: "one", projectId: "A", environmentId: "one", name: "Alpha / one" },
  { id: "two", projectId: "A", environmentId: "two", name: "Alpha / two" },
  { id: "B", projectId: "B", name: "Beta" },
  { id: "other", projectId: "B", environmentId: "other", name: "Beta / other" },
];
it("browses projects, selects effective keys, and keeps conflicts unless explicitly replaced", async () => {
  const onImport = vi.fn();
  const call = vi.fn(async (method: string) => method === "listProjectEnvironments" ? { projects } : {
    text: 'TOKEN=local\n# @bb-disabled FALLBACK=off', revision: 1,
    inherited: [{ key: "TOKEN", value: "parent", source: "project" }, { key: "FALLBACK", value: "global", source: "global" }, { key: "PROJECT_ONLY", value: "shared", source: "project" }],
  });
  const view = render(<EnvironmentCopyPicker rpc={{ call } as any} projectId="A" environmentId="one" localText="TOKEN=existing\nUNRELATED=keep" onClose={() => {}} onImport={onImport} onExport={() => {}} />);
  await waitFor(() => expect(view.getByRole("option", { name: "Alpha / two" })).toBeTruthy());
  expect(view.getByLabelText("Copy project")).toHaveProperty("value", "A");
  expect(view.queryByRole("option", { name: "Alpha / one" })).toBeNull();
  fireEvent.change(view.getByLabelText("Copy source"), { target: { value: "two" } });
  fireEvent.click(await view.findByLabelText("Copy TOKEN"));
  expect(view.getByLabelText("Conflict for TOKEN")).toHaveProperty("value", "keep");
  expect(view.getByRole("button", { name: "Add selected" })).toHaveProperty("disabled", true);
  fireEvent.change(view.getByLabelText("Conflict for TOKEN"), { target: { value: "replace" } });
  expect(view.queryByLabelText("Copy FALLBACK")).toBeNull();
  expect(view.queryByLabelText("Copy PROJECT_ONLY")).toBeNull();
  expect(view.queryByRole("option", { name: "Alpha · Project scope" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Add selected" }));
  expect(onImport).toHaveBeenCalledWith([{ key: "TOKEN", value: "local" }]);
  expect(call.mock.calls.some(([method]) => method.startsWith("save"))).toBe(false);
  fireEvent.change(view.getByLabelText("Copy project"), { target: { value: "B" } });
  expect(await view.findByRole("option", { name: "Beta / other" })).toBeTruthy();
  expect(view.queryByLabelText("Copy TOKEN")).toBeNull();
  fireEvent.change(view.getByLabelText("Copy source"), { target: { value: "other" } });
  expect(await view.findByLabelText("Copy PROJECT_ONLY")).toBeTruthy();
  expect(view.getByLabelText("Copy TOKEN")).toBeTruthy();
  expect(view.queryByLabelText("Copy FALLBACK")).toBeNull();
});
it("merges a copied variable while preserving unrelated definitions and disabled state", () => {
  expect(mergeVariables([{ key: "KEEP", value: "yes" }, { key: "X", value: "old" }], [{ key: "X", value: "new", enabled: false }])).toEqual([
    { key: "KEEP", value: "yes" }, { key: "X", value: "new", enabled: false },
  ]);
});

it("hides empty, disabled-only and shared-only sources but retains empty destinations", async () => {
  const extra = [
    ...projects,
    { id: "empty", projectId: "A", environmentId: "empty", name: "Alpha / empty" },
    { id: "disabled", projectId: "A", environmentId: "disabled", name: "Alpha / disabled" },
  ];
  const call = vi.fn(async (method: string, input: any) => method === "listProjectEnvironments" ? { projects: extra } : {
    text: input.environmentId === "two" ? "LOCAL=yes" : input.environmentId === "disabled" ? "# @bb-disabled OFF=no" : "",
    inherited: [{ key: "SHARED", value: "yes", source: "project" }, { key: "GLOBAL", value: "yes", source: "global" }], revision: 0,
  });
  const props = { rpc: { call } as any, projectId: "A", environmentId: "one", localText: "", onClose: () => {}, onImport: () => {}, onExport: () => {} };
  const view = render(<EnvironmentCopyPicker {...props} />);
  await view.findByRole("option", { name: "Alpha / two" });
  expect(view.queryByRole("option", { name: "Alpha / empty" })).toBeNull();
  expect(view.queryByRole("option", { name: "Alpha / disabled" })).toBeNull();
  fireEvent.change(view.getByLabelText("Copy project"), { target: { value: "B" } });
  // Project values have their own source; they do not make empty worktrees eligible.
  expect(await view.findByRole("option", { name: "Beta · Project scope" })).toBeTruthy();
  expect(view.queryByRole("option", { name: "Beta / other" })).toBeNull();
  view.unmount();
  const destination = render(<EnvironmentCopyPicker {...props} entry={{ key: "X", value: "new" }} />);
  expect(await destination.findByRole("option", { name: "Alpha / empty" })).toBeTruthy();
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ProjectEnvironmentManagement } from "../components/project-environment-management";
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

afterEach(cleanup);
it("loads every definition and saves a scope move atomically", async () => {
  const call = vi.fn(async (method: string, input: any) => method === "getProjectEnvironment"
    ? { text: input.scope === "global" ? "" : input.environmentId ? "TOKEN=local" : "TOKEN=parent", revision: 4 }
    : { keyCount: 1 });
  const view = render(<ProjectEnvironmentManagement rpc={{ call } as any} projectId="A" environmentId="one" projectLabel="Alpha / one" onDismiss={() => {}} />);
  expect(await view.findByLabelText("Key 1")).toHaveProperty("value", "TOKEN");
  expect(view.getByLabelText("Key 2")).toHaveProperty("value", "TOKEN");
  fireEvent.change(view.getByLabelText("Scope 2"), { target: { value: "global" } });
  fireEvent.click(view.getByText("Save"));
  await waitFor(() => expect(call).toHaveBeenCalledWith("saveEnvironmentDefinitions", {
    projectId: "A", environmentId: "one", layers: [
      { scope: "global", text: 'TOKEN="local"', expectedRevision: 4 },
      { scope: "worktree", text: "", expectedRevision: 4 },
    ],
  }));
});
it("rejects duplicate keys in the same scope without saving", async () => {
  const call = vi.fn(async (method: string, input: any) => ({ text: input.scope ? "" : "TOKEN=existing", revision: 1 }));
  const view = render(<ProjectEnvironmentManagement rpc={{ call } as any} projectId="A" environmentId="one" projectLabel="Alpha / one" onDismiss={() => {}} />);
  await view.findByLabelText("Scope 2");
  fireEvent.change(view.getByLabelText("Scope 2"), { target: { value: "project" } });
  fireEvent.click(view.getByText("Save"));
  expect(await view.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("assigned more than once"));
  expect(call.mock.calls.some(([method]) => method === "saveEnvironmentDefinitions")).toBe(false);
});

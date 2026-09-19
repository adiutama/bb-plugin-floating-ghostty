// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { act, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

it("browses and edits project environments from plugin settings", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const section = app.settingsSections.find(
    (candidate) => candidate.id === "project-environments",
  );
  expect(section).toMatchObject({
    title: "Project environments",
  });

  let environment = { text: "TOKEN=existing", revision: 3 };
  const slot = renderSlot(
    section!,
    {},
    {
      rpc: {
        listProjectEnvironments: () => ({
          projects: [
            {
              id: "B",
              name: "Beta",
              configured: false,
              keyCount: 0,
              updatedAt: null,
            },
            {
              id: "C",
              name: "Gamma",
              configured: true,
              keyCount: 3,
              updatedAt: "2026-09-12T08:00:00.000Z",
            },
            {
              id: "A",
              name: "Alpha",
              configured: true,
              keyCount: 1,
              updatedAt: "2026-09-13T08:00:00.000Z",
            },
          ],
        }),
        getProjectEnvironment: (input: any) => input.scope === "global" ? { text: "", revision: 0 } : environment,
        saveEnvironmentDefinitions: (input: unknown) => {
          const value = (input as { layers: { text: string; expectedRevision: number }[] }).layers[0]!;
          environment = {
            text: value.text,
            revision: value.expectedRevision + 1,
          };
          return { revision: environment.revision, keyCount: 1 };
        },
      },
    },
  );

  try {
    expect(await slot.findByText("Alpha")).toBeTruthy();
    expect(slot.getByText("1 variable")).toBeTruthy();
    expect(slot.getByText("Beta")).toBeTruthy();
    expect(slot.getByText("Gamma")).toBeTruthy();

    fireEvent.change(slot.getByRole("textbox", { name: "Search projects" }), {
      target: { value: "alp" },
    });
    expect(slot.queryByText("Gamma")).toBeNull();

    await act(async () =>
      fireEvent.click(
        slot.getByRole("button", { name: "Edit environment for Alpha" }),
      ),
    );
    const dialog = await slot.findByRole("dialog", {
      name: "Environment variables",
    });
    expect(
      dialog.parentElement?.classList.contains("bb-fg-management-scrim"),
    ).toBe(true);
    await act(async () => fireEvent.keyDown(await within(dialog).findByRole("button", { name: "Variable actions" }), { key: "Enter" }));
    await act(async () => fireEvent.click(within(document.body).getByRole("menuitem", { name: "Edit as .env" })));
    const editor = await within(dialog).findByRole("textbox", {
      name: "Environment variables for Alpha",
    });
    expect((editor as HTMLTextAreaElement).value).toBe("TOKEN=existing");
    fireEvent.change(editor, { target: { value: "TOKEN=updated" } });
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" })),
    );

    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "saveEnvironmentDefinitions")
        .map((call) => call.input),
    ).toEqual([
      {
        projectId: "A",
        layers: [{ scope: "project", text: "TOKEN=updated", expectedRevision: 3 }],
      },
    ]);
  } finally {
    slot.lifecycle.unmount();
  }
}, 30000);

it("reviews a copy into a worktree and saves using the destination revision", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const section = app.settingsSections.find((item) => item.id === "project-environments")!;
  const slot = renderSlot(section, {}, { rpc: {
    listProjectEnvironments: () => ({ projects: [
      { id: "A", projectId: "A", name: "Alpha", configured: true, keyCount: 1, updatedAt: null },
      { id: "worktree", projectId: "B", environmentId: "feature", name: "Beta / feature", configured: true, keyCount: 1, updatedAt: null },
    ] }),
    getProjectEnvironment: (input: any) => input.scope === "global" ? { text: "", revision: 0 } : input.environmentId
      ? { text: "OLD=destination", revision: 7 } : { text: "TOKEN=source", revision: 2 },
    saveEnvironmentDefinitions: () => ({ revision: 8, keyCount: 1 }),
  } });
  try {
    const edit = await slot.findByRole("button", { name: "Edit environment for Alpha" });
    await act(async () => fireEvent.click(edit));
    await slot.findByLabelText("Key 1");
    await act(async () => fireEvent.keyDown(slot.getByRole("button", { name: "Variable actions" }), { key: "Enter" }));
    await act(async () => fireEvent.click(within(document.body).getByRole("menuitem", { name: "Copy to…" })));
    fireEvent.change(slot.getByLabelText("Copy to project or worktree"), { target: { value: "worktree" } });
    await act(async () => fireEvent.click(slot.getByRole("button", { name: "Review copy" })));
    expect(await slot.findByLabelText("Value 1")).toHaveProperty("value", "source");
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "saveEnvironmentDefinitions")).toHaveLength(0);
    await act(async () => fireEvent.click(slot.getByRole("button", { name: "Save" })));
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "saveEnvironmentDefinitions").map((call) => call.input)).toEqual([
      { projectId: "B", environmentId: "feature", layers: [{ scope: "worktree", text: "TOKEN=source", expectedRevision: 7 }] },
    ]);
  } finally { slot.lifecycle.unmount(); }
}, 30000);

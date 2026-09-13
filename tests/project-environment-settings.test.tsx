// @vitest-environment jsdom
import { expect, it } from "vitest";
import { act, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

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
        getProjectEnvironment: () => environment,
        saveProjectEnvironment: (input: unknown) => {
          const value = input as { text: string; expectedRevision: number };
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
    expect(slot.queryByText("Beta")).toBeNull();
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
      name: "Project environment",
    });
    expect(
      dialog.parentElement?.classList.contains("bb-fg-management-scrim"),
    ).toBe(true);
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
        .filter((call) => call.method === "saveProjectEnvironment")
        .map((call) => call.input),
    ).toEqual([
      {
        projectId: "A",
        text: "TOKEN=updated",
        expectedRevision: 3,
      },
    ]);
  } finally {
    slot.lifecycle.unmount();
  }
});

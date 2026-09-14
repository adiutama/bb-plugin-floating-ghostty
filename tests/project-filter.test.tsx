// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ProjectFilter } from "../components/project-filter";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("searches projects and selects the matching result with Enter", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = () => {};
  const onChange = vi.fn(),
    onOpenChange = vi.fn();
  const view = render(
    <ProjectFilter
      open
      onOpenChange={onOpenChange}
      value="project:a"
      options={[
        { key: "all", label: "All" },
        { key: "project:a", label: "Alpha" },
        { key: "project:b", label: "Beta" },
      ]}
      onChange={onChange}
      onClose={() => {}}
    />,
  );
  const search = view.getByRole("combobox", { name: "Search projects" });
  fireEvent.change(search, { target: { value: "Beta" } });
  await waitFor(() => expect(view.getAllByRole("option")).toHaveLength(1));
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith("project:b");
  expect(onOpenChange).toHaveBeenCalledWith(false);
}, 20000);

it("lets touch users browse projects before focusing search", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = () => {};
  const view = render(
    <ProjectFilter open focusSearch={false} onOpenChange={() => {}} value="all"
      options={[{ key: "all", label: "All" }, { key: "project:a", label: "Alpha" }]}
      onChange={() => {}} onClose={() => {}} />,
  );
  await waitFor(() => expect(document.activeElement).toBe(view.getByRole("dialog", { name: "Filter by project" })));
  expect(document.activeElement).not.toBe(view.getByRole("combobox", { name: "Search projects" }));
}, 20000);

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { EnvironmentVariableEditor, serializeVariables, type VariableTexts } from "../components/environment-variable-editor";
import { parseProjectEnvironment } from "../lib/project-environment";
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

afterEach(cleanup);
function Editor() {
  const [texts, setTexts] = useState<VariableTexts>({ global: "", project: "", worktree: 'TOKEN="secret"' });
  return <><EnvironmentVariableEditor texts={texts} onChange={setTexts} scopes={["global", "project", "worktree"]} defaultScope="worktree" disabled={false} label="Test" onCopyFrom={() => {}} /><output data-testid="saved">{texts.worktree}</output></>;
}
it("shows values and adds and removes variables", () => {
  const view = render(<Editor />);
  expect(view.getByRole("textbox", { name: "Value 1" })).toHaveProperty("value", "secret");
  fireEvent.change(view.getByLabelText("Value 1"), { target: { value: "new\nvalue" } });
  fireEvent.click(view.getByText("Add variable"));
  fireEvent.change(view.getByLabelText("Key 2"), { target: { value: "EMPTY" } });
  expect(parseProjectEnvironment(view.getByTestId("saved").textContent!)).toEqual([
    { key: "TOKEN", value: "new\nvalue" }, { key: "EMPTY", value: "" },
  ]);
  fireEvent.keyDown(view.getByRole("button", { name: "Actions for variable 1" }), { key: "Enter" });
  fireEvent.click(within(document.body).getByRole("menuitem", { name: "Delete variable" }));
  expect(parseProjectEnvironment(view.getByTestId("saved").textContent!)).toEqual([{ key: "EMPTY", value: "" }]);
});
it("bulk pastes dotenv and rejects duplicates without losing edits", () => {
  const view = render(<Editor />);
  fireEvent.click(view.getByText("Add variable"));
  fireEvent.paste(view.getByLabelText("Key 2"), { clipboardData: { getData: () => 'HOST=local\nPORT=123' } });
  expect(view.getByLabelText("Key 3")).toHaveProperty("value", "PORT");
  const before = view.getByTestId("saved").textContent;
  fireEvent.paste(view.getByLabelText("Key 3"), { clipboardData: { getData: () => 'TOKEN=duplicate' } });
  expect(view.getByRole("alert").textContent).toContain("assigned more than once");
  expect(view.getByTestId("saved").textContent).toBe(before);
});
it("preserves special characters through row serialization", () => {
  const entries = [{ key: "VALUE", value: ' $HOME # " \\ \n\t\r\b' }];
  expect(parseProjectEnvironment(serializeVariables(entries))).toEqual(entries);
});

it("keeps same-key definitions visible and moves scopes without an override action", () => {
  function MixedEditor() {
    const [texts, setTexts] = useState<VariableTexts>({ global: "", project: "TOKEN=parent", worktree: "TOKEN=local" });
    return <><EnvironmentVariableEditor texts={texts} onChange={setTexts} scopes={["global", "project", "worktree"]} defaultScope="worktree" disabled={false} label="Worktree" /><output data-testid="all">{JSON.stringify(texts)}</output></>;
  }
  const view = render(<MixedEditor />);
  expect(view.getByLabelText("Key 1")).toHaveProperty("value", "TOKEN");
  expect(view.getByLabelText("Key 2")).toHaveProperty("value", "TOKEN");
  expect(view.queryByText("Override")).toBeNull();
  fireEvent.change(view.getByLabelText("Scope 2"), { target: { value: "global" } });
  const texts = JSON.parse(view.getByTestId("all").textContent!);
  expect(parseProjectEnvironment(texts.global)).toEqual([{ key: "TOKEN", value: "local" }]);
  expect(parseProjectEnvironment(texts.project)).toEqual([{ key: "TOKEN", value: "parent" }]);
  expect(texts.worktree).toBe("");
});

it("toggles a definition without losing its value and restores the toggle after remounting", () => {
  const view = render(<Editor />);
  const toggle = view.getByRole("switch", { name: "Variable 1 enabled" });
  expect(toggle).toHaveProperty("checked", true);
  fireEvent.click(toggle);
  const saved = view.getByTestId("saved").textContent!;
  expect(parseProjectEnvironment(saved)).toEqual([{ key: "TOKEN", value: "secret", enabled: false }]);
  view.unmount();
  const loaded = render(<EnvironmentVariableEditor texts={{ global: "", project: "", worktree: saved }} scopes={["global", "project", "worktree"]} defaultScope="worktree" onChange={() => {}} disabled={false} label="Test" />);
  expect(loaded.getByRole("switch", { name: "Variable 1 enabled" })).toHaveProperty("checked", false);
  fireEvent.click(loaded.getByRole("switch", { name: "Variable 1 enabled" }));
  expect(loaded.getByLabelText("Value 1")).toHaveProperty("value", "secret");
  expect(loaded.getByRole("switch", { name: "Variable 1 enabled" })).toHaveProperty("checked", true);
});

it.each(["Variable actions", "Actions for variable 1"])("renders %s above the floating terminal", (name) => {
  // Exercise the portal's actual layer selectors against the floating window.
  const css = readFileSync("styles.css", "utf8");
  const style = document.createElement("style");
  style.textContent = ".z-50 { z-index: 50; }" + ["bb-fg-window", "bb-fg-actions-menu", "bb-fg-environment-menu"].map(selector => css.match(new RegExp(`\\.${selector} \\{[^}]*z-index:[^}]*\\}`))?.[0] ?? "").join("\n");
  document.head.append(style);
  try {
    const view = render(<div className="bb-fg-window"><Editor /></div>);
    fireEvent.keyDown(view.getByRole("button", { name }), { key: "Enter" });
    const menu = within(document.body).getByRole("menu");
    const window = view.container.querySelector(".bb-fg-window")!;
    expect(Number(getComputedStyle(menu).zIndex)).toBeGreaterThan(Number(getComputedStyle(window).zIndex));
    expect(Number(getComputedStyle(menu).zIndex)).toBeGreaterThan(70); // Settings dialog layer.
  } finally { style.remove(); }
});

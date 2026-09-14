// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { KeyToolbar } from "../components/key-toolbar";

afterEach(cleanup);
it("exposes shortcuts on demand without taking focus from terminal input", () => {
  const onKey = vi.fn();
  const view = render(<><input aria-label="Shell" /><KeyToolbar ctrlArmed={false} onKey={onKey} /></>);
  const input = view.getByRole("textbox");
  input.focus();
  expect(view.queryByRole("button", { name: "Paste from clipboard" })).toBeNull();
  const more = view.getByRole("button", { name: "More terminal shortcuts" });
  fireEvent.pointerDown(more);
  fireEvent.click(more);
  expect(document.activeElement).toBe(input);
  fireEvent.click(view.getByRole("button", { name: "Shift+Tab" }));
  expect(onKey).toHaveBeenLastCalledWith(expect.objectContaining({ send: "\x1b[Z" }));
  fireEvent.click(view.getByRole("button", { name: "Control" }));
  expect(onKey).toHaveBeenLastCalledWith(expect.objectContaining({ id: "ctrl" }));
  expect(view.queryByRole("group", { name: "More terminal shortcuts" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Show keyboard" }));
  expect(onKey).toHaveBeenLastCalledWith(expect.objectContaining({ id: "keyboard" }));
});
it("sends one interrupt per activation, including accessible click activation", () => {
  const onKey = vi.fn();
  const view = render(<KeyToolbar ctrlArmed={false} onKey={onKey} />);
  const stop = view.getByRole("button", { name: "Interrupt (Ctrl+C)" });
  fireEvent.pointerDown(stop);
  expect(onKey).not.toHaveBeenCalled();
  fireEvent.click(stop);
  expect(onKey).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ send: "\x03" }));
});


it("returns keyboard focus to More when its tray closes", () => {
  const view = render(<KeyToolbar ctrlArmed={false} onKey={() => {}} />);
  const more = view.getByRole("button", { name: "More terminal shortcuts" });
  fireEvent.click(more);
  const ctrl = view.getByRole("button", { name: "Control" });
  ctrl.focus();
  fireEvent.click(ctrl);
  expect(document.activeElement).toBe(more);
});

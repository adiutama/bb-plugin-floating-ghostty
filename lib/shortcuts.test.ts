// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  isAlternativeToggle,
  isSwitcherShortcut,
  matchesShortcut,
} from "./shortcuts";
it("reserves only Ctrl+backtick for the alternative toggle", () => {
  expect(
    isAlternativeToggle(
      new KeyboardEvent("keydown", { code: "Backquote", ctrlKey: true }),
    ),
  ).toBe(true);
  expect(
    isAlternativeToggle(
      new KeyboardEvent("keydown", {
        code: "Backquote",
        ctrlKey: true,
        shiftKey: true,
      }),
    ),
  ).toBe(false);
  expect(isAlternativeToggle(new KeyboardEvent("keydown", { key: "`" }))).toBe(
    false,
  );
});
it("resolves the host's platform modifier exactly", () => {
  const shortcut = {
    key: "Enter",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: true,
  };
  expect(
    matchesShortcut(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        shiftKey: true,
      }),
      shortcut,
      true,
    ),
  ).toBe(true);
  expect(
    matchesShortcut(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        shiftKey: true,
      }),
      shortcut,
      false,
    ),
  ).toBe(true);
  expect(
    matchesShortcut(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        shiftKey: true,
      }),
      shortcut,
      true,
    ),
  ).toBe(false);
  expect(
    isSwitcherShortcut(
      new KeyboardEvent("keydown", { key: "p", metaKey: true }),
      true,
    ),
  ).toBe(true);
});

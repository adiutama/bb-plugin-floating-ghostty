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
      new KeyboardEvent("keydown", { key: "k", metaKey: true }),
      true,
    ),
  ).toBe(true);
});

it.each([
  [true, { key: "k", metaKey: true }, true],
  [false, { key: "k", ctrlKey: true }, true],
  [true, { key: "p", metaKey: true }, false],
  [false, { key: "p", ctrlKey: true }, false],
  [true, { key: "k", ctrlKey: true }, false],
  [true, { key: "k", metaKey: true, shiftKey: true }, false],
  [true, { key: "k", metaKey: true, altKey: true }, false],
] as const)(
  "matches terminal search with the exact platform shortcut (%s, %j)",
  (mac, init, expected) => {
    expect(isSwitcherShortcut(new KeyboardEvent("keydown", init), mac)).toBe(
      expected,
    );
  },
);

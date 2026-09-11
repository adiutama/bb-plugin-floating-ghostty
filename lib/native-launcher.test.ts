// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  mountNativeLauncherOverride,
  nativeLauncherOverride,
} from "./native-launcher";

afterEach(() => {
  nativeLauncherOverride.set(false);
  document.body.replaceChildren();
});

function renderActions() {
  // Current host action row: action button, shortcut hint, and reorder handle.
  const surface = document.createElement("div");
  surface.dataset.testid = "new-tab-actions";
  surface.innerHTML = `<section><div><div data-row="terminal"><button id="file-search-result-start-terminal">Start terminal</button><span>⌘⇧↵</span><button aria-label="Reorder Start terminal"></button></div><div data-row="browser"><button>Open browser</button></div></div></section>`;
  document.body.append(surface);
  return surface;
}

it("hides the whole native action only when opted in and covers host rerenders", () => {
  let surface = renderActions();
  const dispose = mountNativeLauncherOverride();
  const row = () =>
    surface.querySelector<HTMLElement>('[data-row="terminal"]')!;
  try {
    expect(getComputedStyle(row()).display).not.toBe("none");
    nativeLauncherOverride.set(true);
    expect(getComputedStyle(row()).display).toBe("none");
    expect(
      getComputedStyle(surface.querySelector('[data-row="browser"]')!).display,
    ).not.toBe("none");
    surface.remove();
    surface = renderActions();
    expect(getComputedStyle(row()).display).toBe("none");
    nativeLauncherOverride.set(false);
    expect(getComputedStyle(row()).display).not.toBe("none");
    expect(surface.querySelector("button")?.textContent).toBe("Start terminal");
  } finally {
    dispose();
  }
});

it("restores BB on plugin unload even with override enabled", () => {
  const surface = renderActions();
  nativeLauncherOverride.set(true);
  const dispose = mountNativeLauncherOverride();
  const row = surface.querySelector('[data-row="terminal"]')!;
  expect(getComputedStyle(row).display).toBe("none");
  dispose();
  expect(getComputedStyle(row).display).not.toBe("none");
  nativeLauncherOverride.set(false);
  nativeLauncherOverride.set(true);
  expect(getComputedStyle(row).display).not.toBe("none");
});

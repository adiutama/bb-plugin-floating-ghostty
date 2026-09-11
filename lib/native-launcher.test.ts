// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  mountNativeLauncherOverride,
  nativeLauncherOverride,
} from "./native-launcher";
import { windowController } from "./controller";

afterEach(() => {
  nativeLauncherOverride.set(false);
  windowController.hide();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("replaces Start terminal on every page without hiding the action, and restores it on unload", () => {
  const button = document.createElement("button");
  button.id = "file-search-result-start-terminal";
  button.textContent = "Start terminal";
  const native = vi.fn();
  button.addEventListener("click", native);
  document.body.append(button);
  const release = mountNativeLauncherOverride();
  button.click();
  expect(native).toHaveBeenCalledTimes(1);
  nativeLauncherOverride.set(true);
  button.click();
  expect(native).toHaveBeenCalledTimes(1);
  expect(windowController.isOpen()).toBe(true);
  expect(button.hidden).toBe(false);
  windowController.hide();
  release();
  button.click();
  expect(native).toHaveBeenCalledTimes(2);
  expect(windowController.isOpen()).toBe(false);
});

it("redirects pointer and keyboard command-palette terminal actions and disposes pending opens", async () => {
  document.body.innerHTML =
    '<div data-testid="command-palette"><input /><div role="option" aria-selected="true"><span>Open terminal</span><span>Panel</span></div></div>';
  const palette = document.body.firstElementChild!;
  const native = vi.fn();
  palette.addEventListener("click", native);
  nativeLauncherOverride.set(true);
  const release = mountNativeLauncherOverride();
  palette.querySelector<HTMLElement>('[role="option"]')!.click();
  expect(native).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(windowController.isOpen()).toBe(true));
  windowController.hide();
  palette
    .querySelector("input")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  release();
  await new Promise((resolve) => setTimeout(resolve, 220));
  expect(windowController.isOpen()).toBe(false);
});

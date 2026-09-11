// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mountSettingsPresentation } from "./settings-presentation";

it("disables dependent settings, follows host rerenders, and restores the form on unload", async () => {
  document.body.innerHTML = `<div data-testid="plugin-detail-floating-ghostty">
    <div data-control-placement="inline"><button aria-label="App-wide terminal override" aria-checked="true"></button></div>
    <div data-control-placement="inline"><button aria-label="Toggle with Ctrl+backtick"></button></div>
    <div data-control-placement="inline"><button aria-label="Replace terminal launch actions"></button></div>
    <div data-control-placement="inline"><button aria-label="Custom opening size" aria-checked="false"></button></div>
    <div data-control-placement="inline"><input aria-label="Width (px)" /></div>
  </div>`;
  const release = mountSettingsPresentation();
  const field = (label: string) =>
    document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  try {
    expect(field("Toggle with Ctrl+backtick").disabled).toBe(true);
    expect(field("Replace terminal launch actions").disabled).toBe(false);
    expect(field("Width (px)").disabled).toBe(true);
    field("App-wide terminal override").setAttribute("aria-checked", "false");
    await Promise.resolve();
    expect(field("Toggle with Ctrl+backtick").disabled).toBe(false);
    expect(field("Replace terminal launch actions").disabled).toBe(true);
  } finally {
    release();
  }
  expect(field("Width (px)").disabled).toBe(false);
  document.body.replaceChildren();
});

// Conditional controls are not part of BB's declarative settings API yet.
// Adapt only this plugin's host-owned form, retaining BB's persistence and labels.
const rootSelector = '[data-testid="plugin-detail-floating-ghostty"]';
const dependencies: Record<string, string> = {
  "Replace terminal launch actions": "App-wide terminal override",
  "Use BB terminal shortcut": "App-wide terminal override",
  "Toggle with Ctrl+backtick": "!App-wide terminal override",
  "Width (px)": "Custom opening size",
  "Height (px)": "Custom opening size",
};

export function mountSettingsPresentation(): () => void {
  const changed = new Map<HTMLButtonElement | HTMLInputElement, boolean>();
  const rows = new Set<HTMLElement>();
  const update = () => {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    for (const [label, dependency] of Object.entries(dependencies)) {
      const control = root.querySelector<HTMLButtonElement | HTMLInputElement>(
        `[aria-label="${label}"]`,
      );
      const inverse = dependency.startsWith("!");
      const parent = root.querySelector(
        `[aria-label="${inverse ? dependency.slice(1) : dependency}"]`,
      );
      if (!control || !parent) continue;
      if (!changed.has(control)) changed.set(control, control.disabled);
      const on = parent.getAttribute("aria-checked") === "true";
      const disabled = changed.get(control)! || (inverse ? on : !on);
      if (control.disabled !== disabled) control.disabled = disabled;
      const row = control.closest<HTMLElement>("[data-control-placement]");
      if (row) {
        rows.add(row);
        row.classList.toggle("bb-fg-setting-disabled", disabled);
        row.classList.toggle("bb-fg-setting-child", !inverse);
      }
    }
  };
  const style = document.createElement("style");
  style.textContent = `${rootSelector} .bb-fg-setting-disabled { opacity: .45; }
    ${rootSelector} .bb-fg-setting-child { margin-left: 20px; }`;
  document.head.append(style);
  // Observe only host changes; our disabled/class writes are not observed.
  const observer = new MutationObserver(update);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-checked"],
  });
  update();
  return () => {
    observer.disconnect();
    style.remove();
    for (const [control, disabled] of changed) control.disabled = disabled;
    for (const row of rows)
      row.classList.remove("bb-fg-setting-disabled", "bb-fg-setting-child");
  };
}

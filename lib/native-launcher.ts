// BB has no SDK slot for hiding its native terminal action. Keep the host DOM
// adaptation in a trusted content script and remove it completely on teardown.
// The current BB NewTabPage action uses this ID; hide its whole row so the
// shortcut hint and reorder handle do not remain behind. CSS covers rerenders.
const launcher = "#file-search-result-start-terminal";
const launcherRow = `[data-testid="new-tab-actions"] div:has(> ${launcher})`;
let enabled = false;
const listeners = new Set<() => void>();

export const nativeLauncherOverride = {
  set(value: boolean) {
    if (enabled === value) return;
    enabled = value;
    for (const listener of listeners) listener();
  },
};

export function mountNativeLauncherOverride(): () => void {
  const style = document.createElement("style");
  style.textContent = `${launcher}, ${launcherRow} { display: none !important; }`;
  const update = () => {
    if (enabled) document.head.append(style);
    else style.remove();
  };
  listeners.add(update);
  update();
  return () => {
    listeners.delete(update);
    style.remove();
  };
}

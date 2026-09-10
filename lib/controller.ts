// A tiny external store for the window's open state.
//
// Two things drive the window from outside React: the sidebar footer button
// (host-rendered, no component) and the global Ctrl+Shift+` shortcut. Both call this
// singleton; the React tree subscribes via useSyncExternalStore. Module-level
// state is safe here because BB instantiates this frontend module once
// per bb window, tab, or remote client.

type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const windowController = {
  isOpen: (): boolean => open,
  show(): void {
    if (open) return;
    open = true;
    emit();
  },
  hide(): void {
    if (!open) return;
    open = false;
    emit();
  },
  toggle(): void {
    open = !open;
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

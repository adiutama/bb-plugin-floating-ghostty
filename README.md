# Floating Ghostty

A little ghost for your shells. **Floating Ghostty** combines a draggable BB
terminal window with Ghostty's terminal engine through Wterm.

Open the ghost button in BB's sidebar footer, or press **Ctrl+Shift+backtick**.
Choose a project or machine to summon a shell. Hide the window when you're done
looking at it; the shell keeps running.

## Features

- A floating window you can drag, resize from any edge, maximize, and restore.
- Multiple shell tabs, with independent local or remote PTYs managed by BB.
- Persistent tabs and window geometry; surviving shells reattach after a reload.
- Ghostty 0.5.0 via WebAssembly, with Wterm's DOM renderer and Unicode support.
- Bundled Nerd Font symbols, terminal colors, mouse input, alternate-screen apps,
  safe OSC 8 web links, and Wterm's bounded Kitty image support.
- Search retained terminal rows with Cmd/Ctrl+F; Enter and Shift+Enter navigate
  matches. Search is case-insensitive, single-line, and capped at 1,000 matches.
- A compact sheet and extra keyboard controls on small screens.
- Font-size settings and an optional keyboard shortcut.

The shortcut deliberately includes **Shift** so it can coexist with Floating
Terminal's Ctrl+backtick shortcut. Storage, sessions, CSS, and branding are independent
of both reference plugins.

## Install locally

Requires BB 0.42 or newer and plugin SDK 0.4.47 or a compatible 0.4.x release.

```sh
npm ci --include=dev
npm run build
bb plugin install .
```

No native Ghostty installation is needed. This is an **embedded Ghostty engine**,
not a window from the native Ghostty application; it does not read Ghostty's
native configuration file.

## Controls

| Action             | Control                                                 |
| ------------------ | ------------------------------------------------------- |
| Show or hide       | Ghost button, or Ctrl+Shift+backtick                    |
| New shell          | `+`, then choose a project or machine                   |
| Move               | Drag the title bar                                      |
| Resize             | Drag an edge or corner                                  |
| Maximize / restore | Title-bar button, or double-click empty title-bar space |
| Close a shell      | Its tab's close button, or middle-click the tab         |
| Restart a shell    | Restart button; Enter after the shell exits             |
| Find               | Cmd/Ctrl+F inside the terminal                          |
| Jump to new output | **Latest** while viewing history                        |

**Hiding the window preserves shells. Closing a tab terminates that shell.**
Disabling or reloading the plugin detaches its UI; BB still owns the PTYs.
Sessions survive only as long as their host's PTY service does.

Settings live under **Extensions → Floating Ghostty**. Updated font size and
shortcut preferences are read when the window opens. The frame follows BB's
theme; the terminal retains a dark palette.

## Development and verification

```sh
npm run typecheck
npm test
npm run build
bb plugin dev
```

The tests cover the SDK RPC boundary, ownership checks, concurrent tab creation,
persistence, window geometry, the actual pinned Ghostty WASM, Unicode, TUI screen
switches, replay suppression, hidden-tab polling, input, disposal, and overlay
registration with the BB frontend harness.

An additional smoke test exercises the **running BB server**, creates a temporary
shell, sends input, renders its output through the real Ghostty engine, tests
resize/replay/restart, and closes its test shells:

```sh
npm run test:live
# Optional: BB_SERVER_URL and BB_SMOKE_HOST_ID select the target server/host.
```

Desktop drag/resize appearance and mobile keyboard layout still need a manual
visual check. Automated access to the BB window was unavailable during authoring.

## Implementation

- `app.tsx` registers BB's `experimental_appOverlay` and sidebar footer action.
- `components/floating-terminal.tsx` owns window layout and tab presentation.
- `lib/pump.ts` connects one Ghostty renderer to one BB PTY. Hidden tabs stop
  polling; replayed terminal queries cannot become shell input.
- `lib/ghostty.ts` loads the authenticated WASM and adapts Wterm's Ghostty guards.
- `server.ts` uses public `bb.sdk.terminals` APIs and plugin-owned KV storage.
  Every terminal operation checks ownership.

The WASM endpoint resolves the binary from the exact pinned `@wterm/ghostty`
package. There is no duplicate checked-in binary to fall out of sync. Runtime
packages are regular dependencies so BB can build this plugin from a Git source.

This first version focuses on the floating terminal. Wterm's upload UI and
file-preview links are not included. Terminal-driven OSC 52 clipboard writes are
filtered; user-initiated copy and paste work normally. Search jumps to matching
rows without highlighting individual characters.

## Credits and license

Derived from two MIT-licensed BB plugins:

- [Floating Terminal](https://github.com/vburojevic/bb-plugin-floating-terminal)
  by Vedran Burojević: floating window, tabs, directory picker, persistence, and
  terminal transport.
- [Wterm Terminal Preview](https://github.com/Diffuzmetall/bb-wterm-terminal-plugin):
  Ghostty integration approach, compatibility guards, and clipboard filtering.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for exact source revisions
and dependency licenses. Plugin code is [MIT licensed](LICENSE).

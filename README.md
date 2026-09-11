# Floating Ghostty

A little ghost for your shells. **Floating Ghostty** combines a draggable BB
terminal window with Ghostty's terminal engine through Wterm.

Open the ghost button in BB's sidebar footer, or press **Ctrl+backtick**.
Terminal mode opens straight into a shell, ready to type. Its quiet header holds
only the ghost, current terminal selector, and hide control. Press the same shortcut,
use the **×**, or click outside to return to BB. Your shells keep running.

## Context and terminal selection

Each terminal belongs to **Global**, a **Project**, or a **Worktree** (BB environment).
Changing directory inside a shell does not change its owner.

- Outside a project, Global terminals are available.
- Inside a project, Global terminals and every terminal owned by that project or
  any of its worktrees are available. Other projects are excluded.
- Reopening remembers your selection per worktree or project, on this client.
  Without a remembered selection, it prefers the current worktree, then Project,
  then Global, using the most recently visited terminal within that scope.
- If none matches, it starts a shell in the current scope. An unavailable current
  machine/worktree produces a recovery state instead of silently starting elsewhere.
- Navigating to another thread or project hides the overlay. Threads sharing an
  environment share its worktree terminals.

**Cmd+K** (Ctrl+K on other platforms) opens the terminal switcher. It is a flat,
searchable list. The **All** filter includes Global plus the current project and its worktrees;
use the filter above the results to narrow it to Global, Project, or one worktree. Enter switches and
focuses the shell; Escape returns to the existing shell. These keys belong to the
switcher only while it is open; Cmd/Ctrl+K is reserved while the terminal overlay
is open.

The selector follows BB’s **thread search** layout: one search field, terminal
names on the first line, and ownership/machine metadata underneath. Recently used
terminals come first, and matching title text is highlighted. Search always finds
terminals, including names starting with **>**.

Session **⋯** actions appear on hover or keyboard selection and stay visible on
touch screens. Find is in the current session’s menu; Maximize/Restore is in the
session menus. **+ New** sits beside the scope filter above the results.

**Tab / Shift+Tab** cycles through search, category, New, and the highlighted
session's actions. Arrow keys navigate sessions or change the
focused category. Escape closes a session menu first, then the selector; in the
shell it remains a terminal key. Terminal mode contains keyboard input, including its portaled actions
menu, so it does not reach BB's in-app shortcuts. Typing, shell control keys,
copy/paste, terminal search, and the toggle continue to work. OS-reserved shortcuts
and native application-menu commands remain controlled by BB/the operating system.

The selector’s **+ New** action immediately starts a shell in the current BB context: Worktree,
then Project, then Global. There is no creation form, and the selected terminal
or switcher filter does not change the destination. After creation, use
**Selector → session ⋯ → Change ownership…** to move it between Global, the current
project, and its worktrees. This keeps the running process, directory, and original
restart destination. A terminal moved outside the current context disappears from
that context's list.

Each session’s **⋯** menu provides **Rename…**, **Restart shell**, and
**Delete terminal…**. Managing another session leaves your current shell selected.
Closing a management dialog returns to the selector with its search and filter
preserved. Deletion asks for
confirmation and stops the shell and its running commands. A connection failure
keeps the terminal listed so you can retry.

New shells initially say **Shell**, then adopt their shell name, such as **zsh**.
Session-local zsh, bash, and fish hooks report the command executable while it runs
and restore the shell name at the prompt. Applications can also supply OSC titles.
A custom name stays pinned; clear it in Rename to resume automatic naming.
The open switcher refreshes inactive terminals' names every two seconds. When the
overlay is hidden, polling stops and titles catch up when you return.
Existing shells keep running; restart one to enable the new hooks. Other shells
use their native title signals. These hooks do not edit your startup files; an
existing bash DEBUG trap is preserved and may limit automatic command reporting.

## Features

- Centered floating overlay with drag, edge resize, maximize, and restore.
- Independent local or remote PTYs managed by BB; surviving sessions reattach on reload.
- Ghostty 0.5.0 via WebAssembly and Wterm's DOM renderer, bundled Nerd Font symbols,
  Unicode, mouse input, alternate-screen apps, safe OSC 8 web links, and bounded Kitty images.
- Scrollback search with Cmd/Ctrl+F; Enter and Shift+Enter navigate matches.
  Search is case-insensitive, single-line, and capped at 1,000 matches.
- A keyboard-aware fullscreen surface and extra keys on small screens.
- Live shortcut settings and typography matching BB's native terminal (12px).
- Wheel/trackpad history scrolling and alternate-screen app scrolling. Hold Shift
  while scrolling to bypass an application's mouse reporting and scroll history.

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

| Action             | Control                                                      |
| ------------------ | ------------------------------------------------------------ |
| Show / hide        | Ghost button or Ctrl+backtick                                |
| Switch terminal    | Click the terminal title or Cmd/Ctrl+K                       |
| Filter terminals   | Filter beside search                                         |
| New shell          | Selector → **+ New** (current BB context)                    |
| Back to BB         | **×**, toggle shortcut, or click outside                     |
| Move / resize      | Drag the header / an edge or corner                          |
| Maximize / restore | Session ⋯ menu, or double-click empty header space           |
| Rename             | Selector → session ⋯ → Rename…                               |
| Change owner       | Selector → session ⋯ → Change ownership…                     |
| Delete a shell     | Selector → session ⋯ → Delete terminal…                      |
| Restart            | Selector → session ⋯ → Restart shell; Enter after shell exit |
| Find               | Cmd/Ctrl+F inside the terminal                               |
| Jump to new output | **Latest** while viewing history                             |

**Hiding preserves shells. Delete terminal terminates the selected shell.**
Disabling or reloading the plugin detaches its UI; BB still owns the PTYs.
Sessions survive only as long as their host's PTY service does.

Settings live under **Extensions → Floating Ghostty**:

- **Toggle with Ctrl+backtick**: enabled by default; inactive during native override.
- **Override BB terminal shortcut**: **disabled by default**, opt in to make BB's
  configured terminal shortcut toggle this overlay. It follows BB's custom
  keybinding, including a disabled binding, and does not edit BB's settings.
  While enabled, BB's **Start terminal** action is hidden (including its shortcut
  hint and reorder handle), and Ctrl+backtick stops toggling the overlay. Turning
  override off restores the action and your Ctrl+backtick preference.
  Changes to BB's binding are refreshed on browser/window focus and every 30 seconds.
- **Center on open**: disabled by default. Recenter on each opening, preserving size.
- **Custom opening size**: disabled by default. Apply **Width (px)** and **Height (px)**
  on each opening, independently of the centering preference. Defaults are 1100 × 720.
  A viewport smaller than either dimension uses fullscreen, as do BB's compact
  viewports. Fullscreen never overwrites the remembered desktop geometry.

The terminal matches BB's native 12px monospace rendering and shares the app's zoom.
There is no separate plugin font-size setting.

The frame and terminal share one dark surface; selector and management controls follow BB's theme. Existing POC
machine-home sessions become Global and project sessions retain their project
ownership. Existing processes are preserved.

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

Desktop appearance, interaction with BB’s native shortcut handler, and mobile
keyboard layout still need a manual visual check. Automated access to the BB
window was unavailable during this implementation.

## Implementation

- `app.tsx` registers BB's `experimental_appOverlay`, sidebar footer action, and
  trusted content script. `lib/native-launcher.ts` hides the native action using
  its current BB DOM ID; this small host adapter may need updating if BB changes
  its action markup. It restores the action on opt-out or plugin unload.
- `components/floating-terminal.tsx` owns the shell/switcher flow, context selection, and window layout.
- `lib/context.ts` defines project visibility, scope priority, and client selection memory.
- `components/terminal-switcher.tsx` owns the flat list and filters.
- `components/terminal-management.tsx` owns naming, ownership, and deletion dialogs.
- `lib/shell-integration.ts` installs session-local shell title hooks; `lib/terminal-title.ts`
  reads bounded OSC title signals because the pinned Ghostty adapter lacks title reporting.
- `lib/pump.ts` connects one Ghostty renderer to one BB PTY. Hidden tabs stop
  polling; replayed terminal queries cannot become shell input.
- `lib/use-switcher-titles.ts` refreshes inactive titles while the switcher is open,
  without mounting renderers or sending terminal replies.
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

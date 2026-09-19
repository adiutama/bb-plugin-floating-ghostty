# Floating Ghostty

A little ghost for your shells. **Floating Ghostty** combines a draggable BB
terminal window with Ghostty's terminal engine through Wterm.

Open the ghost button in BB's sidebar footer, or press **Ctrl+backtick**.
Terminal mode opens straight into a shell, ready to type. Its quiet header holds
the sidebar toggle, ghost, session name and shortened directory, and hide control. Press the same shortcut,
use the **×**, or click outside to return to BB. Your shells keep running.

## Context and terminal selection

Each terminal belongs to the **worktree where it was created**.
Changing directory inside a shell does not change its owner.

- Opening the terminal checks the current thread’s worktree. If it already has
  a terminal, that terminal is shown; otherwise a new shell starts there.
- Selection is remembered independently per worktree. Another worktree’s shell
  is never reused automatically, even when both belong to the same project.
- Threads without a worktree use the project’s default checkout. Projectless
  conversations use a machine’s home directory. An unavailable current
  machine/worktree produces a recovery state.
- **New terminal** explicitly creates an additional shell in the selected context.
- Navigating to another thread or project hides the overlay without stopping shells.
- Existing sessions recover their worktree ownership from their saved launch location.

The header’s sidebar toggle or **Cmd+K** (Ctrl+K on other platforms) opens the attached terminal sidebar. The project
filter sits below search; **Cmd/Ctrl+P** opens it. It defaults to
the project owning the current thread, or **No project**. Type in the picker to search projects. **All** shows terminals
across every project, including projectless terminals. Selecting another project
filters the list without switching the active shell. Enter switches to the
highlighted terminal, including terminals in another project; Escape returns to
the existing shell.

The selector uses a shared session list: terminal names, project and machine,
and the working directory. The current terminal has a status dot and highlighted row.
The sidebar sits on the left beside the shell on desktop, using BB’s muted surfaces
and compact rows. Selecting a shell keeps the sidebar open. On phones and narrow
windows it fills the terminal body and collapses after selection. Search is part of
the sidebar, never a separate floating dialog.
The footer holds **Environment variables** and **New terminal**.
Touch devices focus the list without automatically opening the keyboard. Recently used terminals come first,
and matching title text is highlighted. Search always finds terminals, including
names starting with **>**.

**New terminal** stays below the results, including while searching. Click it or
Tab to it and press Enter to immediately start a shell
in the selected project, or in the current BB context when the filter is **All**.
For the current project it uses the thread's environment; other projects use
their default checkout. **No project** starts in a machine's home directory.
Ownership is fixed at creation; existing shells and their restart directories are preserved.

Session **⋯** actions appear on hover or keyboard selection and stay visible on
touch screens. Find is in the current session’s menu; Maximize/Restore is in the
session menus. **Tab / Shift+Tab** cycles through search, the project filter, and
the highlighted session's actions, and New terminal. Arrow keys navigate results or the project
menu. Escape closes a menu first, then the selector; in the shell it remains a
terminal key. Terminal mode contains keyboard input, including portaled menus,
so it does not reach BB's in-app shortcuts. OS-reserved shortcuts and native
application-menu commands remain controlled by BB/the operating system.

Exited shells close automatically without a notification. The next live shell
is selected, or the window hides when no shell remains in the current worktree.

**Environment variables** in the sidebar footer replaces the shell viewport with the active terminal’s environment editor. The sidebar stays available, and the shell remains mounted and running. Use **Cancel** or select a sidebar terminal to return. In plugin settings, the editor remains a dialog.
Each project session’s **⋯** menu also provides **Environment variables…** alongside
**Rename…**, **Restart shell**, and **Delete terminal…**. The environment editor
provides key/value rows with always-visible values and remove controls, and bulk .env paste into a key field. The editor **⋯** menu holds **Copy from…** and, when there are unsaved changes, **Discard edits**. Each row’s **⋯** menu holds **Copy to…** and **Delete variable**. Every definition appears in one list with its own scope selector; **Add variable** creates a new row. It accepts strict dotenv assignments and applies them at the next prompt in zsh,
bash, and fish. Each row selects Global (all terminals), Project (the default checkout and all its worktrees), or Worktree (only this worktree). The same key may appear in multiple scopes; duplicate keys within one scope are rejected. All definitions remain visible, with overridden rows muted. Add the same key in a more specific scope to override it. Changing scope moves the definition; deleting it restores the next inherited value. Save validates all changed scopes and writes them in one transaction, rejecting the entire batch if any revision is stale. An empty value is an explicit override. Existing
project records now apply to all their worktrees. Running commands keep their
current environment; updates apply at the next prompt. Older projectless shells
need a restart to pick up global variables. Settings lists projects and worktrees,
including empty environments. **Copy from…** starts in the current project: choose a source worktree (or switch projects), select keys, and add them to the current scope as drafts. **Copy to…** sends one row to a destination review. Both preserve unrelated definitions and default same-scope conflicts to **Keep existing**, with an explicit **Replace** choice. Copies are independent and persist only after **Save**.
Managing another session leaves your current shell selected.
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
New zsh, bash, and fish shells report their working directory after each prompt.
Existing shells keep running; restart one to enable the new hooks. Shells that
report OSC 7 directories are supported too. Other shells
use their native title signals. These hooks do not edit your startup files; an
existing bash DEBUG trap is preserved and may limit automatic command reporting.

## Features

- Centered floating overlay with drag, edge resize, maximize, and restore.
- Independent local or remote PTYs managed by BB; surviving sessions reattach on reload.
- Ghostty 0.5.0 via WebAssembly and Wterm's DOM renderer, bundled Nerd Font symbols,
  Unicode, mouse input, alternate-screen apps, safe OSC 8 web links, and bounded Kitty images.
- Scrollback search with Cmd/Ctrl+F; Enter and Shift+Enter navigate matches.
  Search is case-insensitive, single-line, and capped at 1,000 matches.
- A keyboard-aware fullscreen surface on phones, including landscape.
- Esc, Tab, Stop (Ctrl+C), More, and Type/Hide shortcuts. More groups navigation,
  modifiers, Shift+Tab, clipboard actions, and symbols without a scrolling key strip.
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

| Action             | Control                                            |
| ------------------ | -------------------------------------------------- |
| Show / hide        | Ghost button or Ctrl+backtick                      |
| Switch terminal    | Click the terminal title or Cmd/Ctrl+K             |
| Filter terminals   | Filter beside search or Cmd/Ctrl+P                 |
| New shell          | Selector → **New terminal** (selected project)     |
| Back to BB         | **×**, toggle shortcut, or click outside           |
| Move / resize      | Drag the header / an edge or corner                |
| Maximize / restore | Session ⋯ menu, or double-click empty header space |
| Rename             | Selector → session ⋯ → Rename…                     |
| Environment variables | Sidebar footer, or session ⋯ menu              |
| Delete a shell     | Selector → session ⋯ → Delete terminal…            |
| Restart            | Selector → session ⋯ → Restart shell               |
| Find               | Cmd/Ctrl+F inside the terminal                     |
| Jump to new output | **Latest** while viewing history                   |

**Hiding preserves shells. Delete terminal terminates the selected shell.**
Disabling or reloading the plugin detaches its UI; BB still owns the PTYs.
Sessions survive only as long as their host's PTY service does.

Settings live under **Extensions → Floating Ghostty**:

- **App-wide terminal override**: disabled by default. Its two child flags control
  **Replace terminal launch actions** (Start terminal and the command palette)
  and **Use BB terminal shortcut**. Native launch actions stay visible and open
  Floating Ghostty when enabled. BB's custom/disabled terminal keybinding is respected.
- **Toggle with Ctrl+backtick**: enabled by default; the control and shortcut are
  disabled while the master override is enabled. Turning override off restores
  the saved preference. Native bindings refresh on focus and every 30 seconds.
- **Center on open**: disabled by default. Recenter on each opening, preserving size.
- **Custom opening size**: disabled by default. Apply **Width (px)** and **Height (px)**
  on each opening, independently of the centering preference. Defaults are 1100 × 720.
  A viewport smaller than either dimension uses fullscreen, as do BB's compact
  viewports. Phones remain fullscreen in landscape even with smaller custom
  dimensions. Drag, resize, and Maximize/Restore are unavailable there.
  Fullscreen never overwrites the remembered desktop geometry.

The terminal matches BB's native 12px monospace rendering and shares the app's zoom.
There is no separate plugin font-size setting.

The frame, terminal, selector, and management controls inherit BB's theme. Existing POC
machine-home sessions appear under No project; legacy sessions recover their original worktree ownership. Existing processes and original restart locations are preserved.

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

### Environment inheritance contract

- Persist each scope separately; merge global → project → worktree when preparing shell files.
- Per-scope revisions protect atomic batch saves and moves. Validate every changed layer before any write. Refresh signatures include every ancestor revision.
- Parent saves refresh descendant shell files, including after reconnect and reload.
- Each row has an enable switch. Disabled definitions retain their value and scope but are excluded from shell resolution; enabled ancestors can take effect.
- Raw dotenv represents disabled definitions as `# @bb-disabled KEY="value"`; ordinary comments remain ignored. Copy and scope moves preserve this state. Duplicate keys in one scope remain invalid even when disabled.
- Clearing local variables restores inherited values; explicit empty values override them.
- Copy from shows only worktree definitions within the same project. Across projects it also includes effective project definitions. Global values are always excluded because they are already shared. Source worktrees without their own enabled definitions are hidden, even across projects. Inherited project values remain available through the project-scope source; empty worktrees remain available as copy destinations. Copy to transfers the selected definition, including its enabled state. Both merge into the destination context scope, preserve unrelated keys, require explicit conflict replacement, and remain drafts until Save.
- Global values also apply to projectless terminals.

### Worktree ownership contract

Keep these rules consistent across the server, overlay, and selection memory:

- `scopeKey` is the exact launch scope. Never collapse `worktree:<project>:<environment>`
  to `project:<project>`. A project key represents only its default checkout.
- `availableHere` and `contextKey` include the environment identity. Saved project-wide
  selections, recent sibling shells, and default-checkout shells cannot satisfy a worktree open.
- Automatic opens use `reuseExisting: true`. The server checks the exact scope and
  coalesces concurrent automatic opens. Explicit **New terminal** creates another shell.
- Reload and restart preserve ownership. Legacy project-grouped records recover
  their scope from `launchScopeKey`. Changing shell directory does not transfer ownership.
- Project filters group terminals for browsing only; they do not determine reuse or ownership.
- Exited shells are removed silently; disconnected shells remain available for reconnection.

Regression coverage lives in `lib/context.test.ts` (exact matching and selection keys),
`tests/server.test.ts` (migration, restart, concurrent reuse), and `tests/app.test.tsx`
(thread switching, create-or-show, environment editing, and exit cleanup).

An additional smoke test exercises the **running BB server**, creates a temporary
shell, sends input, renders its output through the real Ghostty engine, tests
resize/replay/restart and shell exit detection, and cleans up its test shells:

```sh
npm run test:live
# Optional: BB_SERVER_URL and BB_SMOKE_HOST_ID select the target server/host.
```

Desktop appearance, interaction with BB’s native shortcut handler, and mobile
keyboard layout still need a manual visual check. Automated access to the BB
window was unavailable during this implementation.

## Implementation

- `app.tsx` registers BB's `experimental_appOverlay`, sidebar footer action, and
  trusted content script. `lib/native-launcher.ts` redirects native terminal launch actions using
  its current BB DOM ID; this small host adapter may need updating if BB changes
  its action markup. It restores the action on opt-out or plugin unload.
- `components/floating-terminal.tsx` owns the shell/sidebar flow, context selection, and window layout.
- `lib/context.ts` defines project visibility, scope priority, and client selection memory.
- `components/terminal-sidebar.tsx` owns attached search, session list, filters, and footer controls.
- `components/terminal-management.tsx` owns naming and deletion dialogs.
- `components/project-environment-management.tsx` owns the worktree environment dialog; `components/environment-variable-editor.tsx` provides key/value rows and raw dotenv editing.
- `components/project-environment-settings.tsx` provides the searchable project and worktree
  environment inventory on the plugin Settings page.
- `lib/shell-integration.ts` installs session-local shell title hooks; `lib/terminal-title.ts`
  reads bounded OSC title signals because the pinned Ghostty adapter lacks title reporting.
- `lib/pump.ts` connects one Ghostty renderer to one BB PTY. Hidden tabs stop
  polling; replayed terminal queries cannot become shell input.
- `lib/use-switcher-titles.ts` refreshes inactive titles while the switcher is open,
  without mounting renderers or sending terminal replies.
- `lib/ghostty.ts` loads the authenticated WASM and adapts Wterm's Ghostty guards.
- `server.ts` uses public `bb.sdk.terminals` APIs, plugin-owned KV storage, and a
  private plugin database for project environments. Existing secret-setting vaults
  are imported once during migration and are no longer exposed in Settings.
  Every terminal operation checks ownership.
- `host.ts` writes a private one-use export file on the shell's machine. The
  shell sources and deletes it during startup; secret values never enter terminal
  creation metadata.

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

### Terminal polish

- Prompt text remains visible after clearing, hiding, and reopening the terminal.
- Cmd+N creates a shell in the current conversation context; in the selector it
  uses the selected project, just like the New terminal button.
- Project environment additions, changes, and removals apply at the next prompt
  in fish, zsh, and bash. New shells use the latest saved revision. Updates never
  type commands into the PTY. Disconnected hosts retry as their terminals resume
  polling. Shells started before the integration was installed need one restart.
- Cmd+A selects all retained output, including virtualized history. Ctrl+Shift+A
  provides the same action. Copy captures that selection as it existed when selected.
- On macOS, Cmd+F opens Find; Ctrl+F and Ctrl+V reach the shell. Cmd+Left/Right
  move to line start/end; modified arrows preserve their modifiers in legacy mode.
- Toolbar input and paste return to the latest output, like physical typing.
- Exited shells close silently. Restarting from the selector asks before stopping
  the shell and replacing its output.
- Cell backgrounds stay within cells. Cursor shape/blink requests are observed
  across output chunks; supported RGB theme colors are reflected in OSC 10/11 replies.
- Search includes all retained matches and maps wide glyphs to terminal columns.
  Search and full-history copy still use physical rows: the pinned Ghostty WASM
  does not expose soft-wrap boundaries. IME candidate positioning, screen-reader
  output announcements, and drag selection across unmounted history remain future work.

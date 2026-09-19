# Floating Ghostty

Summon a shell without leaving your conversation. Floating Ghostty puts a
Ghostty-powered terminal in a draggable, resizable window over BB.

Open it from the ghost in the sidebar footer or **Ctrl+backtick** and type directly
into a shell. Press the same shortcut or the **×** to return to BB. Your shells
keep running, and surviving sessions reattach on reload.

The minimal header shows the sidebar toggle, ghost, terminal name and path, and
hide control. Search and session management live in an attached left sidebar. Managing a background session keeps
your current shell selected, and dialogs return to the same search and filter.

Terminals belong to their launch worktree. Opening the terminal shows an existing
shell for the current thread’s worktree, or creates one if none exists. Each
worktree remembers its own selection. Threads without a worktree use the default
checkout; projectless threads use a machine’s home directory.

**Cmd/Ctrl+K** toggles a compact sidebar beside the shell. Its search and terminal
list use BB’s muted surfaces and flat rows. The sidebar stays open after selecting
a shell on desktop; narrow layouts return to the shell. The project filter groups sessions
for browsing; it does not share terminals between worktrees. **Cmd/Ctrl+P** opens
the filter, and **All** shows terminals across projects. **New terminal** creates
an additional shell in the selected context. Environment variables are accessible
from the sidebar footer. Each session’s **⋯** menu lets you
rename, restart, delete, or edit its environment variables.

Environment variables inherit from Global → Project → Worktree, with the most specific value winning. Each row selects its scope; same-key definitions across scopes stay visible. Add a more specific definition to override, or change scope to move a definition. Saves are atomic across changed scopes. Removing an override restores the inherited value at the next prompt.
Settings lists projects and worktrees, including empty environments. The editor menu’s **Copy from…** browses source worktrees and selected effective keys. Each row’s **Copy to…** reviews that definition at a destination. Both preserve unrelated keys, default conflicts to Keep existing, and save only after review.
Copies are independent. Names follow the shell and running command unless pinned.
Exited shells close silently; the window selects another live shell in the current
worktree or hides if none remain. Disconnected shells stay available for reconnection.

See the [worktree ownership contract](README.md#worktree-ownership-contract) for
implementation invariants and regression tests.

The centered window remembers its position, supports maximize and restore, and
becomes fullscreen on smaller screens, adjusting for the software keyboard.
Optional settings recenter it on each opening and set its opening width and height.
Nerd Font symbols are bundled.

An optional app-wide override redirects Start terminal, the command palette,
and BB's terminal shortcut, with separate action and shortcut flags. Ctrl+backtick
is disabled while the override is enabled. The full terminal inherits BB's theme.
**Override, recentering, and custom sizing are off by default.**

Uses Ghostty's WebAssembly engine through Wterm; native Ghostty is not required.
BB 0.42+ and SDK 0.4.47+ within the 0.4 series are required.

Inspired by Floating Terminal and Wterm Terminal Preview. MIT licensed.

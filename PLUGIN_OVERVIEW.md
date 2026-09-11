# Floating Ghostty

Summon a shell without leaving your conversation. Floating Ghostty puts a
Ghostty-powered terminal in a draggable, resizable window over BB.

Open it from the ghost in the sidebar footer or **Ctrl+backtick** and type directly
into a shell. Press the same shortcut or the **×** to return to BB. Your shells
keep running, and surviving sessions reattach on reload.

The minimal header shows the ghost, terminal selector, and hide control. All
session management lives in the selector. Managing a background session keeps
your current shell selected, and dialogs return to the same search and filter.

Terminals belong to a project or **No project**. **Cmd/Ctrl+K** opens a flat,
searchable list that defaults to the current thread's project. The project filter
sits beside search; **Cmd/Ctrl+P** opens it, and **All** shows terminals across
every project. Compact rows show the shell title above its working directory. The project picker is searchable.
**New terminal** appears in the results when search is empty and creates in the
selected project (the current BB context under All). Worktrees determine the
launch directory; project ownership stays fixed. Each session’s **⋯** menu lets
you rename, restart, or delete it. Project terminals also expose a dotenv editor
whose values are injected into new and restarted shells across that project's
worktrees. Names automatically follow the shell and
running command unless you pin a custom name. Exited shells disappear automatically;
the window selects another shell in the same project or closes if none remain.

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

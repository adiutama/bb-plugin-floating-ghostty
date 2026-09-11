# Floating Ghostty

Summon a shell without leaving your conversation. Floating Ghostty puts a
Ghostty-powered terminal in a draggable, resizable window over BB.

Open it from the ghost in the sidebar footer or **Ctrl+backtick** and type directly
into a shell. Press the same shortcut or the **×** to return to BB. Your shells
keep running, and surviving sessions reattach on reload.

Terminals belong to Global, a Project, or a Worktree. **Cmd/Ctrl+P** opens a flat,
searchable switcher containing Global plus the current project's terminals,
including all its worktrees. Filters narrow that list. **+** creates immediately in the current BB context.
Promote a shell to Project or Global afterward from its actions menu, keeping
its process and working directory.

The centered window remembers its position, supports maximize and restore, and
becomes fullscreen on smaller screens, adjusting for the software keyboard.
Optional settings recenter it on each opening and set its opening width and height.
Nerd Font symbols are bundled.

An optional native shortcut override uses BB's terminal binding, hides its
**Start terminal** action, and disables Ctrl+backtick while enabled. Turning it
back off restores both. **Override, recentering, and custom sizing are off by default.**

Uses Ghostty's WebAssembly engine through Wterm; native Ghostty is not required.
BB 0.42+ and SDK 0.4.47+ within the 0.4 series are required.

Inspired by Floating Terminal and Wterm Terminal Preview. MIT licensed.

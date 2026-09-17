// Session-local shell integration. Only private temporary startup files are written;
// existing user startup files are sourced, never modified.
const ZSH_ENV = `typeset -g __bb_fg_dir="$ZDOTDIR"
ZDOTDIR="$BB_FLOATING_GHOSTTY_ZDOTDIR"
[[ -r "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
export BB_FLOATING_GHOSTTY_ZDOTDIR="\${ZDOTDIR:-$HOME}"
ZDOTDIR="$__bb_fg_dir"
`;

const ZSH_PROFILE = `ZDOTDIR="$BB_FLOATING_GHOSTTY_ZDOTDIR"
[[ -r "$ZDOTDIR/.zprofile" ]] && source "$ZDOTDIR/.zprofile"
export BB_FLOATING_GHOSTTY_ZDOTDIR="\${ZDOTDIR:-$HOME}"
ZDOTDIR="$__bb_fg_dir"
`;

const ZSH_RC = `ZDOTDIR="$BB_FLOATING_GHOSTTY_ZDOTDIR"
[[ -r "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
__bb_fg_environment() {
  setopt localoptions shwordsplit
  if [[ -n "$BB_FLOATING_GHOSTTY_ENV_FILE" && -r "$BB_FLOATING_GHOSTTY_ENV_FILE" ]]; then
    source "$BB_FLOATING_GHOSTTY_ENV_FILE"
  fi
}
__bb_fg_environment
command rm -f -- "$__bb_fg_dir/.zshenv" "$__bb_fg_dir/.zprofile" "$__bb_fg_dir/.zshrc"
command rmdir -- "$__bb_fg_dir" 2>/dev/null
unset __bb_fg_dir BB_FLOATING_GHOSTTY_ZDOTDIR
autoload -Uz add-zsh-hook
__bb_fg_prompt() { builtin printf '\\033]1337;CurrentDir=%s\\007' "$PWD"; builtin printf '\\033]0;bb-fg:shell:zsh\\007'; }
__bb_fg_preexec() {
  local -a words
  words=( \${(z)1} )
  local word
  for word in "\${words[@]}"; do
    [[ "$word" == *=* ]] && continue
    builtin printf '\\033]0;bb-fg:command:%s\\007' "\${(Q)word}"
    break
  done
}
add-zsh-hook precmd __bb_fg_environment
add-zsh-hook precmd __bb_fg_prompt
add-zsh-hook preexec __bb_fg_preexec
`;

const BASH_RC = `# Read login startup files while using a private rcfile for the interactive shell.
[[ -r /etc/profile ]] && source /etc/profile
if [[ -r ~/.bash_profile ]]; then source ~/.bash_profile
elif [[ -r ~/.bash_login ]]; then source ~/.bash_login
elif [[ -r ~/.profile ]]; then source ~/.profile
elif [[ -r ~/.bashrc ]]; then source ~/.bashrc
fi
__bb_fg_environment() {
  if [[ -n "$BB_FLOATING_GHOSTTY_ENV_FILE" && -r "$BB_FLOATING_GHOSTTY_ENV_FILE" ]]; then
    source "$BB_FLOATING_GHOSTTY_ENV_FILE"
  fi
}
__bb_fg_environment
command rm -f -- "$BB_FLOATING_GHOSTTY_RC"
unset BB_FLOATING_GHOSTTY_RC
__bb_fg_prompt() { local result=$?; __bb_fg_environment; builtin printf '\\033]1337;CurrentDir=%s\\007' "$PWD"; builtin printf '\\033]0;bb-fg:shell:bash\\007'; return "$result"; }
__bb_fg_preexec() {
  [[ "$BASH_COMMAND" == __bb_fg_* ]] && return
  local -a words
  local word
  read -r -a words <<< "$BASH_COMMAND"
  for word in "\${words[@]}"; do
    [[ "$word" == *=* ]] && continue
    builtin printf '\\033]0;bb-fg:command:%s\\007' "$word"
    break
  done
}
# A user's existing DEBUG trap may drive their own integration. Never replace it.
if [[ -z "$(trap -p DEBUG)" ]]; then trap '__bb_fg_preexec' DEBUG; fi
if declare -p PROMPT_COMMAND 2>/dev/null | command grep -q 'declare -a'; then
  PROMPT_COMMAND+=(__bb_fg_prompt)
else
  PROMPT_COMMAND="\${PROMPT_COMMAND:+$PROMPT_COMMAND; }__bb_fg_prompt"
fi
`;

// Fish emits its title after fish_prompt/preexec events. Use its title function
// so a later default directory title cannot overwrite the integration signal.
const FISH_INIT = `if set -q BB_FLOATING_GHOSTTY_ENV_FILE; and test -n "$BB_FLOATING_GHOSTTY_ENV_FILE"
  set -gx BB_FLOATING_GHOSTTY_ENV_FILE "$BB_FLOATING_GHOSTTY_ENV_FILE.fish"
end
function __bb_fg_environment --on-event fish_prompt
  if test -n "$BB_FLOATING_GHOSTTY_ENV_FILE"; and test -r "$BB_FLOATING_GHOSTTY_ENV_FILE"
    source "$BB_FLOATING_GHOSTTY_ENV_FILE"
  end
end
__bb_fg_environment
function __bb_fg_directory --on-event fish_prompt
  printf '\\033]1337;CurrentDir=%s\\007' "$PWD"
end
function fish_title
  set -l executable (status current-command)
  if set -q argv[1]
    set -l words (string split ' ' -- $argv[1])
    for word in $words
      test -z "$word"; and continue
      string match -q '*=*' -- $word; and continue
      set executable "$word"
      break
    end
  end
  if test "$executable" = fish
    printf 'bb-fg:shell:fish'
  else
    printf 'bb-fg:command:%s' "$executable"
  end
end
`;

const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";

const SHELL_START_SCRIPT = [
  'bb_fg_shell="${SHELL:-/bin/sh}"',
  'bb_fg_name="$(basename "$bb_fg_shell")"',
  "printf '\\033]0;bb-fg:shell:%s\\007' \"$bb_fg_name\"",
  'case "$bb_fg_name" in',
  "zsh)",
  'bb_fg_dir="$(mktemp -d "${TMPDIR:-/tmp}/bb-ghostty.XXXXXXXX")" || exec "$bb_fg_shell" -l -i',
  "printf %s " + quote(ZSH_ENV) + ' > "$bb_fg_dir/.zshenv"',
  "printf %s " + quote(ZSH_PROFILE) + ' > "$bb_fg_dir/.zprofile"',
  "printf %s " + quote(ZSH_RC) + ' > "$bb_fg_dir/.zshrc"',
  'export BB_FLOATING_GHOSTTY_ZDOTDIR="${ZDOTDIR:-$HOME}"',
  'export ZDOTDIR="$bb_fg_dir"',
  'exec "$bb_fg_shell" -l -i',
  ";;",
  "bash)",
  'BB_FLOATING_GHOSTTY_RC="$(mktemp "${TMPDIR:-/tmp}/bb-ghostty.XXXXXXXX")" || exec "$bb_fg_shell" -l -i',
  "export BB_FLOATING_GHOSTTY_RC",
  "printf %s " + quote(BASH_RC) + ' > "$BB_FLOATING_GHOSTTY_RC"',
  'exec "$bb_fg_shell" --rcfile "$BB_FLOATING_GHOSTTY_RC" -i',
  ";;",
  'fish) exec "$bb_fg_shell" -l -i -C ' + quote(FISH_INIT) + ";;",
  "*)",
  'if [ -n "$BB_FLOATING_GHOSTTY_ENV_FILE" ] && [ -r "$BB_FLOATING_GHOSTTY_ENV_FILE" ]; then',
  '. "$BB_FLOATING_GHOSTTY_ENV_FILE"',
  "unset BB_FLOATING_GHOSTTY_ENV_FILE",
  "fi",
  'exec "$bb_fg_shell"',
  ";;",
  "esac",
].join("\n");

/** BB evaluates command starts in the user's shell (which may be fish). Enter
 * a POSIX launcher explicitly before evaluating assignments and case syntax.
 */
const BASE_SHELL_START_COMMAND =
  "exec /bin/sh -c " + quote(SHELL_START_SCRIPT);

export function shellStartCommand(environmentFile?: string | null): string {
  if (!environmentFile) return BASE_SHELL_START_COMMAND;
  return (
    "BB_FLOATING_GHOSTTY_ENV_FILE=" +
    quote(environmentFile) +
    " " +
    BASE_SHELL_START_COMMAND
  );
}

export const SHELL_START_COMMAND = shellStartCommand();

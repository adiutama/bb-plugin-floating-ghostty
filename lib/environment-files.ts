import { createHash } from "node:crypto";
import {
  environmentExportScript,
  shellQuote,
  type ProjectEnvironmentEntry,
} from "./project-environment";

/** Both files describe the same revision; shells apply it once at a prompt. */
export function environmentRefreshScripts(entries: ProjectEnvironmentEntry[]) {
  const revision = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");
  const keys = entries.map(({ key }) => key).join(" ");
  const exports = environmentExportScript(entries);
  const fishQuote = (value: string) =>
    "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'";
  const fishExports = entries
    .map(({ key, value }) => `set -gx ${key} ${fishQuote(value)}`)
    .join("\n") + "\n";
  return {
    sh: `if [ "$BB_FLOATING_GHOSTTY_ENV_REVISION" != '${revision}' ]; then
  for __bb_fg_key in $BB_FLOATING_GHOSTTY_ENV_KEYS; do unset "$__bb_fg_key"; done
${exports}export BB_FLOATING_GHOSTTY_ENV_KEYS=${shellQuote(keys)}
export BB_FLOATING_GHOSTTY_ENV_REVISION='${revision}'
fi
`,
    fish: `if test "$BB_FLOATING_GHOSTTY_ENV_REVISION" != '${revision}'
  for __bb_fg_key in (string split ' ' -- "$BB_FLOATING_GHOSTTY_ENV_KEYS")
    test -n "$__bb_fg_key"; and set -e "$__bb_fg_key"
  end
${fishExports}set -gx BB_FLOATING_GHOSTTY_ENV_KEYS ${shellQuote(keys)}
set -gx BB_FLOATING_GHOSTTY_ENV_REVISION '${revision}'
end
`,
  };
}

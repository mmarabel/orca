/** Why 127: "command not found" is the closest POSIX status for a script that never arrived. */
export const SETUP_SCRIPT_MISSING_STATUS = 127

/**
 * Builds the one-line text Orca types into a user's interactive shell to run a setup or startup
 * script that travels in `scriptEnvName` instead of in the keystrokes.
 *
 * Why nothing but words, `$` and balanced quotes: single-line startup commands are delivered as
 * keystrokes through the user's line editor, where pair-inserting widgets (zsh-autopair, fish,
 * many .inputrc setups) insert a matching `)`/`]`/`}` and corrupt the command before the shell
 * parses it (#18059).
 *
 * Why the guard: an env carrier that drops the variable would otherwise make the typed command a
 * silent no-op — exit 0, no output — which reads as "setup is still running" forever. `report`
 * must be a line-editor-safe command (no brackets, no single quotes) that announces the miss.
 */
export function buildTypedSetupScriptCommand(scriptEnvName: string, report: string): string {
  const script = [
    `if test -z "$${scriptEnvName}"`,
    `then ${report}`,
    `exit ${SETUP_SCRIPT_MISSING_STATUS}`,
    'fi',
    `eval "$${scriptEnvName}"`
  ].join('; ')
  return `bash -lc '${script}'`
}

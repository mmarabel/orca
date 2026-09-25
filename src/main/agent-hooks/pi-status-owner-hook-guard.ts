import { PI_STATUS_OWNER_ENV_KEYS } from '../pty/pi-process-owner-env'
import { WINDOWS_HOOK_STDIN_DRAIN_LABEL } from './hook-stdin-contract'

// Why (#22011): a child agent under Pi (`devin acp`) inherits Pi's pane key; Pi already reports its status.

/** Must follow payload capture: POSIX hooks own stdin before any exit (#8110). */
export function buildPosixPiStatusOwnerHookGuardLines(): string[] {
  // Why kill -0: a stale PID in a long-lived descendant (e.g. a tmux server) must not silence the pane.
  // Why 0*: `kill -0 0` (or `00`) probes the whole process group and always succeeds.
  return PI_STATUS_OWNER_ENV_KEYS.map(
    (key) =>
      `case "\${${key}:-}" in ''|0*|*[!0-9]*) ;; *) kill -0 "$${key}" 2>/dev/null && exit 0 ;; esac`
  )
}

/** Must follow the Orca env guards, so the drain only runs inside a pane, which closes stdin (#11549). */
export function buildWindowsPiStatusOwnerHookGuardLines(): string[] {
  // Why no liveness probe: cmd has no builtin one, and tasklist per event costs time and EDR signal.
  // Why drain, not exit: an unread payload larger than the pipe buffer fails the agent's write.
  return PI_STATUS_OWNER_ENV_KEYS.map(
    (key) => `if not "%${key}%"=="" goto :${WINDOWS_HOOK_STDIN_DRAIN_LABEL}`
  )
}

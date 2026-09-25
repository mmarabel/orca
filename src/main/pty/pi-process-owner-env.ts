/** Set to the PID of the Pi-family process that reports its pane's status; descendants inherit it. */
export const PI_STATUS_OWNER_ENV_KEYS = [
  'ORCA_PI_STATUS_OWNED',
  'ORCA_PRIME_AGENT_STATUS_OWNED'
] as const

export const PI_PROCESS_OWNER_ENV_KEYS = [
  ...PI_STATUS_OWNER_ENV_KEYS,
  'ORCA_PI_TITLE_MARKER_OWNED'
] as const

/** A new terminal is not a child agent in the pane that launched its host. */
export function stripPiProcessOwnerEnv(env: Record<string, string | undefined>): void {
  for (const key of PI_PROCESS_OWNER_ENV_KEYS) {
    delete env[key]
  }
}

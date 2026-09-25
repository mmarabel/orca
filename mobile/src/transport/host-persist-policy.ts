import { mergeHostNameIdentity } from './host-name-identity'
import type { StoredHostProfile } from './types'

export type RecoveredPairingHostOptions = {
  /**
   * The stored row's address as it stood when this pairing's journal was captured. A re-pair
   * reuses the host id, so the replay writes onto a row that may have moved since: its own
   * address is the newer one only while the row still holds the captured value. Anything else is
   * an edit made after capture and wins. A journal written before this was recorded has none, so
   * that replay keeps the row.
   */
  capturedStoredEndpoint?: string
}

/**
 * The stored-row policy each host-store save entry point needs.
 *
 * The row carries no relay fields, so a relay-carrying save learns nothing it can store and must
 * not replace it from a snapshot that may predate a user edit. Those saves still publish the
 * credential and the relay overlay. They differ on a row that is not there: an upgrade must
 * refuse (the user removed the host mid-flight) while a pairing recovery must create it (the
 * pairing the user asked for never landed).
 *
 * - `create-or-update`: insert when missing, replace when present.
 * - `relay-upgrade`: throw when missing, leave the row untouched when present.
 * - `pairing-recovery`: insert when missing; when present, keep the row except for the one field
 *   the pairing renegotiated, and only while the row is provably unchanged since capture.
 */
export type HostPersistPolicy =
  | { mode: 'create-or-update' }
  | { mode: 'relay-upgrade' }
  | ({ mode: 'pairing-recovery' } & RecoveredPairingHostOptions)

/** What an existing row becomes under one policy; identity means there is nothing to write. */
export function nextStoredRow(
  current: StoredHostProfile,
  incoming: StoredHostProfile,
  policy: HostPersistPolicy
): StoredHostProfile {
  if (policy.mode === 'create-or-update') {
    return mergeHostNameIdentity(incoming, current)
  }
  if (
    policy.mode === 'pairing-recovery' &&
    policy.capturedStoredEndpoint === current.endpoint &&
    incoming.endpoint !== current.endpoint
  ) {
    // Only the address was renegotiated; the name and every other field stay as stored.
    return { ...current, endpoint: incoming.endpoint }
  }
  return current
}

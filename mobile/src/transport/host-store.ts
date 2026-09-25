import { HostProfileSchema } from './types'
import type { HostCatalogEntry, HostProfile, StoredHostProfile } from './types'
import { getNextHostNameFromHosts } from './host-names'
import { withPersonalName } from './host-name-identity'
import {
  nextStoredRow,
  type HostPersistPolicy,
  type RecoveredPairingHostOptions
} from './host-persist-policy'
import * as hostListLoads from './host-list-load-sharing'
import { joinHostCatalogCredentials } from './host-catalog-credential-join'
import { resetPairingKeychainForTests } from './pairing-keychain'
import { readHostDeviceToken } from './host-device-token-store'
import { commitDeviceToken, hostDeviceTokenCache } from './host-device-token-cache'
import { recordHostCredentialCleanupIntent } from './host-credential-cleanup'
import {
  cancelCleanupForDurablyStoredHosts,
  cancelCleanupForStoredHost,
  deleteUnpairedHostCredentials,
  removeOrphanOverlayIfUnpaired,
  scheduleUnpairedHostCredentialCleanup
} from './unpaired-host-cleanup-scheduling'
import {
  loadMobileRelayHostOverlayState,
  removeMobileRelayHostOverlay,
  removeMobileRelayHostOverlays,
  saveMobileRelayHostOverlay
} from './mobile-relay-host-overlay-store'
import { scheduleOrphanedMobileRelayCleanup } from './mobile-relay-orphan-cleanup'
import {
  getHostCredentialWriteRevision,
  resetHostCredentialWriteRevisionsForTests
} from './host-credential-write-revision'
import {
  loadStoredHostProfiles,
  readStoredHostProfilesForMutation,
  toStoredHostProfile
} from './host-metadata-store'
import {
  hostListMutationsSettled,
  mutateStoredHosts,
  resetHostListMutationQueueForTests
} from './host-list-mutation-queue'

export const loadHosts = async (): Promise<HostProfile[]> => (await loadHostListSnapshot()).profiles
export const loadHostCatalog = async (): Promise<HostCatalogEntry[]> =>
  (await loadHostListSnapshot()).catalog

async function loadHostListSnapshot(): Promise<hostListLoads.HostListSnapshot> {
  // Why: writers hold the mutation chain across their full RMW; wait so a load doesn't race a half-written list.
  await hostListMutationsSettled()
  // Why: deduplicate concurrent loadHosts() calls so simultaneously mounting screens share one Keychain read pass.
  return hostListLoads.shareHostListLoad(doLoadHostListSnapshot)
}

async function doLoadHostListSnapshot(): Promise<hostListLoads.HostListSnapshot> {
  const storedHosts = await loadStoredHostProfiles()
  if (!storedHosts) {
    return { catalog: [], profiles: [] }
  }
  const overlayState = await loadMobileRelayHostOverlayState(
    new Set(storedHosts.map(({ id }) => id))
  )
  const orphanWriteRevisions = new Map(
    overlayState.orphanHostIds.map((hostId) => [hostId, getHostCredentialWriteRevision(hostId)])
  )
  await scheduleOrphanedMobileRelayCleanup({
    hostIds: overlayState.orphanHostIds,
    deleteCredential: (hostId) =>
      deleteUnpairedHostCredentials(hostId, orphanWriteRevisions.get(hostId) ?? 0),
    removeOverlay: removeOrphanOverlayIfUnpaired
  })
  return joinHostCatalogCredentials({
    storedHosts,
    overlays: overlayState.overlays,
    tokenCache: hostDeviceTokenCache,
    readToken: readHostDeviceToken,
    getRevision: hostListLoads.getHostListLoadRevision
  })
}

export async function resolvePairingHostIdentity(
  publicKeyB64: string,
  newHostId: string
): Promise<{ id: string; name: string; storedEndpoint?: string }> {
  // Why: one durable read both preserves an existing identity and names a new host, avoiding
  // duplicate cards. It also reports the row's address, which a pairing journal records so a
  // later replay can tell an address this pairing renegotiated from one the user edited since.
  await hostListMutationsSettled()
  const hosts = await readStoredHostProfilesForMutation()
  const match = hosts.find((host) => host.publicKeyB64 === publicKeyB64)
  return match
    ? { id: match.id, name: match.name, storedEndpoint: match.endpoint }
    : { id: newHostId, name: getNextHostNameFromHosts(hosts) }
}

// The page's host-store sibling keeps its own no-op, so only the native store reaches persistence.
export { updateHostDescriptor } from './host-descriptor-persistence'

export { retryPendingHostCredentialCleanup } from './unpaired-host-cleanup-scheduling'

export class MobileRelayUpgradeHostRemovedError extends Error {}

export type { RecoveredPairingHostOptions }

export const saveHost = (host: HostProfile): Promise<void> =>
  persistHost(host, { mode: 'create-or-update' })

export const saveExistingHostRelayUpgrade = (host: HostProfile): Promise<void> =>
  persistHost(host, { mode: 'relay-upgrade' })

export const saveRecoveredPairingHost = (
  host: HostProfile,
  options: RecoveredPairingHostOptions = {}
): Promise<void> => persistHost(host, { mode: 'pairing-recovery', ...options })

async function persistHost(host: HostProfile, policy: HostPersistPolicy): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  const stored = toStoredHostProfile(validated)
  const duplicateHostIds = new Set<string>()
  let updatedExistingHost = false
  let cleanupIntentRecordedBeforeMetadata = false
  let tokenCommittedBeforeMetadata = false
  try {
    await mutateStoredHosts(async (hosts) => {
      const existing = hosts.find((h) => h.id === stored.id)
      for (const candidate of hosts) {
        if (candidate.id !== stored.id && candidate.publicKeyB64 === stored.publicKeyB64) {
          duplicateHostIds.add(candidate.id)
        }
      }
      let next: StoredHostProfile[]
      if (existing) {
        updatedExistingHost = true
        const replacement = nextStoredRow(existing, stored, policy)
        if (replacement === existing && duplicateHostIds.size === 0) {
          // Why: handing back the list read leaves the durable store alone, so a relay-only save
          // does not rewrite an identical host list or invalidate every shared load.
          return hosts
        }
        // Why: an authoritative save is the safe point to collapse pre-existing duplicate rows to the preserved host id.
        next = hosts
          .filter(({ id }) => !duplicateHostIds.has(id))
          .map((candidate) => (candidate === existing ? replacement : candidate))
      } else if (policy.mode === 'relay-upgrade') {
        // Why: an in-flight relay upgrade must not resurrect a host the user removed.
        throw new MobileRelayUpgradeHostRemovedError('mobile relay upgrade host was removed')
      } else {
        next = [...hosts.filter(({ id }) => !duplicateHostIds.has(id)), stored]
      }
      if (duplicateHostIds.size > 0) {
        if (!existing) {
          // Why: process death between the early token write and metadata publication must leave cleanup discoverable.
          await recordHostCredentialCleanupIntent(stored.id)
          cleanupIntentRecordedBeforeMetadata = true
        }
        for (const duplicateHostId of duplicateHostIds) {
          await recordHostCredentialCleanupIntent(duplicateHostId)
        }
        // Why: never remove the only usable same-key row until its replacement credential is durable.
        await commitDeviceToken(stored.id, validated.deviceToken)
        tokenCommittedBeforeMetadata = true
      }
      return next
    })
  } catch (error) {
    await cancelCleanupForDurablyStoredHosts(duplicateHostIds)
    if (cleanupIntentRecordedBeforeMetadata) {
      try {
        await scheduleUnpairedHostCredentialCleanup(stored.id)
      } catch {
        // The write-ahead cleanup intent remains available for retry.
      }
    }
    throw error
  }
  if (!tokenCommittedBeforeMetadata) {
    // Why: the catalog can now surface a failed token write for recovery instead of losing the host.
    await commitDeviceToken(stored.id, validated.deviceToken)
  }
  // Why: a later removal owns its cleanup intent; cancel only while this publication remains authoritative.
  cancelCleanupForStoredHost(stored.id)
  if (validated.endpoints) {
    await saveMobileRelayHostOverlay({
      v: 2,
      hostId: stored.id,
      endpoints: validated.endpoints,
      relayHostId: validated.relayHostId,
      relay: validated.relay
    })
    hostListLoads.dropSharedHostListLoad()
  }
  const overlayRemovalIds = [...duplicateHostIds]
  if (!validated.endpoints && updatedExistingHost) {
    overlayRemovalIds.push(stored.id)
  }
  if (overlayRemovalIds.length > 0) {
    // Why: reusing an id for direct-only re-pairing must not retain routing metadata from the previous transport state.
    await removeMobileRelayHostOverlays(overlayRemovalIds)
    hostListLoads.dropSharedHostListLoad()
  }
  for (const duplicateHostId of duplicateHostIds) {
    try {
      await scheduleUnpairedHostCredentialCleanup(duplicateHostId)
    } catch {
      // Metadata is already deduplicated; orphan-token recovery is best-effort.
    }
  }
}

export async function removeHost(hostId: string): Promise<void> {
  let cleanupIntentRecorded = false
  try {
    await mutateStoredHosts(async (hosts) => {
      try {
        await recordHostCredentialCleanupIntent(hostId)
        cleanupIntentRecorded = true
      } catch {
        // Removal remains authoritative when cleanup intent storage is unavailable.
      }
      return hosts.filter((h) => h.id !== hostId)
    })
  } catch (error) {
    if (cleanupIntentRecorded) {
      await cancelCleanupForDurablyStoredHosts([hostId])
    }
    throw error
  }
  hostDeviceTokenCache.delete(hostId)
  try {
    await removeMobileRelayHostOverlay(hostId)
    hostListLoads.dropSharedHostListLoad()
  } catch {
    // Base removal is authoritative; a retained overlay can't resurrect the host and is cleaned on a later retry.
  }
  // Why: keychain delete can stall/reject; await only the durable cleanup intent so removeHost can't freeze the UI.
  try {
    await scheduleUnpairedHostCredentialCleanup(hostId)
  } catch {
    // Metadata is already committed; orphan-token recovery is best-effort.
  }
}

// Why: single mutation pass commits name + endpoint atomically so a mid-save failure can't persist one without the other.
// `personalName: null` clears the phone's override, returning the row to the desktop-reported name.
export async function updateHostNameAndEndpoint(
  hostId: string,
  updates: { personalName?: string | null; endpoint?: string }
): Promise<void> {
  await mutateStoredHosts((hosts) => {
    const index = hosts.findIndex((host) => host.id === hostId)
    if (index === -1) {
      throw new Error('Host not found')
    }
    let updated: StoredHostProfile = {
      ...hosts[index]!,
      ...(updates.endpoint !== undefined ? { endpoint: updates.endpoint } : {})
    }
    if (updates.personalName !== undefined) {
      updated = withPersonalName(updated, updates.personalName, hosts)
    }
    const next = hosts.slice()
    next[index] = updated
    return next
  })
}

export async function updateLastConnected(hostId: string): Promise<void> {
  try {
    await mutateStoredHosts((hosts) => {
      const index = hosts.findIndex((h) => h.id === hostId)
      if (index === -1) {
        return hosts
      }
      const next = hosts.slice()
      next[index] = { ...next[index]!, lastConnected: Date.now() }
      return next
    })
  } catch {
    // Why: best-effort timestamp fired with void; swallow so unreadable storage doesn't reject.
  }
}

/** Test-only: drain module mutation chain between cases. */
export function resetHostStoreForTests(): void {
  resetHostListMutationQueueForTests()
  hostDeviceTokenCache.clear()
  resetHostCredentialWriteRevisionsForTests()
  hostListLoads.dropSharedHostListLoad()
  resetPairingKeychainForTests()
}

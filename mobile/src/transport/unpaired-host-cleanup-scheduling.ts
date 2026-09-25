// Whether a host's credential and relay overlay are still backed by a row in the durable host
// list, and the scheduling that follows from the answer. Every read here goes through the host
// mutation queue, so a cleanup decision never races a half-written list.
import {
  cancelPendingHostCredentialCleanup,
  retryPendingHostCredentialCleanups,
  scheduleHostCredentialCleanup
} from './host-credential-cleanup'
import { getHostCredentialWriteRevision } from './host-credential-write-revision'
import { hostDeviceTokenCache } from './host-device-token-cache'
import { dropSharedHostListLoad } from './host-list-load-sharing'
import { enqueueHostListMutation, hostListMutationsSettled } from './host-list-mutation-queue'
import { readStoredHostProfilesForMutation } from './host-metadata-store'
import { removeMobileRelayHostOverlay } from './mobile-relay-host-overlay-store'
import { createUnpairedHostCredentialDeletion } from './unpaired-host-credential-deletion'

export const deleteUnpairedHostCredentials = createUnpairedHostCredentialDeletion({
  waitForHostMutations: hostListMutationsSettled,
  hasStoredHost: async (hostId) =>
    (await readStoredHostProfilesForMutation()).some(({ id }) => id === hostId),
  onDeleted: (hostId) => {
    hostDeviceTokenCache.delete(hostId)
    dropSharedHostListLoad()
  }
})

export function scheduleUnpairedHostCredentialCleanup(hostId: string): Promise<void> {
  const writeRevision = getHostCredentialWriteRevision(hostId)
  return scheduleHostCredentialCleanup(hostId, (id) =>
    deleteUnpairedHostCredentials(id, writeRevision)
  )
}

export function cancelCleanupForStoredHost(hostId: string): void {
  void enqueueHostListMutation(async () => {
    const hosts = await readStoredHostProfilesForMutation()
    if (hosts.some(({ id }) => id === hostId)) {
      // Register before later removals enqueue their intent, without blocking host loads on cleanup storage.
      void cancelPendingHostCredentialCleanup(hostId).catch(() => undefined)
    }
  }).catch(() => {})
}

export async function cancelCleanupForDurablyStoredHosts(hostIds: Iterable<string>): Promise<void> {
  const targets = [...hostIds]
  return enqueueHostListMutation(async () => {
    const storedIds = new Set((await readStoredHostProfilesForMutation()).map(({ id }) => id))
    await Promise.all(
      targets
        .filter((hostId) => storedIds.has(hostId))
        .map((hostId) => cancelPendingHostCredentialCleanup(hostId).catch(() => undefined))
    )
  }).catch(() => undefined)
}

export function removeOrphanOverlayIfUnpaired(hostId: string): Promise<void> {
  return enqueueHostListMutation(async () => {
    const hosts = await readStoredHostProfilesForMutation()
    if (!hosts.some(({ id }) => id === hostId)) {
      await removeMobileRelayHostOverlay(hostId)
    }
  })
}

export async function retryPendingHostCredentialCleanup(): Promise<{
  clearedCount: number
  remainingIds: string[]
  storageUnreadable: boolean
}> {
  return retryPendingHostCredentialCleanups((hostId) =>
    deleteUnpairedHostCredentials(hostId, getHostCredentialWriteRevision(hostId))
  )
}

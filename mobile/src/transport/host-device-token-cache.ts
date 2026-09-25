import { markHostCredentialWrite } from './host-credential-write-revision'
import { writeHostDeviceToken } from './host-device-token-store'
import { dropSharedHostListLoad } from './host-list-load-sharing'

// Why: Keychain reads are slow (50-200ms) and loadHosts() runs on every screen mount; cache per-hostId in memory, invalidate on save/remove.
export const hostDeviceTokenCache = new Map<string, string>()

/** The only durable device-token write: it records the revision and refreshes the cache together. */
export async function commitDeviceToken(hostId: string, token: string): Promise<void> {
  markHostCredentialWrite(hostId)
  await writeHostDeviceToken(hostId, token)
  hostDeviceTokenCache.set(hostId, token)
  dropSharedHostListLoad()
}

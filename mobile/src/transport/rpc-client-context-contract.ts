import type { HostClientAcquisition } from './host-client-acquisition-registry'
import type { RpcClient } from './rpc-client'
import type { RelayHostReachability } from './relay-host-reachability'
import type { MobileConnectionPath } from './stable-logical-rpc-client'
import type { ConnectionState, HostProfile } from './types'

export type ForceReconnectOptions = {
  /**
   * The stored host address changed since this client opened, so nothing already in memory can
   * still be trusted to dial it. Two consequences follow and both are needed: the live Relay
   * session is rebuilt rather than preserved (it is bound to the pre-edit endpoint), and the
   * cached host profile is dropped so the reopen re-reads the row the user just saved. Leave it
   * unset for a plain Retry, which wants neither.
   */
  savedAddressChanged?: boolean
}

/** Re-dials one host. `null` where this document cannot dial: the page's shell owns the connection. */
export type ForceReconnect =
  | ((hostId: string, options?: ForceReconnectOptions) => Promise<void>)
  | null

export type RpcClientContextValue = {
  acquire: (
    hostId: string,
    acquisition: HostClientAcquisition,
    host?: HostProfile
  ) => RpcClient | null
  release: (hostId: string, acquisition: HostClientAcquisition) => void
  releaseAndCloseIfUnused: (hostId: string, acquisition: HostClientAcquisition) => void
  closeIfUnused: (hostId: string) => void
  forceReconnect: ForceReconnect
  refreshHostClient: (hostId: string) => void
  forgetHostClient: (hostId: string) => void
  disconnectHostClient: (hostId: string) => void
  getState: (hostId: string) => ConnectionState
  getKnownState: (hostId: string) => ConnectionState | null
  getClientId: (hostId: string) => string | null
  getReconnectAttempt: (hostId: string) => number
  getLastConnectedAt: (hostId: string) => number | null
  getActivePath: (hostId: string) => MobileConnectionPath
  getPendingPath: (hostId: string) => MobileConnectionPath | null
  isPairingRejected: (hostId: string) => boolean
  getRelayHostReachability: (hostId: string) => RelayHostReachability
  subscribeHostState: (hostId: string, listener: (state: ConnectionState) => void) => () => void
  getAllClients: () => { hostId: string; client: RpcClient }[]
  subscribeAllHosts: (listener: () => void) => () => void
  primeHosts: (hosts: HostProfile[]) => void
}

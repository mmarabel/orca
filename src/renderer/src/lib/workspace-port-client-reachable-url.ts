import type { PublicKnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { WorkspacePort } from '../../../shared/workspace-ports'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { clientReachableBrowserUrlForPort } from './workspace-port-urls'

// Why: the endpoint list already reaches the renderer with tokens redacted, so the
// address this client dials is available without new IPC. This is the single source
// for both the imperative open action and any reactive surface that labels a row.
type ClientReachableUrlLookupState = {
  runtimeEnvironments?: readonly PublicKnownRuntimeEnvironment[]
}

function preferredEndpointForEnvironment(
  environment: PublicKnownRuntimeEnvironment
): string | null {
  const endpoint =
    environment.endpoints.find((entry) => entry.id === environment.preferredEndpointId) ??
    environment.endpoints[0]
  return endpoint?.endpoint ?? null
}

/** URL for a remote workspace's port that this machine can open directly, or null when
 *  there is none. Local targets return null: their ports are already on this machine
 *  and the existing local paths own them. */
export function resolveClientReachableUrlForPort(
  state: ClientReachableUrlLookupState,
  port: WorkspacePort,
  target: RuntimeClientTarget | null
): string | null {
  if (target?.kind !== 'environment') {
    return null
  }
  const environment = (state.runtimeEnvironments ?? []).find(
    (entry) => entry.id === target.environmentId
  )
  if (!environment) {
    return null
  }
  // Why: an ssh-tunnelled pairing dials this client's own loopback, so its address
  // cannot reach the runtime's dev servers. The endpoint classification catches this
  // too; the declared dependency is the explicit signal and is checked first.
  if (environment.connectionDependency === 'ssh-tunnel') {
    return null
  }
  return clientReachableBrowserUrlForPort(port, preferredEndpointForEnvironment(environment))
}

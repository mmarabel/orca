import { useMemo } from 'react'
import type { PublicKnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { WorkspacePort } from '../../../shared/workspace-ports'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { useWorktreeRuntimeTarget } from '@/runtime/use-worktree-runtime-target'
import { useAppStore } from '@/store'
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

/** Reactive form for rows that display the address, so what is shown, copied and
 *  opened cannot drift apart. Null keeps the caller on the OS-derived address. */
export function useClientReachableUrlForPort(port: WorkspacePort): string | null {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  // Why: container and external ports carry no owner, so they inherit the active
  // workspace's host — the same fallback openWorkspacePortInBrowser applies.
  const worktreeId = port.kind === 'workspace' ? port.owner.worktreeId : activeWorktreeId
  const target = useWorktreeRuntimeTarget(worktreeId)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  return useMemo(
    () => resolveClientReachableUrlForPort({ runtimeEnvironments }, port, target),
    [runtimeEnvironments, port, target]
  )
}

/** The `host:port` shown on a row, preferring an address this machine can reach. */
export function clientReachableAddress(reachableUrl: string | null): string | null {
  if (!reachableUrl) {
    return null
  }
  try {
    return new URL(reachableUrl).host || null
  } catch {
    return null
  }
}

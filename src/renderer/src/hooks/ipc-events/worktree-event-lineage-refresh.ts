import { createCoalescingKeyedRunner } from '../../../../shared/coalescing-keyed-runner'
import type { ExecutionHostId } from '../../../../shared/execution-host'

export type WorktreeEventLineageTarget =
  | { forceLocalOwner: true }
  | { executionHostId: ExecutionHostId }
  | undefined

/**
 * Lineage is host-wide while change events are per repo, so one host save that touches 25 repos
 * would otherwise fetch the same lineage 25 times. Each caller still gets a fetch that started
 * after its request, so a burst costs the fetch in flight plus one trailing fetch.
 */
export function createWorktreeEventLineageRefresh(
  fetchWorktreeLineage: (target: WorktreeEventLineageTarget) => Promise<void>
): (target: WorktreeEventLineageTarget) => Promise<void> {
  const run = createCoalescingKeyedRunner<void>()
  return (target) => {
    const key = !target
      ? 'active-target'
      : 'forceLocalOwner' in target
        ? 'force-local'
        : `host:${target.executionHostId}`
    return run(key, key, () => fetchWorktreeLineage(target))
  }
}

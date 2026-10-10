import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { createWorktreeEventLineageRefresh } from './worktree-event-lineage-refresh'
import { createWorktreeEventRuntime } from './worktree-event-runtime'

function deferredFetches() {
  const pending: PromiseWithResolvers<void>[] = []
  const fetch = vi.fn(() => {
    const next = Promise.withResolvers<void>()
    pending.push(next)
    return next.promise
  })
  return { fetch, pending }
}

describe('createWorktreeEventLineageRefresh', () => {
  it('serves a burst on one host with the fetch in flight plus one trailing fetch', async () => {
    const { fetch, pending } = deferredFetches()
    const refresh = createWorktreeEventLineageRefresh(fetch)
    const target = { executionHostId: 'runtime:host-a' } as const

    const first = refresh(target)
    const burst = Array.from({ length: 24 }, () => refresh(target))
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)

    let burstSettled = false
    void Promise.all(burst).then(() => {
      burstSettled = true
    })
    pending[0].resolve()
    await first
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    // Why: the burst arrived after the first fetch started, so only the trailing fetch covers it.
    expect(burstSettled).toBe(false)
    pending[1].resolve()
    await Promise.all(burst)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(2, target)
  })

  it('keeps hosts and the forced-local target independent', async () => {
    const { fetch } = deferredFetches()
    const refresh = createWorktreeEventLineageRefresh(fetch)

    void refresh({ executionHostId: 'runtime:host-a' })
    void refresh({ executionHostId: 'runtime:host-b' })
    void refresh({ forceLocalOwner: true })
    void refresh(undefined)
    await Promise.resolve()

    expect(fetch.mock.calls).toEqual([
      [{ executionHostId: 'runtime:host-a' }],
      [{ executionHostId: 'runtime:host-b' }],
      [{ forceLocalOwner: true }],
      [undefined]
    ])
  })
})

describe('worktree change events', () => {
  const initialState = useAppStore.getState()
  afterEach(() => {
    vi.restoreAllMocks()
    useAppStore.setState(initialState, true)
  })

  it('fetches host lineage once per burst instead of once per repo', async () => {
    const fetchWorktrees = vi.spyOn(initialState, 'fetchWorktrees').mockResolvedValue(false)
    const { fetch, pending } = deferredFetches()
    const fetchWorktreeLineage = vi
      .spyOn(initialState, 'fetchWorktreeLineage')
      .mockImplementation(fetch)
    useAppStore.setState({
      fetchWorktrees: initialState.fetchWorktrees,
      fetchWorktreeLineage: initialState.fetchWorktreeLineage
    })
    const unsubs: (() => void)[] = []
    const runtime = createWorktreeEventRuntime(unsubs, () => true)
    try {
      for (let index = 0; index < 25; index++) {
        runtime.worktreeChangeRefreshQueue.enqueue({
          repoId: `repo-${index}`,
          executionHostId: 'runtime:host-a'
        })
      }
      await vi.waitFor(() => expect(fetchWorktrees).toHaveBeenCalledTimes(25))
      await vi.waitFor(() => expect(fetchWorktreeLineage).toHaveBeenCalledTimes(1))
      pending[0].resolve()
      await vi.waitFor(() => expect(fetchWorktreeLineage).toHaveBeenCalledTimes(2))
      pending[1].resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(fetchWorktreeLineage).toHaveBeenCalledTimes(2)
      expect(fetchWorktreeLineage).toHaveBeenCalledWith({ executionHostId: 'runtime:host-a' })
    } finally {
      pending.forEach((fetch) => fetch.resolve())
      unsubs.forEach((unsubscribe) => unsubscribe())
    }
  })
})

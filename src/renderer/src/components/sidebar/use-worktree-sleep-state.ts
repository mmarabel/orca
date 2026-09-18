import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { EMPTY_BROWSER_TABS, EMPTY_TABS } from './WorktreeCardHelpers'
import { selectWorktreeAgentActivitySummary } from './worktree-agent-activity-summary'
import { selectLivePtyIdsForWorktree } from './worktree-card-status-inputs'

// Why: sleep is a runtime-liveness verdict, not an activity-status value. A
// slept workspace keeps its retained done rows, so its status still reads
// 'done' — keying the sleeping glyph on 'inactive' misses exactly the
// completed-but-slept cards it must distinguish (#19624).
export function useIsSleepingWorktree(worktreeId: string): boolean {
  // Why optional: selector unit tests pass partial store mocks; missing maps behave as empty slices.
  const tabs = useAppStore((s) => s.tabsByWorktree?.[worktreeId] ?? EMPTY_TABS)
  const browserTabs = useAppStore(
    (s) => s.browserTabsByWorktree?.[worktreeId] ?? EMPTY_BROWSER_TABS
  )
  const ptyIdsForWorktree = useAppStore(
    useShallow((s) => selectLivePtyIdsForWorktree(s, worktreeId))
  )
  const { hasPermission, hasLiveWorking, hasLiveMonitoring, hasInterrupted } = useAppStore(
    useShallow((s) => selectWorktreeAgentActivitySummary(s, worktreeId))
  )

  // Why: fresh agent activity keeps the workspace awake through brief PTY gaps
  // such as an SSH reconnect, mirroring the hide-sleeping filter (#7197).
  // Attention states win over the sleeping glyph by construction below.
  return useMemo(
    () =>
      !hasPermission &&
      !hasLiveWorking &&
      !hasLiveMonitoring &&
      !hasInterrupted &&
      browserTabs.length === 0 &&
      !tabs.some((tab) => tabHasLivePty(ptyIdsForWorktree, tab.id)),
    [
      tabs,
      browserTabs,
      ptyIdsForWorktree,
      hasPermission,
      hasLiveWorking,
      hasLiveMonitoring,
      hasInterrupted
    ]
  )
}

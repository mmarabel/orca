import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { translate } from '@/i18n/i18n'
import type { WorktreeStatus } from '@/lib/worktree-status'
import { useAppStore, type AppState } from '@/store'
import { selectWorktreeActivityStatuses } from './use-worktree-activity-statuses'

export type LineageHiddenActivityStatus = Extract<
  WorktreeStatus,
  'permission' | 'working' | 'monitoring'
>

/** How many hidden worktrees are in each live state. */
export type LineageHiddenActivity = Record<LineageHiddenActivityStatus, number>

// Why: most urgent first. Only live states surface; a finished, failed or idle
// child stays quiet until the lineage is expanded.
const ACTIVITY_PRIORITY: readonly LineageHiddenActivityStatus[] = [
  'permission',
  'working',
  'monitoring'
]

function isLineageHiddenActivityStatus(
  status: WorktreeStatus
): status is LineageHiddenActivityStatus {
  return status === 'permission' || status === 'working' || status === 'monitoring'
}

export function summarizeLineageHiddenActivity(
  statuses: Iterable<WorktreeStatus>
): LineageHiddenActivity {
  const activity: LineageHiddenActivity = { permission: 0, working: 0, monitoring: 0 }
  for (const status of statuses) {
    if (isLineageHiddenActivityStatus(status)) {
      activity[status] += 1
    }
  }
  return activity
}

export function getLineageHiddenActivityStatus(
  activity: LineageHiddenActivity
): LineageHiddenActivityStatus | null {
  return ACTIVITY_PRIORITY.find((status) => activity[status] > 0) ?? null
}

function getActivityCountLabel(status: LineageHiddenActivityStatus, count: number): string {
  if (status === 'permission') {
    return translate(
      'auto.components.sidebar.WorktreeLineageHiddenActivity.permission',
      '{{value0}} waiting for permission',
      { value0: count }
    )
  }
  if (status === 'working') {
    return translate(
      'auto.components.sidebar.WorktreeLineageHiddenActivity.working',
      '{{value0}} working',
      { value0: count }
    )
  }
  return translate(
    'auto.components.sidebar.WorktreeLineageHiddenActivity.monitoring',
    '{{value0}} monitoring background tasks',
    { value0: count }
  )
}

/** Live work first, then unread: a finished child is news the parent row otherwise hides. */
export function getLineageHiddenActivityLabel(
  activity: LineageHiddenActivity,
  unreadCount: number
): string | null {
  const parts = ACTIVITY_PRIORITY.filter((status) => activity[status] > 0).map((status) =>
    getActivityCountLabel(status, activity[status])
  )
  if (unreadCount > 0) {
    parts.push(
      translate(
        'auto.components.sidebar.WorktreeLineageHiddenActivity.unread',
        '{{value0}} unread',
        {
          value0: unreadCount
        }
      )
    )
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

// Why: reuse the per-card status derivation so the chip reads exactly what the
// hidden cards would show.
export function selectLineageHiddenActivity(
  state: Parameters<typeof selectWorktreeActivityStatuses>[0],
  worktreeIds: readonly string[]
): LineageHiddenActivity {
  return summarizeLineageHiddenActivity(selectWorktreeActivityStatuses(state, worktreeIds).values())
}

// Why shallow: plain counts keep unrelated store ticks from re-rendering the chip.
export function useLineageHiddenActivity(worktreeIds: readonly string[]): LineageHiddenActivity {
  const selectActivity = useCallback(
    (state: AppState) => selectLineageHiddenActivity(state, worktreeIds),
    [worktreeIds]
  )
  return useAppStore(useShallow(selectActivity))
}

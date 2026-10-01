import type { RuntimeClientEvent } from '../../shared/runtime-client-events'
import {
  isAutomaticTabActivation,
  type TabActivationIntent
} from '../../shared/tab-activation-intent'
import { runtimeWorktreeIdentityKey } from './runtime-worktree-path-identity'
import { WORKTREE_TERMINAL_SLEEP_BLOCKED_ERROR } from './worktree-terminal-mutation-lock'

export type WorktreeTerminalSleepState = {
  worktreeId: string
  generation: number
  phase: 'stopping' | 'partial' | 'sleeping'
  ptyIds: string[]
  terminalHandles: string[]
  terminalHandlesByPtyId: Record<string, string[]>
  paneKeysByPtyId: Record<string, string>
}

export type WorktreeTerminalSpawnSurface = { ptyId?: string; paneKey?: string }

export function captureTerminalSleepPanes(
  ptyIds: Iterable<string>,
  records: ReadonlyMap<string, { paneKey?: string | null }>
): Record<string, string> {
  const paneKeys: Record<string, string> = {}
  for (const ptyId of ptyIds) {
    const paneKey = records.get(ptyId)?.paneKey
    if (paneKey) {
      paneKeys[ptyId] = paneKey
    }
  }
  return paneKeys
}

export function blocksAutomaticTerminalSpawnForSleep(
  state: WorktreeTerminalSleepState | undefined,
  surface: WorktreeTerminalSpawnSurface
): boolean {
  if (!state) {
    return false
  }
  if (state.phase !== 'partial') {
    return true
  }
  return state.ptyIds.some(
    (ptyId) =>
      ptyId === surface.ptyId ||
      (surface.paneKey !== undefined && state.paneKeysByPtyId[ptyId] === surface.paneKey)
  )
}

export async function acquireWorktreeTerminalSpawnLease(args: {
  worktreeId?: string
  activationIntent?: TabActivationIntent
  surface: WorktreeTerminalSpawnSurface
  sleepStates: Map<string, WorktreeTerminalSleepState>
  acquire: (worktreeId: string) => Promise<() => void>
  emit: (event: RuntimeClientEvent) => void
}): Promise<() => void> {
  if (!args.worktreeId) {
    return () => {}
  }
  const release = await args.acquire(args.worktreeId)
  const key = runtimeWorktreeIdentityKey(args.worktreeId)
  const sleepState = args.sleepStates.get(key)
  // Recovery queued during teardown must judge its pane after Sleep settles.
  if (isAutomaticTabActivation(args.activationIntent)) {
    if (blocksAutomaticTerminalSpawnForSleep(sleepState, args.surface)) {
      release()
      throw new Error(WORKTREE_TERMINAL_SLEEP_BLOCKED_ERROR)
    }
    return release
  }
  if (sleepState?.phase === 'sleeping' || sleepState?.phase === 'partial') {
    args.sleepStates.delete(key)
    args.emit({
      type: 'worktreeTerminalSleepState',
      worktreeId: sleepState.worktreeId,
      generation: sleepState.generation,
      phase: 'woken',
      ptyIds: sleepState.ptyIds,
      terminalHandles: sleepState.terminalHandles
    })
  }
  return release
}

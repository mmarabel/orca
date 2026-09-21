import type { ExecutionHostId } from '../../../shared/execution-host'
import { useAppStore } from '@/store'
import {
  gateWorktreeAgentActivation,
  workspaceHasSleepingAgentSessions,
  type WorktreeAgentActivationOutcome
} from './worktree-agent-activation-gate'
import { reseedGatedEmptyWorkspace } from './worktree-initial-terminal-seeding'

type GatedEmptyWorkspaceReseedIntent = {
  callerProvidesSurface: boolean
  executionHostId?: ExecutionHostId
}

const latestReseedIntentByGate = new WeakMap<
  Promise<WorktreeAgentActivationOutcome>,
  GatedEmptyWorkspaceReseedIntent
>()

export function gateAndReseedEmptyWorkspace(
  workspaceKey: string,
  callerProvidesSurface: boolean,
  executionHostId?: ExecutionHostId
): void {
  const gate = gateWorktreeAgentActivation(workspaceKey)
  const intent: GatedEmptyWorkspaceReseedIntent = {
    callerProvidesSurface,
    ...(executionHostId ? { executionHostId } : {})
  }
  latestReseedIntentByGate.set(gate, intent)
  void gate.then((outcome) => {
    if (latestReseedIntentByGate.get(gate) !== intent) {
      return
    }
    latestReseedIntentByGate.delete(gate)
    if (outcome === 'empty') {
      reseedGatedEmptyWorkspace(
        workspaceKey,
        intent.callerProvidesSurface,
        intent.executionHostId,
        true
      )
    } else if (outcome === 'blocked-census-unavailable') {
      // Why only this blocked flavor: the PTY census itself could not answer, as distinct from
      // the renderer not yet knowing what surfaces exist (unrestored sessions, structured reads
      // that threw, inconsistent structured ownership). With no sleeping sessions known, the local
      // authority check still decides: `none` reseeds instead of stranding an explicitly opened
      // empty workspace, while `unverifiable`/`live` stay unseeded without the gate's positive
      // empty verdict (STA-4658, #15556).
      if (!workspaceHasSleepingAgentSessions(useAppStore.getState(), workspaceKey)) {
        reseedGatedEmptyWorkspace(
          workspaceKey,
          intent.callerProvidesSurface,
          intent.executionHostId
        )
      }
    }
  })
}

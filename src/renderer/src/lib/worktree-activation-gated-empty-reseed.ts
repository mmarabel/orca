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
    } else if (outcome === 'blocked') {
      // Why: `blocked` conflates a census that could not answer with restores that never became
      // ready and inconsistent structured ownership — in those cases the renderer does not yet know
      // what surfaces exist, so only fall back when no sleeping sessions are known. Otherwise the
      // reseed would add the stray shell the gate's deferral was avoiding. With no sleeping
      // sessions, the local authority check still decides: `none` reseeds, `unverifiable`/`live`
      // stay unseeded without the gate's positive empty verdict (STA-4658, #15556).
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

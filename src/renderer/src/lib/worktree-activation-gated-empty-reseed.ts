import type { ExecutionHostId } from '../../../shared/execution-host'
import {
  gateWorktreeAgentActivation,
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
      // Why: `blocked` means the PTY/structured census could not answer, not that the workspace
      // has a surface. Falling back to the local authority check still rescues `none` workspaces
      // (e.g. structured inventory threw for a non-runtime workspace) instead of stranding an
      // explicitly opened empty workspace. `unverifiable` stays unseeded here — without the gate's
      // empty verdict there is no positive evidence the host holds nothing (STA-4658).
      reseedGatedEmptyWorkspace(workspaceKey, intent.callerProvidesSurface, intent.executionHostId)
    }
  })
}

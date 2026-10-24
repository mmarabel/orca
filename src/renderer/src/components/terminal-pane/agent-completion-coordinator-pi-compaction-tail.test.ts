import { describe, expect, it, vi } from 'vitest'
import { createAgentCompletionCoordinator } from './agent-completion-coordinator'
import {
  HOOK_DONE_QUIET_MS,
  useAgentCompletionCoordinatorLifecycle
} from './agent-completion-coordinator-test-harness'

const STARTED_AT = 1_700_000_000_000
const REPLY_FINISHED_AT = 1_700_000_004_000

function piCoordinator() {
  const dispatchCompletion = vi.fn(() => true)
  const coordinator = createAgentCompletionCoordinator({
    paneKey: 'tab-1:leaf-1',
    getPtyId: () => 'pty-1',
    inspectProcess: vi.fn(),
    dispatchCompletion,
    isLive: () => true
  })
  coordinator.observeHookStatus({
    state: 'working',
    prompt: 'summarize crows',
    agentType: 'pi',
    stateStartedAt: STARTED_AT
  })
  return { coordinator, dispatchCompletion }
}

function stamped(state: 'working' | 'done', stateStartedAt: number) {
  return {
    state,
    prompt: 'summarize crows',
    agentType: 'pi',
    stateStartedAt,
    turnCompletedAt: REPLY_FINISHED_AT
  }
}

// Pi's idle compaction restates the settled reply's finish time on its start and end rows.
describe('Pi idle compaction after a settled reply', () => {
  useAgentCompletionCoordinatorLifecycle()

  it('announces the finish once, at the compaction start, when its quiet window has not run', async () => {
    const { coordinator, dispatchCompletion } = piCoordinator()
    coordinator.observeHookStatus(stamped('done', REPLY_FINISHED_AT))
    coordinator.observeHookStatus(stamped('working', REPLY_FINISHED_AT + 3_000))
    expect(dispatchCompletion).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HOOK_DONE_QUIET_MS * 4)
    coordinator.observeHookStatus(stamped('done', REPLY_FINISHED_AT + 300_000))
    await vi.advanceTimersByTimeAsync(HOOK_DONE_QUIET_MS * 4)
    expect(dispatchCompletion).toHaveBeenCalledTimes(1)
  })

  it('does not announce the finish again when the compaction starts after it rang', async () => {
    const { coordinator, dispatchCompletion } = piCoordinator()
    coordinator.observeHookStatus(stamped('done', REPLY_FINISHED_AT))
    await vi.advanceTimersByTimeAsync(HOOK_DONE_QUIET_MS * 2)
    expect(dispatchCompletion).toHaveBeenCalledTimes(1)
    coordinator.observeHookStatus(stamped('working', REPLY_FINISHED_AT + 3_000))
    coordinator.observeHookStatus(stamped('done', REPLY_FINISHED_AT + 300_000))
    await vi.advanceTimersByTimeAsync(HOOK_DONE_QUIET_MS * 4)
    expect(dispatchCompletion).toHaveBeenCalledTimes(1)
  })
})

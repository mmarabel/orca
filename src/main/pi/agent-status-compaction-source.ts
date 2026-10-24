import type { PiAgentKind } from '../../shared/pi-agent-kind'

/** A compaction right after a finished reply is that turn's tail, so its posts carry the reply's
 *  finish time: the host can announce the finish while the compaction still runs. The run's own
 *  agent_start and agent_end handlers keep that time current, so those events gain no handler. */
export function getPiAgentStatusCompactionHandlerSourceLines(kind: PiAgentKind): string[] {
  if (kind !== 'pi') {
    return []
  }

  return [
    '  let replyFinishedAt: number | undefined',
    '  let compactionTurnCompletedAt: number | undefined',
    '',
    '  function completedReplyFields(): Record<string, unknown> {',
    '    return replyFinishedAt === undefined ? {} : { turn_completed_at: replyFinishedAt }',
    '  }',
    '',
    '  // Why: a run cut off mid-tool, failed or aborted has no finished reply to announce.',
    '  function recordReplyFinish(event): void {',
    '    let reply: { stopReason?: unknown } | undefined',
    '    for (const message of Array.isArray(event?.messages) ? event.messages : []) {',
    "      if (message?.role === 'assistant') reply = message",
    '    }',
    "    const finished = reply?.stopReason === 'stop' || reply?.stopReason === 'length'",
    '    replyFinishedAt = finished && !isOmpRuntime() ? Date.now() : undefined',
    '  }',
    '',
    '  // Why: Pi compacts for an idle prompt before its run starts; that compaction is the next turn.',
    "  onStatus('input', () => {",
    '    if (!piTurnInFlight) replyFinishedAt = undefined',
    '  })',
    '',
    "  onStatus('session_before_compact', (event) => {",
    '    // Why: overflow recovery retries the turn, and live children hold the finish until they end.',
    '    if (replyFinishedAt === undefined || isHeldByChildren()) return',
    "    if (event?.willRetry === true || event?.reason === 'overflow') return",
    '    // Why: outside a run, Pi checks the threshold as the next run starts, including runs with no input.',
    "    if (event?.reason === 'threshold' && !piTurnInFlight) return",
    '    compactionTurnCompletedAt = replyFinishedAt',
    "    post('compaction_start', { turn_completed_at: compactionTurnCompletedAt })",
    '  })',
    '',
    '  // Why: Pi reports a cancelled compaction as a failed one; either way the tail is over.',
    "  for (const name of ['session_compact', 'session_compact_failed']) {",
    '    onStatus(name, () => {',
    '      if (compactionTurnCompletedAt === undefined) return',
    "      post('compaction_end', {",
    '        turn_completed_at: compactionTurnCompletedAt,',
    '        is_idle: !piTurnInFlight && !isHeldByChildren(),',
    '      })',
    '      compactionTurnCompletedAt = undefined',
    '    })',
    '  }',
    ''
  ]
}

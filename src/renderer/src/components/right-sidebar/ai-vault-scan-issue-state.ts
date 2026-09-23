import type {
  AiVaultListResult,
  AiVaultScanIssue,
  AiVaultSession
} from '../../../../shared/ai-vault-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'

function sessionFileKey(executionHostId: string | undefined, path: string): string {
  return JSON.stringify([
    executionHostId ?? LOCAL_EXECUTION_HOST_ID,
    normalizeRuntimePathForComparison(path)
  ])
}

export function aiVaultSessionFileKey(session: AiVaultSession): string {
  return sessionFileKey(session.executionHostId, session.filePath)
}

/** Notices about one listed session's transcript (e.g. a skipped oversized record), keyed by that session's file. */
export function aiVaultSessionReadNotices(
  result: AiVaultListResult | null
): ReadonlyMap<string, string> {
  const notices = new Map<string, string>()
  if (!result) {
    return notices
  }
  const sessionKeys = new Set(result.sessions.map(aiVaultSessionFileKey))
  for (const issue of result.issues) {
    const key = sessionFileKey(issue.executionHostId, issue.path)
    if (issue.kind === 'notice' && sessionKeys.has(key)) {
      notices.set(key, notices.has(key) ? `${notices.get(key)} ${issue.message}` : issue.message)
    }
  }
  return notices
}

export function blockingAiVaultScanIssue(
  result: AiVaultListResult | null
): AiVaultScanIssue | null {
  if (!result || result.sessions.length > 0) {
    return null
  }
  return result.issues.find((issue) => issue.kind === 'host') ?? null
}

// Host and scope issues carry their own scanner-authored copy, so they get their
// own rows instead of being counted as skipped transcripts — a partial scan
// (one SSH host down, rest fine) must not report a connectivity failure as a
// skipped transcript file, and an unreadable *source* (a whole locked
// opencode.db holding every OpenCode session) must not read as "1 transcript
// skipped".
export function aiVaultScanNoticeIssues(result: AiVaultListResult | null): AiVaultScanIssue[] {
  if (!result) {
    return []
  }
  const blocking = blockingAiVaultScanIssue(result)
  // Why: a notice about one session's transcript belongs on that session, not in a
  // panel-wide banner that every rescan re-emits for sessions outside the view.
  const sessionNotices = aiVaultSessionReadNotices(result)
  return result.issues.filter(
    (issue) =>
      Boolean(issue.kind) &&
      issue !== blocking &&
      !(
        issue.kind === 'notice' &&
        sessionNotices.has(sessionFileKey(issue.executionHostId, issue.path))
      )
  )
}

export function skippedAiVaultTranscriptCount(result: AiVaultListResult | null): number {
  return result ? result.issues.filter((issue) => !issue.kind).length : 0
}

const SKIPPED_TRANSCRIPT_REASON_LIMIT = 3

// Why: a bare "3 transcripts skipped" hides the actionable part (a 10 MiB cap
// hit, an unreadable transcript). Surface the distinct scanner-authored reasons,
// capped so a 500-issue scan can't turn the panel into a wall of text.
export function skippedAiVaultTranscriptReasons(result: AiVaultListResult | null): string[] {
  const reasons = new Set<string>()
  for (const issue of result?.issues ?? []) {
    if (issue.kind) {
      continue
    }
    const message = issue.message.trim()
    if (message) {
      reasons.add(message)
    }
    if (reasons.size === SKIPPED_TRANSCRIPT_REASON_LIMIT) {
      break
    }
  }
  return [...reasons]
}

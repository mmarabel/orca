import { createContext, useContext, type ReactNode } from 'react'
import { FileWarning } from 'lucide-react'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import {
  aiVaultSessionFileKey,
  NO_AI_VAULT_SESSION_READ_NOTICES,
  type AiVaultSessionReadNotices
} from './ai-vault-scan-issue-state'

const SessionReadNoticeContext = createContext<AiVaultSessionReadNotices>(
  NO_AI_VAULT_SESSION_READ_NOTICES
)

export function AiVaultSessionReadNoticeProvider({
  notices,
  children
}: {
  /**
   * Built from the browse scan in the panel. Search results come from a
   * different query, so a hit the last browse scan never saw carries no notice.
   */
  notices: AiVaultSessionReadNotices
  children: ReactNode
}): React.JSX.Element {
  return (
    <SessionReadNoticeContext.Provider value={notices}>
      {children}
    </SessionReadNoticeContext.Provider>
  )
}

function useSessionReadNotice(session: AiVaultSession): readonly string[] {
  return useContext(SessionReadNoticeContext).get(aiVaultSessionFileKey(session)) ?? []
}

function partiallyReadLabel(): string {
  return translate('sessionSearch.panel.partiallyRead', 'Partially read')
}

/**
 * Collapsed-row marker for a session whose transcript was only partly read.
 * Without it the warning would only exist behind an expand the user has no
 * reason to perform.
 */
export function SessionReadNoticeIndicator({
  session
}: {
  session: AiVaultSession
}): React.JSX.Element | null {
  const messages = useSessionReadNotice(session)
  if (messages.length === 0) {
    return null
  }
  return (
    <>
      <span className="shrink-0 text-muted-foreground/55">·</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="ai-vault-session-read-notice-indicator"
            className="flex shrink-0 items-center gap-1"
            aria-label={partiallyReadLabel()}
          >
            <FileWarning className="size-3 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        {/* Scanner-authored (sizes, byte offsets), so it renders raw. */}
        <TooltipContent className="max-w-64">{messages.join(' ')}</TooltipContent>
      </Tooltip>
    </>
  )
}

/** The same note spelled out in the expanded row, where there is room for it. */
export function SessionReadNotice({
  session
}: {
  session: AiVaultSession
}): React.JSX.Element | null {
  const messages = useSessionReadNotice(session)
  if (messages.length === 0) {
    return null
  }
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <FileWarning className="size-3 text-muted-foreground/80" />
        <span>{partiallyReadLabel()}</span>
      </div>
      {messages.map((message) => (
        <p key={message} className="text-[11px] leading-4 text-muted-foreground">
          {message}
        </p>
      ))}
    </section>
  )
}

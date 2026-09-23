import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { FileWarning } from 'lucide-react'
import type { AiVaultListResult, AiVaultSession } from '../../../../shared/ai-vault-types'
import { translate } from '@/i18n/i18n'
import { aiVaultSessionFileKey, aiVaultSessionReadNotices } from './ai-vault-scan-issue-state'

const SessionReadNoticeContext = createContext<ReadonlyMap<string, string>>(new Map())

export function AiVaultSessionReadNoticeProvider({
  scanResult,
  children
}: {
  scanResult: AiVaultListResult | null
  children: ReactNode
}): React.JSX.Element {
  const notices = useMemo(() => aiVaultSessionReadNotices(scanResult), [scanResult])
  return (
    <SessionReadNoticeContext.Provider value={notices}>
      {children}
    </SessionReadNoticeContext.Provider>
  )
}

/** A scanner note about this session's own transcript, shown in its details rather than panel-wide. */
export function SessionReadNotice({
  session
}: {
  session: AiVaultSession
}): React.JSX.Element | null {
  const message = useContext(SessionReadNoticeContext).get(aiVaultSessionFileKey(session))
  if (!message) {
    return null
  }
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <FileWarning className="size-3 text-muted-foreground/80" />
        <span>{translate('sessionSearch.panel.partiallyRead', 'Partially read')}</span>
      </div>
      {/* Scanner-authored (sizes, byte offsets), so it renders raw like the scan banners. */}
      <p className="text-[11px] leading-4 text-muted-foreground">{message}</p>
    </section>
  )
}

import { useState } from 'react'
import { ChevronDown, LockKeyholeOpen, ShieldOff, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../../src/renderer/src/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../../src/renderer/src/components/ui/dropdown-menu'
import { NativeChatPermissionModePicker } from '../../../src/renderer/src/components/native-chat/NativeChatPermissionModePicker'
import {
  nativeChatPermissionModeDescription,
  nativeChatPermissionModeLabel
} from '../../../src/renderer/src/components/native-chat/native-chat-permission-mode-labels'
import {
  isAgentChatPermissionMode,
  type AgentChatPermissionMode
} from '../../../src/shared/agent-chat-permission-mode'
import { cn } from '../../../src/renderer/src/lib/utils'

const modes: readonly AgentChatPermissionMode[] = ['ask', 'accept-edits', 'auto', 'full-access']
const preview = new URLSearchParams(location.search).get('permissionPreview') ?? 'current'
export const isFooterPreview = preview.startsWith('footer-')
const FooterIcon =
  preview === 'footer-lock'
    ? LockKeyholeOpen
    : preview === 'footer-shield'
      ? ShieldOff
      : SlidersHorizontal

function modeLabel(mode: AgentChatPermissionMode): string {
  return preview === 'dot' && mode === 'full-access'
    ? 'No approvals'
    : nativeChatPermissionModeLabel(mode)
}

function ModeRow({ mode }: { mode: AgentChatPermissionMode }) {
  return (
    <div className="min-w-0 py-1">
      <div
        className={cn(
          'flex items-center gap-1.5 text-sm',
          mode === 'full-access' && 'text-status-warning'
        )}
      >
        {modeLabel(mode)}
      </div>
      <div className="text-xs font-normal text-muted-foreground">
        {nativeChatPermissionModeDescription(mode, 'claude')}
      </div>
    </div>
  )
}

/** Build-time fixture substitution only; this state never reaches an agent or host. */
export function NativeChatComposerPermissionPicker() {
  return isFooterPreview ? null : <PermissionPreviewControl />
}

export function PermissionPreviewControl() {
  const [current, setCurrent] = useState<AgentChatPermissionMode>('full-access')
  const disabled = new URLSearchParams(location.search).get('permissionDisabled') === '1'
  if (preview === 'current') {
    return (
      <NativeChatPermissionModePicker
        current={current}
        modes={modes}
        agent="claude"
        disabled={disabled}
        onSelect={setCurrent}
      />
    )
  }
  const fullAccess = current === 'full-access'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${isFooterPreview ? 'Permissions for this chat:' : 'Permissions'} ${modeLabel(current)}`}
          className={cn(
            'pointer-coarse:h-11',
            isFooterPreview ? 'shrink-0' : 'max-w-44 min-w-0 shrink'
          )}
        >
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 font-normal',
              fullAccess &&
                preview !== 'dot' &&
                (isFooterPreview ? 'text-chat-warning' : 'text-status-warning')
            )}
          >
            {preview === 'dot' && fullAccess ? (
              <span className="size-1.5 shrink-0 rounded-full bg-status-warning" aria-hidden />
            ) : null}
            {isFooterPreview && (fullAccess || preview === 'footer-sliders') ? (
              <FooterIcon className="size-3.5 shrink-0" aria-hidden />
            ) : null}
            {preview === 'shield' && fullAccess ? (
              <ShieldOff className="size-3.5 shrink-0" aria-hidden />
            ) : null}
            <span className={cn(!isFooterPreview && 'truncate')}>{modeLabel(current)}</span>
          </span>
          <ChevronDown className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isFooterPreview ? 'end' : 'start'}
        side="top"
        collisionPadding={8}
        className="w-80 max-w-[calc(100vw-1rem)]"
      >
        <DropdownMenuLabel>
          {isFooterPreview ? 'Permissions for this chat' : 'Permissions'}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label="Permissions"
          value={current}
          onValueChange={(mode) => {
            if (isAgentChatPermissionMode(mode)) {
              setCurrent(mode)
            }
          }}
        >
          {modes
            .filter((mode) => mode !== 'full-access')
            .map((mode) => (
              <DropdownMenuRadioItem key={mode} value={mode} disabled={disabled}>
                <ModeRow mode={mode} />
              </DropdownMenuRadioItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="full-access" disabled={disabled}>
            <ModeRow mode="full-access" />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { Folder, GitBranch, Server } from 'lucide-react'
import { isFooterPreview, PermissionPreviewControl } from './permission-previews.tsx'

const context = new URLSearchParams(location.search).get('permissionContext') ?? 'remote'
const folder = context === 'folder'
const long = context === 'long'
const host = context === 'local' || folder ? 'This computer' : 'Demo Server'
const workspace = long
  ? 'permission-footer-responsive-preview · Worktree'
  : folder
    ? 'notes · Folder'
    : 'composer · Worktree'
const branch = long
  ? 'demo/keep-host-and-chat-permissions-visible-in-narrow-panes'
  : 'demo/composer'

/** Models the newer app's workspace footer; this checkout has no live footer slot. */
export function PermissionContextRow() {
  return (
    // Flex-wrap preserves host and mode; metadata may use multiple lines before the right-aligned picker.
    <div
      data-permission-context-row
      className="mt-1 flex min-h-5.5 min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
    >
      <div className="flex min-w-0 flex-1 basis-72 flex-wrap items-center gap-x-3 gap-y-1 px-3 text-2xs text-chat-foreground-faint">
        <div data-context-host className="flex shrink-0 items-center gap-1">
          <Server className="size-3 shrink-0" aria-hidden />
          <span>{host}</span>
        </div>
        <div data-context-workspace className="flex min-w-0 max-w-full items-center gap-1">
          <Folder className="size-3 shrink-0" aria-hidden />
          <span className="[overflow-wrap:anywhere]">{workspace}</span>
        </div>
        {!folder ? (
          <div data-context-branch className="flex min-w-0 max-w-full items-center gap-1 font-mono">
            <GitBranch className="size-3 shrink-0" aria-hidden />
            <span className="[overflow-wrap:anywhere]">{branch}</span>
          </div>
        ) : null}
      </div>
      {isFooterPreview ? (
        <div className="ml-auto shrink-0">
          <PermissionPreviewControl />
        </div>
      ) : null}
    </div>
  )
}

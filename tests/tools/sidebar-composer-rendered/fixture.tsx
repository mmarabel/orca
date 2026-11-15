import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChevronDown, Folder, PanelLeft, Server } from 'lucide-react'
import { TooltipProvider } from '../../../src/renderer/src/components/ui/tooltip'
import { Button } from '../../../src/renderer/src/components/ui/button'
import WorktreeCard from '../../../src/renderer/src/components/sidebar/WorktreeCard'
import { NativeChatComposerField } from '../../../src/renderer/src/components/native-chat/NativeChatComposerField'
import { NativeChatApprovalCard } from '../../../src/renderer/src/components/native-chat/NativeChatApprovalCard'
import type { NativeChatComposerInput } from '../../../src/renderer/src/components/native-chat/native-chat-composer-input'
import type { NativeChatComposerNotice } from '../../../src/renderer/src/components/native-chat/native-chat-composer-notice'
import { useImeEnterGestureOwnership } from '../../../src/renderer/src/lib/ime-composition-keyboard-event'
import { cn } from '../../../src/renderer/src/lib/utils'
import { options, repo, surface, workspaces } from './fixture-state'
import './fixture.css'

const noop = () => {}
const scenario = new URLSearchParams(location.search).get('state') ?? 'idle'
const remoteNotice: NativeChatComposerNotice = {
  key: 'host',
  kind: 'host',
  tone: 'warning',
  text: 'Demo Server is disconnected. Reconnect before sending.'
}

function Fixture() {
  const [active, setActive] = useState(0)
  const [draft, setDraft] = useState('Keep the task title clear and the next action easy to find.')
  const [notices, setNotices] = useState<NativeChatComposerNotice[]>(
    scenario === 'error'
      ? [
          remoteNotice,
          {
            key: 'error',
            kind: 'error',
            text: 'Your message was not sent. The server is disconnected.',
            errorText: 'Connection lost while sending. Your draft is still here.',
            action: { label: 'Retry', onClick: () => setNotices([]) }
          }
        ]
      : []
  )
  const [dictating, setDictating] = useState(scenario === 'dictating')
  const finishDictation = () => {
    if (!dictating) {
      return
    }
    setDictating(false)
    setDraft((current) => `${current} Sample dictated text.`)
  }
  const [working, setWorking] = useState(scenario === 'working')
  const [approval, setApproval] = useState(scenario === 'approval')
  const textareaRef = useRef<NativeChatComposerInput | null>(null)
  const imeEnterGesture = useImeEnterGestureOwnership()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    // Frame: 280px sidebar; chat fills with its existing 46rem cap. Below 768px, navigation opens on demand.
    <main className="isolate flex h-dvh min-w-0 bg-background text-foreground antialiased">
      <aside
        className={cn(
          'w-70 shrink-0 flex-col border-r border-worktree-sidebar-border bg-worktree-sidebar text-worktree-sidebar-foreground',
          sidebarOpen ? 'flex' : 'hidden md:flex'
        )}
      >
        <header className="flex h-12 items-center gap-2 border-b border-worktree-sidebar-border px-4 text-sm font-medium">
          <Folder className="size-4 shrink-0" /> Demo project{' '}
          <ChevronDown className="ml-auto size-3.5" />
        </header>
        <div className="flex flex-col gap-1 px-2 py-4">
          <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">Workspaces</p>
          {workspaces.map((worktree, index) => (
            <WorktreeCard
              key={worktree.id}
              worktree={worktree}
              repo={repo}
              isActive={index === active}
              hideRepoBadge
              hostContextLabel={index === 1 ? 'Demo Server' : undefined}
              onActivate={() => setActive(index)}
              nativeDragEnabled={false}
            />
          ))}
        </div>
        <p className="mt-auto p-4 text-xs text-muted-foreground">
          Component prototype · sample data
        </p>
      </aside>
      <section
        className="native-chat-appearance flex min-w-0 flex-1 flex-col bg-chat-canvas"
        data-native-chat-scheme="dark"
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle workspace navigation"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden"
          >
            <PanelLeft />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {workspaces[active].displayName}
          </h1>
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Server className="size-3.5" /> Demo Server
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-3 sm:px-4">
          <div className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-6 py-8 text-sm text-chat-foreground">
            <div className="ml-auto max-w-xl rounded-xl border border-chat-composer-border bg-chat-composer-surface px-4 py-3">
              Make the sidebar easier to scan. Keep remote hosts and anything that needs my
              attention visible.
            </div>
            <div className="space-y-3">
              <p className="text-xs font-medium text-chat-foreground-faint">
                Assistant · sample conversation
              </p>
              <p>
                The task name should lead each row. Branch names and supporting details can stay
                quieter, without hiding warnings.
              </p>
              <p>
                Keep the familiar composer. Make the model name and its logo clear, with the
                reasoning level quieter beside them.
              </p>
            </div>
            {working ? (
              <p className="text-chat-foreground-faint" role="status">
                Working · checking the sidebar layout…
              </p>
            ) : null}
          </div>
        </div>
        {approval ? (
          <NativeChatApprovalCard
            approval={{
              title: 'Allow the test command?',
              description: 'The agent wants to run the focused sidebar checks on Demo Server.',
              detail: 'pnpm test sidebar',
              options: [
                { label: 'Allow once', send: 'allow' },
                { label: 'Deny', send: 'deny' }
              ]
            }}
            onChoose={() => setApproval(false)}
            onCollapse={() => setApproval(false)}
          />
        ) : (
          <NativeChatComposerField
            draftScopeKey="prototype-draft"
            textareaRef={textareaRef}
            draft={draft}
            disabled={false}
            hasPty
            canSend
            autocomplete={{ mode: 'none' }}
            mentionFiles={{ files: [], loading: false, failed: false }}
            activeSuggestion={0}
            notices={notices}
            imageAttachments={[]}
            sendButtonDisabled={notices.length > 0 || scenario === 'disabled'}
            isWorking={working}
            attachDisabled={scenario === 'disabled'}
            dictationDisabled={scenario === 'disabled'}
            isDictating={dictating}
            isDictationHoldMode={scenario === 'hold'}
            imeEnterGesture={imeEnterGesture}
            onDraftChange={setDraft}
            onTextareaSelect={noop}
            onKeyDown={noop}
            onImeSettled={noop}
            onPaste={noop}
            pickerListboxId="prototype-picker"
            onChoosePickerItem={noop}
            onRetrySkills={noop}
            onChooseMentionFile={noop}
            onRemoveImageAttachment={noop}
            onAttach={() => setDraft((current) => `${current} @sample-notes.txt`)}
            onDictationToggle={() => (dictating ? finishDictation() : setDictating(true))}
            onDictationHoldStart={() => setDictating(true)}
            onDictationHoldEnd={finishDictation}
            onSend={() => setWorking(true)}
            onStop={() => setWorking(false)}
            sessionOptionsSurface={surface}
            sessionOptionsSnapshot={options}
            agent="claude"
          />
        )}
      </section>
    </main>
  )
}
const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing fixture root')
}
createRoot(root).render(
  <TooltipProvider>
    <Fixture />
  </TooltipProvider>
)

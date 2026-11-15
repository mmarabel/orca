import { buildDefaultSettings } from '../../../src/shared/default-global-settings'
import { getDefaultNotificationSettings } from '../../../src/shared/notification-settings-defaults'
import type { Repo } from '../../../src/shared/repo-types'
import type { Worktree } from '../../../src/shared/worktree/types'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../src/shared/native-chat-session-options'
import { useAppStore } from '../../../src/renderer/src/store'
import { makePaneKey } from '../../../src/shared/stable-pane-id'
import type { AgentStatusState } from '../../../src/shared/agent-status-types'

export const repo: Repo = {
  id: 'demo-project',
  path: '/demo/project',
  displayName: 'Demo project',
  badgeColor: 'var(--muted-foreground)',
  addedAt: 1
}
export const workspaces: Worktree[] = [
  ['Polish the workspace sidebar', 'design/sidebar'],
  ['Fix reconnect after sleep', 'fix/reconnect'],
  ['Review the permission prompts', 'design/approvals'],
  ['Document the release workflow', 'docs/release']
].map(([displayName, branch], index) => ({
  id: `demo-${index}`,
  repoId: repo.id,
  path: `/demo/project/${index}`,
  displayName,
  branch,
  head: 'demo',
  isBare: false,
  isMainWorktree: false,
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: index === 2,
  isPinned: false,
  sortOrder: index,
  lastActivityAt: 1
}))
const settings = buildDefaultSettings({
  workspaceDir: '/demo',
  appFontFamily: 'Geist',
  editorAutoSaveDelayMs: 1000,
  primarySelectionMiddleClickPaste: false,
  primarySelectionDefaultedForLinux: false,
  terminalFontFamily: 'monospace',
  terminalInactivePaneOpacity: 1,
  terminalRightClickToPaste: false,
  notifications: getDefaultNotificationSettings(),
  voice: {
    enabled: false,
    sttModel: '',
    modelsDir: '',
    language: 'en',
    dictationMode: 'toggle',
    terminalConfirmBeforeInsert: true,
    userModels: [],
    openAiApiKeyConfigured: false,
    microphoneDeviceId: null,
    microphoneDeviceLabel: null
  }
})
useAppStore.setState({
  repos: [repo],
  worktreesByRepo: { [repo.id]: workspaces },
  settings: { ...settings, theme: 'dark', experimentalNewWorktreeCardStyle: true },
  worktreeCardProperties: ['status', 'branch', 'host'],
  tabsByWorktree: Object.fromEntries(
    workspaces.slice(0, 3).map((workspace) => [
      workspace.id,
      [
        {
          id: `${workspace.id}-tab`,
          ptyId: `${workspace.id}-pty`,
          worktreeId: workspace.id,
          title: 'Demo agent',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    ])
  ),
  ptyIdsByTabId: Object.fromEntries(
    workspaces.slice(0, 3).map((workspace) => [`${workspace.id}-tab`, [`${workspace.id}-pty`]])
  ),
  agentStatusByPaneKey: Object.fromEntries(
    workspaces.slice(0, 3).map((workspace, index) => {
      const tabId = `${workspace.id}-tab`
      const paneKey = makePaneKey(tabId, '11111111-1111-4111-8111-111111111111')
      const states: AgentStatusState[] = ['working', 'done', 'waiting']
      return [
        paneKey,
        {
          paneKey,
          tabId,
          worktreeId: workspace.id,
          state: states[index],
          agentType: 'claude',
          prompt: workspace.displayName,
          updatedAt: Date.now(),
          stateStartedAt: Date.now(),
          stateHistory: []
        }
      ]
    })
  ),
  setWorkspaceUnreadByUser: async () => {},
  updateWorktreeMeta: async () => ({ ok: true }),
  setActiveWorktree: () => true,
  fetchHostedReviewForBranch: async () => null,
  fetchIssue: async () => null,
  fetchLinearIssue: async () => null
})

const modelKind = new URLSearchParams(location.search).get('model')
const currentModel =
  modelKind === 'openai'
    ? 'openai-codex/gpt-6.1-terra'
    : modelKind === 'unknown'
      ? 'local/custom-model'
      : 'cliproxy/claude-opus-5-5'

export const options: SessionOptionDescriptor[] = [
  {
    id: 'permissionMode',
    label: 'Permissions',
    category: 'mode',
    kind: {
      type: 'select',
      currentValue: 'full-access',
      choices: [
        { value: 'ask', label: 'Ask before changes' },
        { value: 'full-access', label: 'Full access' }
      ]
    },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  },
  {
    id: 'model',
    label: 'Model',
    category: 'model',
    kind: {
      type: 'select',
      currentValue: currentModel,
      choices: [
        { value: 'cliproxy/claude-opus-5-5', label: 'Opus 5.5' },
        { value: 'openai-codex/gpt-6.1-terra', label: 'GPT-6.1 Terra' },
        { value: 'local/custom-model', label: 'Custom model' }
      ]
    },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  },
  {
    id: 'effort',
    label: 'Effort',
    category: 'thought_level',
    kind: {
      type: 'select',
      currentValue: modelKind === 'openai' ? 'medium' : 'high',
      choices: [
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' }
      ]
    },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  }
]
export const surface: SessionOptionsSurface = {
  getSnapshot: () => options,
  setOption: async () => ({ snapshot: options }),
  invokeAction: async () => ({ snapshot: options }),
  subscribe: () => () => {}
}

import { describe, expect, it } from 'vitest'
import { createGlobalSettingsFixture } from '../../../shared/global-settings-test-fixture'
import { getDefaultNotificationSettings } from '../../../shared/notification-settings-defaults'
import type { WorktreeLineage } from '../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../shared/worktree/types'
import { worktree as baseWorktree } from '@/components/sidebar/worktree-list-groups-test-fixtures'
import {
  shouldShowWorktreeUnread,
  type ChildWorktreeUnreadState
} from './child-worktree-unread-policy'
import { createUnreadBadgeCountSelector } from './unread-badge-count-selector'

function makeWorktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return { ...baseWorktree, id, instanceId: id, hostId: 'local', isUnread: true, ...overrides }
}

function makeLineage(child: string, parent: string): WorktreeLineage {
  return {
    worktreeId: child,
    worktreeInstanceId: child,
    parentWorktreeId: parent,
    parentWorktreeInstanceId: parent,
    origin: 'cli',
    capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
    createdAt: 1
  }
}

function makeState(showChildWorktreeUnread = false) {
  return {
    settings: createGlobalSettingsFixture({
      notifications: { ...getDefaultNotificationSettings(), showChildWorktreeUnread }
    }),
    worktreesByRepo: {
      repo: [makeWorktree('parent'), makeWorktree('child'), makeWorktree('grandchild')]
    },
    worktreeLineageById: {
      child: makeLineage('child', 'parent'),
      grandchild: makeLineage('grandchild', 'child')
    },
    workspaceLineageByChildKey: {},
    folderWorkspaces: [],
    tabsByWorktree: { child: [{ id: 'child-tab' }], grandchild: [{ id: 'grandchild-tab' }] },
    unreadTerminalTabs: { 'child-tab': true, 'grandchild-tab': true } as const
  }
}

describe('child worktree unread presentation', () => {
  it('hides children and grandchildren from cards and both Dock unread sources', () => {
    const state = makeState()
    expect(
      state.worktreesByRepo.repo.map((worktree) => shouldShowWorktreeUnread(state, worktree))
    ).toEqual([true, false, false])
    expect(createUnreadBadgeCountSelector()(state)).toBe(1)
    expect(state.worktreesByRepo.repo.every((worktree) => worktree.isUnread)).toBe(true)
    expect(Object.keys(state.unreadTerminalTabs)).toHaveLength(2)
  })

  it('restores indicators immediately without changing the unread state', () => {
    const state = makeState()
    const select = createUnreadBadgeCountSelector()
    expect(select(state)).toBe(1)
    const restored = { ...state, settings: makeState(true).settings }
    expect(select(restored)).toBe(3)
    expect(shouldShowWorktreeUnread(restored, restored.worktreesByRepo.repo[1])).toBe(true)
    expect(select(state)).toBe(1)
  })

  it('keeps legacy settings and unknown lineage visible', () => {
    const state = makeState()
    const legacy = { ...state, settings: createGlobalSettingsFixture() }
    expect(createUnreadBadgeCountSelector()(legacy)).toBe(3)
    const unresolved = { ...state, worktreeLineageById: {} }
    expect(createUnreadBadgeCountSelector()(unresolved)).toBe(3)
  })

  it('counts terminal-only child unread only when the setting is on', () => {
    const state = makeState()
    state.worktreesByRepo.repo = state.worktreesByRepo.repo.map((worktree) => ({
      ...worktree,
      isUnread: false
    }))
    const select = createUnreadBadgeCountSelector()
    expect(select(state)).toBe(0)
    expect(select({ ...state, settings: makeState(true).settings })).toBe(2)
  })

  it('invalidates the Dock selector when lineage changes without unread changing', () => {
    const state = makeState()
    const select = createUnreadBadgeCountSelector()
    expect(select(state)).toBe(1)
    expect(select({ ...state, worktreeLineageById: {} })).toBe(3)
    expect(select(state)).toBe(1)
  })

  it('fails open for stale parent instances, missing parents and cycles', () => {
    const state = makeState()
    const stale = {
      ...state,
      worktreeLineageById: {
        child: { ...makeLineage('child', 'parent'), parentWorktreeInstanceId: 'old-parent' }
      }
    }
    expect(createUnreadBadgeCountSelector()(stale)).toBe(3)
    const missing = { ...state, worktreesByRepo: { repo: [makeWorktree('child')] } }
    expect(shouldShowWorktreeUnread(missing, missing.worktreesByRepo.repo[0])).toBe(true)
    const cyclic = {
      ...state,
      worktreeLineageById: {
        parent: makeLineage('parent', 'child'),
        child: makeLineage('child', 'parent')
      }
    }
    expect(createUnreadBadgeCountSelector()(cyclic)).toBe(3)
  })

  it('does not suppress an unrelated same-id row on another execution host', () => {
    const state = makeState()
    const remoteChild = makeWorktree('child', { hostId: 'ssh:remote', instanceId: 'remote-child' })
    state.worktreesByRepo.repo = [...state.worktreesByRepo.repo, remoteChild]
    expect(shouldShowWorktreeUnread(state, remoteChild)).toBe(true)
    expect(createUnreadBadgeCountSelector()(state)).toBe(2)
  })

  it.each(['ssh:remote', 'runtime:remote'] as const)(
    'suppresses valid children owned by %s',
    (hostId) => {
      const state = makeState()
      state.worktreesByRepo.repo = state.worktreesByRepo.repo.map((worktree) => ({
        ...worktree,
        hostId
      }))
      expect(createUnreadBadgeCountSelector()(state)).toBe(1)
    }
  )

  it('handles children of folder workspaces without assuming a git parent', () => {
    const state: ChildWorktreeUnreadState = {
      ...makeState(),
      worktreeLineageById: {},
      folderWorkspaces: [
        {
          id: 'folder',
          projectGroupId: 'group',
          name: 'Folder',
          folderPath: '/folder',
          linkedTask: null,
          comment: '',
          isArchived: false,
          isUnread: false,
          isPinned: false,
          sortOrder: 0,
          lastActivityAt: 0,
          createdAt: 0,
          updatedAt: 0
        }
      ],
      workspaceLineageByChildKey: {
        'worktree:child': {
          childWorkspaceKey: 'worktree:child',
          childInstanceId: 'child',
          parentWorkspaceKey: 'folder:folder',
          origin: 'cli',
          capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
          createdAt: 1
        }
      }
    }
    const child = state.worktreesByRepo.repo[1]
    expect(shouldShowWorktreeUnread(state, child)).toBe(false)
    expect(shouldShowWorktreeUnread({ ...state, folderWorkspaces: [] }, child)).toBe(true)
    expect(
      shouldShowWorktreeUnread(
        { ...state, worktreesByRepo: { repo: [{ ...child, instanceId: 'new-child' }] } },
        { ...child, instanceId: 'new-child' }
      )
    ).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type { PtyProviderBufferSnapshot } from '../providers/types'
import type { PtyProcessInfo } from '../providers/pty-process-info'

// #22809: a headless `orca serve` restart adopts the daemon sessions that survived it from the
// controller inventory. No spawn runs, so no restore payload is seeded, and an idle agent read as
// title null / no identity / status null until it happened to report again.

const WORKTREE_ID = 'repo-1::/tmp/adopted-title-worktree'
const PTY_ID = `${WORKTREE_ID}@@session-adopted`
const INCARNATION = '40000000-0000-4000-8000-000000000001'
const REPLACEMENT = '40000000-0000-4000-8000-000000000002'
const CLAUDE_IDLE_TITLE = '✳ Claude Code'
const GEMINI_PERMISSION_TITLE = '✋ Gemini CLI'

function processRow(overrides: Partial<PtyProcessInfo> = {}): PtyProcessInfo {
  // The daemon inventory cannot carry a title; it reports a fixed placeholder.
  return {
    id: PTY_ID,
    cwd: '/tmp/adopted-title-worktree',
    title: 'shell',
    worktreeId: WORKTREE_ID,
    incarnationId: INCARNATION,
    ...overrides
  }
}

function providerSnapshot(
  overrides: Partial<PtyProviderBufferSnapshot> = {}
): PtyProviderBufferSnapshot {
  return {
    data: 'old visible screen\r\n',
    cols: 80,
    rows: 24,
    seq: 10,
    source: 'headless',
    lastTitle: CLAUDE_IDLE_TITLE,
    ...overrides
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type Snapshot = PtyProviderBufferSnapshot | null

// Why a subclass: the assertions read the runtime's own PTY records, which are protected.
class AdoptedTitleRuntime extends OrcaRuntimeService {
  record(ptyId = PTY_ID) {
    return this.ptysById.get(ptyId)
  }
}

function createHeadlessRuntime(options: {
  serializeProviderBuffer: (ptyId: string, opts?: { scrollbackRows?: number }) => Promise<Snapshot>
  listProcesses?: () => Promise<PtyProcessInfo[]>
  getForegroundProcess?: () => Promise<string | null>
  confirmForegroundProcess?: () => Promise<string | null>
}) {
  const runtime = new AdoptedTitleRuntime()
  const serializeProviderBuffer = vi.fn(options.serializeProviderBuffer)
  runtime.setPtyController({
    write: () => true,
    kill: () => true,
    getForegroundProcess: options.getForegroundProcess ?? (async () => null),
    ...(options.confirmForegroundProcess
      ? { confirmForegroundProcess: options.confirmForegroundProcess }
      : {}),
    hasPty: () => true,
    listProcesses: vi.fn(options.listProcesses ?? (async () => [processRow()])),
    serializeProviderBuffer
  })
  return { runtime, serializeProviderBuffer }
}

async function onlyTerminal(runtime: OrcaRuntimeService) {
  const { terminals } = await runtime.listTerminals()
  expect(terminals).toHaveLength(1)
  return terminals[0]!
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('inventory-adopted daemon session title seed (#22809)', () => {
  it('restores the title, agent identity and idle status without fabricating output', async () => {
    const { runtime, serializeProviderBuffer } = createHeadlessRuntime({
      serializeProviderBuffer: async () => providerSnapshot()
    })

    await runtime.listTerminals()
    await vi.waitFor(() => expect(runtime.record()?.lastOscTitle).toBe(CLAUDE_IDLE_TITLE))

    const terminal = await onlyTerminal(runtime)
    expect(terminal.title).toBe(CLAUDE_IDLE_TITLE)
    expect(terminal.agentIdentity).toBe('claude')
    // Historical state only: nothing may read as fresh activity or a frozen screen.
    expect(terminal.lastOutputAt).toBeNull()
    expect(terminal.preview).toBe('')
    expect(runtime.record()?.tailBuffer).toEqual([])
    await expect(runtime.getTerminalAgentStatus(terminal.handle)).resolves.toEqual({
      handle: terminal.handle,
      isRunningAgent: true,
      status: 'idle'
    })
    // Only the title is used, so the probe asks for no scrollback.
    expect(serializeProviderBuffer).toHaveBeenCalledWith(PTY_ID, { scrollbackRows: 0 })
  })

  it('restores the idle status of a Pi title the same way', async () => {
    const { runtime } = createHeadlessRuntime({
      serializeProviderBuffer: async () => providerSnapshot({ lastTitle: 'π - repo' })
    })

    await runtime.listTerminals()
    await vi.waitFor(() => expect(runtime.record()?.lastOscTitle).toBe('π - repo'))

    const terminal = await onlyTerminal(runtime)
    await expect(runtime.getTerminalAgentStatus(terminal.handle)).resolves.toMatchObject({
      isRunningAgent: true,
      status: 'idle'
    })
  })

  it('keeps `terminal read` on the fresh provider screen instead of seeding a tail', async () => {
    const { runtime } = createHeadlessRuntime({
      serializeProviderBuffer: async (_ptyId, opts) =>
        providerSnapshot({
          data: opts?.scrollbackRows === 0 ? 'stale adoption screen\r\n' : 'fresh screen\r\n',
          seq: 0
        })
    })

    await runtime.listTerminals()
    await vi.waitFor(() => expect(runtime.record()?.lastOscTitle).toBe(CLAUDE_IDLE_TITLE))

    const terminal = await onlyTerminal(runtime)
    const read = await runtime.readTerminal(terminal.handle)
    expect(read.tail).toEqual(['fresh screen'])
  })

  it('lets a live title observed first win over the snapshot title', async () => {
    const snapshot = deferred<Snapshot>()
    const { runtime, serializeProviderBuffer } = createHeadlessRuntime({
      serializeProviderBuffer: () => snapshot.promise
    })

    await runtime.listTerminals()
    await vi.waitFor(() => expect(serializeProviderBuffer).toHaveBeenCalledOnce())
    runtime.onPtyData(PTY_ID, '\x1b]0;✳ live title\x07live line\r\n', 1234)
    snapshot.resolve(providerSnapshot({ lastTitle: 'stale snapshot title' }))
    await flushAsyncWork()

    const terminal = await onlyTerminal(runtime)
    expect(terminal.title).toBe('✳ live title')
    expect(terminal.preview).toBe('live line')
    expect(terminal.lastOutputAt).toBe(1234)
  })

  it('stops reporting an agent once a shell owns the foreground behind the restored title', async () => {
    let foreground = 'claude'
    const { runtime } = createHeadlessRuntime({
      serializeProviderBuffer: async () => providerSnapshot(),
      getForegroundProcess: async () => foreground
    })
    await runtime.listTerminals()
    await vi.waitFor(() => expect(runtime.record()?.lastOscTitle).toBe(CLAUDE_IDLE_TITLE))
    const { handle } = await onlyTerminal(runtime)
    await expect(runtime.getTerminalAgentStatus(handle)).resolves.toEqual({
      handle,
      isRunningAgent: true,
      status: 'idle'
    })

    // The agent exited to a shell that never reset the title the daemon kept.
    foreground = 'bash'
    await expect(runtime.getTerminalAgentStatus(handle)).resolves.toEqual({
      handle,
      isRunningAgent: false,
      status: null
    })
    await expect(runtime.isTerminalRunningAgent(handle)).resolves.toBe(false)

    // A title observed live is current evidence again.
    runtime.onPtyData(PTY_ID, `\x1b]0;${CLAUDE_IDLE_TITLE}\x07`, 2000)
    await expect(runtime.isTerminalRunningAgent(handle)).resolves.toBe(true)
  })

  // Same policy as the hook-status path: once the cheap read shows a shell, only fresh evidence of
  // a recognized agent keeps the restored title, so doubt never lets a send type into a shell.
  it.each([
    ['fresh evidence shows the agent', async () => 'bash', async () => 'claude', true],
    ['fresh evidence is unavailable', async () => 'bash', async () => null, false],
    [
      'fresh confirmation fails',
      async () => 'bash',
      () => Promise.reject(new Error('scan')),
      false
    ],
    ['the foreground read fails', () => Promise.reject(new Error('read')), async () => null, true]
  ] as const)(
    'resolves a restored title when %s',
    async (_label, getForegroundProcess, confirmForegroundProcess, running) => {
      const { runtime } = createHeadlessRuntime({
        serializeProviderBuffer: async () => providerSnapshot(),
        getForegroundProcess,
        confirmForegroundProcess
      })
      await runtime.listTerminals()
      await vi.waitFor(() => expect(runtime.record()?.lastOscTitle).toBe(CLAUDE_IDLE_TITLE))
      const { handle } = await onlyTerminal(runtime)

      await expect(runtime.getTerminalAgentStatus(handle)).resolves.toEqual({
        handle,
        isRunningAgent: running,
        status: running ? 'idle' : null
      })
      await expect(runtime.isTerminalRunningAgent(handle)).resolves.toBe(running)
    }
  )

  it('verifies a restored permission title against the foreground before reporting a prompt', async () => {
    let foreground = 'gemini'
    const { runtime } = createHeadlessRuntime({
      serializeProviderBuffer: async () => providerSnapshot({ lastTitle: GEMINI_PERMISSION_TITLE }),
      getForegroundProcess: async () => foreground
    })
    await runtime.listTerminals()
    await vi.waitFor(() => expect(runtime.record()?.lastOscTitle).toBe(GEMINI_PERMISSION_TITLE))
    const { handle } = await onlyTerminal(runtime)
    await expect(runtime.getTerminalAgentStatus(handle)).resolves.toEqual({
      handle,
      isRunningAgent: true,
      status: 'permission'
    })
    await expect(runtime.getTerminalInteractiveWait(handle)).resolves.toEqual({ source: 'title' })

    // The agent exited to a shell that kept the permission title.
    foreground = 'bash'
    await expect(runtime.getTerminalAgentStatus(handle)).resolves.toEqual({
      handle,
      isRunningAgent: false,
      status: null
    })
    await expect(runtime.getTerminalInteractiveWait(handle)).resolves.toBeNull()
  })

  it('probes only records that have seen neither output nor a title', async () => {
    const livePtyId = `${WORKTREE_ID}@@session-live`
    const titledPtyId = `${WORKTREE_ID}@@session-titled`
    const { runtime, serializeProviderBuffer } = createHeadlessRuntime({
      serializeProviderBuffer: async () => providerSnapshot({ lastTitle: 'stale snapshot title' }),
      listProcesses: async () => [
        processRow({ id: livePtyId }),
        processRow({ id: titledPtyId }),
        processRow()
      ]
    })
    runtime.onPtyData(livePtyId, 'live line\r\n', 99)
    runtime.onPtyData(titledPtyId, '\x1b]0;live title\x07', 100)

    await runtime.listTerminals()
    await vi.waitFor(() => expect(runtime.record()?.lastOscTitle).toBe('stale snapshot title'))

    expect(serializeProviderBuffer.mock.calls).toEqual([[PTY_ID, { scrollbackRows: 0 }]])
    expect(runtime.record(livePtyId)?.lastOscTitle).toBeNull()
    expect(runtime.record(titledPtyId)?.lastOscTitle).toBe('live title')
  })

  it.each([
    ['a null snapshot', async () => null],
    ['a snapshot with no title', async () => providerSnapshot({ lastTitle: undefined })],
    [
      'a rejected snapshot',
      async () => {
        throw new Error('provider_unavailable')
      }
    ]
  ] as const)('treats %s as a silent no-op', async (_label, serialize) => {
    const { runtime, serializeProviderBuffer } = createHeadlessRuntime({
      serializeProviderBuffer: serialize
    })

    await runtime.listTerminals()
    await vi.waitFor(() => expect(serializeProviderBuffer).toHaveBeenCalledOnce())
    await flushAsyncWork()

    const terminal = await onlyTerminal(runtime)
    expect(terminal.title).toBeNull()
    expect(terminal.preview).toBe('')
    expect(terminal.lastOutputAt).toBeNull()
  })

  it('probes at most once per PTY incarnation across repeated inventory refreshes', async () => {
    let rows = [processRow()]
    const { runtime, serializeProviderBuffer } = createHeadlessRuntime({
      // Why null: a title-less answer leaves the record seedable, so only the attempt guard stops a refetch.
      serializeProviderBuffer: async () => null,
      listProcesses: async () => rows
    })

    for (let i = 0; i < 3; i += 1) {
      await runtime.listTerminals()
      await flushAsyncWork()
    }
    expect(serializeProviderBuffer).toHaveBeenCalledOnce()

    rows = [processRow({ incarnationId: REPLACEMENT })]
    await runtime.listTerminals()
    await flushAsyncWork()
    expect(serializeProviderBuffer).toHaveBeenCalledTimes(2)
  })

  it('drops a snapshot whose PTY was replaced while it was in flight', async () => {
    const snapshot = deferred<Snapshot>()
    let rows = [processRow()]
    const { runtime, serializeProviderBuffer } = createHeadlessRuntime({
      serializeProviderBuffer: vi
        .fn<(ptyId: string) => Promise<Snapshot>>()
        .mockImplementationOnce(() => snapshot.promise)
        .mockResolvedValue(null),
      listProcesses: async () => rows
    })

    await runtime.listTerminals()
    await vi.waitFor(() => expect(serializeProviderBuffer).toHaveBeenCalledOnce())
    rows = [processRow({ incarnationId: REPLACEMENT })]
    await runtime.listTerminals()
    snapshot.resolve(providerSnapshot())
    await flushAsyncWork()

    expect(runtime.record()?.lastOscTitle).toBeNull()
  })

  it('never probes SSH relay sessions, whose providers serve no buffer snapshot', async () => {
    const sshPtyId = `ssh:relay-1@@${WORKTREE_ID}@@session-remote`
    const { runtime, serializeProviderBuffer } = createHeadlessRuntime({
      serializeProviderBuffer: async () => providerSnapshot(),
      listProcesses: async () => [processRow({ id: sshPtyId }), processRow()]
    })

    await runtime.listTerminals()
    await vi.waitFor(() => expect(runtime.record()?.lastOscTitle).toBe(CLAUDE_IDLE_TITLE))

    expect(serializeProviderBuffer.mock.calls).toEqual([[PTY_ID, { scrollbackRows: 0 }]])
  })
})

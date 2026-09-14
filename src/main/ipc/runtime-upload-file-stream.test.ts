import { lstat, mkdtemp, mkdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StagedRuntimeUploadFileIdentity } from '../../shared/runtime-upload-staging-contract'
import type * as RuntimeImportLimits from './runtime-import-limits'

type RuntimeImportLimitsModule = typeof RuntimeImportLimits

type ChunkCall = { relativePath: string; contentBase64: string; append: boolean }
type RuntimeCallOptions = { expectedEnvironmentRuntimeId?: string }

const callRuntimeEnvironment =
  vi.fn<
    (
      userDataPath: string,
      environmentId: string,
      method: string,
      params: ChunkCall,
      timeoutMs?: number,
      expectedEnvironmentPairingRevision?: number,
      envelope?: unknown,
      options?: RuntimeCallOptions
    ) => unknown
  >()

vi.mock('./runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: (...args: Parameters<typeof callRuntimeEnvironment>) =>
    callRuntimeEnvironment(...args)
}))
vi.mock('./filesystem-auth', () => ({ authorizeExternalPath: () => {} }))
// Why: see filesystem-runtime-upload-staging.test.ts — a real over-limit fixture
// would allocate gigabytes on Windows.
vi.mock('./runtime-import-limits', async (importOriginal) => ({
  ...(await importOriginal<RuntimeImportLimitsModule>()),
  REMOTE_IMPORT_MAX_FILE_BYTES: 2 * 1024 * 1024
}))

const { RUNTIME_UPLOAD_SLICE_BYTES, streamExternalFileToRuntime } =
  await import('./runtime-upload-file-stream')

let workDir: string

function chunkCalls(): ChunkCall[] {
  return callRuntimeEnvironment.mock.calls
    .filter(([, , method]) => method === 'files.writeBase64Chunk')
    .map(([, , , params]) => params)
}

function uploadedBytes(): Buffer {
  return Buffer.concat(chunkCalls().map((call) => Buffer.from(call.contentBase64, 'base64')))
}

/** Mirrors what staging records, so tests exercise the real identity contract. */
async function stagedIdentity(filePath: string): Promise<StagedRuntimeUploadFileIdentity> {
  const stat = await lstat(filePath)
  return {
    byteLength: stat.size,
    inode: stat.ino,
    deviceId: stat.dev,
    modifiedAtMs: stat.mtimeMs
  }
}

async function baseArgs(sourceRootPath: string, entryPath?: string) {
  return {
    userDataPath: '/user-data',
    environmentId: 'env-1',
    sourceRootPath,
    entryRelativePath: entryPath ?? '',
    expected: await stagedIdentity(entryPath ? join(sourceRootPath, entryPath) : sourceRootPath),
    worktree: 'wt-1',
    relativePath: '.upload.tmp'
  }
}

/** A path whose identity was never measured; every field is deliberately absent. */
function unstagedArgs(sourceRootPath: string, entryPath?: string) {
  return {
    userDataPath: '/user-data',
    environmentId: 'env-1',
    sourceRootPath,
    entryRelativePath: entryPath ?? '',
    expected: { byteLength: 0, inode: 0, deviceId: 0, modifiedAtMs: 0 },
    worktree: 'wt-1',
    relativePath: '.upload.tmp'
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'orca-upload-stream-'))
  callRuntimeEnvironment.mockReset()
  callRuntimeEnvironment.mockResolvedValue({ id: 'x', ok: true, result: {}, _meta: {} })
})

afterEach(async () => {
  await rm(workDir, { force: true, recursive: true })
})

describe('streamExternalFileToRuntime', () => {
  it('sends a file larger than the old 25 MB cap as ordered append-only slices', async () => {
    const size = RUNTIME_UPLOAD_SLICE_BYTES * 2 + 1234
    const contents = Buffer.alloc(size)
    for (let index = 0; index < size; index += 1) {
      contents[index] = index % 251
    }
    const filePath = join(workDir, 'big.bin')
    await writeFile(filePath, contents)

    await expect(streamExternalFileToRuntime(await baseArgs(filePath))).resolves.toEqual({
      byteLength: size
    })

    const calls = chunkCalls()
    expect(calls).toHaveLength(3)
    expect(calls.map((call) => call.append)).toEqual([false, true, true])
    expect(uploadedBytes().equals(contents)).toBe(true)
  })

  it('refuses a source whose size no longer matches what staging measured', async () => {
    const filePath = join(workDir, 'grown.bin')
    await writeFile(filePath, Buffer.alloc(1024))
    const staged = await stagedIdentity(filePath)
    await writeFile(filePath, Buffer.alloc(2048))

    await expect(
      streamExternalFileToRuntime({ ...(await baseArgs(filePath)), expected: staged })
    ).rejects.toThrow('File changed since it was staged')
    expect(chunkCalls()).toHaveLength(0)
  })

  it('refuses a source swapped for a different file of the same size', async () => {
    const filePath = join(workDir, 'swapped.bin')
    await writeFile(filePath, Buffer.alloc(2048, 0x41))
    const staged = await stagedIdentity(filePath)

    // A rename-into-place keeps the size and changes the inode.
    const decoyPath = join(workDir, 'decoy.bin')
    await writeFile(decoyPath, Buffer.alloc(2048, 0x42))
    await rename(decoyPath, filePath)

    await expect(
      streamExternalFileToRuntime({ ...(await baseArgs(filePath)), expected: staged })
    ).rejects.toThrow('File changed since it was staged')
    expect(chunkCalls()).toHaveLength(0)
  })

  it('refuses a source rewritten in place at the same size after staging', async () => {
    const filePath = join(workDir, 'rewritten.bin')
    await writeFile(filePath, Buffer.alloc(2048, 0x41))
    const staged = await stagedIdentity(filePath)

    // Same inode and size; only the modification time moves.
    await writeFile(filePath, Buffer.alloc(2048, 0x42))
    const bumped = new Date(staged.modifiedAtMs + 5_000)
    await utimes(filePath, bumped, bumped)

    await expect(
      streamExternalFileToRuntime({ ...(await baseArgs(filePath)), expected: staged })
    ).rejects.toThrow('File changed since it was staged')
    expect(chunkCalls()).toHaveLength(0)
  })

  it('aborts when the source is rewritten at the same size mid-transfer', async () => {
    const filePath = join(workDir, 'racing.bin')
    const size = RUNTIME_UPLOAD_SLICE_BYTES * 2
    await writeFile(filePath, Buffer.alloc(size, 0x41))
    const args = await baseArgs(filePath)

    let rewritten = false
    callRuntimeEnvironment.mockImplementation(async () => {
      if (!rewritten) {
        rewritten = true
        await writeFile(filePath, Buffer.alloc(size, 0x42))
        const bumped = new Date(args.expected.modifiedAtMs + 5_000)
        await utimes(filePath, bumped, bumped)
      }
      return { id: 'x', ok: true, result: {}, _meta: {} }
    })

    await expect(streamExternalFileToRuntime(args)).rejects.toThrow('File changed during upload')
  })

  it('accepts a source that still matches its staged identity', async () => {
    const filePath = join(workDir, 'same.bin')
    await writeFile(filePath, Buffer.alloc(2048))

    await expect(streamExternalFileToRuntime(await baseArgs(filePath))).resolves.toEqual({
      byteLength: 2048
    })
  })

  it('refuses a file over the ceiling', async () => {
    const filePath = join(workDir, 'huge.bin')
    await writeFile(filePath, Buffer.alloc(3 * 1024 * 1024))

    await expect(streamExternalFileToRuntime(await baseArgs(filePath))).rejects.toThrow(
      'over the 2 MB per-file remote import limit'
    )
    expect(chunkCalls()).toHaveLength(0)
  })

  it('never buffers more than one slice per chunk', async () => {
    const filePath = join(workDir, 'sliced.bin')
    await writeFile(filePath, Buffer.alloc(RUNTIME_UPLOAD_SLICE_BYTES * 2))

    await streamExternalFileToRuntime(await baseArgs(filePath))

    for (const call of chunkCalls()) {
      expect(Buffer.from(call.contentBase64, 'base64').byteLength).toBeLessThanOrEqual(
        RUNTIME_UPLOAD_SLICE_BYTES
      )
    }
  })

  it('creates an empty destination for a zero-byte source', async () => {
    const filePath = join(workDir, 'empty.txt')
    await writeFile(filePath, '')

    await expect(streamExternalFileToRuntime(await baseArgs(filePath))).resolves.toEqual({
      byteLength: 0
    })

    expect(chunkCalls()).toEqual([expect.objectContaining({ append: false, contentBase64: '' })])
  })

  it('refuses to finish a zero-byte upload whose source gained content mid-write', async () => {
    const filePath = join(workDir, 'grows.txt')
    await writeFile(filePath, '')
    const args = await baseArgs(filePath)

    callRuntimeEnvironment.mockImplementation(async () => {
      await writeFile(filePath, 'content arrived during the empty write')
      return { id: 'x', ok: true, result: {}, _meta: {} }
    })

    await expect(streamExternalFileToRuntime(args)).rejects.toThrow('File changed during upload')
  })

  it('carries the pairing revision and runtime id on every chunk', async () => {
    const filePath = join(workDir, 'guarded.bin')
    await writeFile(filePath, Buffer.alloc(RUNTIME_UPLOAD_SLICE_BYTES + 10))

    await streamExternalFileToRuntime({
      ...(await baseArgs(filePath)),
      expectedEnvironmentPairingRevision: 41,
      expectedEnvironmentRuntimeId: 'runtime-7'
    })

    const guards = callRuntimeEnvironment.mock.calls
      .filter(([, , method]) => method === 'files.writeBase64Chunk')
      .map(([, , , , , revision, , options]) => ({
        revision,
        runtimeId: options?.expectedEnvironmentRuntimeId
      }))
    expect(guards).toEqual([
      { revision: 41, runtimeId: 'runtime-7' },
      { revision: 41, runtimeId: 'runtime-7' }
    ])
  })

  it('stops at the failing chunk instead of sending the rest of the file', async () => {
    const filePath = join(workDir, 'fails.bin')
    await writeFile(filePath, Buffer.alloc(RUNTIME_UPLOAD_SLICE_BYTES * 3))
    callRuntimeEnvironment.mockResolvedValueOnce({ id: 'x', ok: true, result: {}, _meta: {} })
    callRuntimeEnvironment.mockResolvedValueOnce({
      id: 'x',
      ok: false,
      error: { code: 'write_failed', message: 'disk full' }
    })

    await expect(streamExternalFileToRuntime(await baseArgs(filePath))).rejects.toThrow('disk full')
    expect(chunkCalls()).toHaveLength(2)
  })

  // symlink() needs privileges or Developer Mode on Windows.
  it.skipIf(process.platform === 'win32')('refuses a symlinked source', async () => {
    const targetPath = join(workDir, 'secret.txt')
    await writeFile(targetPath, 'secret')
    const linkPath = join(workDir, 'link.txt')
    await symlink(targetPath, linkPath)

    await expect(streamExternalFileToRuntime(unstagedArgs(linkPath))).rejects.toThrow(
      'Symlink not allowed'
    )
    expect(chunkCalls()).toHaveLength(0)
  })

  it.skipIf(process.platform === 'win32')(
    'refuses a directory entry whose real path escapes the dropped root',
    async () => {
      const outsidePath = join(workDir, 'outside.txt')
      await writeFile(outsidePath, 'outside')
      const rootPath = join(workDir, 'root')
      await mkdir(rootPath)
      await symlink(outsidePath, join(rootPath, 'escape.txt'))

      await expect(
        streamExternalFileToRuntime(unstagedArgs(rootPath, 'escape.txt'))
      ).rejects.toThrow('Symlink not allowed')
      expect(chunkCalls()).toHaveLength(0)
    }
  )
})

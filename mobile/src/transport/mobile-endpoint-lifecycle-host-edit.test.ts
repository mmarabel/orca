import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileRelayEndpoint } from '../../../src/shared/mobile-relay-credential-contract'

const storage = vi.hoisted(() => new Map<string, string>())
const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    storage.set(key, value)
  }),
  removeItem: vi.fn(async (key: string) => {
    storage.delete(key)
  })
}))
const connectMock = vi.hoisted(() => vi.fn())
const openRelayMock = vi.hoisted(() => vi.fn())
const resolveRelayMock = vi.hoisted(() => vi.fn())
const readBundleMock = vi.hoisted(() => vi.fn())

vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorageMock }))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: vi.fn(async () => 'device-token'),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {})
}))
vi.mock('./rpc-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rpc-client')>()),
  connect: (...args: unknown[]) => connectMock(...args)
}))
vi.mock('./mobile-relay-rpc-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-relay-rpc-session')>()),
  connectMobileRelayRpcSession: (...args: unknown[]) => openRelayMock(...args)
}))
vi.mock('./mobile-relay-resume-director', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-relay-resume-director')>()),
  resolveMobileRelayEndpoint: (...args: unknown[]) => resolveRelayMock(...args)
}))
vi.mock('./mobile-relay-credential-bundle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-relay-credential-bundle')>()),
  readMobileRelayCredentialBundle: (...args: unknown[]) => readBundleMock(...args),
  writeMobileRelayCredentialBundle: async () => {}
}))

import { loadHosts, resetHostStoreForTests, updateHostNameAndEndpoint } from './host-store'
import { startMobileEndpointLifecycle } from './mobile-endpoint-lifecycle'
import {
  bundle,
  FakeLogicalClient,
  FakeRelaySession,
  FakeSession,
  host,
  relay
} from './mobile-endpoint-supervisor-test-fakes'
import { RelayOuterError } from './mobile-relay-e2ee-link'
import { resetMobileRelayHostOverlayStoreForTests } from './mobile-relay-host-overlay-store'

const EDITED_ENDPOINT = 'ws://192.168.1.20:6768'
const resolved = { ...relay, cellUrl: 'https://relay-c2.onorca.dev', assignmentEpoch: 8 }

// Starts a relay host whose first dial hits the wrong cell, leaving director resolution pending.
async function startWithPendingResolution(): Promise<{
  logical: FakeLogicalClient
  lifecycle: ReturnType<typeof startMobileEndpointLifecycle>
  settle: (value: MobileRelayEndpoint) => void
}> {
  let settle: (value: MobileRelayEndpoint) => void = () => {}
  resolveRelayMock.mockReturnValue(
    new Promise<MobileRelayEndpoint>((resolve) => {
      settle = resolve
    })
  )
  openRelayMock
    .mockReturnValueOnce(new FakeRelaySession('disconnected', new RelayOuterError(4409)))
    .mockReturnValue(new FakeRelaySession('connected'))
  const logical = new FakeLogicalClient('disconnected', 'lan')
  const lifecycle = startMobileEndpointLifecycle(logical, host, () => {})
  await vi.waitFor(() => expect(resolveRelayMock).toHaveBeenCalledOnce())
  return { logical, lifecycle, settle: (value) => settle(value) }
}

describe('mobile endpoint lifecycle host edits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    resetHostStoreForTests()
    resetMobileRelayHostOverlayStoreForTests()
    const { id, name, endpoint, publicKeyB64, lastConnected } = host
    storage.set('orca:hosts', JSON.stringify([{ id, name, endpoint, publicKeyB64, lastConnected }]))
    storage.set(
      'orca:mobile-relay:host-overlays:v2',
      JSON.stringify([
        { v: 2, hostId: id, endpoints: host.endpoints, relayHostId: relay.relayHostId, relay }
      ])
    )
    connectMock.mockImplementation(() => new FakeSession('disconnected'))
    readBundleMock.mockResolvedValue(bundle)
  })

  it('keeps an edit made while relay resolution was pending', async () => {
    const { lifecycle, settle } = await startWithPendingResolution()

    await updateHostNameAndEndpoint(host.id, { personalName: 'Renamed', endpoint: EDITED_ENDPOINT })
    settle(resolved)
    await vi.waitFor(() => expect(openRelayMock).toHaveBeenCalledTimes(2))

    const [saved] = await loadHosts()
    expect(saved).toMatchObject({ name: 'Renamed', endpoint: EDITED_ENDPOINT, relay: resolved })
    expect(saved!.endpoints?.map(({ url }) => url)).not.toContain(host.endpoint)
    lifecycle.stop()
  })

  it('does not persist a resolution that settles after stop', async () => {
    const { logical, lifecycle, settle } = await startWithPendingResolution()
    await updateHostNameAndEndpoint(host.id, { personalName: 'Renamed', endpoint: EDITED_ENDPOINT })
    const writesBeforeSettle = asyncStorageMock.setItem.mock.calls.length

    lifecycle.stop()
    const recoveryPathCalls = logical.setRecoveryPath.mock.calls.length
    settle(resolved)
    // The withdrawn dial clears the recovery path only after any persistence has run.
    await vi.waitFor(() =>
      expect(logical.setRecoveryPath).toHaveBeenCalledTimes(recoveryPathCalls + 1)
    )

    expect(asyncStorageMock.setItem).toHaveBeenCalledTimes(writesBeforeSettle)
    const [saved] = await loadHosts()
    expect(saved).toMatchObject({ name: 'Renamed', endpoint: EDITED_ENDPOINT, relay })
    expect(openRelayMock).toHaveBeenCalledOnce()
  })
})

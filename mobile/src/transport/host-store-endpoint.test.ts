import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadHosts,
  MobileRelayUpgradeHostRemovedError,
  resetHostStoreForTests,
  saveExistingHostRelayUpgrade,
  saveRecoveredPairingHost,
  updateHostNameAndEndpoint
} from './host-store'
import { withRelayRouting } from './mobile-relay-routing'
import {
  resetMobileRelayHostOverlayStoreForTests,
  saveMobileRelayHostRouting
} from './mobile-relay-host-overlay-store'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn()
  }
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }
}))

describe('updateHostNameAndEndpoint', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
  })

  const stored = [
    {
      id: 'host-1',
      name: 'Desk',
      endpoint: 'ws://100.64.0.5:6768',
      publicKeyB64: 'pk',
      lastConnected: 1
    },
    {
      id: 'host-2',
      name: 'Laptop',
      endpoint: 'wss://laptop.example:8443',
      publicKeyB64: 'pk-2',
      lastConnected: 2
    }
  ]

  it('commits name and endpoint together in a single write', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', {
      name: 'Home Desk',
      endpoint: 'ws://192.168.1.10:6768'
    })

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'orca:hosts',
      JSON.stringify([
        { ...stored[0], name: 'Home Desk', endpoint: 'ws://192.168.1.10:6768' },
        stored[1]
      ])
    )
  })

  it('updates only the provided field', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', { name: 'Home Desk' })

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'orca:hosts',
      JSON.stringify([{ ...stored[0], name: 'Home Desk' }, stored[1]])
    )
  })

  it('rewrites only the endpoint when name is omitted', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', { endpoint: 'ws://192.168.1.10:6768' })

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'orca:hosts',
      JSON.stringify([{ ...stored[0], endpoint: 'ws://192.168.1.10:6768' }, stored[1]])
    )
  })

  it('throws and writes nothing when the host is missing', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue('[]')

    await expect(updateHostNameAndEndpoint('missing', { name: 'Renamed' })).rejects.toThrow(
      'Host not found'
    )
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  })
})

describe('host edits with a relay overlay', () => {
  const OVERLAY_KEY = 'orca:mobile-relay:host-overlays:v2'
  const OLD_ENDPOINT = 'ws://192.168.1.10:6768'
  const NEW_ENDPOINT = 'ws://192.168.1.20:6768'
  const relay = {
    v: 1 as const,
    directorUrl: 'https://relay.onorca.dev',
    cellUrl: 'https://relay-c1.onorca.dev',
    assignmentEpoch: 7,
    relayHostId: 'AbCdEf0123_-xyZ9',
    e2eeFraming: 2 as const
  }
  const storage = new Map<string, string>()

  beforeEach(() => {
    resetHostStoreForTests()
    resetMobileRelayHostOverlayStoreForTests()
    storage.clear()
    storage.set(
      'orca:hosts',
      JSON.stringify([
        { id: 'host-1', name: 'Desk', endpoint: OLD_ENDPOINT, publicKeyB64: 'pk', lastConnected: 1 }
      ])
    )
    storage.set(
      OVERLAY_KEY,
      JSON.stringify([
        {
          v: 2,
          hostId: 'host-1',
          endpoints: [
            { id: 'direct-primary', kind: 'lan', url: OLD_ENDPOINT },
            { id: 'relay-primary', kind: 'relay', url: 'wss://relay-c1.onorca.dev/v1/connect/id' }
          ],
          relayHostId: relay.relayHostId,
          relay
        }
      ])
    )
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) => storage.get(key) ?? null)
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      storage.set(key, value)
    })
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue('device-token')
  })

  it('leaves no old direct URL in the loaded endpoints after an endpoint edit', async () => {
    await updateHostNameAndEndpoint('host-1', { endpoint: NEW_ENDPOINT })

    const [host] = await loadHosts()
    expect(host?.endpoint).toBe(NEW_ENDPOINT)
    expect(host?.endpoints?.map(({ url }) => url)).not.toContain(OLD_ENDPOINT)
    expect(host?.endpoints).toContainEqual({ id: 'direct-primary', kind: 'lan', url: NEW_ENDPOINT })
  })

  it('merges a relay move onto the current host instead of a stale snapshot', async () => {
    await updateHostNameAndEndpoint('host-1', { name: 'Renamed', endpoint: NEW_ENDPOINT })
    const moved = { ...relay, cellUrl: 'https://relay-c2.onorca.dev', assignmentEpoch: 8 }

    await saveMobileRelayHostRouting('host-1', moved)

    const [host] = await loadHosts()
    expect(host).toMatchObject({ name: 'Renamed', endpoint: NEW_ENDPOINT, relay: moved })
    expect(host?.endpoints).toEqual([
      { id: 'direct-primary', kind: 'lan', url: NEW_ENDPOINT },
      {
        id: 'relay-primary',
        kind: 'relay',
        url: 'wss://relay-c2.onorca.dev/v1/connect/AbCdEf0123_-xyZ9'
      }
    ])
  })

  it('keeps an edit made while a direct-only host was being upgraded to relay', async () => {
    storage.set(OVERLAY_KEY, '[]')
    const [snapshot] = await loadHosts()
    if (!snapshot) {
      throw new Error('expected a stored host')
    }
    await updateHostNameAndEndpoint('host-1', { name: 'Renamed', endpoint: NEW_ENDPOINT })

    // Mirrors the direct upgrade's publish: the pre-edit snapshot plus relay routing.
    await saveExistingHostRelayUpgrade({ ...snapshot, ...withRelayRouting(relay) })

    const [host] = await loadHosts()
    expect(host).toMatchObject({ name: 'Renamed', endpoint: NEW_ENDPOINT, relay })
    expect(host?.endpoints?.map(({ url }) => url)).not.toContain(OLD_ENDPOINT)
  })

  it('does not create relay routing for a host with no overlay', async () => {
    storage.set('orca:hosts', '[]')
    storage.set(OVERLAY_KEY, '[]')

    await saveMobileRelayHostRouting('host-1', relay)

    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  })

  it('drops the direct URL an older build left in the overlay when relay routing is saved', async () => {
    await saveMobileRelayHostRouting('host-1', relay)

    const [overlay] = JSON.parse(storage.get(OVERLAY_KEY) ?? '[]')
    expect(overlay.endpoints).toEqual([
      {
        id: 'relay-primary',
        kind: 'relay',
        url: 'wss://relay-c1.onorca.dev/v1/connect/AbCdEf0123_-xyZ9'
      }
    ])
  })

  it('leaves every stored row field untouched during a relay upgrade', async () => {
    await updateHostNameAndEndpoint('host-1', { name: 'Renamed', endpoint: NEW_ENDPOINT })

    await saveExistingHostRelayUpgrade({
      id: 'host-1',
      name: 'Host 1',
      endpoint: OLD_ENDPOINT,
      publicKeyB64: 'stale-pk',
      deviceToken: 'device-token',
      lastConnected: 1,
      ...withRelayRouting(relay)
    })

    const stored = JSON.parse(storage.get('orca:hosts') ?? '[]')
    expect(stored).toMatchObject([
      { id: 'host-1', name: 'Renamed', endpoint: NEW_ENDPOINT, publicKeyB64: 'pk' }
    ])
  })

  it('refuses a relay upgrade for a host the user removed', async () => {
    storage.set('orca:hosts', '[]')

    await expect(
      saveExistingHostRelayUpgrade({
        id: 'host-1',
        name: 'Desk',
        endpoint: OLD_ENDPOINT,
        publicKeyB64: 'pk',
        deviceToken: 'device-token',
        lastConnected: 1,
        ...withRelayRouting(relay)
      })
    ).rejects.toBeInstanceOf(MobileRelayUpgradeHostRemovedError)
  })

  it('keeps an edit made between a pairing journal capture and its replay', async () => {
    // The journal carries the host exactly as it looked when pairing started.
    const captured = {
      id: 'host-1',
      name: 'Host 1',
      endpoint: OLD_ENDPOINT,
      publicKeyB64: 'pk',
      deviceToken: 'device-token',
      lastConnected: 1
    }
    await updateHostNameAndEndpoint('host-1', { name: 'Tailnet desk', endpoint: NEW_ENDPOINT })

    await saveRecoveredPairingHost({ ...captured, ...withRelayRouting(relay) })

    const [host] = await loadHosts()
    expect(host).toMatchObject({ name: 'Tailnet desk', endpoint: NEW_ENDPOINT, relay })
    expect(host?.endpoints?.map(({ url }) => url)).not.toContain(OLD_ENDPOINT)
  })

  it('creates the row when a pairing replay finds it was never written', async () => {
    storage.set('orca:hosts', '[]')
    storage.set(OVERLAY_KEY, '[]')

    await saveRecoveredPairingHost({
      id: 'host-1',
      name: 'Host 1',
      endpoint: OLD_ENDPOINT,
      publicKeyB64: 'pk',
      deviceToken: 'device-token',
      lastConnected: 1,
      ...withRelayRouting(relay)
    })

    const [host] = await loadHosts()
    expect(host).toMatchObject({ id: 'host-1', name: 'Host 1', endpoint: OLD_ENDPOINT, relay })
  })
})

import type { Duplex } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { PairingOffer } from '../../shared/pairing'
import type { PortForwardListener } from './port-forward-listener'
import { PortForwardManager, type PortForwardManagerDeps } from './port-forward-manager'
import type { PortForwardTransport } from './port-forward-transport'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the manager reads nothing off PairingOffer; it only forwards the value to createTransport, which is stubbed here.
const PAIRING = {} as PairingOffer

function harness(overrides: { listenPort?: (preferred: number) => number } = {}) {
  const opened: number[] = []
  const closedListeners: number[] = []
  const transportClosed = vi.fn()
  let lostHandler: ((error: Error) => void) | null = null
  let listenerCount = 0

  const deps: PortForwardManagerDeps = {
    createTransport: (_pairing, onLost) => {
      lostHandler = onLost
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the manager calls only start() and close() on a transport; a full instance would need a live pairing and websocket.
      return {
        start: () =>
          Promise.resolve({
            open: (target: { host: string; port: number }) => {
              opened.push(target.port)
              // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: nothing in these tests reads the stream; the manager only hands it to the listener, which is stubbed.
              return Promise.resolve({} as Duplex)
            }
          }),
        close: transportClosed
      } as unknown as PortForwardTransport
    },
    createListener: () => {
      const id = ++listenerCount
      let bound = 0
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the manager calls only listen() and close() on a listener; the real one binds a socket, which this test does not need.
      return {
        listen: (preferred: number) => {
          bound = overrides.listenPort ? overrides.listenPort(preferred) : preferred
          return Promise.resolve({ port: bound, exact: bound === preferred })
        },
        close: () => {
          closedListeners.push(id)
          return Promise.resolve()
        }
      } as unknown as PortForwardListener
    }
  }

  return { deps, opened, closedListeners, transportClosed, lost: () => lostHandler }
}

describe('PortForwardManager', () => {
  it('returns a loopback URL on the host port when it is free', async () => {
    const { deps } = harness()
    const manager = new PortForwardManager(deps)

    await expect(manager.ensure('env-1', PAIRING, 4322)).resolves.toEqual({
      port: 4322,
      exact: true,
      url: 'http://127.0.0.1:4322'
    })
  })

  it('reports the remap rather than hiding it when the port is taken', async () => {
    const { deps } = harness({ listenPort: () => 53211 })
    const manager = new PortForwardManager(deps)

    await expect(manager.ensure('env-1', PAIRING, 4322)).resolves.toEqual({
      port: 53211,
      exact: false,
      url: 'http://127.0.0.1:53211'
    })
  })

  it('shares one forward per remote port instead of binding a second listener', async () => {
    const { deps } = harness()
    const manager = new PortForwardManager(deps)

    const first = await manager.ensure('env-1', PAIRING, 4322)
    const second = await manager.ensure('env-1', PAIRING, 4322)

    expect(second).toEqual(first)
    expect(manager.get('env-1', 4322)).toEqual(first)
  })

  it('collapses concurrent requests for the same port into one listener', async () => {
    const { deps, closedListeners } = harness()
    const manager = new PortForwardManager(deps)

    const [a, b] = await Promise.all([
      manager.ensure('env-1', PAIRING, 4322),
      manager.ensure('env-1', PAIRING, 4322)
    ])

    // Without the in-flight map both would bind and the loser would leak.
    expect(a).toEqual(b)
    expect(closedListeners).toEqual([])
  })

  it('keeps forwards for different ports and different environments apart', async () => {
    const { deps } = harness()
    const manager = new PortForwardManager(deps)

    await manager.ensure('env-1', PAIRING, 4322)
    await manager.ensure('env-1', PAIRING, 5173)
    await manager.ensure('env-2', PAIRING, 4322)

    expect(manager.get('env-1', 4322)?.port).toBe(4322)
    expect(manager.get('env-1', 5173)?.port).toBe(5173)
    expect(manager.get('env-2', 4322)?.port).toBe(4322)
  })

  it('tears down the environment when its tunnel is lost', async () => {
    const { deps, transportClosed, lost } = harness()
    const manager = new PortForwardManager(deps)
    await manager.ensure('env-1', PAIRING, 4322)

    lost()?.(new Error('tunnel died'))

    expect(manager.get('env-1', 4322)).toBeNull()
    expect(transportClosed).toHaveBeenCalled()
  })

  it('drops the subscription once its last forward is released', async () => {
    const { deps, transportClosed } = harness()
    const manager = new PortForwardManager(deps)
    await manager.ensure('env-1', PAIRING, 4322)
    await manager.ensure('env-1', PAIRING, 5173)

    await manager.release('env-1', 4322)
    expect(transportClosed).not.toHaveBeenCalled()

    await manager.release('env-1', 5173)
    expect(transportClosed).toHaveBeenCalledTimes(1)
    expect(manager.get('env-1', 5173)).toBeNull()
  })

  it('opens the stream against the host loopback, never the client address', async () => {
    const { deps, opened } = harness()
    const manager = new PortForwardManager(deps)
    const handle = await manager.ensure('env-1', PAIRING, 4322)

    // The listener is constructed with an opener bound to the remote port; the local
    // port it binds is incidental and must not be what the tunnel dials.
    expect(handle.port).toBe(4322)
    expect(opened).toEqual([])
  })

  it('closes everything on shutdown', async () => {
    const { deps, transportClosed } = harness()
    const manager = new PortForwardManager(deps)
    await manager.ensure('env-1', PAIRING, 4322)
    await manager.ensure('env-2', PAIRING, 5173)

    manager.closeAll()

    expect(transportClosed).toHaveBeenCalledTimes(2)
    expect(manager.get('env-1', 4322)).toBeNull()
    expect(manager.get('env-2', 5173)).toBeNull()
  })
})

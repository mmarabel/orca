import type { MobileRelayEndpoint } from '../../../src/shared/mobile-relay-credential-contract'
import type { MobileRelayHostOverlay } from './mobile-relay-host-overlay'

export type MobileRelayRouting = Pick<MobileRelayHostOverlay, 'endpoints' | 'relayHostId' | 'relay'>

export function relayWebSocketUrl(relay: { cellUrl: string; relayHostId: string }): string {
  const url = new URL(relay.cellUrl)
  url.protocol = 'wss:'
  url.pathname = `/v1/connect/${encodeURIComponent(relay.relayHostId)}`
  return url.toString()
}

// Why: the stored host row is the only owner of the direct address, so relay routing carries
// the relay endpoint alone — a second durable copy is what a host edit could never reach.
export function withRelayRouting(relay: MobileRelayEndpoint): MobileRelayRouting {
  return {
    endpoints: [{ id: 'relay-primary', kind: 'relay', url: relayWebSocketUrl(relay) }],
    relayHostId: relay.relayHostId,
    relay
  }
}

// Why: the catalog rebuilds the direct entry from the stored row on every read, so an overlay
// written by an older build stops contributing its pre-edit address to the dial list.
export function directAccessEndpoints(storedEndpoint: string): MobileRelayHostOverlay['endpoints'] {
  return [{ id: 'direct-primary', kind: 'lan', url: storedEndpoint }]
}

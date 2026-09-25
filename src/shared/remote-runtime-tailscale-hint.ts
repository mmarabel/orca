/**
 * Appends the dialed endpoint and an actionable network recommendation to
 * remote-runtime connection failures, mirroring `withMacTailscaleDnsHint`. Lives
 * in `shared` as a pure function with no package dependencies so both the main
 * process (desktop transport) and the renderer (web client) can route their
 * user-facing errors through it without leaking presentation copy into the
 * shared error constructors (which the CLI, logs, and mobile typecheck also
 * consume).
 */
import { classifyRemotePairingHostname, endpointForDisplay } from './remote-pairing-endpoint'

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download'

// Why: only the "runtime is unreachable" family of failures has a Tailscale
// remedy; auth/protocol errors pass through untouched.
const REMOTE_RUNTIME_UNREACHABLE_RE =
  /could not connect to the remote orca runtime|remote orca runtime closed the connection|timed out (?:waiting for|while connecting to) the remote orca runtime/i

const TAILSCALE_MAGIC_DNS_SUFFIX_RE = /(?:^|\.)ts\.net$/i
// Why: gate the CGNAT check on a full IPv4 literal — the range regex alone also
// matches DNS names like `100.64.0.1.example.com`, which aren't Tailscale IPs.
const IPV4_LITERAL_RE =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
// Tailscale assigns node IPs from the 100.64.0.0/10 CGNAT range (second octet 64–127).
const TAILSCALE_CGNAT_RE = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
// Tailscale also assigns each node an IPv6 address from the fd7a:115c:a1e0::/48 ULA
// block, and pairing endpoints can carry an IPv6 literal (see resolvePairingEndpoint).
const TAILSCALE_IPV6_RE = /^fd7a:115c:a1e0:/i

function extractHost(endpoint: string): string | null {
  let host: string | null
  try {
    host = new URL(endpoint).hostname || null
  } catch {
    // Why: a bare host (no scheme) isn't a valid URL; strip any scheme, take the authority,
    // and keep a bracketed IPv6 literal whole — splitting it on `:` like a host:port pair
    // leaves a lone hextet (`[fd7a:…]` -> `fd7a`) that reads as a short hostname downstream.
    const authority = endpoint.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/, 1)[0] ?? ''
    host = /^\[[^\]]*\]/.exec(authority)?.[0] || authority.split(':', 1)[0] || null
  }
  if (!host) {
    return null
  }
  // Why: WHATWG URL keeps IPv6 literals bracketed (`[fd7a:…]`) and FQDNs can carry
  // a trailing dot; normalize both so the host checks below see a bare address/name.
  return host.replace(/^\[|\]$/g, '').replace(/\.$/, '') || null
}

export function isTailscaleEndpoint(endpoint: string | null | undefined): boolean {
  if (!endpoint) {
    return false
  }
  const host = extractHost(endpoint)
  if (!host) {
    return false
  }
  return (
    TAILSCALE_MAGIC_DNS_SUFFIX_RE.test(host) ||
    (IPV4_LITERAL_RE.test(host) && TAILSCALE_CGNAT_RE.test(host)) ||
    TAILSCALE_IPV6_RE.test(host)
  )
}

/**
 * Why: a server already reached over Tailscale fails for tailnet-specific reasons, so "use
 * Tailscale" would be useless — point at the real causes. Already-paired devices keep their
 * saved token across server restarts, so re-pairing only matters when adding a new device.
 */
const TAILNET_ENDPOINT_HINT =
  "The server may be offline on your tailnet, or its Tailscale Funnel reverted to tailnet-only. Confirm it's reachable; re-pair only when adding a new device, since already-paired devices reconnect with their saved token."

// Why: a LAN address fails from any other network regardless of Tailscale, so the fix is a
// reachable address in the pairing link, not joining a tailnet the device may already be on.
const LAN_ENDPOINT_HINT =
  "That is a local-network address, so it only works from the server's own network. A device elsewhere, even one on the same tailnet, should re-pair using an address it can reach, such as the server's Tailscale address (100.x or a *.ts.net name)."

const OTHER_NETWORK_HINT = `If the server is on another network, connect both devices to Tailscale and pair using its Tailscale address (100.x or a *.ts.net name). See ${TAILSCALE_DOWNLOAD_URL}.`

export function withRemoteRuntimeTailscaleHint(
  message: string,
  endpoint: string | null | undefined
): string {
  if (!REMOTE_RUNTIME_UNREACHABLE_RE.test(message)) {
    return message
  }
  // Why: keep the hint idempotent so a message routed through this helper twice (e.g. a
  // re-wrapped error response) isn't suffixed with duplicate guidance. Keyed on the hints
  // themselves, not on the word — messages now carry an endpoint whose host can contain it.
  if (
    message.endsWith(TAILNET_ENDPOINT_HINT) ||
    message.endsWith(LAN_ENDPOINT_HINT) ||
    message.endsWith(OTHER_NETWORK_HINT)
  ) {
    return message
  }
  return `${withDialedEndpoint(message, endpoint)} ${hintForEndpoint(endpoint)}`
}

// Why: name the address that was actually dialed, so a stale or unreachable address in the
// pairing link is visible instead of the hint implying the network itself is at fault.
function withDialedEndpoint(message: string, endpoint: string | null | undefined): string {
  if (!endpoint) {
    return message
  }
  const display = endpointForDisplay(endpoint)
  if (message.includes(display)) {
    return message
  }
  return message.endsWith('.')
    ? `${message.slice(0, -1)} (dialed ${display}).`
    : `${message} (dialed ${display})`
}

function hintForEndpoint(endpoint: string | null | undefined): string {
  if (isTailscaleEndpoint(endpoint)) {
    return TAILNET_ENDPOINT_HINT
  }
  const host = endpoint ? extractHost(endpoint) : null
  const kind = host ? classifyRemotePairingHostname(host) : null
  // Why: the classifier also recognises IPv4-mapped IPv6 tailnet literals isTailscaleEndpoint misses.
  if (kind === 'tailscale') {
    return TAILNET_ENDPOINT_HINT
  }
  return kind === 'lan' ? LAN_ENDPOINT_HINT : OTHER_NETWORK_HINT
}

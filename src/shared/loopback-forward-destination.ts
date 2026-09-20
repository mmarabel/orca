// Why a purpose-built check rather than reusing classifyRemotePairingHostname: that
// helper answers a display question and accepts anything starting with `127.`, which
// as a string test also admits `127.evil.example.com`. This one gates which sockets a
// paired client may reach on the host, so it is a strict allowlist of literal loopback
// forms and fails closed on anything it does not recognise.

const IPV4_MAPPED_PREFIX = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/
const IPV6_LOOPBACK = new Set(['::1', '0:0:0:0:0:0:0:1'])

function isLoopbackIPv4(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4) {
    return false
  }
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return false
    }
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet > 255) {
      return false
    }
  }
  // Why the whole /8: dev servers and OAuth callbacks bind across 127.0.0.0/8,
  // not only 127.0.0.1.
  return Number(parts[0]) === 127
}

/**
 * True only for addresses that cannot leave the host they resolve on.
 *
 * `0.0.0.0` is deliberately rejected: as a connect target its meaning is
 * platform-dependent, and a wildcard-bound listener is reachable directly and so
 * never needs a forward. Subdomains of `localhost` are rejected too — RFC 6761
 * points them at loopback but resolver behaviour varies, and a wrong answer here
 * opens a hole rather than merely failing.
 */
export function isLoopbackForwardDestination(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  if (normalized === 'localhost') {
    return true
  }
  if (IPV6_LOOPBACK.has(normalized)) {
    return true
  }
  const mapped = IPV6_LOOPBACK.has(normalized) ? null : IPV4_MAPPED_PREFIX.exec(normalized)
  return isLoopbackIPv4(mapped ? mapped[1] : normalized)
}

export function isForwardablePort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535
}

import type { Agent } from 'node:http'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { ProxyAgent, type Dispatcher } from 'undici'
import { defaultProxySession, type ProxySession } from './electron-default-proxy-session'
import { getElectronProxyCredentialsForSession } from './electron-proxy-credentials'
import { resolveProxyPolicyWithoutSession } from './proxy-policy-resolution'

/**
 * The proxy that main-process Node-side connections — WebSocket sockets and the
 * Chromium-less fetch fallback — must tunnel through for a given target.
 *
 * Chromium owns the policy: app Settings, then proxy env vars, then the system
 * proxy, including the bypass list. `session.resolveProxy` is therefore the only
 * authority the desktop consults; the env policy is used solely on a host with no
 * Chromium session (a Node host has no other source and no bypass matcher, so it
 * applies the env proxy to every non-loopback target).
 *
 * Only a plain HTTP proxy can be tunnelled here: HTTPS-proxy and SOCKS rules from
 * the resolver are deliberately left direct, matching what those transports did
 * before this existed rather than sending them somewhere they cannot reach.
 */

const DEFAULT_PROXY_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443'
}

function normalizedHostname(url: URL | string): string {
  return (typeof url === 'string' ? url : url.hostname).replace(/^\[|\]$/g, '').toLowerCase()
}

function isLoopbackHost(url: URL): boolean {
  const host = normalizedHostname(url)
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

/** Chromium's proxy resolver is asked about the http(s) sibling of a ws(s) target. */
function proxyProbeUrl(targetUrl: string): string {
  const url = new URL(targetUrl)
  if (url.protocol === 'wss:') {
    url.protocol = 'https:'
  } else if (url.protocol === 'ws:') {
    url.protocol = 'http:'
  }
  return url.toString()
}

function proxyUrlFromRules(rules: string): string | null {
  for (const rule of rules.split(';')) {
    const match = /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5|QUIC)\s+(\S+)$/i.exec(rule.trim())
    if (match && match[1]!.toUpperCase() === 'PROXY') {
      return `http://${match[2]}`
    }
  }
  return null
}

/**
 * Chromium answers with the proxy it would use but without credentials, which it
 * supplies on the auth challenge instead. A Node socket has no such hook, so the
 * credentials the same settings produced are attached when host and port match.
 * Returns null for a rule value that is not a usable proxy, which resolves as direct.
 */
function withProxyCredentials(
  proxyUrl: string,
  proxySession: ProxySession | null,
  credentials: ReturnType<typeof getElectronProxyCredentialsForSession>
): string | null {
  let url: URL
  try {
    url = new URL(proxyUrl)
  } catch {
    return null
  }
  if (!proxySession || !credentials) {
    return proxyUrl
  }
  const port = url.port || DEFAULT_PROXY_PORTS[url.protocol] || ''
  if (
    normalizedHostname(url) !== normalizedHostname(credentials.host) ||
    Number(port) !== credentials.port
  ) {
    return proxyUrl
  }
  url.username = encodeURIComponent(credentials.username)
  url.password = encodeURIComponent(credentials.password)
  return `${url.protocol}//${url.username}:${url.password}@${url.host}`
}

export async function resolveOutboundProxyUrl(targetUrl: string): Promise<string | null> {
  const probeUrl = proxyProbeUrl(targetUrl)
  // Chromium implicitly bypasses loopback unless the list asks otherwise; local
  // relay cells and dev servers must keep working with a proxy configured.
  if (isLoopbackHost(new URL(probeUrl))) {
    return null
  }
  const proxySession = defaultProxySession()
  if (proxySession) {
    const credentials = getElectronProxyCredentialsForSession(proxySession)
    const resolved = proxyUrlFromRules(await proxySession.resolveProxy(probeUrl))
    return resolved === null ? null : withProxyCredentials(resolved, proxySession, credentials)
  }
  const policy = resolveProxyPolicyWithoutSession({}, process.env)
  return policy.source === 'env' ? policy.proxyRules : null
}

const socketAgentsByProxyUrl = new Map<string, Agent>()
const dispatchersByProxyUrl = new Map<string, Dispatcher>()

/** A socket agent for the relay's WebSocket connections, or undefined to go direct. */
export async function outboundProxySocketAgent(targetUrl: string): Promise<Agent | undefined> {
  const proxyUrl = await resolveOutboundProxyUrl(targetUrl)
  if (!proxyUrl) {
    return undefined
  }
  let agent = socketAgentsByProxyUrl.get(proxyUrl)
  if (!agent) {
    // CONNECT-tunnels ws:// and wss:// alike, so one agent serves both.
    agent = new HttpsProxyAgent(proxyUrl)
    socketAgentsByProxyUrl.set(proxyUrl, agent)
  }
  return agent
}

/** The dispatcher for the Node fetch fallback, or undefined to go direct. */
export async function outboundProxyFetchDispatcher(
  targetUrl: string
): Promise<Dispatcher | undefined> {
  const proxyUrl = await resolveOutboundProxyUrl(targetUrl)
  if (!proxyUrl) {
    return undefined
  }
  let dispatcher = dispatchersByProxyUrl.get(proxyUrl)
  if (!dispatcher) {
    dispatcher = new ProxyAgent({ uri: proxyUrl })
    dispatchersByProxyUrl.set(proxyUrl, dispatcher)
  }
  return dispatcher
}

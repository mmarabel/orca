import { describe, expect, it } from 'vitest'
import { isForwardablePort, isLoopbackForwardDestination } from './loopback-forward-destination'

describe('isLoopbackForwardDestination', () => {
  it('accepts the literal loopback forms a dev server or OAuth callback binds', () => {
    expect(isLoopbackForwardDestination('localhost')).toBe(true)
    expect(isLoopbackForwardDestination('127.0.0.1')).toBe(true)
    expect(isLoopbackForwardDestination('::1')).toBe(true)
    expect(isLoopbackForwardDestination('[::1]')).toBe(true)
    expect(isLoopbackForwardDestination('0:0:0:0:0:0:0:1')).toBe(true)
    expect(isLoopbackForwardDestination('::ffff:127.0.0.1')).toBe(true)
  })

  it('accepts the whole 127.0.0.0/8 range, not just 127.0.0.1', () => {
    expect(isLoopbackForwardDestination('127.0.0.53')).toBe(true)
    expect(isLoopbackForwardDestination('127.1.2.3')).toBe(true)
    expect(isLoopbackForwardDestination('127.255.255.255')).toBe(true)
  })

  it('normalises case, surrounding brackets and a trailing dot', () => {
    expect(isLoopbackForwardDestination('  LocalHost ')).toBe(true)
    expect(isLoopbackForwardDestination('localhost.')).toBe(true)
    expect(isLoopbackForwardDestination('[::FFFF:127.0.0.1]')).toBe(true)
  })

  it('refuses names that merely start with a loopback-looking prefix', () => {
    // Regression: a `startsWith('127.')` test would admit every one of these.
    expect(isLoopbackForwardDestination('127.evil.example.com')).toBe(false)
    expect(isLoopbackForwardDestination('127.0.0.1.evil.example.com')).toBe(false)
    expect(isLoopbackForwardDestination('localhost.evil.example.com')).toBe(false)
    expect(isLoopbackForwardDestination('notlocalhost')).toBe(false)
  })

  it('refuses subdomains of localhost, whose resolution is not guaranteed', () => {
    expect(isLoopbackForwardDestination('app.localhost')).toBe(false)
    expect(isLoopbackForwardDestination('foo.orca.localhost')).toBe(false)
  })

  it('refuses routable, wildcard and malformed addresses', () => {
    expect(isLoopbackForwardDestination('0.0.0.0')).toBe(false)
    expect(isLoopbackForwardDestination('::')).toBe(false)
    expect(isLoopbackForwardDestination('100.64.1.20')).toBe(false)
    expect(isLoopbackForwardDestination('192.168.1.5')).toBe(false)
    expect(isLoopbackForwardDestination('10.0.0.1')).toBe(false)
    expect(isLoopbackForwardDestination('169.254.169.254')).toBe(false)
    expect(isLoopbackForwardDestination('example.com')).toBe(false)
    expect(isLoopbackForwardDestination('')).toBe(false)
    expect(isLoopbackForwardDestination('127.0.0')).toBe(false)
    expect(isLoopbackForwardDestination('127.0.0.256')).toBe(false)
    expect(isLoopbackForwardDestination('127.0.0.01x')).toBe(false)
  })
})

describe('isForwardablePort', () => {
  it('accepts the usable TCP range', () => {
    expect(isForwardablePort(1)).toBe(true)
    expect(isForwardablePort(4322)).toBe(true)
    expect(isForwardablePort(65535)).toBe(true)
  })

  it('refuses out-of-range and non-integer ports', () => {
    expect(isForwardablePort(0)).toBe(false)
    expect(isForwardablePort(-1)).toBe(false)
    expect(isForwardablePort(65536)).toBe(false)
    expect(isForwardablePort(1.5)).toBe(false)
    expect(isForwardablePort(Number.NaN)).toBe(false)
  })
})

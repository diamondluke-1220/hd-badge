// The one client-IP rule: forwarded headers count only from a trusted proxy.

import { describe, it, expect } from 'bun:test';
import { resolveClientIp, isLocalhost, parseTrustedProxies } from '../../src/client-ip';

const behindProxy = { trustProxy: true, trustedProxies: parseTrustedProxies('172.20.0.') };
const headers = (h: Record<string, string>) => (name: string) => h[name];

describe('resolveClientIp', () => {
  it('uses cf-connecting-ip from a trusted proxy', () => {
    expect(resolveClientIp('172.20.0.11', headers({ 'cf-connecting-ip': '203.0.113.7' }), behindProxy)).toBe('203.0.113.7');
  });

  it('accepts the proxy address in IPv4-mapped IPv6 form', () => {
    expect(resolveClientIp('::ffff:172.20.0.11', headers({ 'cf-connecting-ip': '203.0.113.7' }), behindProxy)).toBe('203.0.113.7');
  });

  it('falls back to the first X-Forwarded-For hop, then X-Real-IP, then the peer', () => {
    expect(resolveClientIp('172.20.0.11', headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }), behindProxy)).toBe('198.51.100.1');
    expect(resolveClientIp('172.20.0.11', headers({ 'x-real-ip': '198.51.100.2' }), behindProxy)).toBe('198.51.100.2');
    expect(resolveClientIp('172.20.0.11', headers({}), behindProxy)).toBe('172.20.0.11');
  });

  it('ignores forwarded headers from a peer outside the trusted list', () => {
    expect(resolveClientIp('192.168.1.5', headers({ 'cf-connecting-ip': '203.0.113.7' }), behindProxy)).toBe('192.168.1.5');
  });

  it('ignores forwarded headers entirely when proxy trust is off', () => {
    expect(resolveClientIp('172.20.0.11', headers({ 'cf-connecting-ip': '203.0.113.7' }), { ...behindProxy, trustProxy: false })).toBe('172.20.0.11');
  });

  it('a prefix needs its trailing dot to match, and an exact entry matches only itself', () => {
    const exact = { trustProxy: true, trustedProxies: parseTrustedProxies('10.0.0.5, 172.20.0.') };
    expect(resolveClientIp('10.0.0.5', headers({ 'cf-connecting-ip': 'A' }), exact)).toBe('A');
    expect(resolveClientIp('10.0.0.50', headers({ 'cf-connecting-ip': 'A' }), exact)).toBe('10.0.0.50');
    expect(resolveClientIp('172.20.01.5', headers({ 'cf-connecting-ip': 'A' }), exact)).toBe('172.20.01.5');
  });

  it('trusts loopback peers with no list set', () => {
    expect(resolveClientIp('127.0.0.1', headers({ 'cf-connecting-ip': 'A' }), { trustProxy: true, trustedProxies: [] })).toBe('A');
  });
});

describe('isLocalhost', () => {
  it('knows IPv4, IPv6 and mapped loopback', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']) expect(isLocalhost(ip)).toBe(true);
    expect(isLocalhost('172.20.0.11')).toBe(false);
  });
});

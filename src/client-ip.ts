// Works out which client a request came from, for rate limits, the admin
// lockout and the live-stream caps.
//
// Forwarding headers count only when the socket peer is a trusted proxy. The
// container's port is also reachable directly from the LAN, and a direct client
// can set any header it likes; trusting it would give that client a fresh
// rate-limit and admin-lockout key on every request.

export interface ProxyTrust {
  /** TRUST_PROXY=1: read the client address from forwarding headers at all. */
  trustProxy: boolean;
  /** Exact addresses, or prefixes ending in '.' or ':', whose headers count. Loopback always counts. */
  trustedProxies: string[];
}

/** Splits a TRUSTED_PROXY_IPS value ("172.20.0., 10.0.0.5") into entries. */
export function parseTrustedProxies(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/** IPv4, IPv6 and IPv4-mapped loopback. */
export function isLocalhost(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

/** Bun reports IPv4 peers on a dual-stack socket as ::ffff:a.b.c.d; returns plain a.b.c.d for those, anything else unchanged. */
export function unmapIPv4(ip: string): string {
  return ip.replace(/^::ffff:(?=\d{1,3}(\.\d{1,3}){3}$)/i, '');
}

function isTrustedProxy(peer: string, trustedProxies: string[]): boolean {
  if (isLocalhost(peer)) return true;
  return trustedProxies.some(entry =>
    entry.endsWith('.') || entry.endsWith(':') ? peer.startsWith(entry) : peer === entry
  );
}

/**
 * The client address for a request: the forwarded address when the socket
 * peer is a trusted proxy (cf-connecting-ip, then the first X-Forwarded-For
 * hop, then X-Real-IP), otherwise the peer itself.
 */
export function resolveClientIp(
  rawPeer: string,
  header: (name: string) => string | null | undefined,
  trust: ProxyTrust,
): string {
  const peer = unmapIPv4(rawPeer);
  if (trust.trustProxy && isTrustedProxy(peer, trust.trustedProxies)) {
    return header('cf-connecting-ip')
      || header('x-forwarded-for')?.split(',')[0]?.trim()
      || header('x-real-ip')
      || peer;
  }
  return peer;
}

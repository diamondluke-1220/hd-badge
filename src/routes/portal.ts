// ─── Captive Portal Routes ────────────────────────────────
// OS-level connectivity checks + portal clearance.

import type { Hono } from 'hono';

interface PortalDeps {
  getClientIp: (c: any) => string;
  portalCleared: Set<string>;
  markPortalCleared: (ip: string) => void;
}

export function registerPortalRoutes(app: Hono, deps: PortalDeps) {
  const { getClientIp, portalCleared, markPortalCleared } = deps;

  // ─── Captive Portal Detection ────────────────────────────
  // OS-level connectivity checks. Two-phase approach:
  //
  // Phase 1 (initial connect): Return "wrong" response → OS opens captive portal
  //   mini-browser → fan sees badge generator.
  //
  // Phase 2 (after badge created): Fan hits "Done" or OS re-checks connectivity.
  //   We return the "correct" success responses so the OS stays connected.

  // iOS / macOS
  app.get('/hotspot-detect.html', (c) => {
    const ip = getClientIp(c);
    if (portalCleared.has(ip)) {
      return c.text('Success');
    }
    return c.redirect('/');
  });

  // Android (Google + Samsung)
  app.get('/generate_204', (c) => {
    const ip = getClientIp(c);
    if (portalCleared.has(ip)) {
      return new Response(null, { status: 204 });
    }
    return c.redirect('/');
  });
  app.get('/gen_204', (c) => {
    const ip = getClientIp(c);
    if (portalCleared.has(ip)) {
      return new Response(null, { status: 204 });
    }
    return c.redirect('/');
  });

  // Windows
  app.get('/connecttest.txt', (c) => {
    const ip = getClientIp(c);
    if (portalCleared.has(ip)) {
      return c.text('Microsoft Connect Test');
    }
    return c.redirect('/');
  });
  app.get('/ncsi.txt', (c) => {
    const ip = getClientIp(c);
    if (portalCleared.has(ip)) {
      return c.text('Microsoft NCSI');
    }
    return c.redirect('/');
  });

  // Firefox
  app.get('/success.txt', (c) => {
    const ip = getClientIp(c);
    if (portalCleared.has(ip)) {
      return c.text('success\n');
    }
    return c.redirect('/');
  });

  // ─── Captive Portal Clearance ────────────────────────────
  // Client-side JS calls this on page load to clear the portal for this device.
  app.post('/api/portal/clear', (c) => {
    const ip = getClientIp(c);
    markPortalCleared(ip);
    return c.json({ cleared: true });
  });
}

// Help Desk Badge Generator — server entry point.
// Reads settings from the environment, prepares ./data and the database,
// starts the render pool and the live stream, builds the app (src/app.ts),
// pre-renders the print assets and serves on PORT.

import type { Server } from 'bun';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { initDb, closeDb, listAllBadgeIds } from './db';
import { log, errorMessage } from './logger';
import { initDemo } from './demo';
import { initPresentation } from './presentation';
import { isShowMode } from './rate-limit';
import { sweepOrphanFiles } from './badge-files';
import { parseTrustedProxies, type ProxyTrust } from './client-ip';
import { createRenderPool } from './render-pool';
import { createLiveStream } from './live-stream';
import { createApp } from './app';

// ─── Settings ───────────────────────────────────────────

const port = Number(process.env.PORT) || 3000;
const DATA_DIR = './data';
const dirs = {
  PHOTOS_DIR: join(DATA_DIR, 'photos'),
  BADGES_DIR: join(DATA_DIR, 'badges'),
  THUMBS_DIR: join(DATA_DIR, 'thumbs'),
  HEADSHOTS_DIR: join(DATA_DIR, 'headshots'),
  PRINTS_DIR: join(DATA_DIR, 'prints'),
};
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

/**
 * Peers whose forwarding headers count. TRUSTED_PROXY_IPS lists the
 * address(es) the reverse proxy connects from: comma-separated exact IPs, or
 * a prefix ending in '.' or ':' such as "172.17." for a Docker bridge subnet.
 * When TRUST_PROXY=1 and this is unset, only loopback peers are trusted.
 */
const TRUSTED_PROXY_IPS = parseTrustedProxies(process.env.TRUSTED_PROXY_IPS || '');

/** TRUST_PROXY is read on every request, TRUSTED_PROXY_IPS once at startup. */
function proxyTrust(): ProxyTrust {
  return { trustProxy: process.env.TRUST_PROXY === '1', trustedProxies: TRUSTED_PROXY_IPS };
}

// ─── Data ───────────────────────────────────────────────

for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
initDb(join(DATA_DIR, 'badges.db'));

// Files left behind by badges that no longer exist
{
  const orphanCount = sweepOrphanFiles(dirs, listAllBadgeIds());
  if (orphanCount > 0) {
    console.log(`🧹 Cleaned ${orphanCount} orphaned file${orphanCount !== 1 ? 's' : ''} from data directories`);
  }
}

// ─── Services and app ───────────────────────────────────

const renderPool = createRenderPool({ photosDir: dirs.PHOTOS_DIR, port });
const liveStream = createLiveStream();

initDemo({ broadcast: liveStream.broadcastNewBadge, writeFile: writeFileSync, badgesDir: dirs.BADGES_DIR });
initPresentation({ broadcast: liveStream.broadcastSSE });

const badgeApp = createApp({
  ...dirs,
  THUMB_WIDTH: 320,
  HEADSHOT_WIDTH: 200,
  adminToken: ADMIN_TOKEN,
  adminLocalOnly: () => process.env.ADMIN_LOCAL_ONLY === '1',
  proxyTrust,
  renderBadgePlaywright: renderPool.renderBadge,
  renderPageScreenshot: renderPool.renderPageScreenshot,
  broadcastNewBadge: liveStream.broadcastNewBadge,
  broadcastSSE: liveStream.broadcastSSE,
  connectLiveStream: liveStream.connect,
});

// Stale admin-auth failures are forgotten every 30 minutes
setInterval(badgeApp.pruneAdminFailures, 30 * 60 * 1000);

// ─── Startup messages ───────────────────────────────────

log('info', 'server', `Started on port ${port} (admin=${ADMIN_TOKEN ? 'enabled' : 'disabled'}, local_only=${process.env.ADMIN_LOCAL_ONLY || '0'}, show_mode=${process.env.SHOW_MODE || '0'})`);
console.log(`🎫 Help Desk Badge Generator running at http://localhost:${port}`);
if (process.env.TRUST_PROXY === '1' && TRUSTED_PROXY_IPS.length === 0) {
  console.warn(
    '⚠️  TRUST_PROXY=1 but TRUSTED_PROXY_IPS is unset — forwarding headers are ' +
    'honored from loopback peers only. If the reverse proxy reaches this app ' +
    'from another address, set TRUSTED_PROXY_IPS to it (e.g. TRUSTED_PROXY_IPS=172.17.) ' +
    'or every client behind it will share one rate-limit key.'
  );
}
if (ADMIN_TOKEN) {
  console.log(`🔐 Admin panel: http://localhost:${port}/admin`);
  console.log(`📺 Presentation: http://localhost:${port}/presentation`);
} else {
  console.log(`⚠️  No ADMIN_TOKEN set — admin panel disabled`);
}
if (isShowMode()) {
  console.log(`🎸 SHOW MODE active — relaxed rate limits (300/hr, 800/day)`);
}

// ─── Print assets ───────────────────────────────────────
// The K-layer front and the badge back are the same for every badge, so they
// are rendered once at startup.
(async () => {
  try {
    const klayerPath = join(dirs.PRINTS_DIR, 'klayer-front.png');
    const backPath = join(dirs.PRINTS_DIR, 'badge-back.png');
    // The K-layer hides all variable content, so the first band badge serves as the template.
    const placeholderBadge = { employee_id: 'HD-00001', name: 'Template', department: '', title: '' };
    const klayerBuf = await renderPool.renderBadge(placeholderBadge, { klayer: true });
    writeFileSync(klayerPath, klayerBuf);
    log('info', 'server', `Pre-rendered K-layer front → ${klayerPath}`);

    const backBuf = await renderPool.renderPageScreenshot('/badge-back.html', '#card');
    writeFileSync(backPath, backBuf);
    log('info', 'server', `Pre-rendered badge back → ${backPath}`);

    console.log(`🖨️  Print assets ready in ${dirs.PRINTS_DIR}`);
  } catch (e) {
    log('error', 'server', `Failed to pre-render print assets: ${errorMessage(e)}`);
  }
})();

// ─── Shutdown ───────────────────────────────────────────

process.on('SIGTERM', async () => { await renderPool.close(); closeDb(); process.exit(0); });
process.on('SIGINT', async () => { await renderPool.close(); closeDb(); process.exit(0); });

export default {
  port,
  idleTimeout: 120,
  fetch(req: Request, server: Server<unknown>): Response | Promise<Response> {
    return badgeApp.fetch(req, server);
  },
};

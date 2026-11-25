// Security checks against the real server.ts middleware, booted in a child
// process by tests/helpers/real-server.ts. Covers rules that the setup.ts
// mirror cannot see: the request body cap and the live-stream (SSE) per-IP cap.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import type { Subprocess } from 'bun';

const REPO = resolve(import.meta.dir, '../..');
const PROXY_PEER = '172.20.0.5';
const DIRECT_PEER = '192.168.1.5';

let child: Subprocess<'ignore', 'pipe', 'pipe'>;
let workDir: string;
let baseUrl: string;

async function waitForReady(proc: typeof child): Promise<number> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
    const match = seen.match(/READY (\d+)/);
    if (match) {
      reader.releaseLock();
      return Number(match[1]);
    }
  }
  throw new Error(`real server did not start:\n${seen}`);
}

/** Open an SSE stream and return its status plus a way to close it. */
async function openStream(peer: string, clientIp: string) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/badges/stream`, {
    headers: { 'x-test-peer': peer, 'cf-connecting-ip': clientIp },
    signal: controller.signal,
  });
  return { status: res.status, close: () => controller.abort() };
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'hdbadge-real-'));
  symlinkSync(join(REPO, 'public'), join(workDir, 'public'));
  child = Bun.spawn(['bun', join(REPO, 'tests/helpers/real-server.ts')], {
    cwd: workDir,
    env: {
      ...process.env,
      HDBADGE_REPO: REPO,
      TRUST_PROXY: '1',
      TRUSTED_PROXY_IPS: '172.20.0.',
      ADMIN_TOKEN: 'real-server-test-token',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const port = await waitForReady(child);
  baseUrl = `http://127.0.0.1:${port}`;
}, 30_000);

afterAll(() => {
  child?.kill();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('request body cap (real server)', () => {
  it('refuses a body over 10 MB sent with Content-Length', async () => {
    const body = JSON.stringify({ name: 'X', pad: 'a'.repeat(11 * 1024 * 1024) });
    const res = await fetch(`${baseUrl}/api/badge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(413);
  });

  it('refuses a body over 10 MB sent chunked, with no Content-Length', async () => {
    const chunk = new TextEncoder().encode('a'.repeat(1024 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) controller.enqueue(new TextEncoder().encode('{"pad":"'));
        if (sent < 12) {
          controller.enqueue(chunk);
          sent++;
        } else {
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        }
      },
    });
    const res = await fetch(`${baseUrl}/api/badge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      // @ts-expect-error Bun accepts duplex for streamed request bodies
      duplex: 'half',
    });
    expect(res.status).toBe(413);
  });
});

describe('live stream per-IP cap (real server)', () => {
  it('keys a direct client by its socket address, ignoring a forged cf-connecting-ip', async () => {
    const streams: Awaited<ReturnType<typeof openStream>>[] = [];
    try {
      for (let i = 0; i < 51; i++) {
        streams.push(await openStream(DIRECT_PEER, `203.0.113.${i}`));
      }
      const statuses = streams.map(s => s.status);
      expect(statuses.slice(0, 50).every(s => s === 200)).toBe(true);
      expect(statuses[50]).toBe(429);
    } finally {
      streams.forEach(s => s.close());
    }
  });

  it('keys visitors behind the trusted proxy by their forwarded address', async () => {
    const streams: Awaited<ReturnType<typeof openStream>>[] = [];
    try {
      for (let i = 0; i < 51; i++) {
        streams.push(await openStream(PROXY_PEER, `198.51.100.${i}`));
      }
      expect(streams.every(s => s.status === 200)).toBe(true);
    } finally {
      streams.forEach(s => s.close());
    }
  });
});

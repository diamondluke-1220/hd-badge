// Starts tests/helpers/real-server.ts in a child process with a temp working
// directory and returns its base URL and a stop function.

import { mkdtempSync, rmSync, symlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const REPO = resolve(import.meta.dir, '../..');

export async function spawnRealServer(env: Record<string, string>) {
  const workDir = mkdtempSync(join(tmpdir(), 'hdbadge-real-'));
  symlinkSync(join(REPO, 'public'), join(workDir, 'public'));
  const child = Bun.spawn(['bun', join(REPO, 'tests/helpers/real-server.ts')], {
    cwd: workDir,
    env: { ...process.env, HDBADGE_REPO: REPO, ...env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const deadline = Date.now() + 20_000;
  let port = 0;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
    const match = seen.match(/READY (\d+)/);
    if (match) { port = Number(match[1]); break; }
  }
  reader.releaseLock();
  if (!port) {
    child.kill();
    throw new Error(`real server did not start:\n${seen}`);
  }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop() {
      child.kill();
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

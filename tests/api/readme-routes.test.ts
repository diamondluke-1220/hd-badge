// Every route the server registers appears in the README's API tables.

import { describe, it, expect } from 'bun:test';
import { resolve } from 'path';

const REPO = resolve(import.meta.dir, '../..');
const SOURCES = ['src/server.ts', 'src/routes/public.ts', 'src/routes/admin.ts'];

async function codeRoutes(): Promise<string[]> {
  const routes = new Set<string>();
  for (const file of SOURCES) {
    const text = await Bun.file(`${REPO}/${file}`).text();
    for (const m of text.matchAll(/app\.(get|post|put|delete)\('([^']+)'/g)) {
      routes.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
    for (const m of text.matchAll(/url\.pathname === '([^']+)'/g)) {
      routes.add(`GET ${m[1]}`);
    }
  }
  return [...routes].sort();
}

async function readmeRoutes(): Promise<Set<string>> {
  const text = await Bun.file(`${REPO}/README.md`).text();
  const routes = new Set<string>();
  for (const m of text.matchAll(/^\| `([^`]+)` \| (GET|POST|PUT|DELETE) \|/gm)) {
    routes.add(`${m[2]} ${m[1]}`);
  }
  return routes;
}

describe('README API tables', () => {
  it('list every registered route', async () => {
    const documented = await readmeRoutes();
    const missing = (await codeRoutes()).filter(r => !documented.has(r));
    expect(missing).toEqual([]);
  });

  it('list no route the server does not register', async () => {
    const registered = new Set(await codeRoutes());
    const stale = [...(await readmeRoutes())].filter(r => !registered.has(r));
    expect(stale).toEqual([]);
  });
});

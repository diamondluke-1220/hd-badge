// Boots the real src/server.ts app for tests that must exercise its own
// middleware (body limit, client-IP rules, SSE limits) instead of the mirror
// in setup.ts.
//
// Run as a child process with its working directory set to a temp folder that
// holds a `public` symlink; server.ts creates ./data there. Each request's
// socket peer is taken from the `x-test-peer` header (default 127.0.0.1), so a
// test can play a trusted proxy or an untrusted direct client. Prints
// `READY <port>` on stdout once listening.

const serverModule = await import(`${process.env.HDBADGE_REPO}/src/server.ts`);
const appHandler = serverModule.default;

const listener = Bun.serve({
  port: 0,
  idleTimeout: 30,
  maxRequestBodySize: 64 * 1024 * 1024,
  fetch(req) {
    const peer = req.headers.get('x-test-peer') || '127.0.0.1';
    const fakeServer = { requestIP: () => ({ address: peer, family: 'IPv4', port: 40000 }) };
    return appHandler.fetch(req, fakeServer);
  },
});

console.log(`READY ${listener.port}`);

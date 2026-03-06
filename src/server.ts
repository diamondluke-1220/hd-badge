import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';

const app = new Hono();

// Serve static files from public/
app.use('/*', serveStatic({ root: './public' }));

// Fallback to index.html for SPA-style routing
app.get('/', serveStatic({ path: './public/index.html' }));

const port = Number(process.env.PORT) || 3000;

console.log(`🎫 Help Desk Badge Generator running at http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

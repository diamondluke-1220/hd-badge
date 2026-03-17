import { test, expect } from '@playwright/test';

test.describe('SSE Connectivity', () => {
  test('SSE endpoint responds with event stream', async ({ request }) => {
    const res = await request.get('/api/badges/stream');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/event-stream');
  });

  test('SSE sends connected event on connect', async ({ request }) => {
    const res = await request.get('/api/badges/stream');
    const body = await res.text();
    expect(body).toContain('event: connected');
    expect(body).toContain('data: connected');
  });

  test('SSE endpoint exists and is accessible', async ({ page }) => {
    // Verify from browser context that EventSource can connect
    const connected = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const es = new EventSource('/api/badges/stream');
        const timeout = setTimeout(() => {
          es.close();
          resolve(false);
        }, 5000);
        es.addEventListener('connected', () => {
          clearTimeout(timeout);
          es.close();
          resolve(true);
        });
        es.onerror = () => {
          clearTimeout(timeout);
          es.close();
          resolve(false);
        };
      });
    });
    expect(connected).toBe(true);
  });
});

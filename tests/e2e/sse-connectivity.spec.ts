import { test, expect } from '@playwright/test';

test.describe('SSE Connectivity', () => {
  test('SSE endpoint responds with event stream headers', async ({ page, baseURL }) => {
    await page.goto('/');
    const result = await page.evaluate(async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(`${url}/api/badges/stream`, { signal: controller.signal });
        clearTimeout(timeout);
        const contentType = res.headers.get('content-type') || '';
        const reader = res.body?.getReader();
        let chunk = '';
        if (reader) {
          const { value } = await reader.read();
          chunk = new TextDecoder().decode(value);
          reader.cancel();
        }
        return { status: res.status, contentType, chunk };
      } catch (e: any) {
        clearTimeout(timeout);
        return { status: 0, contentType: '', chunk: '', error: e.message };
      }
    }, baseURL);
    expect(result.status).toBe(200);
    expect(result.contentType).toContain('text/event-stream');
  });

  test('SSE sends connected event on connect', async ({ page, baseURL }) => {
    await page.goto('/');
    const connected = await page.evaluate(async (url) => {
      return new Promise<boolean>((resolve) => {
        const es = new EventSource(`${url}/api/badges/stream`);
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
    }, baseURL);
    expect(connected).toBe(true);
  });
});

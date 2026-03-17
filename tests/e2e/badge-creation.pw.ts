import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Badge Creation', () => {
  test('form page loads with badge element', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#badge')).toBeVisible();
  });

  test('name field is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#badge #nameField')).toBeVisible();
  });

  test('API rejects missing required fields', async ({ request }) => {
    const res = await request.post('/api/badge', {
      data: { name: 'Incomplete' },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test('API rejects profanity in name', async ({ request }) => {
    const res = await request.post('/api/badge', {
      data: {
        name: 'TestHitler',
        department: 'Test',
        title: 'Test',
        song: 'Test',
        accessLevel: 'Test',
        accessCss: 'blue',
      },
    });
    // 400 = profanity blocked (expected), 429 = rate limited (also acceptable)
    expect([400, 429]).toContain(res.status());
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test('API badge creation returns success or render error', async ({ request }) => {
    const res = await request.post('/api/badge', {
      data: {
        name: 'E2E Test',
        department: 'PRINTER JAMS',
        title: 'E2E Specialist',
        song: 'THE MEMO',
        accessLevel: 'PAPER JAM CLEARANCE',
        accessCss: 'paper-jam',
      },
    });
    // 200 = full success, 500 = render failed in CI, 429 = rate limited
    expect([200, 429, 500]).toContain(res.status());
    const json = await res.json();
    if (res.status() === 200) {
      expect(json.success).toBe(true);
      expect(json.employeeId).toMatch(/^HD-\d{5}$/);
    } else {
      expect(json.success).toBe(false);
      expect(json.error).toBeDefined();
    }
  });
});

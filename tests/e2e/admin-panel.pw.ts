import { test, expect } from '@playwright/test';

const ADMIN_TOKEN = 'test-e2e-token';

test.describe('Admin Panel', () => {
  test('admin page loads', async ({ page }) => {
    await page.goto('/admin');
    // Admin page should load (may show auth prompt or dashboard)
    await expect(page).toHaveURL(/admin/);
  });

  test('admin API returns badges', async ({ request }) => {
    const res = await request.get('/api/admin/badges', {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.badges).toBeTruthy();
    expect(Array.isArray(json.badges)).toBe(true);
  });

  test('band members present in admin badge list', async ({ request }) => {
    const res = await request.get('/api/admin/badges', {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    });
    const json = await res.json();
    const bandMembers = json.badges.filter((b: any) => b.isBandMember);
    expect(bandMembers.length).toBe(5);
  });
});

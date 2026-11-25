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

test.describe('Admin Panel escaping', () => {
  const hostile = '"></SELECT><H1 ID=PWN>X';

  test('department and division names render as text, never as markup', async ({ page }) => {
    await page.addInitScript(token => sessionStorage.setItem('admin-token', token), ADMIN_TOKEN);
    await page.route('**/api/admin/stats', route => route.fulfill({
      json: { total: 1, today: 1, flagged: 0, byDepartment: { [hostile]: 1 } },
    }));
    await page.route('**/api/admin/divisions', route => route.fulfill({
      json: { divisions: [hostile] },
    }));

    await page.goto('/admin');
    await expect(page.locator('#deptFilter option')).toHaveCount(2);
    await expect(page.locator('#divisionFilter option')).toHaveCount(2);

    expect(await page.locator('#PWN, #pwn').count()).toBe(0);
    await expect(page.locator('#deptFilter option').nth(1)).toHaveText(`${hostile} (1)`);
    await expect(page.locator('#divisionFilter option').nth(1)).toHaveText(hostile);
    expect(await page.locator('#deptFilter option').nth(1).getAttribute('value')).toBe(hostile);
  });

  test('a badge name cannot break out of the preview or delete click handlers', async ({ page }) => {
    const breakout = "X'),window.PWNED=1,('";
    await page.addInitScript(token => sessionStorage.setItem('admin-token', token), ADMIN_TOKEN);
    await page.route('**/api/admin/badges?*', route => route.fulfill({
      json: {
        badges: [{ employeeId: 'HD-99999', name: breakout, department: 'QA', title: 'T', isVisible: true }],
        total: 1, page: 1, pages: 1,
      },
    }));

    await page.goto('/admin');
    await page.locator('button[title="Preview badge"]').first().click();
    expect(await page.evaluate(() => (window as any).PWNED)).toBeUndefined();
    await expect(page.locator('#previewModal')).toContainText(breakout);
    await page.evaluate(() => document.getElementById('previewModal')?.remove());

    await page.locator('button[title="Delete"]').first().click();
    await expect(page.locator('.confirm-overlay .delete-name')).toHaveText(breakout);
    expect(await page.evaluate(() => (window as any).PWNED)).toBeUndefined();
  });
});

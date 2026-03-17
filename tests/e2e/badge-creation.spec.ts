import { test, expect } from '@playwright/test';

test.describe('Badge Creation', () => {
  test('form page loads with badge element', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#badge')).toBeVisible();
  });

  test('name field is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#nameField')).toBeVisible();
  });

  test('API badge creation returns employeeId', async ({ request }) => {
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
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.employeeId).toMatch(/^HD-\d{5}$/);
  });

  test('created badge retrievable via API', async ({ request }) => {
    const createRes = await request.post('/api/badge', {
      data: {
        name: 'E2E Retrieve',
        department: 'WATERCOOLER SERVICES',
        title: 'Hydration Specialist',
        song: 'UN-PTO',
        accessLevel: 'WATERCOOLER ACCESS',
        accessCss: 'watercooler',
      },
    });
    const { employeeId } = await createRes.json();

    const getRes = await request.get(`/api/badge/${employeeId}`);
    expect(getRes.status()).toBe(200);
    const badge = await getRes.json();
    expect(badge.name).toBe('E2E RETRIEVE');
  });
});

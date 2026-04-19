import { test, expect } from '@playwright/test';

const BOM_URL = 'https://madisonmagazine.secondstreetapp.com/Best-of-Madison-2026/gallery?category=5791127&group=535264';

// Intercepts /api/site-config and returns voteBannerActive: true so the banner
// renders regardless of the current date or the server's BOM_VOTE_OVERRIDE env.
async function forceBannerActive(page: import('@playwright/test').Page) {
  await page.route('**/api/site-config', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ voteBannerActive: true }),
    });
  });
}

test.describe('Vote Banner', () => {
  test.beforeEach(async ({ page }) => {
    await forceBannerActive(page);
    // Playwright contexts are fresh per-test, so localStorage starts empty.
    // No explicit clear needed — doing it via addInitScript would also clear
    // across reloads and break the dismiss-persists assertion.
  });

  test('renders on the main page with correct deep link', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('.vote-banner');
    await expect(banner).toBeVisible();

    const cta = banner.locator('a.vote-banner-cta');
    await expect(cta).toHaveText(/Cast Your Vote/i);
    await expect(cta).toHaveAttribute('href', BOM_URL);
    await expect(cta).toHaveAttribute('target', '_blank');
    await expect(cta).toHaveAttribute('rel', /noopener/);
  });

  test('renders on the Employee Directory page', async ({ page }) => {
    await page.goto('/orgchart');
    await expect(page.locator('.vote-banner')).toBeVisible();
  });

  test('dismiss persists across reload within the same day', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('.vote-banner');
    await expect(banner).toBeVisible();

    await banner.locator('.vote-banner-close').click();
    await expect(banner).toBeHidden();

    const stored = await page.evaluate(() => localStorage.getItem('hd_bom_dismissed_date'));
    expect(stored).toBe(new Date().toISOString().slice(0, 10));

    await page.reload();
    await expect(page.locator('.vote-banner')).toHaveCount(0);
  });

  test('stays hidden when server says inactive', async ({ page }) => {
    // Override the intercept — return inactive
    await page.route('**/api/site-config', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ voteBannerActive: false }),
      });
    });
    await page.goto('/');
    // Give the fetch a beat to resolve
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.vote-banner')).toHaveCount(0);
  });
});

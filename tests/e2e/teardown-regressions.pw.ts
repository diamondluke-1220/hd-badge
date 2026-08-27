import { test, expect } from '@playwright/test';

// Regression tests for the 2026-08-27 review — frontend batch.
//
//   1. Mobile users must not get stranded in Rack/Review view. GridRenderer
//      moves the view switcher into its own container on mobile, and returned
//      it to .app-nav — which rack.css and reviewboard.css hide — so the
//      switcher vanished with no keyboard fallback on a phone.
//   2. The badge-detail modal must detach its document keydown listener on
//      every close path, not just Escape.

test.describe('Mobile view switcher', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('stays reachable after switching into the rack', async ({ page }) => {
    await page.goto('/orgchart');
    await page.waitForFunction(() => typeof switchView === 'function');

    // Grid first — this is what relocates the dropdown on mobile.
    await page.evaluate(() => switchView('grid'));
    await expect(page.locator('.view-dropdown')).toBeVisible();

    await page.evaluate(() => switchView('rack'));

    // The switcher must still be on screen. Previously it was returned to
    // .app-nav, which `body.view-rack .app-header > .app-nav` hides outright.
    const dropdown = page.locator('.view-dropdown');
    await expect(dropdown).toBeVisible();

    // And it must still work — you can get back out.
    await page.evaluate(() => switchView('grid'));
    expect(await page.evaluate(() => document.body.className)).toContain('view-grid');
  });
});

test.describe('Badge detail modal', () => {
  test('removes its document keydown listener on every close path', async ({ page }) => {
    await page.goto('/orgchart');
    await page.waitForFunction(() => typeof showBadgeDetail === 'function');

    // Instrument document-level keydown add/remove so we can prove balance.
    await page.evaluate(() => {
      const w = window as any;
      w.__kd = 0;
      const add = document.addEventListener.bind(document);
      const remove = document.removeEventListener.bind(document);
      document.addEventListener = function (type: string, ...rest: any[]) {
        if (type === 'keydown') w.__kd++;
        return add(type, ...(rest as [any]));
      };
      document.removeEventListener = function (type: string, ...rest: any[]) {
        if (type === 'keydown') w.__kd--;
        return remove(type, ...(rest as [any]));
      };
    });

    // Close via the Close button — the path that used to leak.
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => showBadgeDetail('HD-00001', 'LUKE'));
      await page.locator('#detailCloseBtn').click();
    }

    // Close via the backdrop — also used to leak.
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => showBadgeDetail('HD-00001', 'LUKE'));
      await page.locator('.badge-detail-modal, #badgeDetailModal').first()
        .click({ position: { x: 5, y: 5 } });
    }

    // Every listener added must have been removed. Before the fix this ended
    // at +10, each closure pinning a detached modal holding a full-size image.
    expect(await page.evaluate(() => (window as any).__kd)).toBe(0);
  });
});

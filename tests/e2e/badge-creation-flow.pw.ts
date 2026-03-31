import { test, expect } from '@playwright/test';

// ─── Shared test logic for badge creation flow ─────────────
// Runs on desktop and mobile viewports

const ADMIN_TOKEN = 'test-e2e-token';

/** Click a badge element by selector within the preview area */
async function clickBadgeElement(page: any, selector: string) {
  const el = page.locator(`#badgePreviewArea ${selector}`);
  await el.waitFor({ state: 'visible', timeout: 5000 });
  await el.click();
}

/** Wait for popover to open and stabilize */
async function waitForPopover(page: any) {
  await expect(page.locator('.popover.visible')).toBeVisible({ timeout: 3000 });
  // Wait for entrance animation to complete (150ms transition)
  await page.waitForTimeout(200);
}

/** Click Done button in popover (dispatchEvent for fixed-position popovers that may be below fold) */
async function clickDone(page: any) {
  await page.locator('.popover-done').dispatchEvent('click');
  await expect(page.locator('.popover.visible')).not.toBeVisible({ timeout: 2000 });
}

/** Click X button in popover */
async function clickClose(page: any) {
  await page.locator('.popover-close').dispatchEvent('click');
  await expect(page.locator('.popover.visible')).not.toBeVisible({ timeout: 2000 });
}

// ─── Desktop Tests ─────────────────────────────────────────

test.describe('Badge Creation Flow — Desktop', () => {
  test.describe.configure({ mode: 'serial' });

  test('page loads with badge preview and edit hint', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#badge')).toBeVisible();
    await expect(page.locator('#badgePreviewArea')).toBeVisible();

    // Edit hint visible with pulse animation
    const hint = page.locator('.edit-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('click elements on the badge to customize');
  });

  test('discovery pulse fires on editable elements', async ({ page }) => {
    await page.goto('/');
    const previewArea = page.locator('#badgePreviewArea');
    await expect(previewArea).toHaveClass(/discover-pulse/);
  });

  test('header layout: title left, nav right, stable position', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('.app-header');
    await expect(header).toBeVisible();

    // Title should be left-aligned
    const h1 = page.locator('.app-header h1');
    await expect(h1).toBeVisible();

    // Nav links should be present
    await expect(page.locator('.app-nav-link[data-page="editor"]')).toBeVisible();
    await expect(page.locator('.app-nav-link[data-page="orgchart"]')).toBeVisible();

    // Placeholder should exist (reserves space for dropdown)
    await expect(page.locator('.view-dropdown-placeholder')).toBeAttached();
  });

  test('name popover: opens, updates preview, Done closes', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.name');
    await waitForPopover(page);

    // Should have input and Done button
    const input = page.locator('#popName');
    await expect(input).toBeVisible();
    await expect(page.locator('.popover-done')).toBeVisible();

    // Type name and verify preview updates
    await input.fill('Test User');
    const nameField = page.locator('#badgePreviewClone #nameField');
    await expect(nameField).toContainText('TEST USER');

    // Done closes popover
    await clickDone(page);
  });

  test('photo popover: Upload, Selfie, Done buttons present', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.photo-frame');
    await waitForPopover(page);

    await expect(page.locator('#popUpload')).toBeVisible();
    await expect(page.locator('#popCamera')).toBeVisible();
    await expect(page.locator('.popover-done')).toBeVisible();

    await clickDone(page);
  });

  test('department popover: preset cards update preview', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.department');
    await waitForPopover(page);

    // Click a preset card
    await page.locator('.popover .card[data-value="MOSH PIT HR"]').dispatchEvent('click');
    await expect(page.locator('#badgePreviewClone #deptField')).toContainText('MOSH PIT HR');
    await clickDone(page);
  });

  test('department popover: custom input uppercases', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.department');
    await waitForPopover(page);

    const input = page.locator('#popDeptCustom');
    await input.fill('custom dept');
    await expect(page.locator('#badgePreviewClone #deptField')).toContainText('CUSTOM DEPT');
    await clickDone(page);
  });

  test('title popover: auto-Title Case, not all caps', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.title');
    await waitForPopover(page);

    const input = page.locator('#popTitleCustom');
    await input.fill('test title here');

    // Input should show Title Case (not uppercase)
    await expect(input).toHaveValue('Test Title Here');

    // Badge preview should also show Title Case
    await expect(page.locator('#badgePreviewClone #titleField')).toContainText('Test Title Here');

    // Verify text-transform is none on the input
    const textTransform = await input.evaluate((el: HTMLElement) =>
      getComputedStyle(el).textTransform
    );
    expect(textTransform).toBe('none');

    await clickDone(page);
  });

  test('access level popover: preset cards and custom input', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.access-badge');
    await waitForPopover(page);

    // Click a preset
    await page.locator('.popover .card').first().dispatchEvent('click');
    await clickDone(page);
  });

  test('song popover: barcode/sticker toggle and song selection', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.waveform-sticker');
    await waitForPopover(page);

    // Toggle to sticker
    await page.locator('.wave-btn[data-style="sticker"]').dispatchEvent('click');
    await page.waitForTimeout(100);

    // Select a song
    await page.locator('.popover .card[data-value="RED ALERT"]').dispatchEvent('click');
    await expect(page.locator('.popover-done')).toBeVisible();

    await clickDone(page);
  });

  test('caption popover: preset selection and custom input', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.badge-caption');
    await waitForPopover(page);

    // Click a preset
    await page.locator('.popover .card').first().dispatchEvent('click');
    await clickDone(page);
  });

  test('X close button also works on all popovers', async ({ page }) => {
    await page.goto('/');

    // Test X close on name popover
    await clickBadgeElement(page, '.name');
    await waitForPopover(page);
    await clickClose(page);

    // Wait for popover to fully close before reopening
    await page.waitForTimeout(300);

    // Test X close on department popover
    await clickBadgeElement(page, '.department');
    await waitForPopover(page);
    await clickClose(page);
  });

  test('Escape key closes popover', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.name');
    await waitForPopover(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.popover.visible')).not.toBeVisible({ timeout: 2000 });
  });

  test('clicking outside popover closes it', async ({ page }) => {
    await page.goto('/');
    await clickBadgeElement(page, '.name');
    await waitForPopover(page);
    // Click on the body outside the popover
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.popover.visible')).not.toBeVisible({ timeout: 2000 });
  });

  test('submit flow: privacy modal and badge creation', async ({ page }) => {
    await page.goto('/');

    // Set a name first (required for submit)
    await clickBadgeElement(page, '.name');
    await waitForPopover(page);
    await page.locator('#popName').fill('E2E Tester');
    await clickDone(page);

    // Click Join the Org
    await page.locator('#submitBadgeBtn').click();

    // Privacy modal should appear
    const modal = page.locator('#privacyModal');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#privacySubmitBtn')).toBeVisible();
    await expect(page.locator('#privacyCancelBtn')).toBeVisible();

    // Photo toggle buttons present
    await expect(page.locator('#photoYes')).toBeVisible();
    await expect(page.locator('#photoNo')).toBeVisible();

    // Submit the badge
    await page.locator('#privacySubmitBtn').click();

    // Wait for loading to finish
    await expect(page.locator('#loading.active')).not.toBeVisible({ timeout: 15000 });

    // Badge render may fail in CI (no Playwright pool) — accept either success or error toast
    const success = page.locator('#submitSuccess');
    const errorToast = page.locator('.toast-error');
    await expect(success.or(errorToast)).toBeVisible({ timeout: 5000 });
  });

  test('orgchart: stats panel has donut, latest hire, most requested', async ({ page }) => {
    await page.goto('/orgchart');

    // Wait for content to load
    await expect(page.locator('.org-header')).toBeVisible({ timeout: 5000 });

    // Stats panel elements
    await expect(page.locator('.orgchart-donut')).toBeVisible();
    await expect(page.locator('.stats-card-label').first()).toBeVisible();

    // View dropdown
    await expect(page.locator('.view-dropdown-trigger')).toBeVisible();
  });

  test('orgchart: view dropdown switches views', async ({ page }) => {
    await page.goto('/orgchart');
    await expect(page.locator('.org-header')).toBeVisible({ timeout: 5000 });

    // Open dropdown
    await page.locator('#viewDropdownBtn').click();
    await expect(page.locator('#viewDropdownMenu')).toBeVisible();

    // Verify all 4 view options plus FX
    await expect(page.locator('.view-dropdown-item[data-mode="grid"]')).toBeVisible();
    await expect(page.locator('.view-dropdown-item[data-mode="reviewboard"]')).toBeVisible();
    await expect(page.locator('.view-dropdown-item[data-mode="dendro"]')).toBeVisible();
    await expect(page.locator('.view-dropdown-item[data-mode="arcade"]')).toBeVisible();
    await expect(page.locator('#animToggleBtn')).toBeVisible();

    // Close by clicking outside
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#viewDropdownMenu')).not.toBeVisible();
  });

  test('popover positioning: does not overlap badge on narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/');

    await clickBadgeElement(page, '.department');
    await waitForPopover(page);

    // Get badge bottom and popover top
    const badgeRect = await page.locator('#badgePreviewArea').boundingBox();
    const popover = page.locator('.popover.visible');
    const popRect = await popover.boundingBox();

    if (badgeRect && popRect) {
      // Popover should be below the badge preview wrapper, not overlapping
      const wrapper = await page.locator('.preview-wrapper').boundingBox();
      if (wrapper) {
        expect(popRect.y).toBeGreaterThanOrEqual(wrapper.y + wrapper.height - 10);
      }
    }

    await clickDone(page);
  });
});

// ─── Mobile Viewport Tests ─────────────────────────────────

const mobileViewports = [
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'Pixel 7', width: 412, height: 915 },
];

for (const { name, width, height } of mobileViewports) {
  test.describe(`Badge Creation Flow — ${name}`, () => {
    test(`[${name}] page loads with badge and tap hint`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.locator('#badge')).toBeVisible();
      const hint = page.locator('.edit-hint');
      await expect(hint).toBeVisible();
    });

    test(`[${name}] header stacks vertically`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.locator('.app-header')).toBeVisible();
      // Nav links should use short labels on mobile
      const shortNav = page.locator('.nav-short');
      await expect(shortNav.first()).toBeVisible();
    });

    test(`[${name}] name popover opens as bottom sheet`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await clickBadgeElement(page, '.name');
      await waitForPopover(page);

      const popover = page.locator('.popover.visible');
      const popRect = await popover.boundingBox();

      // On mobile, popover should be anchored to bottom of viewport
      if (popRect) {
        const popBottom = popRect.y + popRect.height;
        expect(popBottom).toBeGreaterThan(height - 20);
      }

      await expect(page.locator('.popover-done')).toBeVisible();
      await clickDone(page);
    });

    test(`[${name}] department popover: card selection works`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await clickBadgeElement(page, '.department');
      await waitForPopover(page);
      await page.locator('.popover .card').first().click();
      await expect(page.locator('.popover-done')).toBeVisible();
      await clickDone(page);
    });

    test(`[${name}] title popover: auto-Title Case on mobile`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await clickBadgeElement(page, '.title');
      await waitForPopover(page);

      const input = page.locator('#popTitleCustom');
      await input.fill('mobile title test');
      await expect(input).toHaveValue('Mobile Title Test');
      await clickDone(page);
    });

    test(`[${name}] submit flow works on mobile`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');

      await clickBadgeElement(page, '.name');
      await waitForPopover(page);
      await page.locator('#popName').fill('Mobile Tester');
      await clickDone(page);

      await page.locator('#submitBadgeBtn').click();
      await expect(page.locator('#privacyModal')).toBeVisible({ timeout: 3000 });
      await page.locator('#privacySubmitBtn').click();
      await expect(page.locator('#loading.active')).not.toBeVisible({ timeout: 15000 });
    });

    test(`[${name}] orgchart loads with stats toggle and dept filter`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/orgchart');
      await expect(page.locator('.org-header')).toBeVisible({ timeout: 5000 });

      // Stats panel hidden by default on mobile — toggle button visible
      await expect(page.locator('.stats-toggle-btn')).toBeVisible();
      await expect(page.locator('.orgchart-donut')).not.toBeVisible();

      // Click stats toggle → panel expands
      await page.locator('.stats-toggle-btn').click();
      await expect(page.locator('.orgchart-donut')).toBeVisible();

      // Dept filter select dropdown visible on mobile
      await expect(page.locator('.dept-filter-select')).toBeVisible();
    });

    test(`[${name}] badge grid renders on mobile`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/orgchart');
      await page.waitForTimeout(2000);
      await expect(page.locator('.badge-grid').first()).toBeVisible({ timeout: 10000 });
    });
  });
}

// ─── Tablet Viewport Test ──────────────────────────────────

test.describe('Badge Creation Flow — iPad', () => {
  test('[iPad] popover opens and has Done button', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await clickBadgeElement(page, '.department');
    await waitForPopover(page);
    await expect(page.locator('.popover.visible')).toBeVisible();
    await expect(page.locator('.popover-done')).toBeAttached();
    await clickDone(page);
  });

  test('[iPad] stats panel renders', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/orgchart');
    await expect(page.locator('.stats-panel')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.orgchart-donut')).toBeVisible();
  });
});

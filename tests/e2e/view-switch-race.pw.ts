import { test, expect } from '@playwright/test';

// Regression tests for the 2026-08-27 code review fixes.
//
// Covered:
//   1. switchView() serialization + renderer generation tokens — rapid view
//      switching used to interleave init()/destroy(), leaving an orphaned
//      renderer with an uncancellable 14s interval throwing forever.
//   2. Rack port click delegation — ports were wired with an interpolated
//      inline onclick built from the badge name, which esc() could not safely
//      escape for a JS string literal.
//   3. esc() escaping the apostrophe and tolerating non-strings.

/** Collect uncaught page errors and console errors for the life of the page. */
function trackErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test.describe('esc() escaping contract', () => {
  test('escapes the apostrophe and coerces non-strings', async ({ page }) => {
    await page.goto('/orgchart');
    const result = await page.evaluate(() => ({
      apostrophe: esc("O'Brien"),
      quote: esc('a"b'),
      angle: esc('<script>'),
      amp: esc('a&b'),
      nullish: esc(null as unknown as string),
      numeric: esc(42 as unknown as string),
    }));

    // The apostrophe MUST be escaped — the name field permits it, and esc()
    // output lands in attribute values.
    expect(result.apostrophe).toBe('O&#39;Brien');
    expect(result.quote).toBe('a&quot;b');
    expect(result.angle).toBe('&lt;script&gt;');
    // Ampersand escaped first, so no double-escaping of the entities above.
    expect(result.amp).toBe('a&amp;b');
    // Non-strings must not throw — a null name used to abort an entire render.
    expect(result.nullish).toBe('');
    expect(result.numeric).toBe('42');
  });
});

test.describe('Rack ports', () => {
  test('carry no inline onclick and open badge detail via delegation', async ({ page }) => {
    const errors = trackErrors(page);

    await page.goto('/orgchart');

    // The first rack init renders EMPTY panels and animates badges in one at a
    // time via _createPort (a DOM path). The _createPortHtml string path under
    // test only runs on a switch back into the rack, which instant-fills. So:
    // in, out, and back in.
    await page.evaluate(async () => {
      await switchView('rack');
      await switchView('grid');
      await switchView('rack');
    });

    const port = page.locator('.rack-port[data-employee-id]').first();
    await expect(port).toBeAttached({ timeout: 15_000 });

    // The inline handler is the injection sink that was removed. Badge data
    // now rides in attributes and behavior is attached by delegation.
    expect(await port.getAttribute('onclick')).toBeNull();
    expect(await port.getAttribute('data-badge-name')).not.toBeNull();

    // Delegation still opens the detail modal.
    await port.click();
    await expect(page.locator('#detailCloseBtn')).toBeVisible({ timeout: 10_000 });

    expect(errors).toEqual([]);
  });
});

// NOTE ON COVERAGE: the two tests above are proven regression tests — both fail
// against the pre-fix code. The test below is NOT. It passes with and without
// the switchView serialization fix, because ReviewBoardRenderer's badge fetch
// returns empty in this environment, so _startRotation() early-returns and the
// orphaned interval never forms. It is kept as an invariant guard (no leftover
// renderer state, no errors across a full 14s rotation period), not as evidence
// that the race is fixed. Reproducing the race needs a seeded reviewboard.
test.describe('Rapid view switching', () => {
  test('serializes switches and leaves exactly one live renderer', async ({ page }) => {
    const errors = trackErrors(page);

    await page.goto('/orgchart');
    await page.waitForFunction(() => typeof switchView === 'function');

    // Force the interleave window open. BadgePool caches, so in a warm page the
    // fetch resolves too fast to reproduce the race — the bug needs a slow
    // fetch, which is exactly what a live show over venue wifi provides.
    await page.evaluate(() => {
      const realFetchAll = BadgePool.fetchAll.bind(BadgePool);
      BadgePool.fetchAll = async (...args: unknown[]) => {
        const result = await realFetchAll(...args);
        await new Promise((r) => setTimeout(r, 600));
        return result;
      };
    });

    // Fire all four views without awaiting — the exact interleave that used to
    // orphan a renderer. switchView now queues, so all four resolve in order.
    await page.evaluate(async () => {
      const runs = ['grid', 'reviewboard', 'rack', 'arcade'].map((m) => switchView(m));
      await Promise.all(runs);
    });

    // The last requested view is the one that wins.
    expect(await page.evaluate(() => document.body.className)).toContain('view-arcade');

    // Generation tokens: every renderer that was torn down must have been
    // invalidated, so no orphaned init() resumed behind the current view.
    const orphaned = await page.evaluate(() => {
      const board = window.ReviewBoardRenderer;
      const rack = window.RackRenderer;
      return {
        boardHasContainer: !!board._container,
        boardHasTimer: !!board._rotationTimer,
        rackHasContainer: !!rack._container,
      };
    });
    expect(orphaned.boardHasContainer).toBe(false);
    expect(orphaned.boardHasTimer).toBe(false);
    expect(orphaned.rackHasContainer).toBe(false);

    // The zombie interval threw every 14s. Wait past one full period.
    await page.waitForTimeout(16_000);
    expect(errors).toEqual([]);
  });
});

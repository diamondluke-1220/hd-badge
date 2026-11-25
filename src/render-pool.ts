// Server-side badge rendering: one headless Chromium with a warm page that
// already has the badge template loaded, used by one render at a time.
// Needs the server to be listening on `port`, since the warm page loads the
// app's own index.html.

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import sharp from 'sharp';
import type { Browser, Page } from 'playwright';
import type { RenderableBadge, RenderOptions } from './types';

export interface RenderPool {
  /** Renders a badge PNG. Renders queue behind each other; a failed attempt is retried once on a fresh page. */
  renderBadge(badge: RenderableBadge, options?: RenderOptions): Promise<Buffer>;
  /** Renders a local HTML page's `selector` element as a 600 DPI PNG, on its own page. */
  renderPageScreenshot(path: string, selector: string): Promise<Buffer>;
  /** Closes the warm page and the browser. */
  close(): Promise<void>;
}

export function createRenderPool(opts: { photosDir: string; port: number }): RenderPool {
  let browser: Browser | null = null;
  let browserLaunching: Promise<Browser> | null = null;
  let warmPage: Page | null = null;
  // Serializes badge renders: the shared warm page can only render one badge
  // at a time. Concurrent renders would interleave on the same DOM and
  // screenshot the wrong badge, so every render queues behind this chain.
  let renderLock: Promise<unknown> = Promise.resolve();

  // Placeholder photo as a data URL, read once (it never changes).
  let placeholderDataUrl: string | null = null;
  const placeholderPath = join('public', 'placeholder-photo.png');
  if (existsSync(placeholderPath)) {
    placeholderDataUrl = `data:image/png;base64,${readFileSync(placeholderPath).toString('base64')}`;
  }

  async function getBrowser(): Promise<Browser> {
    if (browser?.isConnected()) return browser;
    if (browserLaunching) return browserLaunching;
    browser = null;
    warmPage = null;
    browserLaunching = (async () => {
      try {
        const { chromium } = await import('playwright');
        const launched = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        browser = launched;
        return launched;
      } finally {
        // Cleared on the failure path too: a rejected launch left here would be
        // awaited by every later caller, and rendering would never recover.
        browserLaunching = null;
      }
    })();
    return browserLaunching;
  }

  /** A page with the badge template loaded and all other page UI hidden. */
  async function getWarmPage(): Promise<Page> {
    if (warmPage && !warmPage.isClosed()) return warmPage;

    const b = await getBrowser();
    warmPage = await b.newPage({ viewport: { width: 1400, height: 2200 } });
    await warmPage.goto(`http://localhost:${opts.port}/`, { waitUntil: 'domcontentloaded' });
    await warmPage.waitForSelector('#badge', { timeout: 5000 });

    await warmPage.evaluate(() => {
      document.querySelectorAll('body > *:not(#badgeCapture)').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
      const capture = document.getElementById('badgeCapture');
      if (capture) {
        capture.style.position = 'static';
        capture.style.left = '0';
      }
    });
    return warmPage;
  }

  /**
   * Options:
   *  - withPhoto: include photo (default true)
   *  - print: flat 600 DPI print export (no corner rounding, white bg)
   *  - klayer: K-layer pre-print for two-pass printing (body.k-layer CSS)
   *  - colorlayer: color pass for two-pass printing (body.color-layer CSS)
   *  - calibration: drift measurement grid (body.k-calibration CSS, standalone)
   */
  async function renderBadgeInner(badge: RenderableBadge, options?: RenderOptions): Promise<Buffer> {
    const page = await getWarmPage();

    const id = badge.employee_id;
    const photoPath = join(opts.photosDir, `${id}.jpg`);
    const includePhoto = (options?.withPhoto !== false) && badge.has_photo && existsSync(photoPath);
    let photoDataUrl: string | null = null;
    if (includePhoto) {
      const photoBuffer = await Bun.file(photoPath).arrayBuffer();
      photoDataUrl = `data:image/jpeg;base64,${Buffer.from(photoBuffer).toString('base64')}`;
    } else {
      photoDataUrl = placeholderDataUrl;
    }

    await page.evaluate(({ badge, photoDataUrl, isPrint, isKLayer, isColorLayer, isCalibration }) => {
      // Layer body classes are reset every render, since the warm page is reused
      document.body.classList.remove('k-layer', 'color-layer', 'k-calibration');
      if (isKLayer) document.body.classList.add('k-layer');
      if (isColorLayer) document.body.classList.add('color-layer');
      if (isCalibration) document.body.classList.add('k-calibration');

      const previewArea = document.getElementById('badgePreviewArea');
      if (previewArea) previewArea.innerHTML = '';

      const idEl = document.getElementById('idField');
      if (idEl) { idEl.textContent = badge.employee_id; idEl.dataset.set = '1'; }
      const issuedEl = document.getElementById('issuedField');
      if (issuedEl) {
        const d = new Date(badge.created_at as string);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(2);
        issuedEl.textContent = `ISSUED ${mm}.${dd}.${yy}`;
        issuedEl.dataset.set = '1';
      }

      const frame = document.querySelector('#badge .photo-frame') as HTMLElement;
      if (frame) {
        const staleImg = frame.querySelector('img');
        if (staleImg) staleImg.remove();
        frame.classList.remove('has-photo');
        const placeholder = frame.querySelector('.photo-placeholder-text') as HTMLElement;
        if (placeholder) placeholder.style.display = '';
      }

      // Print-mode overrides are reset before each render
      const el = document.getElementById('badge');
      if (el) {
        el.style.borderRadius = '';
        el.style.boxShadow = '';
      }
      document.body.style.background = '';

      if (isPrint && el) {
        el.style.borderRadius = '0';
        el.style.boxShadow = 'none';
        document.body.style.background = 'white';
      }

      (window as any).updateBadge({
        name: badge.name,
        department: badge.department,
        title: badge.title,
        song: badge.song,
        accessLevel: badge.access_level,
        accessCss: badge.access_css,
        photoUrl: photoDataUrl,
        waveStyle: badge.wave_style || 'barcode',
        caption: badge.caption || 'SCAN TO FILE COMPLAINT',
      });
    }, { badge, photoDataUrl, isPrint: !!options?.print, isKLayer: !!options?.klayer, isColorLayer: !!options?.colorlayer, isCalibration: !!options?.calibration });

    if (includePhoto) {
      await page.waitForFunction(() => {
        const img = document.querySelector('.photo-frame img') as HTMLImageElement;
        return img && img.complete && img.naturalWidth > 0;
      }, { timeout: 5000 }).catch(() => {
        // Photo may not have loaded; continue with the placeholder
      });
    }

    const badgeEl = await page.$('#badge');
    if (!badgeEl) throw new Error('Badge element not found');

    // Flat print modes all want a solid white background and no corner rounding
    const isFlatPrint = !!(options?.print || options?.klayer || options?.colorlayer || options?.calibration);
    const pngBuf = await badgeEl.screenshot({ type: 'png', omitBackground: !isFlatPrint });

    if (isFlatPrint) {
      // DPI metadata so the image maps to CR80 card size
      return await sharp(Buffer.from(pngBuf))
        .withMetadata({ density: 600 })
        .png()
        .toBuffer();
    }

    // Round corners with an SVG mask
    const meta = await sharp(Buffer.from(pngBuf)).metadata();
    const W = meta.width || 700;
    const H = meta.height || 1100;
    const R = Math.round(W * 0.0588);
    const roundedMask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="${R}" ry="${R}" fill="white"/></svg>`
    );
    return await sharp(Buffer.from(pngBuf))
      .ensureAlpha()
      .composite([{ input: roundedMask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  }

  return {
    renderBadge(badge, options) {
      // On failure the (possibly dirty) warm page is dropped, so the retry
      // starts on a clean one instead of inheriting the corruption.
      const attempt = () => renderBadgeInner(badge, options).catch(async (err) => {
        try { await warmPage?.close(); } catch { /* already gone */ }
        warmPage = null;
        throw err;
      });
      // Queue behind any in-flight render, and retry once on a fresh page:
      // transient Playwright hiccups usually clear on a clean page.
      const run = renderLock.then(() => attempt().catch(() => attempt()));
      // The chain stays alive even if both attempts reject; the caller still gets the error.
      renderLock = run.then(() => undefined, () => undefined);
      return run;
    },

    async renderPageScreenshot(path, selector) {
      const b = await getBrowser();
      const page = await b.newPage({ viewport: { width: 1400, height: 2200 } });
      try {
        await page.goto(`http://localhost:${opts.port}${path}`, { waitUntil: 'networkidle' });
        const el = await page.$(selector);
        if (!el) throw new Error(`Element ${selector} not found on ${path}`);
        const pngBuf = await el.screenshot({ type: 'png', omitBackground: false });
        return await sharp(Buffer.from(pngBuf))
          .withMetadata({ density: 600 })
          .png()
          .toBuffer();
      } finally {
        await page.close();
      }
    },

    async close() {
      if (warmPage && !warmPage.isClosed()) {
        await warmPage.close().catch(() => {});
        warmPage = null;
      }
      if (browser) {
        await browser.close().catch(() => {});
        browser = null;
      }
    },
  };
}

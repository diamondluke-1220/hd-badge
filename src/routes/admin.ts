// ─── Admin API Routes ─────────────────────────────────────
// Badge management, analytics, demo mode, presentation mode.

import type { Hono } from 'hono';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import sharp from 'sharp';
import archiver from 'archiver';
import { getBadge, listBadges, hardDeleteBadge, toggleVisibility, togglePaid, togglePrinted, toggleFlagged, setHasPhoto, getStats, getAnalytics, getDivisionNames, exportAllBadges, getPrintQueue, serializeBadge, reissueToken } from '../db';
import { log, getLog } from '../logger';
import { startDemo, stopDemo, getDemoStatus, cleanupDemo } from '../demo';
import { startPresentation, stopPresentation, getPresentationState, getPublicState, updateChyron, skipBandIntro } from '../presentation';
import { setShowMode, isShowMode, resetRateLimits } from '../rate-limit';

interface AdminDeps {
  renderBadgePlaywright: (badge: any, options?: { withPhoto?: boolean; print?: boolean }) => Promise<Buffer>;
  PHOTOS_DIR: string;
  BADGES_DIR: string;
  THUMBS_DIR: string;
  HEADSHOTS_DIR: string;
}

export function registerAdminRoutes(app: Hono, deps: AdminDeps) {
  const { renderBadgePlaywright, PHOTOS_DIR, BADGES_DIR, THUMBS_DIR, HEADSHOTS_DIR } = deps;

  // ─── Badge Management ────────────────────────────────────

  app.get('/api/admin/badges', (c) => {
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '100', 10);
    const department = c.req.query('department') || undefined;
    const search = c.req.query('search') || undefined;
    const division = c.req.query('division') || undefined;
    const dateFrom = c.req.query('dateFrom') || undefined;
    const dateTo = c.req.query('dateTo') || undefined;
    const photoParam = c.req.query('hasPhoto');
    const hasPhoto = photoParam === '1' ? true : photoParam === '0' ? false : undefined;

    const result = listBadges({ page, limit, includeHidden: true, department, division, dateFrom, dateTo, hasPhoto, search });

    return c.json({
      badges: result.badges.map(b => serializeBadge(b, { admin: true })),
      total: result.total,
      page: result.page,
      pages: result.pages,
    });
  });

  app.get('/api/admin/stats', (c) => {
    return c.json(getStats());
  });

  app.post('/api/admin/badge/:id/hide', (c) => {
    const success = toggleVisibility(c.req.param('id'));
    if (!success) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }
    return c.json({ success: true, message: 'Visibility toggled.' });
  });

  app.delete('/api/admin/badge/:id', (c) => {
    const id = c.req.param('id');

    const success = hardDeleteBadge(id);
    if (!success) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    const files = [
      join(BADGES_DIR, `${id}.png`),
      join(BADGES_DIR, `${id}-nophoto.png`),
      join(PHOTOS_DIR, `${id}.jpg`),
      join(THUMBS_DIR, `${id}.png`),
      join(HEADSHOTS_DIR, `${id}.jpg`),
    ];
    for (const f of files) {
      try { unlinkSync(f); } catch { /* ignore — file may not exist */ }
    }

    return c.json({ success: true, message: 'Badge permanently deleted.' });
  });

  app.post('/api/admin/badge/:id/paid', (c) => {
    const success = togglePaid(c.req.param('id'));
    if (!success) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }
    return c.json({ success: true, message: 'Payment status toggled.' });
  });

  app.post('/api/admin/badge/:id/printed', (c) => {
    const success = togglePrinted(c.req.param('id'));
    if (!success) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }
    return c.json({ success: true, message: 'Print status toggled.' });
  });

  // ─── Print Queue ──────────────────────────────────────────

  app.get('/api/admin/badges/print-queue', (c) => {
    const badges = getPrintQueue();
    return c.json({
      badges: badges.map(b => ({
        employeeId: b.employee_id,
        name: b.name,
        department: b.department,
        title: b.title,
        hasPhoto: !!b.has_photo,
        createdAt: b.created_at,
      })),
      count: badges.length,
    });
  });

  app.get('/api/admin/badge/:id/print', async (c) => {
    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    const printBuffer = await renderBadgePlaywright(badge, { print: true });
    return new Response(printBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${id}-print.png"`,
        'Cache-Control': 'no-cache',
      },
    });
  });

  app.post('/api/admin/badge/:id/flag', (c) => {
    const success = toggleFlagged(c.req.param('id'));
    if (!success) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }
    return c.json({ success: true, message: 'Flag status toggled.' });
  });

  // ─── Badge Recovery (reissue token) ─────────────────────

  app.post('/api/admin/badge/:id/recover', (c) => {
    const id = c.req.param('id');
    const newToken = reissueToken(id);
    if (!newToken) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }
    log('info', 'admin', `Recovery token reissued for ${id}`);
    return c.json({ success: true, employeeId: id, token: newToken });
  });

  // ─── Photo Upload ────────────────────────────────────────

  app.post('/api/admin/badge/:id/photo', async (c) => {
    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    try {
      const formData = await c.req.formData();
      const file = formData.get('photo');
      if (!file || !(file instanceof File)) {
        return c.json({ success: false, error: 'No photo file provided.' }, 400);
      }

      if (!file.type.startsWith('image/')) {
        return c.json({ success: false, error: 'File must be an image.' }, 400);
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      // Validate magic bytes: JPEG (FF D8 FF) or PNG (89 50 4E 47)
      const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
      if (!isJpeg && !isPng) {
        return c.json({ success: false, error: 'Invalid image file. JPEG or PNG only.' }, 400);
      }

      await sharp(buffer)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toFile(join(PHOTOS_DIR, `${id}.jpg`));

      setHasPhoto(id, true);

      // Re-render badge with new photo
      const updatedBadge = getBadge(id);
      if (updatedBadge) {
        const badgeBuffer = await renderBadgePlaywright(updatedBadge);
        await Bun.write(join(BADGES_DIR, `${id}.png`), badgeBuffer);

        // Render nophoto variant if photo is private
        if (!updatedBadge.photo_public) {
          const noPhotoBuffer = await renderBadgePlaywright(updatedBadge, { withPhoto: false });
          await Bun.write(join(BADGES_DIR, `${id}-nophoto.png`), noPhotoBuffer);
        }
      }

      // Invalidate cached derivatives
      const thumbPath = join(THUMBS_DIR, `${id}.png`);
      if (existsSync(thumbPath)) {
        unlinkSync(thumbPath);
      }
      const headshotPath = join(HEADSHOTS_DIR, `${id}.jpg`);
      if (existsSync(headshotPath)) {
        unlinkSync(headshotPath);
      }

      log('info', 'admin', `Photo uploaded and badge re-rendered for ${id} (${badge.name})`);
      return c.json({ success: true, message: `Photo uploaded and badge re-rendered for ${badge.name}.` });
    } catch (err: any) {
      log('error', 'admin', `Photo upload failed for ${id}: ${err.message}`);
      return c.json({ success: false, error: 'Photo upload failed.' }, 500);
    }
  });

  // ─── Photo Source (admin only) ───────────────────────────

  app.get('/api/admin/badge/:id/photo-source', (c) => {
    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge || !badge.has_photo) {
      return c.json({ success: false, error: 'Photo not found.' }, 404);
    }

    const photoPath = join(PHOTOS_DIR, `${id}.jpg`);
    if (!existsSync(photoPath)) {
      return c.json({ success: false, error: 'Photo file not found.' }, 404);
    }

    const file = Bun.file(photoPath);
    return new Response(file, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' },
    });
  });

  // ─── Badge Render ────────────────────────────────────────

  app.post('/api/admin/badge/:id/render', async (c) => {
    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    try {
      const badgeBuffer = await renderBadgePlaywright(badge);
      await Bun.write(join(BADGES_DIR, `${id}.png`), badgeBuffer);

      const thumbPath = join(THUMBS_DIR, `${id}.png`);
      if (existsSync(thumbPath)) {
        unlinkSync(thumbPath);
      }

      log('info', 'admin', `Badge rendered (Playwright) for ${id} (${badge.name})`);
      return c.json({ success: true, message: `Badge rendered for ${badge.name}.` });
    } catch (err: any) {
      log('error', 'admin', `Badge render failed for ${id}: ${err.message}`);
      return c.json({ success: false, error: 'Badge render failed.' }, 500);
    }
  });

  // ─── Batch Print (ZIP) ──────────────────────────────────

  app.get('/api/admin/badges/batch-print', async (c) => {
    const badges = getPrintQueue();
    if (badges.length === 0) {
      return c.json({ success: false, error: 'No badges in print queue (paid + unprinted).' }, 404);
    }

    try {
      log('info', 'admin', `Batch print started: ${badges.length} badges`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));

      // Render each badge in print mode and add to ZIP
      for (const badge of badges) {
        try {
          const printBuffer = await renderBadgePlaywright(badge, { print: true });
          const safeName = badge.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
          archive.append(printBuffer, { name: `${badge.employee_id}-${safeName}.png` });
        } catch (err: any) {
          log('error', 'admin', `Batch print: render failed for ${badge.employee_id}: ${err.message}`);
          // Skip failed badge, continue with rest
        }
      }

      await archive.finalize();
      const zipBuffer = Buffer.concat(chunks);

      const filename = `helpdesk-print-queue-${new Date().toISOString().slice(0, 10)}.zip`;
      log('info', 'admin', `Batch print complete: ${badges.length} badges, ${(zipBuffer.length / 1024).toFixed(0)}KB`);

      return new Response(zipBuffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache, no-store',
        },
      });
    } catch (err: any) {
      log('error', 'admin', `Batch print failed: ${err.message}`);
      return c.json({ success: false, error: 'Batch print failed.' }, 500);
    }
  });

  // ─── Re-render All Badges ──────────────────────────────

  app.post('/api/admin/badges/rerender-all', async (c) => {
    const result = listBadges({ limit: 1000, maxLimit: 1000 });
    const badges = result.badges;

    if (badges.length === 0) {
      return c.json({ success: false, error: 'No badges to render.' }, 404);
    }

    log('info', 'admin', `Re-render all started: ${badges.length} badges`);
    let rendered = 0;
    let failed = 0;

    for (const badge of badges) {
      try {
        const badgeBuffer = await renderBadgePlaywright(badge);
        await Bun.write(join(BADGES_DIR, `${badge.employee_id}.png`), badgeBuffer);

        // Re-render nophoto variant if needed
        if (badge.has_photo && !badge.photo_public) {
          const noPhotoBuffer = await renderBadgePlaywright(badge, { withPhoto: false });
          await Bun.write(join(BADGES_DIR, `${badge.employee_id}-nophoto.png`), noPhotoBuffer);
        }

        // Invalidate cached thumb
        const thumbPath = join(THUMBS_DIR, `${badge.employee_id}.png`);
        if (existsSync(thumbPath)) unlinkSync(thumbPath);

        rendered++;
      } catch (err: any) {
        log('error', 'admin', `Re-render failed for ${badge.employee_id}: ${err.message}`);
        failed++;
      }
    }

    log('info', 'admin', `Re-render all complete: ${rendered} rendered, ${failed} failed`);
    return c.json({ success: true, rendered, failed, total: badges.length });
  });

  // ─── Analytics & Export ──────────────────────────────────

  app.get('/api/admin/analytics', (c) => {
    return c.json(getAnalytics());
  });

  app.get('/api/admin/divisions', (c) => {
    return c.json({ divisions: getDivisionNames() });
  });

  app.get('/api/admin/export/csv', (c) => {
    const badges = exportAllBadges();

    const headers = ['id', 'employee_id', 'name', 'department', 'title', 'song', 'access_level', 'access_css', 'created_at', 'source', 'is_visible', 'has_photo', 'is_band_member', 'photo_public', 'is_paid', 'paid_at', 'is_printed', 'printed_at', 'is_flagged'];

    const escCsv = (val: any): string => {
      if (val === null || val === undefined) return '';
      let s = String(val);
      // Prevent formula injection in Excel (=, +, -, @, \t can trigger formulas)
      if (/^[=+\-@\t]/.test(s)) {
        s = "'" + s;
      }
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const lines = [headers.join(',')];
    for (const b of badges) {
      const row = headers.map(h => escCsv((b as any)[h]));
      lines.push(row.join(','));
    }

    const csv = lines.join('\n');
    const filename = `helpdesk-badges-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  // ─── System Logs ─────────────────────────────────────────

  app.get('/api/admin/logs', (c) => {
    return c.json({ logs: getLog() });
  });

  // ─── Demo Mode ───────────────────────────────────────────

  app.post('/api/admin/demo/start', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const count = body.count || 30;
    const duration = body.duration || 300;
    const result = startDemo(count, duration);
    if ('error' in result) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({ success: true, ...result });
  });

  app.post('/api/admin/demo/stop', (c) => {
    const result = stopDemo();
    if ('error' in result) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({ success: true, ...result });
  });

  app.get('/api/admin/demo/status', (c) => {
    return c.json(getDemoStatus());
  });

  app.post('/api/admin/demo/cleanup', (c) => {
    const result = cleanupDemo(BADGES_DIR, THUMBS_DIR, HEADSHOTS_DIR);
    return c.json({ success: true, ...result });
  });

  // ─── Presentation Mode ──────────────────────────────────

  app.post('/api/admin/presentation/start', async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { body = {}; }
    const result = startPresentation({ chyronMessages: body.chyronMessages });
    if ('error' in result) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json(result);
  });

  app.post('/api/admin/presentation/stop', (c) => {
    const result = stopPresentation();
    if ('error' in result) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json(result);
  });

  app.get('/api/admin/presentation/status', (c) => {
    return c.json(getPresentationState());
  });

  app.post('/api/admin/presentation/chyron', async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { body = {}; }
    const messages = Array.isArray(body.messages) ? body.messages.filter((m: any) => typeof m === 'string' && m.trim()) : [];
    const result = updateChyron(messages);
    return c.json(result);
  });

  app.post('/api/admin/presentation/skip-intro', (c) => {
    const result = skipBandIntro();
    if ('error' in result) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json(result);
  });

  // Public presentation status (no auth — for SSE reconnect recovery)
  app.get('/api/presentation/status', (c) => {
    return c.json(getPublicState());
  });

  // ─── Show Mode (relaxed rate limits) ────────────────────

  app.post('/api/admin/show-mode/toggle', (c) => {
    const active = !isShowMode();
    setShowMode(active);
    if (active) resetRateLimits();
    log('info', 'show-mode', active ? 'Show mode ON — 50/hr, 200/day limits' : 'Show mode OFF — normal limits');
    return c.json({ showMode: active });
  });

  app.get('/api/admin/show-mode/status', (c) => {
    return c.json({ showMode: isShowMode() });
  });
}

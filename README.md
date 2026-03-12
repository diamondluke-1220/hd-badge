# Help Desk Badge Generator

Employee badge creator for [Help Desk](https://open.spotify.com/artist/64AtvxMQy2FsyDOX0zVfke), a comedy/office-themed punk band from Madison, WI. Fans create custom corporate ID badges at live shows, pick a department and job title, and join the company org chart.

Built for merch tables — runs on a tablet or laptop at shows, optionally behind a captive WiFi portal so fans just connect and start building.

<!-- TODO: Add screenshots once band badges are loaded -->

## Features

**Badge Creator**
- Click-to-edit badge designer — click any element to customize via anchored popover
- Keyboard keycap header with binary texture overlay
- 11 departments, 17 job titles, 19 access levels, 13 captions
- Song waveform "barcodes" generated from real audio RMS data (14 songs)
- Photo upload with crop tool
- "sudo randomize" button for instant random badges
- PNG download

**Employee Directory**
- Division-grouped hierarchy with color-coded headers
- Responsive grid (5/4/3/2 columns)
- Server-side thumbnails (sharp, 320px, cached on disk)
- Four view modes with keyboard shortcuts (1/2/3/4):
  - **Grid** — default card layout with photo circles
  - **Split-Flap Lobby** — airport departures board aesthetic
  - **Dendrogram Tree** — D3 horizontal hierarchy with neon glow nodes
  - **Arcade Select** — fighting game character select grid

**Live Show Features**
- SSE real-time badge events (new hires appear live on the org chart projector)
- Stock ticker banner with corporate parody stats
- Terminal onboarding animation (CLI-style new hire sequence)
- Spotlight mode (newest badge highlighted with glow)
- CSS donut chart (department distribution)

**Admin (HR Dashboard)**
- Bearer token auth with rate limiting (5 fails = 15min lockout)
- Search, filters (date range, division, department, photo, status)
- Payment + print tracking (Venmo manual workflow)
- Content flagging system (two-tier profanity filter)
- Analytics dashboard and CSV export
- Localhost-only mode for WiFi kiosk security

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Server:** [Hono](https://hono.dev)
- **Database:** SQLite (bun:sqlite, WAL mode)
- **Thumbnails:** [sharp](https://sharp.pixelplumbing.com)
- **Visualizations:** [D3.js](https://d3js.org) (dendrogram tree view)
- **Client-side:** Vanilla JS, html2canvas, Cropper.js
- **CI/CD:** GitHub Actions → ghcr.io → Docker (Unraid)

## Quick Start

```bash
# Clone and install
git clone https://github.com/diamondluke-1220/hd-badge.git
cd hd-badge
bun install

# Run (creates data/ dir and SQLite DB automatically)
bun run dev        # watch mode
bun run start      # production
```

Open `http://localhost:3000` — badge creator. `/orgchart` — employee directory.

### Admin Panel

Set `ADMIN_TOKEN` to enable the HR Dashboard at `/admin`:

```bash
ADMIN_TOKEN=your-secret-here bun run start
```

## Docker

```bash
docker build -t hd-badge .
docker run -p 3000:3000 \
  -e ADMIN_TOKEN=your-secret-here \
  -v ./data:/app/data \
  hd-badge
```

Pre-built image available:

```bash
docker pull ghcr.io/diamondluke-1220/hd-badge:latest
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listen port |
| `ADMIN_TOKEN` | *(empty)* | Bearer token for admin access |
| `ADMIN_LOCAL_ONLY` | `1` | Restrict admin to localhost (`0` for Docker/tunnel) |
| `TRUST_PROXY` | *(unset)* | Trust `X-Forwarded-For` headers (`1` behind proxy) |
| `SHOW_MODE` | `0` | Relaxed rate limits for live shows |

## Project Structure

```
src/
  server.ts          # Hono server, routes, SSE
  db.ts              # SQLite schema, queries, migrations
  profanity.ts       # Two-tier content filter
  rate-limit.ts      # IP-based rate limiting
public/
  index.html         # Badge creator
  admin.html         # HR Dashboard
  table-tent.html    # Printable merch table card with QR codes
  js/app.js          # Badge editor, SSE, ticker, terminal, shared state
  js/view-grid.js    # Grid renderer (default)
  js/view-splitflap.js # Split-Flap Lobby renderer
  js/view-dendro.js    # D3 dendrogram renderer
  js/view-arcade.js    # Arcade Select renderer
  js/arcade-stats.js   # RPG stat generation
  css/               # App styles, badge styles, theme overrides
  lib/               # Vendored deps (d3, html2canvas, cropper, qrcode)
  fonts/             # Self-hosted web fonts (Barlow, Inter, JetBrains Mono, Orbitron)
data/                # Runtime data (gitignored)
  badges.db          # SQLite database
  photos/            # Uploaded fan photos
  thumbs/            # Server-generated thumbnails
```

## License

MIT

# Badge Render Architecture

> How badges get created, rendered, and stored in the Help Desk Badge Generator.
> Updated: 2026-03-12 | Commit: `6f50004`

---

## Fan Badge Creation Flow

```mermaid
flowchart TD
    A[Fan opens badge creator] --> B[Live CSS preview in browser]
    B --> C{Fan edits fields}
    C -->|Name, Dept, Title, Song| B
    C -->|Upload Photo| D[Cropper.js modal]
    D -->|Crop & confirm| E[700x630 JPEG stored in browser state]
    E --> B
    B --> F[Fan clicks 'Join the Company']
    F --> G{Has photo?}
    G -->|Yes| H[Privacy modal: public or private?]
    G -->|No| I[Submit to server]
    H --> I

    I -->|POST /api/badge| J[Server receives metadata + photo data URL]

    subgraph Server ["Server-Side Processing"]
        J --> K[Create SQLite record]
        K --> L{Photo provided?}
        L -->|Yes| M[Decode base64 → save data/photos/ID.jpg]
        L -->|No| N[No photo file saved]
        M --> O[Playwright renders badge]
        N --> O
        O --> P{Photo on disk?}
        P -->|Yes| Q[Inject photo into badge DOM]
        P -->|No| R[Inject skull headset placeholder]
        Q --> S[Screenshot → Sharp corner clip → PNG]
        R --> S
        S --> T[Save data/badges/ID.png]
        T --> U{Photo private?}
        U -->|Yes| V[Re-render without photo → ID-nophoto.png]
        U -->|No| W[Done]
        V --> W
    end

    W --> X[Return employeeId + deleteToken]
    X --> Y[Client shows success + badge status bar]
    Y --> Z[SSE broadcasts to org chart viewers]
```

---

## Admin Re-Render Flow

```mermaid
flowchart LR
    A[Admin clicks Render button] -->|POST /api/admin/badge/ID/render| B[Server]
    B --> C[Load badge record from SQLite]
    C --> D[renderBadgePlaywright]
    D --> E[Save data/badges/ID.png]
    E --> F[Delete cached thumbnail]
    F --> G[Return success]
```

Both flows use the same `renderBadgePlaywright()` function — identical output regardless of who triggers the render.

---

## Admin Photo Upload Flow

```mermaid
flowchart TD
    A[Admin clicks Photo button] --> B[File picker opens]
    B --> C[Cropper.js modal]
    C -->|Crop to 740/720 aspect ratio| D[700x630 canvas]
    D -->|toBlob JPEG 85%| E[POST /api/admin/badge/ID/photo]
    E --> F[Sharp resize max 1200x1200]
    F --> G[Save data/photos/ID.jpg]
    G --> H[Set has_photo=1 in SQLite]
    H --> I[Admin can now re-render badge with photo]
```

---

## Playwright Render Pipeline

```mermaid
flowchart TD
    A[renderBadgePlaywright called] --> B[Launch headless Chromium]
    B --> C[Navigate to localhost:3000/]
    C --> D[Clear preview area DOM]
    D --> E[Inject badge data via updateBadge]
    E --> F{Photo file exists?}
    F -->|Yes| G[Read photo → base64 data URL → inject]
    F -->|No| H[Read placeholder-photo.png → inject]
    G --> I[Wait 300ms for image render]
    H --> I
    I --> J[Strip all DOM except badgeCapture]
    J --> K[Position badge at 0,0 fixed]
    K --> L[Apply clip-path: inset 0 round 75px]
    L --> M[element.screenshot omitBackground:true]
    M --> N[Sharp: ensureAlpha → PNG buffer]
    N --> O[SVG rounded-rect mask 75px radius]
    O --> P[Sharp composite dest-in blend]
    P --> Q[Return RGBA PNG with transparent corners]
    Q --> R[browser.close in finally block]
```

---

## Storage Layout

```mermaid
graph LR
    subgraph SQLite ["data/badges.db (SQLite WAL)"]
        DB[Badge Records<br/>name, dept, title, song<br/>has_photo, photo_public<br/>is_paid, is_printed<br/>is_flagged, is_visible<br/>created_at, delete_token]
    end

    subgraph Filesystem ["data/ directory"]
        PH[data/photos/ID.jpg<br/>Cropped headshot<br/>700x630 JPEG 85%<br/>Source material for re-renders]
        BD[data/badges/ID.png<br/>Full rendered badge<br/>1276x2026 RGBA PNG<br/>Transparent rounded corners]
        NP[data/badges/ID-nophoto.png<br/>Privacy variant<br/>Same as above but no photo<br/>Only if photoPublic=false]
        TH[data/thumbs/ID.png<br/>Auto-generated thumbnail<br/>320px wide, cached<br/>Regenerated when source changes]
    end

    DB -.->|has_photo flag| PH
    PH -->|Playwright render| BD
    BD -->|Sharp resize| TH
```

---

## API Endpoints (Render-Related)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/badge` | POST | Rate limited | Create badge → server renders via Playwright |
| `/api/badge/:id/image` | GET | Public | Serve full badge PNG |
| `/api/badge/:id/thumb` | GET | Public | Serve 320px thumbnail (auto-cached) |
| `/api/badge/:id/photo` | GET | Public | Serve cropped headshot JPEG |
| `/api/admin/badge/:id/render` | POST | Bearer token | Re-render badge via Playwright |
| `/api/admin/badge/:id/photo` | POST | Bearer token | Upload/replace photo (with crop modal) |

---

## Key Design Decisions

**Why server-side render for fan badges?**
- html2canvas output varies by browser/device — a fan on old Android gets different quality than desktop Chrome
- Playwright renders with perfect CSS fidelity every time
- Server controls the output — consistent print-ready badges
- Client still shows live CSS preview (zero render cost for browsing)

**Why keep photos separate from rendered badges?**
- Re-renders: if badge design changes, all existing badges can be re-rendered from stored photos
- Photo endpoint: org chart views could use cropped photos directly for better avatar quality
- Privacy: no-photo variant rendered separately without touching the original photo

**Why skull headset placeholder?**
- Badges without photos looked broken ("404 Photo Not Found" text)
- Placeholder gives consistent visual appearance across all badges
- On-brand (Help Desk skeleton mascot with headset polo)

**Photo homogenization:**
- Cropper.js enforces 740/720 aspect ratio on all uploads
- `getCroppedCanvas()` outputs fixed 700x630px regardless of source camera
- All photos are uniform — no device-specific variation

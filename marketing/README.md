# Prism — marketing assets

All graphics are built from the real app UI (demo backend, captured at 2×) and the Prism
design system (`app/src/design`), composed as HTML in `src/` and rendered with headless Edge.
Every composition exists in a dark and a light variant unless noted.

## Banners

| File | Size | Use |
|---|---|---|
| `hero.png` / `hero-light.png` | 2400 × 1000 | Website hero / store header |
| `og.png` / `og-light.png` | 1200 × 630 | Open Graph / social link preview |
| `features.png` / `features-light.png` | 2400 × 1500 | Feature grid: segmentation, browser integration, 8K/HDR video, queues & scheduler, site grabber, crash-safe resume, liquid-glass UI, light & dark |

## Screenshots in device frames — `screens/` (2400 × 1500)

| File | Shows |
|---|---|
| `main-{dark,light}.png` | Main window with the connections pane |
| `video-{dark,light}.png` | In-page “Download video” button + quality picker over a browser window |
| `details-{dark,light}.png` | Download details window (connection lanes, speed graph) + mini window |
| `scheduler-{dark,light}.png` | Scheduler sheet |
| `grabber-{dark,light}.png` | Site grabber results |
| `settings-{dark,light}.png` | Settings → Appearance |
| `desktop-{dark,light}.png` | Download File dialog, completion dialog and mini window on the desktop |

## Feature cards — `cards/` (1080 × 1080, square)

`card-1` … `card-6` (dark) and `card-N-light.png`:

1. 16 connections. One file. — dynamic segmentation
2. Any video. Up to 8K HDR.
3. Every click, captured. — browser integration
4. Set it. Sleep. Done. — queues & scheduler
5. Pull the plug. Lose nothing. — crash-safe resume
6. Your light. Your dark. — themes

## Logo pack — `logo-pack/`

`svg/`
- `prism-mark.svg`: full-colour mark that works on both light and dark backgrounds.
- `prism-mark-on-dark.svg`: white-glass mark for dark backgrounds.
- `prism-mark-mono.svg`: one colour, uses `currentColor`.
- `prism-mark-white.svg`, `prism-mark-black.svg`: single-colour versions.
- `prism-wordmark-for-dark-bg.svg`, `prism-wordmark-for-light-bg.svg`: mark plus the “Prism” name in outlined Inter.
- `prism-app-icon.svg`: 1024 px app icon. `prism-app-icon-small.svg`: simplified version for 32 px and below.

`png/`
- Each mark (`prism-mark`, `-on-dark`, `-white`, `-black`) at 128, 512 and 1024 px.
- `prism-app-icon` at 128, 512 and 1024 px.
- Each wordmark at 600, 1200 and 2400 px wide.
- `prism-lockup-{dark,light}-1600x900.png`: wordmark centred on a brand background.

Source of truth: `assets/brand/` (see `docs/design-system.md` §10).

## Rebuilding

1. Raw captures in `src/raw/` (`<view>-<theme>.png`, 2×) come from the demo UI:
   `npm --prefix app run dev`, then e.g. `http://localhost:1420/?theme=dark&select=demo0#/`,
   `?sheet=scheduler:night`, `?sheet=grabber:g1`, `?sheet=settings:appearance`,
   `#/details/demo0`, `#/video/vid1`, `#/mini`, `#/capture/cap1`, `#/complete/demo4`
   (window routes captured in a 1440 × 900 viewport and cropped to the window).
2. Render a composition, e.g.
   `msedge --headless=new --disable-gpu --hide-scrollbars --window-size=2400,1500 --screenshot=screens/main-dark.png "file:///…/marketing/src/screen.html?shot=main&theme=dark"`
   - `hero.html` (2400×1000), `og.html` (1200×630), `features.html` (2400×1500)
   - `screen.html?shot=main|video|details|scheduler|grabber|settings|desktop`
   - `card.html?card=1..6`
   - add `&theme=light` (or `?theme=light`) for the light variant.

The demo content is fictional (example.com hosts); *Big Buck Bunny* and *Cosmos Laundromat* are Blender open movies (CC BY).

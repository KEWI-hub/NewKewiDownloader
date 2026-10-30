# Prism — posters & ad banners

Every file comes in `-dark` and `-light`. All compositions are HTML in `src/`, rendered with headless Edge.

## Print — `print/`

These are A2 portrait posters, 4961 × 7016 px at 300 dpi.

| File | Theme |
|---|---|
| `poster-beam-{dark,light}-A2.png` / `.pdf` | **One beam. Many rays.** Key visual: a glass prism splitting one beam into segmented spectral rays. |
| `poster-engine-{dark,light}-A2.png` / `.pdf` | **16 connections. One file.** Connection lanes plus the measured figures: 966 MiB/s, ≈15×, crash-safe resume. |
| `poster-video-{dark,light}-A2.png` / `.pdf` | **Any video. MP4 or MP3.** The real video dialog, with the MP4 / MP3 choice. |

- The PDFs are one A2 page each (420 × 594 mm). They embed the 300-dpi image as a high-quality JPEG.
- There is **no bleed**. If the printer needs 3 mm bleed, re-render with a larger window and crop marks.

## Web posters — `web/`

`poster-{beam,engine,video}-{dark,light}.png` at 1240 × 1754. These are the same layouts at web size.

## Banners — `banners/`

| File | Size |
|---|---|
| `billboard-6000x2000-{theme}.png` | 6000 × 2000 |
| `web-hero-3840x1600-{theme}.png` | 3840 × 1600 |

## Social — `social/`

| File | Size | Notes |
|---|---|---|
| `youtube-channel-art-2560x1440-{theme}.png` | 2560 × 1440 | Logo and claim sit inside the 1546 × 423 safe area that shows on every device. |
| `x-header-1500x500-{theme}.png` | 1500 × 500 | Copy starts 270 px from the left, clear of the profile picture. |
| `linkedin-banner-1584x396-{theme}.png` | 1584 × 396 | Copy starts 420 px from the left, clear of the avatar. |
| `instagram-post-{1,2,3}-1080x1350-{theme}.png` | 1080 × 1350 | The three poster themes. |
| `story-{1,2}-1080x1920-{theme}.png` | 1080 × 1920 | Key elements stay clear of the top and bottom ~250 px UI zones. |
| `producthunt-{1..4}-1270x760-{theme}.png` | 1270 × 760 | Gallery: hero, engine, video (MP4 / MP3), light & dark. |

## Claims used (all from `docs/benchmarks.md` / the app)

- **966 MiB/s** raw throughput: 2 GiB on localhost, 8 connections (scenario B).
- **≈15×** faster than a single connection on servers that throttle each connection: 1 GiB at 4 MiB/s per connection, 16 connections versus curl (scenario A).
- **Crash-safe resume**, SHA-256 verified.
- **Up to 32 connections** per file.
- Video comes down as **MP4** at a chosen quality, or **MP3** audio at 320 kbps.
- Runs on **Windows · Linux · macOS**.
- No third-party logos. The only external name shown is the demo video title inside the app screenshot (Big Buck Bunny, Blender open movie, CC BY).

## Rebuilding

Sources live in `src/`:
- `poster.html?p=beam|engine|video&theme=dark|light` is designed at 1240 × 1754.
- `banner.html?f=billboard|webhero|youtube|x|linkedin|ig1|ig2|ig3|story1|story2|ph1..ph4&theme=…` covers every other format.
- `kv.js` is the SVG key visual. `ps.css` and `pk.js` hold shared styles and helpers.
- `raw/` holds the app captures at 3–4× resolution from the demo UI (`npm --prefix app run dev`).

Render command:

```
msedge --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --force-device-scale-factor=<scale> --window-size=<css w>,<css h> --virtual-time-budget=6000 \
  --screenshot=<out.png> "file:///…/marketing/posters/src/poster.html?p=beam&theme=dark"
```

Scale factors:

| Output | Scale |
|---|---|
| A2 posters | 4 (then resampled 4960 → 4961 px) |
| Billboard | 4 |
| Web hero, YouTube | 2 |
| Everything else | 1 |

To make the PDFs: `Image.open(png).save(pdf, "PDF", resolution=300, quality=95)` (Pillow).

**Blender key visual:** add `&kv=../../keyvisual/<still>.png` to `poster.html?p=beam` or to any `banner.html` key-visual format. That replaces the SVG prism with the raster still. `marketing/keyvisual/` was still empty when these files were rendered.

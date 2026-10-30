# Prism Design System

Direction: **Obsidian Glass** (see `design/DECISION.md`). Calm obsidian solids for data, liquid glass
for floating chrome, one spectral signature for moving bytes.

```
app/src/design/
  fonts.css          @font-face (Inter 4 variable + JetBrains Mono variable, self-hosted, OFL)
  fonts/             woff2 files + OFL-Inter.txt, OFL-JetBrainsMono.txt
  tokens.css         all design tokens (CSS custom properties)
  base.css           reset, typography, focus, scrollbars, materials, progress, reduced motion
  components.css     reference component classes (used by the mockups; import or port 1:1)
  icons/
    icons.source.mjs single source of truth for icon geometry
    generate.mjs     → svg/*.svg, index.tsx, names.ts, design/assets/icons.js
    index.tsx        <Icon name="…" />
    names.ts         IconName union, ICON_NAMES, ICON_GROUPS
assets/brand/        logo, wordmarks, app icon (SVG + PNG + .ico + Tauri icon set), tray icons
design/              moodboard, mockups, screenshots
```

Root setup:

```ts
import "./design/fonts.css";
import "./design/tokens.css";
import "./design/base.css";
import "./design/components.css";
```

```html
<html data-theme="dark" data-accent="prism" data-density="comfortable" class="">  <!-- add "no-blur" / "reduce-motion" from settings -->
```

---

## 1. Colour

### 1.1 Surfaces & text

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg-canvas` | `#07080b` | `#e6e8ee` | Window background under glass (with `--bg-ambient` light pools; use `.canvas`) |
| `--surface-sunken` | `#090a0e` | `#f0f1f5` | Wells, tracks |
| `--surface-base` | `#0d0e13` | `#fbfbfd` | Content sheet: the download table |
| `--surface-raised` | `#14151c` | `#ffffff` | Cards, headers, settings groups |
| `--surface-overlay` | `#1a1b23` | `#ffffff` | Solid popovers, segmented thumb |
| `--text-primary` | `#eceef4` | `#111318` | Names, values, titles |
| `--text-secondary` | `#a3a7b5` | `#4a4f5c` | Labels, secondary values, icons in toolbars |
| `--text-tertiary` | `#888da1` | `#5e6373` | Meta (host · type), captions, counts |
| `--text-disabled` | `#555a68` | `#a4a8b4` | Disabled & decorative only (exempt from contrast) |
| `--border-subtle / default / strong` | white 6 / 10 / 16 % | ink 6 / 10 / 17 % | Hairlines |
| `--divider` | white 5.5 % | ink 6.5 % | Row separators |
| `--state-hover / pressed` | white 4.5 / 8 % | ink 4 / 7 % | State layers on any surface |
| `--state-selected` | accent 14 % | accent 10 % | Selected rows / nav items (+ `--state-selected-border`) |

### 1.2 Accents (`data-accent`)

Each accent defines `--accent` (text/icon), `--accent-rgb` (for tints), `--accent-solid` (fills),
`--accent-solid-hover`, `--accent-contrast` (text on solid) and `--accent-2` (gradient partner).
Derived: `--accent-soft` (14 %), `--accent-softer` (8 %), `--accent-border` (35 %), `--accent-glow`,
`--focus-ring`, `--gradient-accent`, `--progress-fill`.

| Accent | Dark text / solid / on-solid | Light text / solid / on-solid |
|---|---|---|
| **prism** (default, signature violet-blue) | `#8e8cff` / `#6461f2` / `#fff` | `#4f4be0` / `#5653ea` / `#fff` |
| cyan | `#4fd3ee` / `#36c5e6` / `#03141b` | `#0a7899` / `#0b7fa0` / `#fff` |
| emerald | `#46d99c` / `#2fc489` / `#04150e` | `#087f53` / `#087f53` / `#fff` |
| amber | `#f5bd55` / `#f2b54a` / `#1a1203` | `#a35f00` / `#a86200` / `#fff` |
| rose | `#ff8aa5` / `#d03a64` / `#fff` | `#c42d58` / `#cf3760` / `#fff` |
| graphite (monochrome) | `#d6d9e2` / `#e6e8ee` / `#111318` | `#2b2f38` / `#1f2229` / `#fff` |

The accent also tints the window's ambient light (`--ambient-1`), so the glass picks up the user's colour.

### 1.3 Status colours (fixed — never follow the accent)

| Status | Token | Dark | Light | Icon |
|---|---|---|---|---|
| Downloading, merging | `--status-downloading` → `--accent` | accent | accent | `status-downloading`, `status-merging` |
| Completed | `--success` | `#3dd68c` | `#0a7d50` | `status-completed` |
| Paused, waiting/retrying | `--warning` | `#f5b544` | `#9a5800` | `status-paused`, `status-waiting` |
| Failed | `--danger` | `#ff6b6b` | `#c42f35` | `status-error` |
| Scheduled, verifying | `--info` | `#5cc8f0` | `#0a70a0` | `status-scheduled`, `status-verifying` |
| Queued | `--neutral` | `#8a8fa0` | `#646979` | `status-queued` |

Every status is also distinguishable by **icon and text**, never by colour alone.
Each status colour has an `-rgb` triplet (`--success-rgb` …) for tinted backgrounds (`.badge--success`).

### 1.4 Spectrum (brand signature)

`--spectrum-1 … 8` (dark: `#8b7bff #6a8cff #46a8ff #2fcbe6 #2ed3a9 #7ad66a #f2c14e #ff7f8f`; light uses
deeper variants). Used **only** for: connection n → `--spectrum-((n-1) % 8 + 1)` in segment bars and
lanes, the logo, the completion burst, and `--gradient-prism` in marketing. Never for buttons, text or status.

File-type tints for icon tiles: `--type-video | audio | image | archive | document | program | other`.

### 1.5 Contrast (WCAG 2.2, measured)

Glass values are the *effective* background: tint composited over the canvas, and over the strongest
ambient light pool (worst case).

**Dark**

| Text token | on base | on raised | on glass | on glass @ ambient |
|---|---|---|---|---|
| text-primary `#eceef4` | 16.6 | 15.7 | 16.4 | 13.5 |
| text-secondary `#a3a7b5` | 8.0 | 7.6 | 7.9 | 6.5 |
| text-tertiary `#888da1` | 5.9 | 5.5 | 5.8 | 4.7 |
| success `#3dd68c` | 10.3 | 9.7 | 10.1 | 8.3 |
| warning `#f5b544` | 10.6 | 10.0 | 10.5 | 8.6 |
| danger `#ff6b6b` | 7.0 | 6.6 | 6.8 | 5.6 |
| info `#5cc8f0` | 10.1 | 9.5 | 9.9 | 8.2 |
| neutral `#8a8fa0` | 6.0 | 5.7 | 5.9 | 4.8 |

**Light**

| Text token | on base | on raised | on glass | on glass @ ambient |
|---|---|---|---|---|
| text-primary `#111318` | 18.0 | 18.6 | 16.6 | 14.8 |
| text-secondary `#4a4f5c` | 7.9 | 8.2 | 7.3 | 6.5 |
| text-tertiary `#5e6373` | 5.8 | 6.0 | 5.3 | 4.8 |
| success `#0a7d50` | 5.0 | 5.2 | 4.6 | 4.1 * |
| warning `#9a5800` | 5.4 | 5.6 | 5.0 | 4.4 * |
| danger `#c42f35` | 5.3 | 5.5 | 4.9 | 4.4 * |
| info `#0a70a0` | 5.3 | 5.5 | 4.9 | 4.4 * |

**Accents**: accent text on `surface-base` — dark ≥ 6.7:1 (prism 6.7, rose 8.7, others ≥ 10.7),
light ≥ 4.8:1 (prism 5.95, cyan 4.89, emerald 4.87, amber 4.84, rose 5.26, graphite 13.0).
Text on accent solids: prism 4.63 / 5.50, cyan 9.19 / 4.61, emerald 8.38 / 5.03, amber 10.15 / 4.76,
rose 4.70 / 4.81, graphite 15.2 / 15.9 (dark / light). **All body-text pairs pass AA (4.5:1).**

\* Rule: status and accent colours are used as **text** only on solid surfaces. On glass, coloured
elements are icons, dots or badges (non-text, ≥ 3:1 required — all pass) paired with
`--text-primary/secondary` labels. `--text-disabled` is for disabled controls only (WCAG-exempt).

---

## 2. Spacing, layout, radii

4 px grid with 2 px half-steps: `--space-0_5 2` · `-1 4` · `-1_5 6` · `-2 8` · `-2_5 10` · `-3 12` ·
`-4 16` · `-5 20` · `-6 24` · `-8 32` · `-10 40` · `-12 48` · `-16 64`.

| Metric | Token | Value |
|---|---|---|
| Sidebar width | `--sidebar-w` | 236 (glass panel 228 + gutter) |
| Window gutter (glass ↔ sheet) | `--window-gutter` | 8 |
| Toolbar | `--toolbar-h` | 52 |
| Title row (page title + filters) | — | 60 |
| Table header | `--table-header-h` | 32 |
| Row, comfortable / compact | `--row-h-comfortable` / `--row-h-compact` (→ `--row-h`) | 44 / 30 |
| Status bar | `--statusbar-h` | 30 |
| Controls | `--control-h-xs/-sm/(default)/-lg` | 22 / 26 / 30 / 36 |
| Icon sizes | `--icon-xs…xl` | 14 / 16 / 18 / 20 / 24 |

Radii: `--radius-xs 4` (badges, bars) · `-sm 6` (small buttons, chips) · `-md 8` (controls, rows) ·
`-lg 12` (panels, sheet, popovers) · `-xl 16` (dialogs) · `-2xl 22` (hero tiles) · `-full`.
Semantic: `--radius-control 8`, `--radius-row 8`, `--radius-panel 12`, `--radius-dialog 16`,
`--radius-menu 10`, `--radius-menu-item 6`. Sidebar glass panel uses 14. Nested radii = outer − padding.

---

## 3. Elevation

| Token | Use |
|---|---|
| `--shadow-1` | Pressed / tiny lift (thumb, chip) |
| `--shadow-2` | Raised cards, row hover action cluster, tooltips |
| `--shadow-3` | Menus, popovers, dragged rows |
| `--shadow-4` | Dialogs and secondary windows |
| `--shadow-sheet` | The content sheet: hairline ring + soft drop |
| `--highlight-top` | 1 px top inner highlight for solid raised surfaces |

Glass has its own depth: `--glass-highlight` (inset top highlight) + `--glass-shadow`.

---

## 4. Glass materials & blur

### Recipes (`base.css`)

| Class | Blur | Tint (dark / light) | Extras | Where |
|---|---|---|---|---|
| `.glass` | `--blur-lg` 40 | `rgb(22 23 31/.56)` / `rgb(248 249 252/.58)` | sheen, specular rim, highlight, shadow | Sidebar, status bar (with `.blur-md`), toolbars that float |
| `.glass-strong` | 40 | `/.78` / `/.80` | + caustic light | Dialogs, menus, popovers, toasts, mini window, video quality menu |
| `.glass-subtle` | `--blur-md` 24 | `/.38` / `/.40` | no drop shadow | Large background panes (rare) |
| `.solid` / `.solid-raised` | — | `--surface-base` / `--surface-raised` | sheet shadow / top highlight | Tables, cards, inputs |

Modifiers: `.blur-sm` (12) · `.blur-md` (24) · `.blur-lg` (40) · `.blur-xl` (64, mini window over the
desktop) · `.edge-top | .edge-bottom | .edge-right | .edge-none` (which edges get the specular rim).
`.canvas` paints `--bg-canvas` + `--bg-ambient` (the soft accent/cyan/rose light pools glass refracts).

Anatomy (layers, bottom → top): **refraction** (`backdrop-filter: blur() saturate(170%)`) → **tint**
(`--glass-tint*`) → **sheen** (`--glass-sheen`, top-down falloff) → **specular rim** (`::before`, 1 px
masked `--glass-rim` gradient: bright top-left key light, faint bounce bottom-right) → **depth**
(`--glass-highlight`, `--glass-shadow`). `.glass*` uses both `::before` and (strong) `background-image`;
wrap content if a component needs its own pseudo-elements.

### Rules — where glass is allowed

1. **At most ~6 blurred surfaces visible at once**, all large and mostly static: sidebar, status bar,
   (floating) toolbar, one dialog, one menu/popover, toast.
2. **Never** on table rows, list items, badges, chips, thumbnails, or anything inside the virtualized
   list. Never animate the *size* of a blurred element; animate `transform`/`opacity` only.
3. Glass must sit over something that varies (the ambient canvas or scrolling content). Glass over a
   flat colour equal to its tint is just grey — use `.solid` instead.
4. Dense data (tables, logs, lanes) sits on solid surfaces, even inside a glass window (`.wbody-solid`
   pattern in the mockups).
5. **Fallback:** `<html class="no-blur">` (Settings → Appearance → Liquid glass off, auto on remote
   desktop / software rendering / WebKitGTK without GPU), `@media (prefers-reduced-transparency: reduce)`
   and browsers without `backdrop-filter` all switch to `--glass-fallback*` — same rim, sheen and
   shadow, near-opaque tint. Layout and hierarchy are identical (`design/screens/a-dark-noblur.png`).
6. Secondary OS windows: on Windows 11 use native Mica/Acrylic behind a transparent WebView and keep
   the CSS tint; on Linux default those windows to `.no-blur`.

---

## 5. Typography

Inter 4 variable (`opsz` + `wght` axes, self-hosted latin + latin-ext). JetBrains Mono variable for
URLs, hashes, byte ranges, logs, and numeric columns in compact density. `font-optical-sizing: auto`.
Features: `cv05` (l with tail), `cv08` (upper-case 0 slashed), `ss03` (round quotes); live numbers use
`.tnum` (`tabular-nums`) so columns never jitter.

| Token | px | Weight | Tracking | Use |
|---|---|---|---|---|
| `--text-3xl` | 34 | 650 | −0.024em | Onboarding, marketing |
| `--text-2xl` | 26 | 600 | −0.024em | Hero numbers (speed readout, details %) |
| `--text-xl` | 20 | 600–650 | −0.022em | Page title ("All downloads") |
| `--text-lg` | 16 | 600 | −0.014em | Dialog titles |
| `--text-md` | 14 | 400 | −0.006em | Dialog body |
| `--text-base` | **13** | 400/500 | −0.006em | Default UI: rows, buttons, menus, inputs |
| `--text-sm` | 12 | 400/500 | −0.006em | Secondary row text, table header, tooltips |
| `--text-xs` | 11 | 500 | 0 | Status bar, badges, counts |
| `--text-2xs` | 10 | 600 | +0.06em CAPS | Overline section captions |

Utilities: `.t-display .t-title .t-heading .t-body .t-body-lg .t-small .t-caption .t-overline .t-mono .tnum`,
colour helpers `.text-primary/-secondary/-tertiary/-accent/-success/-warning/-danger/-info`, `.truncate`.
File names truncate **in the middle** (keep the extension) — done in JS.

---

## 6. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 80 ms | Press feedback, checkbox tick |
| `--dur-fast` | 140 ms | Hover, colour, tooltip in |
| `--dur-base` | 200 ms | Menus, popovers, segmented thumb, switch |
| `--dur-slow` | 320 ms | Dialogs, panels, sidebar collapse |
| `--dur-slower` | 480 ms | Completion burst, onboarding |
| `--dur-progress` | 250 ms linear | Progress/segment tween = one engine tick (4 Hz) |
| `--dur-shimmer` | 1.8 s loop | Active progress shimmer |
| `--dur-pulse` | 2.4 s loop | Live status dot |

Easings: `--ease-standard (.2,0,0,1)` default · `--ease-out (.16,1,.3,1)` entrances · `--ease-in (.4,0,1,1)`
exits · `--ease-in-out (.65,0,.35,1)` loops · `--ease-spring (.34,1.36,.64,1)` switch knob / tick only.

What animates: progress fills (`transform: scaleX`, linear 250 ms), shimmer on active fills (transform
only, child of the fill so it never leaks into the track), live write-heads on connection lanes, the
live status dot pulse, dialogs/popovers (`prism-pop-in`: 4 px rise + fade, 200 ms), toasts, row
insert/remove (height + fade, 200 ms), segmented thumb, switch knob. **Nothing else moves while idle.**
Keyframes: `prism-shimmer`, `prism-indeterminate`, `prism-pulse`, `prism-pop-in`, `prism-fade-in`,
`prism-spin` (+ `.anim-pop-in`, `.anim-fade-in`, `.anim-pulse`, `.anim-spin`).

Reduced motion (`prefers-reduced-motion` or `<html class="reduce-motion">`): loops stop, transitions
become 1 ms; progress values still update (information, not decoration). Pause shimmer when the window
is hidden/minimized (`document.visibilityState`).

---

## 7. Iconography

* 136 original icons, `app/src/design/icons/svg/*.svg`, specimen `design/icons.html`.
* 24 × 24 grid, live area 2–22, **1.75 stroke**, round caps & joins, `currentColor`, no fills except
  dots (ⓘ, !, ellipsis, drag handle) and the HDR half-disc.
* Keylines: circle r 9, square 16, portrait 14 × 17, landscape 18 × 14. Status icons all share the
  r 9 ring so they align in columns. File-type icons share one document silhouette.
* Sizes: 18 toolbar · 16 rows/menus/sidebar · 14 badges & status bar (use `strokeWidth={2}`) ·
  24+ hero (use `strokeWidth={1.5}`).
* Metaphors: download = arrow into tray; resume = play; queue = list; scheduler = alarm clock;
  grabber = globe + arrow; verifying = dashed ring + check; merging = converging arrows; waiting = hourglass.
* Edit `icons.source.mjs`, then `node app/src/design/icons/generate.mjs`.

### `<Icon>` API

```tsx
import { Icon, type IconName, ICON_NAMES, ICON_GROUPS, ICONS } from "@/design/icons";

<Icon name="pause" />                         // 18 px, decorative (aria-hidden)
<Icon name="status-error" size={14} strokeWidth={2} className="text-danger" />
<Icon name="delete" title="Delete download" /> // role="img" + <title>
```

Props: `name: IconName` (required) · `size?: number | string` (18) · `strokeWidth?: number` (1.75) ·
`title?: string` · plus any SVG props. Renders inline geometry from a static map (no fetching), adds
`class="icon"` and `data-icon`.

Groups (`ICON_GROUPS`): `toolbar` (add-url, resume, pause, stop, stop-all, delete, delete-completed,
options, settings, scheduler, start-queue, stop-queue, grabber, speed-limiter, batch, import, export,
search, filter, more, more-vertical, columns, download, upload) · `categories` (all, video, music,
documents, programs, compressed, images, other, folder, custom-folder, unfinished, finished, queue,
grabber-project, trash) · `files` (file, file-video, file-audio, file-image, file-archive,
file-document, file-pdf, file-exe, file-code, file-font, disk-image, torrent) · `status`
(status-downloading, -paused, -queued, -completed, -error, -scheduled, -verifying, -merging, -waiting)
· `actions` (folder-open, open-file, copy, link, refresh-url, retry, move, rename, properties, checksum,
shield, power, sleep, lock, lock-closed, lock-open, key, sound, sound-off, clipboard, browser, puzzle,
globe, proxy, hard-drive, activity, bolt, calendar, clock, history, eye, user, bell, tag, star, list,
grid, sidebar, x-circle, prism) · `window` (chevron-*, chevrons-up-down, chevrons-right, arrow-*,
close, minimize, maximize, restore, pin, mini-mode, sun, moon, monitor, check, plus, minus, info,
warning, play, external, drag-handle, sort-asc, sort-desc) · `media` (magnet, subtitle, hdr,
music-note, playlist, thumbnail, picture-in-picture).

---

## 8. Components (reference classes in `components.css`)

| Component | Class(es) | Spec |
|---|---|---|
| Button | `.btn` + `--primary`, `--ghost`, `--danger`, `--danger-solid`, `--sm`, `--lg`, `--icon` | 30 h (26 sm / 36 lg), radius 8, 12 px x-padding, 13/500 text, 6 gap, icon 16. Primary: accent solid, inner top highlight, accent-tinted drop shadow. Press: translateY .5 + scale .985 (80 ms). One primary per surface; destructive never primary-coloured. |
| Toolbar button | `.tb-btn`, `.tb-btn--labeled`, `.tb-sep` | 34 × 34 hit area, radius 9, 18 px icon in `--text-secondary`; hover state layer + primary text; `aria-pressed="true"` → accent-soft. Separators 1 × 18. Labels in tooltips (`Resume · Ctrl R`). |
| Sidebar item | `.side-item` (+ `__label`, `.count`), `.side-section` | 30 h, radius 8, 16 px icon (tertiary), 13/500 label, count right in 11 px tabular. Current: `aria-current="true"` → `--state-selected` + 1 px accent ring, icon in accent. |
| Table row | (app) | Comfortable 44: 44 × 28 lead slot (file tile 28 or video thumb 44 × 28), name 13/500 + meta 11.5 tertiary; progress cell = status/percent line + 4 px bar; numbers right-aligned tabular. Compact 30: one line, 20 px tile, progress inline (96 px status text + bar), mono numbers. Dividers inset from the lead slot; hover = state layer + floating action cluster (28 px `tb-btn`s on `--surface-raised`, `--shadow-2`); selected = `--state-selected` + accent ring + visible checkbox. |
| Progress | `.progress` + `.progress__fill`, `data-state="active|paused|queued|completed|error|indeterminate"`, `--value: 0..1`, `.progress--thin/--thick/--xl` | 4 px track (3/6/8–10), radius full, fill via `scaleX`. Active: accent gradient + glow + shimmer. Completed is intentionally muted (success 55 %). |
| Segment bar | `.segbar` + `.segbar__seg` (`--a`, `--b`, `--p`, `--c`, `data-active`) | 6–12 px, radius 4. Each segment occupies its byte range; fill = `--spectrum-n`; active write-head = 2 px white line with coloured glow. Details window also shows per-connection *lanes* (7 px, full width, range + speed in mono). |
| File tile / thumb | `.file-tile` (`--tint`), `.thumb` (`--thumb`) + `.thumb__dur` | Tile 28 radius 8 (24/20 in dense contexts), 14 % tint bg + 18 % ring, icon 60 % of tile. Thumb 44 × 28 radius 6, duration chip 8.5/600. |
| Badge | `.badge` + `--accent/--success/--warning/--danger/--info/--outline`, `.count`, `.status-dot(--live)` | 18 h, radius 4, 11/500, 13 % tint (10 % light). Status badges always include icon + text. |
| Input | `.input` (+ `--lg`, `--invalid`), `.field`, `.field__label`, `.field__hint`, `.select`, `.kbd` | 30 h, radius 8, inset 1 px border + inner shadow; focus = accent border + 3 px accent halo. URL/path values in mono, middle-truncated. |
| Checkbox | `.checkbox[aria-checked]` | 16, radius 5, 1.5 px ring; checked = accent solid + 12 px check (stroke 2.5). |
| Switch | `.switch[aria-checked]` | 32 × 18 track, 14 knob, spring easing, accent when on. |
| Segmented control | `.segmented` + `.segmented__item[aria-selected]` (+ `__count`, `--sm`) | 30 h (26 sm), 2 px inset, thumb = `--surface-overlay` + shadow; 12/500 labels. |
| Menu / context menu | `.menu.glass-strong.blur-sm` + `.menu__item` (`.kbd-hint`, `--danger`), `.menu__sep`, `.menu__label` | min 220 w, 5 px padding, radius 10; items 28 h, radius 6, icon 15 secondary; hover = accent solid with contrast text. Destructive item last, red. |
| Tooltip | `.tooltip` | Inverse surface, 12/500, radius 7, 5 × 8 padding, optional `.kbd`. Delay 500 ms in, 0 out; 140 ms fade. |
| Toast | `.toast.glass-strong.blur-md` | 320+ w, radius 12, 12 padding, 32 px status tile, one action button. Bottom-right, stack upward, 5 s auto-dismiss (pause on hover). |
| Dialog | `.dialog` (+ `__header`, `__title`, `__body`, `__footer`) on `.glass-strong` | Radius 16, `--shadow-4`; header 16/600 title; footer with `--divider` top, secondary actions left, Cancel + primary right. Enter: `prism-pop-in` 200 ms; scrim `--scrim` for in-window modals. |
| Window caption | `.caption` + `.caption__btn(--close)` | 44–46 × bar height, close hover `#c42b1c` (Windows convention). Custom title bars use `.drag-region` / `.no-drag`. |

---

## 9. Accessibility

* Body text pairs ≥ 4.5:1 (see §1.5); non-text UI (icons, focus rings, progress) ≥ 3:1.
* Status = colour **+ icon + text**; progress also exposes `role="progressbar"` with `aria-valuenow`
  and a text alternative (`"62.4 %, 18.4 MB/s, 2 minutes left"`), updated at most once per second for
  screen readers (`aria-live="polite"` region, not the 4 Hz tick).
* Focus: `:focus-visible` → `--focus-ring` (2 px surface gap + 2 px accent at 75 %). Never remove focus
  styles; inset variant `.focus-ring-inset` for elements in tight lists.
* Full keyboard: table is a grid (`role="grid"`, arrow keys, Space = pause/resume, Enter = open,
  Del = delete, Ctrl+A); toolbar is a `role="toolbar"` with roving tabindex; all icon buttons have
  accessible names (`<Icon title>` or `aria-label`).
* Hit targets ≥ 28 × 28 (toolbar 34 × 34).
* `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-color-scheme` are honoured;
  the app settings can force each.
* Do not convey information with the spectrum colours alone — segment lanes are numbered.
* Text is never placed directly on the ambient canvas or on spectrum colours.

---

## 10. Brand assets (`assets/brand/`)

| File | Use |
|---|---|
| `logo-mark.svg` | Universal mark (indigo glass prism, 5 segmented spectral rays) — works on light & dark |
| `logo-mark-on-dark.svg` | White-glass mark for dark tiles / dark UI |
| `logo-mark-mono.svg` | Single colour, `currentColor` |
| `logo-wordmark-dark.svg` / `-light.svg` | Mark + "Prism" (Inter 640, outlined) for **dark** / **light** backgrounds |
| `app-icon.svg` | 1024 master: obsidian rounded tile, ambient violet light, glass prism, rays bleeding off the edge |
| `app-icon-small.svg` | Hand-tuned ≤ 32 px master (solid white prism + 3 rays) |
| `app-icon.ico` | Multi-size ICO: 16/24/32 from the small master, 48–256 from the full art |
| `tauri-icons/` | Tauri set (`icon.ico` = hand-tuned ICO, `icon.icns`, PNGs, Windows Store logos) |
| `tray/tray-{idle,downloading,paused,error}-{light,dark}.svg` | `light` = white glyph for **dark** taskbars, `dark` = ink glyph for light taskbars; state badge bottom-right with a 1 px knock-out |
| `tray/tray-*-template.svg` | macOS template images (black + alpha only) |
| `png/` | Rasterized app icon 16–1024, logos 32–512, wordmarks @1x/@2x/@4x, tray 16/32/64 @1x/@2x |

Rebuild: `assets/brand/_build/` (`brand.mjs` → SVGs, `rasterize.mjs` → PNG + ICO using
`@resvg/resvg-js` and `png-to-ico`; `wordmark.py` outlines the wordmark from the bundled Inter), then
`npx @tauri-apps/cli@2.12.2 icon assets/brand/png/app-icon-1024.png -o assets/brand/tauri-icons` and copy
`app-icon.ico` over `tauri-icons/icon.ico` and `png/app-icon-32.png` over `tauri-icons/32x32.png`.

# Design direction — decision

**Chosen: A · "Obsidian Glass"** — with two ideas borrowed from the other explorations.

| | A · Obsidian Glass | B · Aurora | C · Studio |
|---|---|---|---|
| Screens | `screens/a-dark.png`, `a-light.png`, `a-dark-compact.png` | `screens/b-dark.png`, `b-light.png` | `screens/c-dark.png`, `c-light.png` |
| Glass | Sidebar + status bar over an ambient canvas; dialogs & menus | Every panel, over a vivid aurora field | Context menu only |
| Density | 44 px two-line rows · 30 px compact | 54 px card-like rows | 28 px single-line, 11 columns |
| Visible rows @ 900 px | 16 (comfortable) / 24 (compact) | 13 | 18 + docked details |
| GPU cost | 2–3 blurred surfaces, all static | 4 large blurred surfaces incl. the list | ~0 |

## Why A

1. **It is the only direction that satisfies both halves of the brief at once.** The client asked for
   *liquid glass* **and** *dark, dense, solid elements*. A puts glass exactly where it means something —
   the chrome that floats (sidebar over the ambient light, the status bar over the scrolling list,
   dialogs, menus, the mini window) — and keeps the data on a calm obsidian sheet. B is the most
   beautiful screenshot but the glass is everywhere, so it stops signalling hierarchy and the list
   competes with the wallpaper. C is a superb tool but has almost no glass, so it doesn't feel like Prism.
2. **Information density without noise.** The two-line row (file name / host · type) plus a progress
   cell that carries status text means we show *more* useful information than a 10-column IDM grid
   with fewer columns. Compact mode (30 px, inline progress, mono numbers) gives power users C's density
   with the same visual language — verified in `screens/a-dark-compact.png`.
3. **Performance-safe by construction.** WebView2 and especially WebKitGTK pay per blurred pixel per
   frame. In A the blurred surfaces are static (sidebar) or small (30 px status bar) and the table — the
   only thing that scrolls and animates at 4 Hz — is solid. B blurs a 850×820 surface that sits under
   a constantly-repainting list. The `.no-blur` fallback is visually ~95 % identical in A
   (`screens/a-dark-noblur.png`), because the hierarchy comes from tint, rim and shadow, not from blur.
4. **Calm.** Colour appears only where something is happening: the accent for active transfers, the
   spectrum only for connection segments, amber/red only for paused/failed. Completed items are
   intentionally muted (done is not news). This is the "clean, calm, focused, not overloaded" note.
5. **Both themes are first-class.** A light ("Porcelain") reads as frosted milk glass on a cool
   off-white sheet rather than an inverted dark theme.

## What we take from B and C

* **From B — the inspector & hero stats.** The selected-item inspector (thumbnail, 2×2 stat tiles,
  connection bar, speed graph) becomes the *Details window* layout (`details.html`) and an optional
  right-hand inspector pane (toggle, off by default) in the main window. B's in-page "glass pill"
  became the browser video button (`dialogs.html`).
* **From C — the engineering views.** C's per-connection lanes, Gantt-like file map, mono byte ranges
  and tabbed bottom panel inform the Details window's *Connections* panel; C's 11-column layout is the
  basis for the optional column chooser, and its context menu is the reference context menu.

## Follow-up mockups in direction A

| File | Content | Screens |
|---|---|---|
| `details.html` | Per-download window: live % / speed / ETA, 16 connection lanes (spectrum colours, live write heads), file map, 60 s speed graph. Animated at 4 Hz like the engine. | `screens/details-{dark,light}.png` |
| `dialogs.html` | Download File capture dialog, completion dialog (spectral burst), toast, mini window, in-browser *Download video* pill + quality menu. | `screens/dialogs-{dark,light}.png` |
| `settings.html` | Settings window, Appearance page (theme cards, accents, glass/motion, density, typography). | `screens/settings-{dark,light}.png` |
| `scheduler-grabber.html` | Scheduler (queues, weekdays, stop time, post-queue action, drag-reorder) and Site Grabber (stepper, crawl stats, type chips, result table). | `screens/scheduler-grabber-{dark,light}.png` |

## Implementation notes for the app

* Import `app/src/design/fonts.css`, `tokens.css`, `base.css`, `components.css` once at the root;
  put `data-theme`, `data-accent`, `data-density` (and `class="no-blur"` when the user turns glass
  off) on `<html>`.
* Main window: `.canvas` on the root, `.glass` sidebar (`left/top/bottom: 8px`, radius 14), a solid
  content sheet (`left: 244px`, inset 8, radius 12), `.glass.blur-md.edge-top` status bar overlaying
  the virtualized list (give the list `padding-bottom: var(--statusbar-h)`).
* Secondary windows (details, dialogs, settings): on Windows 11 create them transparent and apply
  Mica/Acrylic (`window-vibrancy`), then use `.glass-strong` with the same tint — the CSS blur then
  only affects in-window layers. On Linux/WebKitGTK default to `.no-blur` for secondary windows.

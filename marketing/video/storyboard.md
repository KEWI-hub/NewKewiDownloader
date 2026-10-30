# Prism — launch film storyboard ("One beam. Many rays.")

1920×1080 · 60 fps · 121.2 s (120 s of picture + a 1.2 s tail) · 100 BPM. One beat is 0.6 s
(36 frames) and one bar is 2.4 s, so every cut, title and sound hit lands on the beat grid.
Every time below comes from `src/timeline.json`, which drives both the picture and the sound.

| # | Time (s) | Bars | Picture | Type / kinetic | Sound |
|---|---|---|---|---|---|
| **1 Cold open** | 0.0 – 11.4 | 0 – 4¾ | Darkness, dust, a faint glass prism (Blender/Cycles). A thin white beam crosses the frame (2D lead-in, then the 3D beam). | — | Low D drone; the beam's charge-up riser and glass shimmer |
| | 4.8 | 2 | **HIT.** The beam enters the prism and splits into 8 spectral rays: flash, anamorphic streak, spark burst, camera shake, chromatic aberration | — | Impact + sub drop + glass shimmer; pads come in on Dm |
| | 6.0 / 7.2 | 2½ / 3 | Slow orbit around the prism; sparks run along each ray | "One beam." rises through a mask · "Many rays." letters fly in along the rays (spectral gradient) | Type hit · spectral chime |
| | 8.4 – 9.6 | 3½ – 4 | The headline shrinks into a tagline; the logo mark draws itself (triangle stroke, beam, then the 5 rays); "Prism" wordmark rises | Lockup | Reverse swell, soft chime |
| | 11.4 | 4¾ | **Glass shatter**: the whole frame breaks into ~120 3D shards that fly toward the camera | — | Shatter (crack, tinkles, body) |
| **2 The problem** | 11.4 – 21.0 | 4¾ – 8¾ | Near-black and grey. One thin line draws across the screen: one connection, crawling | "Most downloads" / "crawl." (letters crawl in one by one) | Clock ticks on every beat, pedal note, sparse bells |
| | 14.4 – 18.6 | | The progress fill crawls; mono stats: `1 connection · 4.0 MiB/s`, `ETA 4:16` (curl, benchmark scenario A) | "One connection." → "One lane." → "Waiting…" | Ticks |
| | 19.2 – 21.0 | 8 – 8¾ | Push-in; the line charges up white and shakes, then snaps back to the left edge | "Let it split." (glitch letters, RGB split) | Riser + accelerating snare roll, a 150 ms gap before the drop |
| **3 The engine** | 21.0 – 30.0 | 8¾ – 12½ | The line becomes the beam (Blender, locked camera) | — | Beam zip |
| | 21.6 | 9 | **DROP**: the beam hits the prism, 16 rays race out and **bend into 16 parallel lanes**. Masks sweep in from the right and turn the rays into progress lanes with white heads and per-lane speeds | — | Drop impact, 16 staggered zips, full groove starts |
| | 24.0 / 25.2 | 10 / 10½ | Lanes pump with the kick | "16 connections." / "One file." | Type slam |
| | 26.4 – 29.4 | 11 – 12¼ | Each lane drops down into its segment of the **file map**; the speed odometer rolls 0 → 61.8 MiB/s | Odometer | Long zip, counter ticks |
| | 30.0 – 33.6 | 12½ – 14 | Whip pan (motion blur) to the benchmark: curl's single bar against Prism's 16-segment bar (8× time-lapse) | **"15×"** slams at 31.2, then "faster on throttled servers", with the benchmark as a footnote | Whoosh, slam |
| | 33.6 – 36.0 | 14 – 15 | 32 lanes. **Work stealing**: lane 9 finishes, a spark arcs over and takes half of the biggest remaining gap | "Up to 32 connections." + callout | Zips, paired blips |
| | 36.0 – 38.4 | 15 – 16 | The lanes accelerate into speed streaks; 32 lanes merge back to 16 | **"966 MiB/s"** odometer slam; "raw throughput · 2 GiB written in 2.1 s" | Slam + fast whoosh |
| | 38.4 – 40.2 | 16 – 16¾ | **Pull the plug**: CRT power-off, black screen, a checkpoint line types itself (`fsync ✓`) | "Pull the plug." | The music tape-stops, power-down whine, key clicks |
| | 40.2 – 43.2 | 16¾ – 18 | Power on: every lane resumes exactly where it stopped, then the lanes fly into the exact positions of the real details window's lanes | "Lose nothing." + "✓ Crash-safe resume" chip | Power-up, success hit |
| **4 The app** | 43.2 – 48.0 | 18 – 20 | **Match cut** to the real details window (live UI capture: lanes, graph, numbers all moving), tilting in 3D with a glass sheen | "Meet Prism." + 2 callout chips | Soft impact, half-time groove |
| | 48.0 – 54.0 | 20 – 22½ | The main window rises in perspective (live list) | "Every download." / "One calm list." → "Liquid glass." (tracking in) → "Dark." "Dense." "Calm." on the beats | Low whoosh, glass shimmer |
| | 54.0 – 57.6 | 22½ – 24 | Accent colour changes on every beat (prism, cyan, emerald, amber, rose, graphite), with the ambient light following | "Make it yours." | Blips on the beats |
| | 57.6 – 60.9 | 24 – 25⅜ | The real Download File dialog pops in with a spring; the cursor clicks **Start download**; the dialog flies into the list | "Add a link. That's it." | Pop, click, whoosh |
| | 61.2 – 63.6 | 25½ – 26½ | Completion dialog (real capture with its spectral ring) plus a burst of particles | "Done." / "Verified." + SHA-256 chip | Success chime |
| | 63.6 – 66.6 | 26½ – 27¾ | The live mini window floats in | "Out of your way." | — |
| | 66.6 | 27¾ | **Glass shatter** into the next scene | — | Reverse swell, shatter |
| **5 Browser + video** | 67.2 – 74.4 | 28 – 31 | A generic browser with no branding and a directory listing. The cursor clicks the ISO link, and Prism's real capture dialog pops out of the page toward the camera | "Click any link." → **"257 ms"** odometer ("from a browser click to Prism", measured) | Click, big pop, type slam |
| | 74.4 – 82.8 | 31 – 34½ | The page slides to a generic video site. The player shows our own film. The floating **Download video** pill springs in, gets clicked, and the quality menu staggers in (8K HDR … Audio only · MP3). Then the real Download video dialog | "Any video." → "Up to 8K HDR." → "Or just the sound." | Pop, click, 5 blips |
| | 82.8 – 84.0 | 34½ – 35 | Abstract site tiles fly through in 3D (no third-party logos) | "Thousands of sites." | — |
| | 84.0 – 88.8 | 35 – 37 | **Rays → download arrow**: 8 spectral rays enter from the left, bend down into a shaft and converge into the arrow head, over a spectral "tray". Slam at 85.2, then the arrow dives out of frame | "Download everything." | 8 zips, slam, short riser, tom fill |
| **6 Montage** | 88.8 – 96.0 | 37 – 40 | Beat-cut whip transitions (motion blur): Scheduler sheet → Site grabber → Add torrent | "Queues & scheduler." "Set it. Sleep. Done." · "Site grabber." · "Torrents & magnets." | Peak groove, whooshes |
| | 96.0 – 98.4 | 40 – 41 | **Light/dark morph**: a spectral light band sweeps across and reveals the light theme, then sweeps back | "Your light." / "Your dark." | Glass sweeps |
| | 98.4 – 100.8 | 41 – 42 | Full-frame type | "Windows" "Linux" "macOS" (one per beat, different moves) + package formats | Type slams |
| | 100.8 – 105.6 | 42 – 44 | **Word storm**: 16 features at 0.3 s each, each with a different kinetic mode (snap, zoom, split, scramble, flip, glitch…), with the lanes flashing behind | HTTP/2 · FTP · HLS & DASH · BitTorrent · … | Storm ticks |
| | 105.6 – 108.0 | 44 – 45 | **Every lane collapses** into a single point; white flash | — | Riser + snare roll |
| **7 Outro** | 108.0 – 111.6 | 45 – 46½ | Blender: the rays retract into the prism (sparks sucked back), the beam follows, and the prism turns to face the camera | — | Impact, reverse swell |
| | 111.6 | 46½ | **Flash → app icon**: the 2D app icon appears exactly on the prism's silhouette (locked to the projected 3D geometry), then glides into the lockup | "Prism" wordmark rises (112.2) | Final impact + chime; pads resolve to **D major** |
| | 113.4 – 118.8 | 47¼ – 49½ | Lockup on a dark violet glow | "Download everything, beautifully." · "One beam. Many rays." · WINDOWS · LINUX · MACOS | Bells, descending pluck, pad tail |
| | 118.8 – 121.2 | | Fade to black | | Tail |

## Recuts (cut on bar lines, so the music stays in time; `src/edits.json`)

* **Teaser, 30 s**: 2.4–9.6 (cold open, hit, lockup) · 21.6–26.4 (drop, 16 lanes) · 31.2–33.6 (15×) ·
  36.0–38.4 (966 MiB/s) · 43.2–45.6 (match cut to the real UI) · 70.8–73.2 (click → 257 ms) ·
  98.4–100.8 (Windows · Linux · macOS) · 111.6–117.6 (icon, lockup).
* **Vertical 9:16, 20.4 s**: 2.4–9.6 · 21.6–26.4 · 31.2–33.6 · 111.6–117.6. The 16:9 picture sits as a
  rounded inset over a blurred cover-fill of itself. On top is a native 9:16 caption layer
  (`film/vertical.html`): "One beam. / Many rays.", "16 connections. / One file.", "15×",
  and a full-height end card (icon, wordmark, tagline, platforms).

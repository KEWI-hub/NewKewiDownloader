# New Kewi Downloader

A fast, multi-connection download manager for Windows, macOS and Linux — up to 32 parallel
connections per file, browser integration, video and MP3 downloads, BitTorrent, and
crash-safe resume.

**New Kewi Downloader is a fork of [Prism](https://github.com/FortoGraphy/prism-download-manager)**
(MIT, by [FortoGraphy](https://github.com/FortoGraphy)). Prism is the engine, the UI and the
browser bridge; this repository rebrands it and is where our own work on top of it lands.
Credit for everything below the branding belongs upstream.

## What it does

- **Segmented downloads** — a file is split across up to 32 connections, and when one finishes
  its part it takes over half of the largest part still outstanding, so no connection idles
- **Resume that survives anything** — pause, sleep, power cut; progress is checkpointed only
  after data is flushed, and resume re-validates size, ETag and `Last-Modified`
- **Video and music** — yt-dlp for YouTube and 1,800+ other sites, MP4 up to 8K or MP3 only,
  with subtitles and chapters; ffmpeg is fetched and kept up to date by the app
- **Every protocol** — HTTP(S), FTP/FTPS, HLS, DASH, BitTorrent and magnet links
- **Browser integration** — an MV3 extension (Chromium and Firefox) hands downloads to the
  app over native messaging
- **Organised** — categories, queues with schedules and speed limits, site grabber, clipboard
  monitor, batch downloads, a mini window and a tray icon

The deep dive on how the engine works is upstream's [ARCHITECTURE.md](ARCHITECTURE.md).

## Build

Needs the Rust stable MSVC toolchain, Node 20+, and (on Windows) Visual Studio with the C++
workload plus WebView2.

```bash
npm ci --prefix app && npm ci --prefix extension
npm run build --prefix extension
cd app && npm run tauri:build
```

Tests:

```bash
cargo test --workspace     # Rust engine, core, native host
npm test --prefix app      # React UI
npm test --prefix extension
```

Platform notes are in [BUILD.md](BUILD.md).

## Releasing

`.github/workflows/release.yml` builds and signs the installers. It needs two repository
secrets before a tag will produce a working release:

- `TAURI_SIGNING_PRIVATE_KEY` — the contents of our updater private key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — empty, since the key has no password

The key pair was generated for this fork; the public half is already in
`app/src-tauri/tauri.conf.json`. The private half lives outside this repository at
`%USERPROFILE%\.newkewi-keys\newkewi.key` and must never be committed. Lose it and the
auto-updater can no longer be fed: every installed copy would have to be replaced by hand.

The `pages` and `badge-refresh` workflows are upstream's and switch themselves off outside
their repository.

## How this fork differs from Prism

Only the identity is changed, so that upstream work can keep being merged rather than
re-ported:

| | Prism | here |
|---|---|---|
| Product name | Prism | New Kewi Downloader |
| Binary | `prism` | `newkewi` |
| Bundle identifier | `dev.prism.manager` | `dev.newkewi.manager` |
| Native messaging host | `dev.prism.host` | `dev.newkewi.host` |
| Data directory | `%APPDATA%\Prism` | `%APPDATA%\NewKewi` |
| Part files | `.prismpart` | `.kewipart` |
| Updater | FortoGraphy releases, their key | this repo's releases, our own key |
| Icons | Prism | the Kewi bird |

Rust crate names stay `prism-*` on purpose: renaming them would conflict on every upstream
merge and no user ever sees them.

Upstream is wired up as a git remote, so pulling their work in is:

```bash
git fetch upstream && git merge upstream/main
```

## The old app

The first version of New Kewi Downloader was a C#/WPF app with per-site Lua config modules and
a portable Chromium for getting past bot walls. It was replaced wholesale by this fork. What is
worth reusing is parked under [`legacy/`](legacy/): the Lua site modules, the old extension, the
icons, and the old architecture notes. Nothing in `legacy/` is built or shipped.

## License

MIT, same as upstream — see [LICENSE](LICENSE). Third-party notices are in
[THIRD_PARTY.md](THIRD_PARTY.md).

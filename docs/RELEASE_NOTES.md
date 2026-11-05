# New Kewi Downloader 1.1.9

A download manager for Windows, Linux and macOS with browser integration and video downloads,
built on [Prism](https://github.com/FortoGraphy/prism-download-manager) 1.1.7.

## What's new in 1.1.9

* **File names within 250 letters everywhere.** Videos from YouTube and other yt-dlp sites were
  cut at 180 letters, and a long title could lose its `.mp4`. They now keep up to 250 letters
  with the extension, like other downloads, and yt-dlp's own names stay within that too.
* **No site name in video titles.** "Clip name - Example.com" is saved as "Clip name". The site
  name is dropped when it is a domain or matches the page's address. Other parts of a title,
  like "Artist - Song", stay.
* **No more "Invalid downloadId" errors** in the browser extension. They were logged each
  time the app took a download over.

The browser extension is updated separately: download `newkewi-chromium.zip`, or reload the
unpacked extension.

### New Kewi Downloader 1.1.8

* **In-app updates.** This is the first release New Kewi Downloader can update itself to. From
  now on a new version shows up in the app and installs with one click.
* **Videos named after the page.** A video played in an embedded player was saved as
  "Video Player.mp4". It now takes the title of the page in the tab. File names keep up to 250
  letters, extension included (Thai titles used to be cut at about 66).
* **Telegram Web.** Videos from web.telegram.org are left to the browser, which can download
  them. The app can't, and those downloads used to fail.
* **Stream Origin players** (pornavhd.com and others): pasting the page's link into *Add URL*
  finds the video and downloads it as MP4 in the best quality.
* **Streams shown as MP4.** The video menu and the toolbar popup show a stream's quality and
  "MP4", the format it is saved as, instead of "Stream · HLS". A stream whose playlist doesn't
  give its size is measured from its first segment.
* **Segment hosts that refuse the page's identity** (Google's, with HTTP 429) are asked again
  without it, so these videos download instead of failing as a "robot check".
* **Browser integration** finds the renamed app, and *Repair* registers it with a path every
  browser reads.

## Downloads

| System | File |
| --- | --- |
| Windows 10 / 11 | `NewKewi_1.1.9_x64-setup.exe` (recommended) · `NewKewi_1.1.9_x64_en-US.msi` · `NewKewi-1.1.9-windows-x64-portable.zip` |
| macOS — Apple Silicon | `NewKewi_1.1.9_aarch64.dmg` |
| macOS — Intel | `NewKewi_1.1.9_x64.dmg` |
| Ubuntu / Debian / Mint | `new-kewi-downloader_1.1.9_amd64.deb` |
| Fedora / openSUSE | `new-kewi-downloader-1.1.9-1.x86_64.rpm` |
| Any Linux | `NewKewi_1.1.9_amd64.AppImage` |

The browser extension is in `newkewi-chromium.zip` (Chrome, Edge, Brave) and
`newkewi-firefox.zip`. Load it unpacked, then click *Repair* in Settings › Browser integration.

## Known limitations

* The installers are **not code-signed**. On Windows, SmartScreen asks: click
  **More info → Run anyway**. In-app updates are signed and checked by the app.

// Shared fake data + formatting helpers for the Prism mockups.
(function () {
  var GB = 1024 * 1024 * 1024, MB = 1024 * 1024, KB = 1024;

  // Abstract "video frames" painted with gradients (no images).
  var THUMBS = {
    aurora: "radial-gradient(120% 80% at 30% 110%, #0f3d3a 0%, transparent 60%), radial-gradient(60% 50% at 70% 30%, rgba(80,240,190,.75) 0%, transparent 70%), radial-gradient(50% 40% at 35% 20%, rgba(140,110,255,.6) 0%, transparent 70%), linear-gradient(180deg, #071226 0%, #0b2a3a 70%, #102016 100%)",
    lecture: "radial-gradient(40% 60% at 72% 55%, rgba(255,214,170,.55) 0%, transparent 70%), linear-gradient(90deg, #1f2732 0%, #2c3746 55%, #3a3f46 100%)",
    synth: "radial-gradient(50% 40% at 50% 62%, #ff8a5c 0%, #ff4f8b 40%, transparent 70%), linear-gradient(180deg, #160a2e 0%, #3b1258 55%, #13051f 56%, #2a0d45 100%)",
    iceland: "radial-gradient(70% 40% at 50% 100%, #2b3d2f 0%, transparent 70%), linear-gradient(180deg, #9fb7c9 0%, #d9e4ea 45%, #5c7380 46%, #34474f 100%)",
    bunny: "radial-gradient(30% 35% at 60% 55%, #f5f1e6 0%, transparent 70%), radial-gradient(80% 60% at 50% 100%, #5f9b3c 0%, transparent 70%), linear-gradient(180deg, #8fc7f0 0%, #c9e7f7 50%, #79b04a 51%, #4d7f2c 100%)",
    demo: "radial-gradient(45% 45% at 50% 50%, rgba(139,123,255,.9) 0%, rgba(47,203,230,.35) 50%, transparent 72%), linear-gradient(135deg, #0b0c12 0%, #151626 100%)",
    city: "repeating-linear-gradient(90deg, rgba(255,210,120,.0) 0 7px, rgba(255,210,120,.35) 7px 9px), linear-gradient(180deg, #0a1022 0%, #1d2346 60%, #2b1c33 100%)",
    ocean: "radial-gradient(60% 30% at 50% 35%, rgba(255,240,200,.8) 0%, transparent 70%), linear-gradient(180deg, #f7b07a 0%, #f08a7a 35%, #2d5f8a 36%, #12324f 100%)",
  };

  var items = [
    { name: "OpenStreetMap-europe-latest.osm.pbf", kind: "archive", size: 28.9 * GB, done: 0.124, status: "downloading", speed: 31.2 * MB, conns: 16, host: "download.geofabrik.de", added: "Today 14:02", queue: "Main" },
    { name: "Northern Lights over Lofoten — 4K HDR.mp4", kind: "video", size: 2.14 * GB, done: 0.382, status: "downloading", speed: 9.6 * MB, conns: 8, host: "vimeo.com", added: "Today 13:55", thumb: "aurora", dur: "12:41", res: "2160p HDR", queue: "Main" },
    { name: "ubuntu-24.04.1-desktop-amd64.iso", kind: "disk", size: 5.83 * GB, done: 0.624, status: "downloading", speed: 18.4 * MB, conns: 12, host: "releases.ubuntu.com", added: "Today 13:41", queue: "Main", selected: true },
    { name: "LibreOffice_25.2.1_Win_x86-64.msi", kind: "program", size: 352 * MB, done: 0.881, status: "downloading", speed: 6.1 * MB, conns: 8, host: "download.documentfoundation.org", added: "Today 13:40", queue: "Main" },
    { name: "Product Demo — Prism 1.0 [1080p].mp4", kind: "video", size: 486 * MB, done: 1, status: "merging", speed: 0, conns: 0, host: "youtube.com", added: "Today 13:38", thumb: "demo", dur: "3:12", res: "1080p60" },
    { name: "linux-6.11.4.tar.xz", kind: "archive", size: 141 * MB, done: 1, status: "verifying", speed: 0, conns: 0, host: "cdn.kernel.org", added: "Today 13:30" },
    { name: "Lecture 07 — Distributed Consensus.mkv", kind: "video", size: 1.21 * GB, done: 0.713, status: "paused", speed: 0, conns: 0, host: "media.university.edu", added: "Today 11:12", thumb: "lecture", dur: "1:24:05", res: "1080p" },
    { name: "game-patch-1.4.2-full.pak", kind: "other", size: 3.4 * GB, done: 0.27, status: "waiting", speed: 0, conns: 0, host: "patch-cdn.example.net", added: "Today 10:58", note: "Connection reset · retrying in 12 s" },
    { name: "vs_BuildTools.exe", kind: "program", size: 4.2 * MB, done: 0.0, status: "error", speed: 0, conns: 0, host: "aka.ms", added: "Today 10:21", note: "403 Forbidden · link expired" },
    { name: "wallpapers-aurora-pack.zip", kind: "archive", size: 864 * MB, done: 0, status: "queued", speed: 0, conns: 0, host: "files.example.com", added: "Today 10:05", queue: "Main", pos: 1 },
    { name: "Synthwave Mix 2026 [1080p60].webm", kind: "video", size: 1.62 * GB, done: 0, status: "queued", speed: 0, conns: 0, host: "youtube.com", added: "Today 09:47", thumb: "synth", dur: "58:20", res: "1080p60", queue: "Main", pos: 2 },
    { name: "photos-2026-09-backup.7z", kind: "archive", size: 12.4 * GB, done: 0, status: "queued", speed: 0, conns: 0, host: "nas.local", added: "Today 09:30", queue: "Main", pos: 3 },
    { name: "Cinematic Drone Reel — Iceland.mov", kind: "video", size: 3.42 * GB, done: 0, status: "scheduled", speed: 0, conns: 0, host: "footage.example.org", added: "Yesterday", thumb: "iceland", dur: "6:05", res: "2160p", note: "Night queue · starts 01:00" },
    { name: "Big Buck Bunny (4K, 60 fps).mp4", kind: "video", size: 1.06 * GB, done: 1, status: "completed", speed: 0, conns: 0, host: "download.blender.org", added: "Yesterday", thumb: "bunny", dur: "10:34", res: "2160p60" },
    { name: "annual-report-2025.pdf", kind: "pdf", size: 12.6 * MB, done: 1, status: "completed", host: "investors.example.com", added: "Yesterday" },
    { name: "podcast-ep142-the-latency-budget.mp3", kind: "audio", size: 74.2 * MB, done: 1, status: "completed", host: "feeds.example.fm", added: "Yesterday" },
    { name: "Blender-4.2.3-windows-x64.msi", kind: "program", size: 342 * MB, done: 1, status: "completed", host: "download.blender.org", added: "Mon 18:12" },
    { name: "debian-13.1.0-amd64-netinst.iso", kind: "disk", size: 754 * MB, done: 1, status: "completed", host: "cdimage.debian.org", added: "Mon 17:40" },
    { name: "Inter-4.1.zip", kind: "font", size: 18.3 * MB, done: 1, status: "completed", host: "github.com", added: "Mon 09:02" },
    { name: "Chill Lofi Radio — 3h mix.m4a", kind: "audio", size: 214 * MB, done: 1, status: "completed", host: "music.example.com", added: "Sun 22:15" },
    { name: "Sunset Timelapse — Pacific.mp4", kind: "video", size: 688 * MB, done: 1, status: "completed", host: "footage.example.org", added: "Sun 20:03", thumb: "ocean", dur: "4:48", res: "1440p" },
    { name: "attention-is-all-you-need.pdf", kind: "pdf", size: 2.1 * MB, done: 1, status: "completed", host: "arxiv.org", added: "Sun 11:47" },
    { name: "node-v22.11.0-x64.msi", kind: "program", size: 28.4 * MB, done: 1, status: "completed", host: "nodejs.org", added: "Sat 16:30" },
    { name: "city-night-drive.mp4", kind: "video", size: 412 * MB, done: 1, status: "completed", host: "footage.example.org", added: "Sat 14:22", thumb: "city", dur: "2:51", res: "1080p" },
    { name: "ui-kit-components.fig", kind: "other", size: 88.4 * MB, done: 1, status: "completed", host: "assets.example.design", added: "Sat 10:09" },
    { name: "sample-raw-photos.zip", kind: "archive", size: 2.31 * GB, done: 1, status: "completed", host: "files.example.com", added: "Fri 19:55" },
    { name: "rustup-init.exe", kind: "program", size: 9.7 * MB, done: 1, status: "completed", host: "static.rust-lang.org", added: "Fri 12:30" },
    { name: "texture-pack-8k.zip", kind: "archive", size: 6.9 * GB, done: 1, status: "completed", host: "assets.example.com", added: "Thu 21:04" },
  ];

  var KIND = {
    video: { icon: "file-video", tint: "--type-video", cat: "Video" },
    audio: { icon: "file-audio", tint: "--type-audio", cat: "Music" },
    image: { icon: "file-image", tint: "--type-image", cat: "Images" },
    archive: { icon: "file-archive", tint: "--type-archive", cat: "Compressed" },
    pdf: { icon: "file-pdf", tint: "--type-document", cat: "Documents" },
    document: { icon: "file-document", tint: "--type-document", cat: "Documents" },
    program: { icon: "file-exe", tint: "--type-program", cat: "Programs" },
    disk: { icon: "disk-image", tint: "--type-program", cat: "Programs" },
    font: { icon: "file-font", tint: "--type-other", cat: "Other" },
    other: { icon: "file", tint: "--type-other", cat: "Other" },
  };

  var STATUS = {
    downloading: { icon: "status-downloading", label: "Downloading", cls: "accent", prog: "active" },
    paused: { icon: "status-paused", label: "Paused", cls: "warning", prog: "paused" },
    queued: { icon: "status-queued", label: "Queued", cls: "neutral", prog: "queued" },
    completed: { icon: "status-completed", label: "Completed", cls: "success", prog: "completed" },
    error: { icon: "status-error", label: "Failed", cls: "danger", prog: "error" },
    scheduled: { icon: "status-scheduled", label: "Scheduled", cls: "info", prog: "queued" },
    verifying: { icon: "status-verifying", label: "Verifying SHA-256", cls: "info", prog: "active" },
    merging: { icon: "status-merging", label: "Merging audio + video", cls: "accent", prog: "active" },
    waiting: { icon: "status-waiting", label: "Waiting", cls: "warning", prog: "paused" },
  };

  function size(b) {
    if (b >= GB) return (b / GB).toFixed(b >= 10 * GB ? 1 : 2) + " GB";
    if (b >= MB) return (b / MB).toFixed(b >= 100 * MB ? 0 : 1) + " MB";
    return Math.round(b / KB) + " KB";
  }
  function speed(b) { return b ? (b >= MB ? (b / MB).toFixed(1) + " MB/s" : Math.round(b / KB) + " KB/s") : ""; }
  function eta(it) {
    if (it.status !== "downloading" || !it.speed) return "";
    var s = Math.round((it.size * (1 - it.done)) / it.speed);
    if (s >= 3600) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    if (s >= 60) return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
    return s + "s";
  }
  function pct(it) { return (it.done * 100).toFixed(it.done >= 1 || it.done === 0 ? 0 : 1) + "%"; }

  function statusText(it) {
    var st = STATUS[it.status];
    if (it.status === "downloading") return pct(it);
    if (it.status === "queued") return "Queued · #" + it.pos;
    if (it.note) return it.note;
    if (it.status === "paused") return "Paused · " + pct(it);
    return st.label;
  }

  function fileTile(it, sz) {
    var k = KIND[it.kind];
    sz = sz || 28;
    if (it.thumb) {
      return '<span class="thumb" style="--thumb:' + THUMBS[it.thumb].replace(/"/g, "'") + '"><span class="thumb__dur">' + (it.dur || "") + "</span></span>";
    }
    return '<span class="file-tile" style="--tint: var(' + k.tint + ')">' + icon(k.icon, Math.round(sz * 0.6)) + "</span>";
  }

  function progress(it, cls) {
    var st = STATUS[it.status];
    var v = it.status === "queued" || it.status === "scheduled" ? 0 : it.done;
    return '<div class="progress ' + (cls || "") + '" data-state="' + st.prog + '" style="--value:' + v + '"><div class="progress__fill"></div></div>';
  }

  // Deterministic pseudo-random speed history for sparklines / graphs.
  function series(n, seed, base, vol) {
    var out = [], v = base, s = seed;
    for (var i = 0; i < n; i++) {
      s = (s * 9301 + 49297) % 233280;
      var r = s / 233280;
      v += (r - 0.5) * vol + (base - v) * 0.08;
      out.push(Math.max(base * 0.25, v));
    }
    return out;
  }
  function sparkPath(data, w, h, pad) {
    pad = pad || 1;
    var max = Math.max.apply(null, data) * 1.1, step = w / (data.length - 1);
    var pts = data.map(function (d, i) { return [i * step, h - pad - (d / max) * (h - pad * 2)]; });
    var line = "M" + pts.map(function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("L");
    // smooth with Catmull-Rom → Bezier
    var d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      var c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += "C" + c1[0].toFixed(1) + " " + c1[1].toFixed(1) + " " + c2[0].toFixed(1) + " " + c2[1].toFixed(1) + " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    return { line: d, area: d + "L" + w + " " + h + "L0 " + h + "Z", raw: line };
  }

  // Segment map for a download: n connections, each with [start,end,pos] in 0..1.
  function segments(n, done, seed) {
    var segs = [], s = seed || 7;
    for (var i = 0; i < n; i++) {
      s = (s * 9301 + 49297) % 233280;
      var a = i / n, b = (i + 1) / n;
      var fill = Math.min(1, Math.max(0.08, done + (s / 233280 - 0.5) * 0.5));
      segs.push({ start: a, end: b, pos: a + (b - a) * fill, active: fill < 1 });
    }
    return segs;
  }

  window.MOCK = {
    items: items, KIND: KIND, STATUS: STATUS, THUMBS: THUMBS,
    size: size, speed: speed, eta: eta, pct: pct, statusText: statusText,
    fileTile: fileTile, progress: progress, series: series, sparkPath: sparkPath, segments: segments,
    totals: function () {
      var t = { all: items.length, active: 0, queued: 0, completed: 0, failed: 0, speed: 0 };
      items.forEach(function (i) {
        if (i.status === "downloading") { t.active++; t.speed += i.speed; }
        if (i.status === "queued" || i.status === "scheduled") t.queued++;
        if (i.status === "completed") t.completed++;
        if (i.status === "error") t.failed++;
      });
      return t;
    },
  };
})();

// Local test site: a page with a downloadable .zip link, a <video>, images and links, and a
// LinkedIn-like feed (/feed.html) where an autoplaying ad sits above the post's own video.
import { createServer } from 'node:http';

const ZIP_SIZE = 2 * 1024 * 1024;
// The ad is the biggest file on the feed page, so "largest sniffed stream first" picks it.
const MP4_SIZES = { 'clip.mp4': 300 * 1024, 'ad.mp4': 900 * 1024, 'post-720p.mp4': 500 * 1024, 'post-640p.mp4': 400 * 1024, 'post-360p.mp4': 200 * 1024 };

const page = (origin) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Prism e2e page</title>
<style>body{font:15px system-ui;margin:24px;background:#fafafa} video{display:block;background:#123;margin:40px 0}</style></head>
<body>
  <h1>Prism e2e</h1>
  <p id="sel">Selection: <a id="sel-link" href="/files/selected.7z">selected archive</a> and text link ${origin}/files/plain-text.iso here.</p>
  <p><a id="zip" href="/files/test.zip">Download test.zip</a> · <a id="pdf-page" href="/about.html">About page</a> · <a href="https://example.org/ext.rar">external rar</a></p>
  <p><img src="/img/a.png" alt="first" width="40" height="40"> <img src="/img/b.png" alt="second" width="40" height="40"></p>
  <video id="vid" src="/media/clip.mp4" width="640" height="360" controls preload="auto" muted></video>
  <p style="height:600px">filler</p>
</body></html>`;

// Like a LinkedIn feed: video.js players (`video.vjs-tech`), the post lists its qualities in
// `data-sources` and plays one of them; a promoted post autoplays muted above it.
const feed = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>Feed | Prism e2e</title>
<style>body{font:15px system-ui;margin:24px;background:#f4f2ee} .post{background:#fff;margin:0 0 40px;padding:12px;width:640px} video{display:block;background:#123}</style></head>
<body>
  <div class="post" data-urn="urn:li:fsd_update:(urn:li:activity:7000000000000000001,MAIN_FEED,EMPTY,DEFAULT,false)"><p>Promoted</p>
    <video id="ad" class="vjs-tech" src="/media/ad.mp4" width="640" height="360" muted autoplay loop playsinline preload="auto"></video></div>
  <div class="post" data-urn="urn:li:activity:7000000000000000002"><p>A post with a video</p>
    <video id="post" class="vjs-tech" src="/media/post-640p.mp4" width="640" height="360" muted playsinline preload="auto"
      data-sources='[{"src":"/media/post-360p.mp4","type":"video/mp4"},{"src":"/media/post-720p.mp4","type":"video/mp4"},{"src":"/media/post-640p.mp4","type":"video/mp4"}]'></video></div>
  <p style="height:600px">filler</p>
</body></html>`;

// Like LinkedIn's newer UI (search, company and feed pages): the page scrolls inside
// main#workspace; a post is a [role=listitem] card with no link or id around its video; the id
// is only in the componentkey of the post's text block, a sibling branch of the video. Card 2 is
// a repost with its own text around the original post; card 3 has no text (no id at all).
const commentary = (kind, id) =>
  `translatable-commentary-FeTranslationUrn(contentUrnCommentUrn=null, contentUrnGroupPostUrn=null, contentUrnShareUrn=${kind === 'share' ? `ContentUrnShareUrn(shareUrn=ShareUrn(shareId=${id}))` : 'null'}, contentUrnUgcPostUrn=${kind === 'ugc' ? `ContentUrnUgcPostUrn(userGeneratedContentPostUrn=UserGeneratedContentPostUrn(userGeneratedContentId=${id}))` : 'null'}, detectedLocale=, targetLocale=en)`;
const cards = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>Search | Prism e2e</title>
<style>body{margin:0;font:15px system-ui} main{position:fixed;inset:0;overflow:auto;padding:24px} [role=listitem]{background:#fff;margin:0 0 40px;padding:12px;width:640px} video{display:block;background:#123}</style></head>
<body><main id="workspace"><div role="list">
  <div role="listitem" componentkey="update-card-focusa1FeedType_FLAGSHIP_SEARCH">
    <div><div><a href="/company/example-one/">Company one</a></div><div><span componentkey="${commentary('ugc', '7500000000000000011')}">Post text</span></div></div>
    <div><div><video id="nv1" src="/media/clip.mp4" width="640" height="360" muted playsinline preload="auto"></video></div></div>
  </div>
  <div role="listitem" componentkey="update-card-focusb2FeedType_FLAGSHIP_SEARCH">
    <div><a href="/in/example-two/">Person two</a></div>
    <div><span componentkey="${commentary('ugc', '7500000000000000022')}">Repost text</span></div>
    <div class="shared"><div><span componentkey="${commentary('share', '7500000000000000033')}">Original text</span></div>
      <div><div><video id="nv2" src="/media/post-360p.mp4" width="640" height="360" muted playsinline preload="auto"></video></div></div></div>
  </div>
  <div role="listitem" componentkey="update-card-focusc3FeedType_FLAGSHIP_SEARCH">
    <div><a href="/company/example-three/">Company three</a></div>
    <div><div><video id="nv3" src="/media/post-640p.mp4" width="640" height="360" muted playsinline preload="auto"></video></div></div>
  </div>
</div><p style="height:600px">filler</p></main></body></html>`;

// Like an X timeline (a "video site" in step 2c): each post is an <article> with links to the
// author's profile and to the post itself; the page URL names no single video.
const timeline = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>Home | Prism e2e</title>
<style>body{font:15px system-ui;margin:24px} article{margin:0 0 40px;width:640px} video{display:block;background:#123}</style></head>
<body>
  <article><a href="/alice">Alice</a> · <a href="/alice/status/111">2h</a> <a href="/hashtag/cats">#cats</a>
    <video id="t1" src="/media/clip.mp4" width="640" height="360" muted preload="auto"></video></article>
  <article><a href="/bob">Bob</a> · <a href="/bob/status/222/analytics">stats</a> · <a href="/bob/status/222">3h</a>
    <video id="t2" src="/media/post-640p.mp4" width="640" height="360" muted preload="auto"></video></article>
  <article><a href="/carol">Carol</a> · <a href="/carol/status/333">5h</a>
    <video id="t4" src="/media/clip.mp4" width="640" height="360" muted preload="auto"></video></article>
  <a href="/reel/R1abc/" title="Instagram Explore style tile"><video id="t3" src="/media/post-360p.mp4" width="640" height="360" muted preload="auto"></video></a>
  <p style="height:600px">filler</p>
</body></html>`;

// A player that loads HLS manifests from script (as hls.js does): `src` is the manifest path on this
// host, or a full URL (another host: the cross-site case); a second one on `/slow/` hangs in the app.
const hlsPage = (src) => `<!doctype html>
<html><head><meta charset="utf-8"><title>HLS player | Prism e2e</title></head>
<body style="margin:24px"><video id="hv" width="640" height="360" muted style="display:block;background:#123"></video>
<script>fetch(${JSON.stringify(src)}, { mode: 'no-cors' }); fetch('/hls/slow/master.m3u8');</script>
<p style="height:600px">filler</p></body></html>`;

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
v360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
v1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
v720.m3u8
`;

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

export async function startSite() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const origin = `http://${req.headers.host}`;
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'session=abc123; Path=/' });
      return res.end(page(origin));
    }
    if (url.pathname === '/blob.html') {
      // A player that plays from a blob: URL (as MSE players do): there is no URL to hand over.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Blob player | Prism e2e</title>
<body style="margin:24px"><video id="b" width="640" height="360" muted></video>
<script>fetch('/media/clip.mp4').then((r) => r.blob()).then((b) => { document.getElementById('b').src = URL.createObjectURL(b); });</script>`);
    }
    if (url.pathname === '/home') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(timeline());
    }
    if (url.pathname === '/feed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(feed());
    }
    if (url.pathname === '/cards.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(cards());
    }
    if (url.pathname === '/hls.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(hlsPage(url.searchParams.get('src') ?? '/hls/master.m3u8'));
    }
    if (url.pathname.startsWith('/hls/') && url.pathname.endsWith('.m3u8')) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*' });
      return res.end(MASTER);
    }
    if (url.pathname === '/about.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<p>about</p>');
    }
    if (url.pathname.startsWith('/files/')) {
      const name = url.pathname.split('/').pop();
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': ZIP_SIZE,
      });
      // Stream slowly so the browser cannot finish before the extension decides.
      let sent = 0;
      const tick = () => {
        if (res.destroyed) return;
        const n = Math.min(64 * 1024, ZIP_SIZE - sent);
        sent += n;
        if (sent >= ZIP_SIZE) return res.end(Buffer.alloc(n));
        res.write(Buffer.alloc(n));
        setTimeout(tick, 50);
      };
      return tick();
    }
    const mp4 = url.pathname.startsWith('/media/') ? MP4_SIZES[url.pathname.slice(7)] : undefined;
    if (mp4) {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), mp4 - 1) : mp4 - 1;
      const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${mp4}`;
      res.writeHead(range ? 206 : 200, headers);
      return res.end(Buffer.alloc(end - start + 1));
    }
    if (url.pathname.startsWith('/img/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () => {
      server.closeAllConnections?.();
      return new Promise((r) => server.close(r));
    },
  };
}

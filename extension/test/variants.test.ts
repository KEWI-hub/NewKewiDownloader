import { describe, expect, it } from 'vitest';
import type { VideoOption } from '../src/shared/messages';
import { variantLabel, variantOptions } from '../src/shared/variants';

const base: VideoOption = {
  id: 's:https://cdn.example/master.m3u8',
  label: 'master.m3u8',
  group: 'stream',
  stream: { url: 'https://cdn.example/master.m3u8', kind: 'hls', quality: '720p', headers: { Referer: 'https://site.example/watch' } },
};

describe('stream qualities in the video menu', () => {
  it('lists every variant best first, each with its manifest index', () => {
    const opts = variantOptions(base, 'hls', [
      { index: 0, url: 'https://cdn.example/lo.m3u8', bandwidth: 800_000, width: 640, height: 360 },
      { index: 1, url: 'https://cdn.example/hi.m3u8', bandwidth: 5_000_000, width: 1920, height: 1080 },
      { index: 2, url: 'https://cdn.example/mid.m3u8', bandwidth: 2_000_000, width: 1280, height: 720 },
    ])!;
    expect(opts.map((o) => [o.label, o.detail, o.stream?.variantIndex])).toEqual([
      ['1080p', 'HLS · 5000 kbps', 1],
      ['720p', 'HLS · 2000 kbps', 2],
      ['360p', 'HLS · 800 kbps', 0],
    ]);
    // The manifest's URL, headers and group stay; the quality is the picked variant's.
    expect(opts[0]!.stream).toEqual({ ...base.stream, quality: '1080p', variantIndex: 1 });
    expect(opts[0]!.group).toBe('stream');
    expect(new Set(opts.map((o) => o.id)).size).toBe(3);
  });

  it('names a portrait variant by its shorter side, and one without a size by its bitrate', () => {
    expect(variantLabel({ index: 0, url: 'u', width: 1080, height: 1920 })).toBe('1080p');
    expect(variantLabel({ index: 0, url: 'u', height: 480 })).toBe('480p');
    expect(variantLabel({ index: 0, url: 'u', bandwidth: 96_000 })).toBe('96 kbps');
    expect(variantLabel({ index: 0, url: 'u' })).toBe('Stream');
  });

  it('keeps the single entry for a manifest with one variant or none', () => {
    expect(variantOptions(base, 'dash', [{ index: 0, url: 'u', height: 720 }])).toBeNull();
    expect(variantOptions(base, 'dash', [])).toBeNull();
  });
});

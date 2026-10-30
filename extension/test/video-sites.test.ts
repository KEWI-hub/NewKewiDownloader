import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_SITES } from '../src/shared/settings';

// The app sends its own list once connected, so the two copies must not drift apart (an
// embedded youtube-nocookie.com player lost its formats that way). No Node typings here.
declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: URL, encoding: 'utf8'): string } };
const rust = process.getBuiltinModule('node:fs').readFileSync(new URL('../../crates/prism-core/src/manager/capture.rs', import.meta.url), 'utf8');

describe('video sites', () => {
  it('match the app list (crates/prism-core/src/manager/capture.rs VIDEO_SITES)', () => {
    const block = /const VIDEO_SITES: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust)?.[1] ?? '';
    const app = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(app.length).toBeGreaterThan(10);
    expect([...app].sort()).toEqual([...DEFAULT_VIDEO_SITES].sort());
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BypassTracker } from '../src/shared/bypass';
import { buildCookieHeader, mergeCookieHeaders, parseCookieHeader, pickCookieStoreId } from '../src/shared/cookies';
import { Correlator, NativeError, classifyDisconnect } from '../src/shared/correlator';

describe('cookie header', () => {
  it('orders by path length and joins', () => {
    const h = buildCookieHeader([
      { name: 'a', value: '1', path: '/' },
      { name: 'b', value: '2', path: '/dl/files' },
      { name: 'c', value: '3', path: '/dl' },
      { name: '', value: 'bare', path: '/' },
    ]);
    expect(h).toBe('b=2; c=3; a=1; bare');
    expect(buildCookieHeader([])).toBe('');
  });
  it('parses and merges, request header wins', () => {
    expect(parseCookieHeader('a=1; b = x=y ;; c')).toEqual([
      ['a', '1'],
      ['b', 'x=y'],
      ['', 'c'],
    ]);
    expect(mergeCookieHeaders('sid=req; part=1', 'sid=store; other=2')).toBe('sid=req; part=1; other=2');
    expect(mergeCookieHeaders(undefined, 'x=1')).toBe('x=1');
    expect(mergeCookieHeaders('', '')).toBe('');
  });
  it('picks the incognito store', () => {
    expect(pickCookieStoreId([{ id: '0' }, { id: '1' }], false)).toBeUndefined();
    expect(pickCookieStoreId([{ id: '0' }, { id: '1' }], true)).toBe('1');
    expect(pickCookieStoreId([{ id: 'firefox-default' }, { id: 'firefox-private' }], true)).toBe('firefox-private');
    expect(pickCookieStoreId([{ id: 'a' }, { id: 'b', incognito: true }], true)).toBe('b');
  });
});

describe('Correlator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('routes replies by id, out of order', async () => {
    const c = new Correlator<{ id: string; v: number }>(3000, 'p');
    const a = c.nextId();
    const b = c.nextId();
    expect(a).toBe('p-1');
    const pa = c.wait(a);
    const pb = c.wait(b);
    expect(c.resolve({ id: b, v: 2 })).toBe(true);
    expect(c.resolve({ id: a, v: 1 })).toBe(true);
    await expect(pa).resolves.toEqual({ id: a, v: 1 });
    await expect(pb).resolves.toEqual({ id: b, v: 2 });
    expect(c.resolve({ id: a, v: 9 })).toBe(false); // late duplicate
    expect(c.size).toBe(0);
  });

  it('times out and rejects all', async () => {
    const c = new Correlator<{ id: string }>(3000);
    const p = c.wait(c.nextId());
    const q = c.wait(c.nextId(), 10_000);
    vi.advanceTimersByTime(3001);
    await expect(p).rejects.toMatchObject({ code: 'timeout' });
    c.rejectAll(new NativeError('host_exited', 'gone'));
    await expect(q).rejects.toMatchObject({ code: 'host_exited' });
    expect(c.size).toBe(0);
  });

  it('accepts numeric ids', async () => {
    const c = new Correlator<{ id?: unknown }>();
    const p = c.wait('5');
    expect(c.resolve({ id: 5 })).toBe(true);
    await expect(p).resolves.toEqual({ id: 5 });
    expect(c.resolve({})).toBe(false);
  });

  it('classifies disconnect messages', () => {
    expect(classifyDisconnect('Specified native messaging host not found.')).toBe('host_missing');
    expect(classifyDisconnect('No such native application dev.prism.host')).toBe('host_missing');
    expect(classifyDisconnect('Access to the specified native messaging host is forbidden.')).toBe('host_forbidden');
    expect(classifyDisconnect('Native host has exited.')).toBe('host_exited');
    expect(classifyDisconnect(undefined)).toBe('disconnected');
  });
});

describe('BypassTracker', () => {
  it('matches URLs for a while and generic clicks briefly', () => {
    let now = 1000;
    const t = new BypassTracker(15_000, 2_500, () => now);
    t.record('https://x/a.zip#top');
    expect(t.isActive(['https://x/a.zip'])).toBe(true);
    expect(t.isActive(['https://x/b.zip'])).toBe(false);
    now += 16_000;
    expect(t.isActive(['https://x/a.zip'])).toBe(false);
    t.record();
    expect(t.isActive(['https://x/anything'])).toBe(true);
    now += 3_000;
    expect(t.isActive(['https://x/anything'])).toBe(false);
  });
});

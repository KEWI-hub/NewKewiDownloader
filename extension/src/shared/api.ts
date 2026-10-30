/**
 * Tiny cross-browser shim. Firefox exposes promise-based `browser.*`; Chromium
 * MV3 `chrome.*` returns promises too, so both are used through one handle
 * typed as `chrome`. Feature differences are checked at the call sites
 * (e.g. `downloads.onDeterminingFilename` is Chromium-only).
 */
declare const __TARGET__: 'chromium' | 'firefox';

const g = globalThis as unknown as { browser?: typeof chrome; chrome?: typeof chrome };

export const api: typeof chrome = (g.browser ?? g.chrome) as typeof chrome;

/** Build target (esbuild `define`); falls back to runtime detection. */
export const TARGET: 'chromium' | 'firefox' =
  typeof __TARGET__ !== 'undefined' ? __TARGET__ : g.browser ? 'firefox' : 'chromium';

export const IS_FIREFOX = TARGET === 'firefox';

/** Promise wrapper for `runtime.sendMessage` that never throws "receiving end does not exist". */
export async function sendInternal<T>(msg: unknown): Promise<T | undefined> {
  try {
    return (await api.runtime.sendMessage(msg)) as T;
  } catch {
    return undefined;
  }
}

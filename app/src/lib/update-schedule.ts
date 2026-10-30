// When Prism looks for a new version by itself (the manual "Check for updates" is separate).

export const FIRST_CHECK_MS = 5_000;
export const EVERY_MS = 60 * 60 * 1000;
/**
 * Coming back to the window checks again when the last check is older than this: timers stall
 * while the computer sleeps or Prism sits in the tray.
 */
export const ON_RETURN_MS = 30 * 60 * 1000;

export interface ScheduleEnv {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
  /** Calls `fn` whenever the window becomes visible or focused; returns the unsubscribe. */
  onReturn(fn: () => void): () => void;
}

/**
 * Starts the automatic checks. `lastCheck()` is when the latest check started (automatic or
 * manual; failed ones count too, so an offline computer isn't asked again on every focus).
 * Returns the function that stops them.
 */
export function scheduleUpdateChecks(check: () => void, lastCheck: () => number, env: ScheduleEnv): () => void {
  const first = env.setTimeout(check, FIRST_CHECK_MS);
  const every = env.setInterval(check, EVERY_MS);
  const off = env.onReturn(() => {
    if (env.now() - lastCheck() >= ON_RETURN_MS) check();
  });
  return () => {
    env.clearTimeout(first);
    env.clearInterval(every);
    off();
  };
}

/** The browser window's clock, timers and "came back" events. */
export const windowEnv: ScheduleEnv = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
  onReturn: (fn) => {
    const visible = () => {
      if (document.visibilityState === "visible") fn();
    };
    window.addEventListener("focus", fn);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", fn);
      document.removeEventListener("visibilitychange", visible);
    };
  },
};

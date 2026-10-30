import { describe, expect, it } from "vitest";
import { EVERY_MS, FIRST_CHECK_MS, ON_RETURN_MS, type ScheduleEnv, scheduleUpdateChecks } from "./update-schedule";

/** A clock that only moves when told, with timers and a "came back to the window" trigger. */
function fakeEnv() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const returns = new Set<() => void>();
  const env: ScheduleEnv = {
    now: () => now,
    setTimeout: (fn, ms) => (timers.set(next, { at: now + ms, fn }), next++),
    clearTimeout: (id) => void timers.delete(id),
    setInterval: (fn, ms) => (timers.set(next, { at: now + ms, fn, every: ms }), next++),
    clearInterval: (id) => void timers.delete(id),
    onReturn: (fn) => (returns.add(fn), () => void returns.delete(fn)),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      now = t.at;
      if (t.every) t.at += t.every;
      else timers.delete(id);
      t.fn();
    }
    now = end;
  };
  const comeBack = () => [...returns].forEach((fn) => fn());
  return { env, advance, comeBack, live: () => timers.size + returns.size };
}

describe("automatic update checks", () => {
  it("check 5 s after start, then every hour", () => {
    const { env, advance } = fakeEnv();
    const at: number[] = [];
    let last = 0;
    scheduleUpdateChecks(() => at.push((last = env.now())), () => last, env);
    advance(3 * EVERY_MS);
    expect(at).toEqual([FIRST_CHECK_MS, EVERY_MS, 2 * EVERY_MS, 3 * EVERY_MS]);
  });

  it("coming back to the window checks only when the last check is 30 min old", () => {
    const { env, advance, comeBack } = fakeEnv();
    let checks = 0;
    let last = 0; // the app's start
    scheduleUpdateChecks(() => ((last = env.now()), checks++), () => last, env);
    comeBack(); // right after the start: nothing yet
    expect(checks).toBe(0);
    advance(FIRST_CHECK_MS);
    expect(checks).toBe(1);
    advance(ON_RETURN_MS - 1);
    comeBack(); // 1 ms short of 30 min since that check
    expect(checks).toBe(1);
    advance(1);
    comeBack();
    expect(checks).toBe(2);
    // Every focus right after counts from that check (also when it failed: no retry storm offline).
    for (let i = 0; i < 20; i++) {
      advance(60_000);
      comeBack();
    }
    expect(checks).toBe(2);
  });

  it("a manual check counts as the last one", () => {
    const { env, advance, comeBack } = fakeEnv();
    let checks = 0;
    let last = 0;
    scheduleUpdateChecks(() => ((last = env.now()), checks++), () => last, env);
    advance(ON_RETURN_MS + 10);
    expect(checks).toBe(1); // the first one at 5 s
    last = env.now(); // "Check for updates" in About
    comeBack();
    expect(checks).toBe(1);
  });

  it("stopping removes every timer and listener", () => {
    const { env, advance, live } = fakeEnv();
    let checks = 0;
    const stop = scheduleUpdateChecks(() => checks++, () => 0, env);
    expect(live()).toBe(3);
    stop();
    expect(live()).toBe(0);
    advance(5 * EVERY_MS);
    expect(checks).toBe(0);
  });
});

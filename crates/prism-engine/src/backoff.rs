//! Exponential backoff with jitter (0.5 s · 2ⁿ, capped at 30 s, "equal jitter").

use std::time::Duration;

/// Default first delay.
pub(crate) const BASE: Duration = Duration::from_millis(500);
/// Default maximum delay.
pub(crate) const CAP: Duration = Duration::from_secs(30);

/// Delay for the given 0-based `attempt` with jitter factor `r` in `[0, 1)`: the result lies in
/// `[d/2, d)` where `d = min(cap, base · 2^attempt)`.
pub(crate) fn delay_for(attempt: u32, base: Duration, cap: Duration, r: f64) -> Duration {
    let exp = base.as_secs_f64() * 2f64.powi(attempt.min(30) as i32);
    let d = exp.min(cap.as_secs_f64());
    Duration::from_secs_f64(d / 2.0 + d / 2.0 * r.clamp(0.0, 1.0))
}

/// Stateful backoff sequence.
#[derive(Debug, Clone)]
pub(crate) struct Backoff {
    base: Duration,
    cap: Duration,
    attempt: u32,
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new(BASE, CAP)
    }
}

impl Backoff {
    pub(crate) fn new(base: Duration, cap: Duration) -> Self {
        Self {
            base,
            cap,
            attempt: 0,
        }
    }

    /// Next delay (advances the sequence).
    pub(crate) fn next_delay(&mut self) -> Duration {
        let d = delay_for(self.attempt, self.base, self.cap, fastrand::f64());
        self.attempt = self.attempt.saturating_add(1);
        d
    }

    /// Starts over (after progress was made).
    pub(crate) fn reset(&mut self) {
        self.attempt = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grows_and_caps() {
        assert_eq!(delay_for(0, BASE, CAP, 0.0), Duration::from_millis(250));
        assert_eq!(delay_for(0, BASE, CAP, 1.0), Duration::from_millis(500));
        assert_eq!(delay_for(3, BASE, CAP, 1.0), Duration::from_secs(4));
        assert_eq!(delay_for(20, BASE, CAP, 1.0), CAP);
        assert_eq!(delay_for(20, BASE, CAP, 0.0), CAP / 2);
    }

    #[test]
    fn jitter_in_range_and_reset() {
        let mut b = Backoff::default();
        for i in 0..12u32 {
            let d = b.next_delay();
            let full = (0.5 * 2f64.powi(i as i32)).min(30.0);
            assert!(
                d.as_secs_f64() >= full / 2.0 - 1e-9 && d.as_secs_f64() <= full + 1e-9,
                "{i}: {d:?}"
            );
        }
        assert_eq!(b.attempt, 12);
        b.reset();
        assert!(b.next_delay() <= Duration::from_millis(500));
    }
}

//! Exponentially weighted moving-average speed meter.

use std::time::{Duration, Instant};

/// Smoothing time constant.
const TAU: f64 = 2.0;

/// Tracks a monotonically increasing byte counter and reports a smoothed rate.
#[derive(Debug, Clone, Default)]
pub(crate) struct SpeedMeter {
    rate: f64,
    last_total: u64,
    last: Option<Instant>,
}

impl SpeedMeter {
    /// Feeds the current counter value; returns the smoothed rate in bytes/s.
    pub(crate) fn update(&mut self, total: u64, now: Instant) -> u64 {
        match self.last {
            None => {
                self.last = Some(now);
                self.last_total = total;
            }
            Some(last) => {
                let dt = now.saturating_duration_since(last);
                if dt >= Duration::from_millis(50) {
                    let inst = total.saturating_sub(self.last_total) as f64 / dt.as_secs_f64();
                    if self.rate == 0.0 {
                        self.rate = inst;
                    } else {
                        let alpha = 1.0 - (-dt.as_secs_f64() / TAU).exp();
                        self.rate += alpha * (inst - self.rate);
                    }
                    self.last = Some(now);
                    self.last_total = total;
                }
            }
        }
        self.rate.max(0.0) as u64
    }

    /// Last computed rate.
    pub(crate) fn rate(&self) -> u64 {
        self.rate.max(0.0) as u64
    }

    /// Restarts measurement from `total`.
    #[cfg(test)]
    pub(crate) fn reset(&mut self, total: u64, now: Instant) {
        self.rate = 0.0;
        self.last_total = total;
        self.last = Some(now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converges_to_steady_rate() {
        let mut m = SpeedMeter::default();
        let t0 = Instant::now();
        let mut total = 0u64;
        for i in 1..=40u64 {
            total += 250_000; // 1 MB/s at 250 ms ticks
            m.update(total, t0 + Duration::from_millis(250 * i));
        }
        let r = m.rate() as f64;
        assert!((r - 1_000_000.0).abs() < 20_000.0, "{r}");
        // Drops toward zero when idle.
        for i in 41..=80u64 {
            m.update(total, t0 + Duration::from_millis(250 * i));
        }
        assert!(m.rate() < 50_000);
    }
}

//! Per-host connection accounting shared by all downloads of an engine.
//!
//! reqwest has no per-host connection cap, so every worker holds a [`HostPermit`] for as long
//! as it owns a connection. The cap per host is the minimum of the configured global
//! `max_connections_per_host` and a *learned* limit recorded when a server refuses extra
//! connections. Learned limits expire after a TTL and can be exported/imported by the
//! application (to persist them across restarts).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

/// A learned per-host connection limit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostLimit {
    /// `host[:port]`.
    pub host: String,
    /// Maximum simultaneous connections that worked.
    pub connections: u32,
}

#[derive(Debug, Default)]
struct Entry {
    learned: Option<(usize, Instant)>,
    active: usize,
    connected: usize,
}

/// Engine-wide host table.
#[derive(Debug)]
pub(crate) struct HostLimits {
    inner: Mutex<HashMap<String, Entry>>,
    changed: Notify,
    /// Learned-limit lifetime in milliseconds.
    ttl_ms: AtomicU64,
    /// Global per-host cap, `usize::MAX` = none.
    cap: AtomicUsize,
}

impl HostLimits {
    pub(crate) fn new(cap: Option<u16>, ttl: Duration) -> Self {
        let h = Self {
            inner: Mutex::new(HashMap::new()),
            changed: Notify::new(),
            ttl_ms: AtomicU64::new(0),
            cap: AtomicUsize::new(usize::MAX),
        };
        h.set_policy(cap, ttl);
        h
    }

    /// Updates the global per-host cap and the learned-limit TTL.
    pub(crate) fn set_policy(&self, cap: Option<u16>, ttl: Duration) {
        let cap = cap
            .map(usize::from)
            .filter(|c| *c > 0)
            .unwrap_or(usize::MAX);
        self.cap.store(cap, Ordering::Release);
        self.ttl_ms.store(
            ttl.as_millis().min(u128::from(u64::MAX)) as u64,
            Ordering::Release,
        );
        self.changed.notify_waiters();
    }

    fn ttl(&self) -> Duration {
        Duration::from_millis(self.ttl_ms.load(Ordering::Acquire))
    }

    fn cap(&self) -> Option<usize> {
        Some(self.cap.load(Ordering::Acquire)).filter(|c| *c != usize::MAX)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.inner.lock().expect("host limits lock")
    }

    fn limit_of(&self, e: &Entry) -> usize {
        let ttl = self.ttl();
        let learned = e
            .learned
            .filter(|(_, at)| at.elapsed() < ttl)
            .map(|(n, _)| n);
        match (learned, self.cap()) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => usize::MAX,
        }
    }

    /// Current effective cap for `host` (`None` = unlimited).
    pub(crate) fn limit(&self, host: &str) -> Option<usize> {
        let g = self.lock();
        let l = g
            .get(host)
            .map_or_else(|| self.cap().unwrap_or(usize::MAX), |e| self.limit_of(e));
        (l != usize::MAX).then_some(l)
    }

    /// Waits for a connection slot to `host`.
    pub(crate) async fn acquire(self: &Arc<Self>, host: &str) -> HostPermit {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut g = self.lock();
                let e = g.entry(host.to_string()).or_default();
                let limit = self.limit_of(e);
                if e.active < limit {
                    e.active += 1;
                    return HostPermit {
                        limits: self.clone(),
                        host: host.to_string(),
                        connected: false,
                    };
                }
            }
            notified.await;
        }
    }

    /// Records that `host` accepts at most `connections` simultaneous connections.
    pub(crate) fn record(&self, host: &str, connections: usize) {
        let mut g = self.lock();
        g.entry(host.to_string()).or_default().learned = Some((connections.max(1), Instant::now()));
        drop(g);
        self.changed.notify_waiters();
    }

    /// Forgets or sets a learned limit (application import/override).
    pub(crate) fn set(&self, host: &str, connections: Option<usize>) {
        let mut g = self.lock();
        g.entry(host.to_string()).or_default().learned =
            connections.map(|c| (c.max(1), Instant::now()));
        drop(g);
        self.changed.notify_waiters();
    }

    /// All unexpired learned limits.
    pub(crate) fn learned(&self) -> Vec<HostLimit> {
        let g = self.lock();
        let ttl = self.ttl();
        let mut v: Vec<HostLimit> = g
            .iter()
            .filter_map(|(h, e)| {
                e.learned
                    .filter(|(_, at)| at.elapsed() < ttl)
                    .map(|(n, _)| HostLimit {
                        host: h.clone(),
                        connections: n as u32,
                    })
            })
            .collect();
        v.sort_by(|a, b| a.host.cmp(&b.host));
        v
    }
}

/// A connection slot; released on drop.
#[derive(Debug)]
pub(crate) struct HostPermit {
    limits: Arc<HostLimits>,
    host: String,
    connected: bool,
}

impl HostPermit {
    /// Marks the slot as having (or no longer having) a working connection.
    pub(crate) fn set_connected(&mut self, connected: bool) {
        if self.connected == connected {
            return;
        }
        self.connected = connected;
        let mut g = self.limits.lock();
        let e = g.entry(self.host.clone()).or_default();
        if connected {
            e.connected += 1;
        } else {
            e.connected = e.connected.saturating_sub(1);
        }
    }
}

impl Drop for HostPermit {
    fn drop(&mut self) {
        {
            let mut g = self.limits.lock();
            let e = g.entry(self.host.clone()).or_default();
            e.active = e.active.saturating_sub(1);
            if self.connected {
                e.connected = e.connected.saturating_sub(1);
            }
        }
        self.limits.changed.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn caps_and_learned_limits() {
        let h = Arc::new(HostLimits::new(None, Duration::from_secs(60)));
        assert_eq!(h.limit("a"), None);
        let mut p1 = h.acquire("a").await;
        p1.set_connected(true);
        let _p2 = h.acquire("a").await;
        assert_eq!(h.lock()["a"].connected, 1);
        h.record("a", 2);
        assert_eq!(h.limit("a"), Some(2));
        // Third acquire waits until a permit is dropped.
        let h2 = h.clone();
        let waiter = tokio::spawn(async move { h2.acquire("a").await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!waiter.is_finished());
        drop(p1);
        let _p3 = tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(h.lock()["a"].connected, 0);
        assert_eq!(
            h.learned(),
            vec![HostLimit {
                host: "a".into(),
                connections: 2
            }]
        );
        h.set("a", None);
        assert!(h.learned().is_empty());
    }

    #[tokio::test]
    async fn global_cap_and_expiry() {
        let h = Arc::new(HostLimits::new(Some(3), Duration::from_millis(30)));
        assert_eq!(h.limit("x"), Some(3));
        h.record("x", 1);
        assert_eq!(h.limit("x"), Some(1));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(h.limit("x"), Some(3), "learned limit expired");
    }
}

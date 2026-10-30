//! Shared helpers for the integration tests.
#![allow(dead_code)]

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use prism_engine::{
    Completed, DownloadEvent, DownloadHandle, DownloadRequest, DownloadState, Engine, EngineConfig,
    EngineError, ProgressSnapshot, Url,
};
use prism_testserver::{ServerConfig, TestServer};
use sha2::{Digest, Sha256};
use tokio::sync::broadcast::error::RecvError;

pub const MIB: u64 = 1 << 20;

pub fn engine() -> Engine {
    Engine::new(EngineConfig {
        connect_timeout: Duration::from_secs(5),
        read_timeout: Duration::from_secs(10),
        ..EngineConfig::default()
    })
}

pub async fn server(cfg: ServerConfig) -> TestServer {
    TestServer::start(cfg).await.expect("start test server")
}

pub async fn default_server() -> TestServer {
    server(ServerConfig::default()).await
}

pub fn request(url: &str, dir: &Path, connections: u8) -> DownloadRequest {
    let mut r = DownloadRequest::new(Url::parse(url).unwrap(), dir);
    r.connections = connections;
    r
}

pub fn sha256_file(path: &Path) -> String {
    let data = std::fs::read(path).unwrap();
    prism_testserver::sha256_hex(&data)
}

pub fn sha256(data: &[u8]) -> String {
    let d = Sha256::digest(data);
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// Collects all events of a handle in the background.
pub fn collect_events(h: &DownloadHandle) -> Arc<Mutex<Vec<DownloadEvent>>> {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut rx = h.events();
    let sink = events.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(e) => sink.lock().unwrap().push(e),
                Err(RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });
    events
}

pub async fn wait(h: &DownloadHandle, secs: u64) -> Result<Completed, EngineError> {
    tokio::time::timeout(Duration::from_secs(secs), h.wait())
        .await
        .expect("download timed out")
}

/// Waits until the transfer itself is over (the job enters `Finalizing`) and returns the time
/// since `since`. Timing asserts use this: the flush, fsync and rename that follow are slow on
/// some CI file systems and say nothing about the transfer.
pub async fn transfer_time(h: &DownloadHandle, since: Instant, secs: u64) -> Duration {
    let mut events = h.events();
    tokio::time::timeout(Duration::from_secs(secs), async {
        loop {
            match events.recv().await {
                Ok(DownloadEvent::StateChanged {
                    state: DownloadState::Finalizing,
                }) => return since.elapsed(),
                Ok(DownloadEvent::StateChanged { state }) if state.is_terminal() => {
                    panic!("ended as {state:?} before finalizing")
                }
                Ok(_) | Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => panic!("event stream closed"),
            }
        }
    })
    .await
    .expect("transfer timed out")
}

/// Waits until the job's progress snapshot satisfies `pred` (`what` names it on timeout).
pub async fn wait_until(
    h: &DownloadHandle,
    what: &str,
    pred: impl Fn(&ProgressSnapshot) -> bool,
) -> ProgressSnapshot {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let s = h.snapshot();
            if pred(&s) {
                return s;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        let s = h.snapshot();
        panic!(
            "timed out: {what} ({:?}, {} active of {})",
            s.state, s.active_connections, s.target_connections
        )
    })
}

/// Waits until at least `bytes` were downloaded.
pub async fn wait_for_progress(h: &DownloadHandle, bytes: u64) {
    tokio::time::timeout(Duration::from_secs(30), async {
        while h.snapshot().downloaded < bytes {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("no progress");
}

pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init();
}

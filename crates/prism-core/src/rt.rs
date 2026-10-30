//! Access to the tokio runtime the core was started on.
//!
//! Some callers live outside any runtime (the UI thread for tray menus, single-instance
//! callbacks, synchronous shell code). Public core entry points that spawn tasks call
//! [`enter`] so `tokio::spawn` (in the core and in the engine) always has a runtime.

use std::sync::OnceLock;
use tokio::runtime::{EnterGuard, Handle};

static RUNTIME: OnceLock<Handle> = OnceLock::new();

/// Remember the runtime (called once from `Core::start`).
pub(crate) fn init() {
    if let Ok(h) = Handle::try_current() {
        let _ = RUNTIME.set(h);
    }
}

/// Enter the core runtime if the current thread is not already inside one.
pub(crate) fn enter() -> Option<EnterGuard<'static>> {
    if Handle::try_current().is_ok() {
        return None;
    }
    RUNTIME.get().map(Handle::enter)
}

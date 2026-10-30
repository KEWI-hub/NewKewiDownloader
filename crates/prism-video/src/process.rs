//! Child-process helpers: no console windows on Windows, kill-on-drop, and
//! whole-tree termination (the PyInstaller yt-dlp executable runs a second
//! child process, and yt-dlp itself spawns ffmpeg).

use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::{Child, Command};

use crate::error::{Result, VideoError};
use crate::tools::Tool;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command preconfigured for a background tool: no console window, UTF-8
/// Python I/O, null stdin, piped stdout/stderr, killed when dropped.
pub(crate) fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        // Own process group so the whole tree can be signalled.
        cmd.process_group(0);
    }
    cmd
}

/// A spawned child plus whatever is needed to kill its whole process tree.
pub(crate) struct Spawned {
    pub child: Child,
    #[cfg(windows)]
    job: Option<job::Job>,
}

impl Spawned {
    pub fn spawn(cmd: &mut Command) -> std::io::Result<Spawned> {
        let child = cmd.spawn()?;
        #[cfg(windows)]
        {
            let job = job::Job::new().filter(|j| child.raw_handle().is_some_and(|h| j.assign(h)));
            Ok(Spawned { child, job })
        }
        #[cfg(not(windows))]
        {
            Ok(Spawned { child })
        }
    }

    /// Kill the child and all of its descendants.
    pub async fn kill_tree(&mut self) {
        #[cfg(windows)]
        {
            if let Some(job) = &self.job {
                job.terminate();
            } else if let Some(pid) = self.child.id() {
                let _ = command(Path::new("taskkill"))
                    .args(["/T", "/F", "/PID", &pid.to_string()])
                    .status()
                    .await;
            }
        }
        #[cfg(unix)]
        {
            if let Some(pid) = self.child.id() {
                let _ = Command::new("kill")
                    .args(["-KILL", "--", &format!("-{pid}")])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .await;
            }
        }
        let _ = self.child.kill().await;
    }
}

impl Drop for Spawned {
    /// Windows: dropping the job handle kills the tree (KILL_ON_JOB_CLOSE).
    /// Unix: `kill_on_drop` only reaches the direct child, so signal the whole group.
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Ok(None) = self.child.try_wait()
            && let Some(pid) = self.child.id()
        {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", "--", &format!("-{pid}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

/// Run a short-lived command and capture its output, with a timeout.
pub(crate) async fn run_capture<I, S>(
    tool: Tool,
    program: &Path,
    args: I,
    timeout: Duration,
) -> Result<std::process::Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = command(program);
    cmd.args(args);
    let mut sp = Spawned::spawn(&mut cmd)?;
    let stdout = sp.child.stdout.take();
    let stderr = sp.child.stderr.take();
    let read_out = async move {
        let mut buf = Vec::new();
        if let Some(mut s) = stdout {
            use tokio::io::AsyncReadExt;
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    };
    let read_err = async move {
        let mut buf = Vec::new();
        if let Some(mut s) = stderr {
            use tokio::io::AsyncReadExt;
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    };
    let fut = async {
        let (out, err) = tokio::join!(read_out, read_err);
        let status = sp.child.wait().await?;
        Ok::<_, std::io::Error>(std::process::Output {
            status,
            stdout: out,
            stderr: err,
        })
    };
    match tokio::time::timeout(timeout, fut).await {
        Ok(r) => Ok(r?),
        Err(_) => {
            sp.kill_tree().await;
            Err(VideoError::ToolFailed {
                tool,
                code: None,
                message: format!("timed out after {}s", timeout.as_secs()),
            })
        }
    }
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::RawHandle;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject,
    };

    /// Job object with KILL_ON_JOB_CLOSE: closing the handle (drop) or
    /// terminating it kills every process in the tree.
    pub struct Job(HANDLE);

    // SAFETY: a job handle is a kernel object handle usable from any thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> Option<Job> {
            // SAFETY: plain Win32 calls with valid arguments; the handle is owned by `Job`.
            unsafe {
                let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if h.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    h,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    CloseHandle(h);
                    return None;
                }
                Some(Job(h))
            }
        }

        pub fn assign(&self, process: RawHandle) -> bool {
            // SAFETY: `process` is a live process handle owned by the tokio Child.
            unsafe { AssignProcessToJobObject(self.0, process as HANDLE) != 0 }
        }

        pub fn terminate(&self) {
            // SAFETY: valid job handle.
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: we own the handle.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

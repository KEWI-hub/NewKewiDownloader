//! Native messaging framing: a `u32` length in **native byte order** followed
//! by that many bytes of UTF-8 JSON, in both directions.
//!
//! Limits (Chrome and Firefox): browser → host up to 64 MiB, host → browser
//! must be at most 1 MiB (we keep it strictly below).

use std::io::{self, Read, Write};

/// Largest message we accept from the browser.
pub const MAX_INCOMING: usize = 64 * 1024 * 1024;
/// Largest message we send to the browser (strictly below 1 MiB).
pub const MAX_OUTGOING: usize = 1024 * 1024 - 1;

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("i/o error: {0}")]
    Io(#[from] io::Error),
    #[error("frame of {0} bytes exceeds the limit")]
    TooLarge(usize),
    #[error("stream ended in the middle of a frame")]
    Truncated,
}

/// Encodes one frame (length prefix + body).
pub fn encode_frame(body: &[u8]) -> Result<Vec<u8>, FrameError> {
    if body.len() > MAX_OUTGOING {
        return Err(FrameError::TooLarge(body.len()));
    }
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&(body.len() as u32).to_ne_bytes());
    out.extend_from_slice(body);
    Ok(out)
}

/// Writes one frame and flushes. Header and body go out in a single
/// `write_all` so concurrent writers holding a lock never interleave.
pub fn write_frame<W: Write>(w: &mut W, body: &[u8]) -> Result<(), FrameError> {
    let frame = encode_frame(body)?;
    w.write_all(&frame)?;
    w.flush()?;
    Ok(())
}

/// Reads until `buf` is full. Returns the number of bytes read, which is less
/// than `buf.len()` only on EOF. Retries on `Interrupted`.
fn read_full<R: Read>(r: &mut R, buf: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match r.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(filled)
}

/// Reads one frame. `Ok(None)` means a clean EOF at a frame boundary (the
/// browser closed the port). Handles arbitrarily fragmented reads.
pub fn read_frame<R: Read>(r: &mut R) -> Result<Option<Vec<u8>>, FrameError> {
    let mut header = [0u8; 4];
    let n = read_full(r, &mut header)?;
    if n == 0 {
        return Ok(None);
    }
    if n < 4 {
        return Err(FrameError::Truncated);
    }
    let len = u32::from_ne_bytes(header) as usize;
    if len > MAX_INCOMING {
        return Err(FrameError::TooLarge(len));
    }
    let mut body = vec![0u8; len];
    if read_full(r, &mut body)? < len {
        return Err(FrameError::Truncated);
    }
    Ok(Some(body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A reader that returns at most `chunk` bytes per call.
    struct Trickle {
        data: Vec<u8>,
        pos: usize,
        chunk: usize,
    }
    impl Read for Trickle {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let n = self.chunk.min(buf.len()).min(self.data.len() - self.pos);
            buf[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
            self.pos += n;
            Ok(n)
        }
    }

    #[test]
    fn roundtrip() {
        let mut buf = Vec::new();
        write_frame(&mut buf, br#"{"a":1}"#).unwrap();
        write_frame(&mut buf, b"{}").unwrap();
        assert_eq!(&buf[..4], &7u32.to_ne_bytes());
        let mut c = Cursor::new(buf);
        assert_eq!(read_frame(&mut c).unwrap().unwrap(), br#"{"a":1}"#);
        assert_eq!(read_frame(&mut c).unwrap().unwrap(), b"{}");
        assert!(read_frame(&mut c).unwrap().is_none());
    }

    #[test]
    fn partial_reads_one_byte_at_a_time() {
        let body = vec![b'x'; 70_000];
        let mut data = encode_frame(&body).unwrap();
        data.extend(encode_frame(b"[1]").unwrap());
        let mut t = Trickle {
            data,
            pos: 0,
            chunk: 1,
        };
        assert_eq!(read_frame(&mut t).unwrap().unwrap().len(), 70_000);
        assert_eq!(read_frame(&mut t).unwrap().unwrap(), b"[1]");
        assert!(read_frame(&mut t).unwrap().is_none());
    }

    #[test]
    fn large_incoming_message() {
        // 5 MiB: above the outgoing limit but valid incoming.
        let len = 5 * 1024 * 1024;
        let mut data = (len as u32).to_ne_bytes().to_vec();
        data.extend(std::iter::repeat_n(b'a', len));
        let mut t = Trickle {
            data,
            pos: 0,
            chunk: 65_536,
        };
        assert_eq!(read_frame(&mut t).unwrap().unwrap().len(), len);
    }

    #[test]
    fn outgoing_limit() {
        assert!(encode_frame(&vec![0u8; MAX_OUTGOING]).is_ok());
        assert!(matches!(
            encode_frame(&vec![0u8; MAX_OUTGOING + 1]),
            Err(FrameError::TooLarge(_))
        ));
    }

    #[test]
    fn incoming_limit_and_truncation() {
        let data = ((MAX_INCOMING + 1) as u32).to_ne_bytes().to_vec();
        assert!(matches!(
            read_frame(&mut Cursor::new(data)),
            Err(FrameError::TooLarge(_))
        ));
        let mut data = 10u32.to_ne_bytes().to_vec();
        data.extend_from_slice(b"abc");
        assert!(matches!(
            read_frame(&mut Cursor::new(data)),
            Err(FrameError::Truncated)
        ));
        assert!(matches!(
            read_frame(&mut Cursor::new(vec![1u8, 0])),
            Err(FrameError::Truncated)
        ));
    }
}

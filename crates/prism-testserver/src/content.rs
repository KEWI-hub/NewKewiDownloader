//! Deterministic pseudo-random content addressed by `(seed, offset)`.
//!
//! The server never stores file bodies: every byte is a pure function of the seed and its
//! absolute offset, so any range can be produced (and verified by tests) independently.

use sha2::{Digest, Sha256};

const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

#[inline]
fn splitmix64(mut z: u64) -> u64 {
    z = z.wrapping_add(GOLDEN);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[inline]
fn word(seed: u64, index: u64) -> [u8; 8] {
    splitmix64(seed ^ index.wrapping_mul(GOLDEN)).to_le_bytes()
}

/// Derives the seed used for a given content `version` (version 0 is the seed itself).
///
/// Changing the version of a served file changes every byte, its ETag and Last-Modified.
pub fn versioned_seed(seed: u64, version: u64) -> u64 {
    if version == 0 {
        seed
    } else {
        splitmix64(seed ^ version.rotate_left(17))
    }
}

/// Fills `buf` with the content bytes starting at absolute `offset`.
pub fn fill(seed: u64, offset: u64, buf: &mut [u8]) {
    let mut pos = 0usize;
    let mut off = offset;
    // Unaligned head.
    let head = (off % 8) as usize;
    if head != 0 {
        let w = word(seed, off / 8);
        let n = (8 - head).min(buf.len());
        buf[..n].copy_from_slice(&w[head..head + n]);
        pos += n;
        off += n as u64;
    }
    // Whole words.
    while buf.len() - pos >= 8 {
        buf[pos..pos + 8].copy_from_slice(&word(seed, off / 8));
        pos += 8;
        off += 8;
    }
    // Tail.
    if pos < buf.len() {
        let w = word(seed, off / 8);
        let n = buf.len() - pos;
        buf[pos..].copy_from_slice(&w[..n]);
    }
}

/// Returns the content bytes for `range` (half-open, absolute offsets).
pub fn expected_bytes(seed: u64, range: std::ops::Range<u64>) -> Vec<u8> {
    let mut v = vec![0u8; (range.end - range.start) as usize];
    fill(seed, range.start, &mut v);
    v
}

/// Lower-case hex SHA-256 of the first `size` content bytes.
pub fn expected_sha256(seed: u64, size: u64) -> String {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut off = 0u64;
    while off < size {
        let n = ((size - off) as usize).min(buf.len());
        fill(seed, off, &mut buf[..n]);
        hasher.update(&buf[..n]);
        off += n as u64;
    }
    hex(&hasher.finalize())
}

/// Lower-case hex encoding.
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 15) as usize] as char);
    }
    s
}

/// Lower-case hex SHA-256 of arbitrary bytes.
pub fn sha256_hex(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_is_offset_consistent() {
        let all = expected_bytes(7, 0..1000);
        for start in [0u64, 1, 3, 7, 8, 9, 513] {
            for len in [0usize, 1, 5, 8, 17, 100] {
                let part = expected_bytes(7, start..start + len as u64);
                assert_eq!(&part[..], &all[start as usize..start as usize + len]);
            }
        }
    }

    #[test]
    fn versions_differ() {
        assert_ne!(
            expected_bytes(1, 0..64),
            expected_bytes(versioned_seed(1, 1), 0..64)
        );
        assert_eq!(versioned_seed(5, 0), 5);
    }

    #[test]
    fn sha_matches_bytes() {
        let data = expected_bytes(3, 0..3_000_001);
        assert_eq!(sha256_hex(&data), expected_sha256(3, 3_000_001));
    }
}

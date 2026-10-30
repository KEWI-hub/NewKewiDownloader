//! Helpers for the application layer: batch URL pattern expansion.

/// Maximum number of URLs a pattern may expand to.
pub const MAX_BATCH_EXPANSION: usize = 10_000;

/// Batch pattern errors.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BatchError {
    /// The pattern expands to more than [`MAX_BATCH_EXPANSION`] URLs.
    #[error("pattern expands to {count} URLs (limit {MAX_BATCH_EXPANSION})")]
    TooMany {
        /// Number of URLs the pattern would produce (saturating).
        count: u64,
    },
    /// A range is syntactically a pattern but invalid (e.g. step 0, mixed letter case).
    #[error("invalid range [{0}]")]
    InvalidRange(String),
}

#[derive(Debug, Clone)]
enum Part {
    Literal(String),
    Choices(Vec<String>),
}

/// Expands batch patterns in `pattern`:
///
/// * `[1-10]` → `1`, `2`, …, `10`
/// * `[001-100]` → zero-padded to the width of the bounds (`001` … `100`)
/// * `[1-10:2]` → step 2 (`1, 3, 5, 7, 9`); descending ranges (`[10-1]`) count down
/// * `[a-z]`, `[A-F]` → letters (step allowed: `[a-z:2]`)
///
/// Several patterns produce the cartesian product (leftmost varies slowest). Brackets whose
/// content is not a range (e.g. IPv6 hosts like `[::1]`) are kept literally. A pattern without
/// ranges expands to itself.
pub fn expand_batch_pattern(pattern: &str) -> Result<Vec<String>, BatchError> {
    let parts = parse(pattern)?;
    let mut count: u64 = 1;
    for p in &parts {
        if let Part::Choices(c) = p {
            count = count.saturating_mul(c.len() as u64);
        }
    }
    if count > MAX_BATCH_EXPANSION as u64 {
        return Err(BatchError::TooMany { count });
    }
    let mut out = vec![String::new()];
    for p in &parts {
        match p {
            Part::Literal(l) => out.iter_mut().for_each(|s| s.push_str(l)),
            Part::Choices(c) => {
                let mut next = Vec::with_capacity(out.len() * c.len());
                for prefix in &out {
                    for choice in c {
                        next.push(format!("{prefix}{choice}"));
                    }
                }
                out = next;
            }
        }
    }
    Ok(out)
}

fn parse(pattern: &str) -> Result<Vec<Part>, BatchError> {
    let mut parts = Vec::new();
    let mut lit = String::new();
    let mut rest = pattern;
    while let Some(open) = rest.find('[') {
        lit.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find(']') {
            Some(close) => {
                let inner = &after[..close];
                match parse_range(inner)? {
                    Some(choices) => {
                        if !lit.is_empty() {
                            parts.push(Part::Literal(std::mem::take(&mut lit)));
                        }
                        parts.push(Part::Choices(choices));
                    }
                    None => {
                        lit.push('[');
                        lit.push_str(inner);
                        lit.push(']');
                    }
                }
                rest = &after[close + 1..];
            }
            None => {
                lit.push_str(&rest[open..]);
                rest = "";
            }
        }
    }
    lit.push_str(rest);
    if !lit.is_empty() {
        parts.push(Part::Literal(lit));
    }
    Ok(parts)
}

/// `Ok(None)` when `inner` is not range syntax at all.
fn parse_range(inner: &str) -> Result<Option<Vec<String>>, BatchError> {
    let (range, step) = match inner.split_once(':') {
        Some((r, s)) => (r, Some(s)),
        None => (inner, None),
    };
    let Some((a, b)) = range.split_once('-') else {
        return Ok(None);
    };
    let invalid = || BatchError::InvalidRange(inner.to_string());
    let step: u64 = match step {
        None => 1,
        Some(s) if s.chars().all(|c| c.is_ascii_digit()) && !s.is_empty() => {
            s.parse().map_err(|_| invalid())?
        }
        Some(_) => return Ok(None),
    };
    let numeric = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    let letter = |s: &str| s.len() == 1 && s.chars().all(|c| c.is_ascii_alphabetic());
    if numeric(a) && numeric(b) {
        if step == 0 {
            return Err(invalid());
        }
        let (x, y): (u64, u64) = (
            a.parse().map_err(|_| invalid())?,
            b.parse().map_err(|_| invalid())?,
        );
        let width = if (a.len() > 1 && a.starts_with('0')) || (b.len() > 1 && b.starts_with('0')) {
            a.len().max(b.len())
        } else {
            0
        };
        let span = x.abs_diff(y) / step + 1;
        if span > MAX_BATCH_EXPANSION as u64 {
            return Err(BatchError::TooMany { count: span });
        }
        let values = (0..span).map(|i| if x <= y { x + i * step } else { x - i * step });
        return Ok(Some(values.map(|v| format!("{v:0width$}")).collect()));
    }
    if letter(a) && letter(b) {
        let (x, y) = (a.as_bytes()[0], b.as_bytes()[0]);
        if step == 0 || x.is_ascii_uppercase() != y.is_ascii_uppercase() {
            return Err(invalid());
        }
        let span = u64::from(x.abs_diff(y)) / step + 1;
        let values = (0..span).map(|i| {
            let i = (i * step) as u8;
            (if x <= y { x + i } else { x - i }) as char
        });
        return Ok(Some(values.map(String::from).collect()));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_padding_and_step() {
        let v = expand_batch_pattern("http://h/file[001-100].zip").unwrap();
        assert_eq!(v.len(), 100);
        assert_eq!(v[0], "http://h/file001.zip");
        assert_eq!(v[99], "http://h/file100.zip");
        assert_eq!(
            expand_batch_pattern("x[1-10:3]").unwrap(),
            vec!["x1", "x4", "x7", "x10"]
        );
        assert_eq!(
            expand_batch_pattern("x[3-1]").unwrap(),
            vec!["x3", "x2", "x1"]
        );
        assert_eq!(
            expand_batch_pattern("[8-11]").unwrap(),
            vec!["8", "9", "10", "11"]
        );
    }

    #[test]
    fn letters_and_product() {
        assert_eq!(expand_batch_pattern("[a-c]").unwrap(), vec!["a", "b", "c"]);
        assert_eq!(
            expand_batch_pattern("[A-E:2]").unwrap(),
            vec!["A", "C", "E"]
        );
        let v = expand_batch_pattern("u/[a-b]/[1-3].jpg").unwrap();
        assert_eq!(
            v,
            vec![
                "u/a/1.jpg",
                "u/a/2.jpg",
                "u/a/3.jpg",
                "u/b/1.jpg",
                "u/b/2.jpg",
                "u/b/3.jpg"
            ]
        );
    }

    #[test]
    fn literals_and_errors() {
        assert_eq!(
            expand_batch_pattern("http://[::1]:8080/a").unwrap(),
            vec!["http://[::1]:8080/a"]
        );
        assert_eq!(
            expand_batch_pattern("no pattern").unwrap(),
            vec!["no pattern"]
        );
        assert_eq!(
            expand_batch_pattern("open [1-2").unwrap(),
            vec!["open [1-2"]
        );
        assert!(matches!(
            expand_batch_pattern("[1-5:0]"),
            Err(BatchError::InvalidRange(_))
        ));
        assert!(matches!(
            expand_batch_pattern("[a-Z]"),
            Err(BatchError::InvalidRange(_))
        ));
        assert!(matches!(
            expand_batch_pattern("[1-20000]"),
            Err(BatchError::TooMany { .. })
        ));
        assert!(matches!(
            expand_batch_pattern("[1-200][1-100]"),
            Err(BatchError::TooMany { count: 20000 })
        ));
        assert_eq!(
            expand_batch_pattern("[1-100][1-100]").unwrap().len(),
            10_000
        );
    }
}

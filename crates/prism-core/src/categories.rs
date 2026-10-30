//! Built-in categories and file-type classification.

use crate::model::Category;
use std::path::{Path, PathBuf};

pub const OTHER: &str = "other";

/// `(id, display name, icon, extensions)` of the built-in categories, in sidebar order.
const BUILTIN: &[(&str, &str, &str, &[&str])] = &[
    (
        "video",
        "Video",
        "cat-video",
        &[
            "3gp", "asf", "avi", "flv", "m2ts", "m4v", "mkv", "mov", "mp4", "mpe", "mpeg", "mpg",
            "ogv", "qt", "rm", "rmvb", "ts", "vob", "webm", "wmv",
        ],
    ),
    (
        "music",
        "Music",
        "cat-music",
        &[
            "aac", "aif", "aiff", "alac", "ape", "flac", "m4a", "mid", "mp3", "mpa", "oga", "ogg",
            "opus", "ra", "wav", "wma",
        ],
    ),
    (
        "documents",
        "Documents",
        "cat-documents",
        &[
            "csv", "doc", "docx", "epub", "md", "odp", "ods", "odt", "pdf", "pps", "ppt", "pptx",
            "rtf", "txt", "xls", "xlsx", "xps",
        ],
    ),
    (
        "programs",
        "Programs",
        "cat-programs",
        &[
            "apk", "appimage", "bin", "deb", "dmg", "exe", "flatpak", "jar", "msi", "msix", "msu",
            "pkg", "rpm", "run", "snap",
        ],
    ),
    (
        "compressed",
        "Compressed",
        "cat-compressed",
        &[
            "7z", "ace", "arj", "bz2", "cab", "gz", "gzip", "img", "iso", "lz", "lzh", "lzma",
            "r00", "r01", "rar", "sit", "sitx", "tar", "tbz", "tgz", "txz", "xz", "z", "zip",
            "zst",
        ],
    ),
    (
        "images",
        "Images",
        "cat-images",
        &[
            "avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "psd", "raw", "svg", "tif",
            "tiff", "webp",
        ],
    ),
    ("other", "Other", "cat-other", &[]),
];

/// A file name whose content is never a web page: programs, archives and disk images, media and
/// binary documents. A small HTML answer for one is an error or check page, not the file.
pub fn is_binary_file_name(name: &str) -> bool {
    const TEXT: &[&str] = &["csv", "md", "rtf", "svg", "txt"];
    let Some(ext) = Path::new(name).extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let ext = ext.to_ascii_lowercase();
    !TEXT.contains(&ext.as_str())
        && BUILTIN
            .iter()
            .any(|(id, _, _, exts)| *id != OTHER && exts.contains(&ext.as_str()))
}

pub fn builtin_categories() -> Vec<Category> {
    BUILTIN
        .iter()
        .enumerate()
        .map(|(i, (id, name, icon, exts))| Category {
            id: (*id).into(),
            name: (*name).into(),
            icon: (*icon).into(),
            extensions: exts.iter().map(|e| e.to_string()).collect(),
            save_dir: None,
            builtin: true,
            position: i as i64,
        })
        .collect()
}

/// Lower-case extension of a file name without the dot (`"Movie.MKV"` → `"mkv"`).
pub fn extension_of(file_name: &str) -> Option<String> {
    Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !e.is_empty())
}

/// Pick the category for a file. Custom categories win over built-ins so users can
/// override (e.g. a "Linux ISOs" category claiming `iso`).
pub fn classify(categories: &[Category], file_name: &str) -> String {
    let Some(ext) = extension_of(file_name) else {
        return OTHER.into();
    };
    let matches = |c: &&Category| c.extensions.iter().any(|e| e.eq_ignore_ascii_case(&ext));
    categories
        .iter()
        .filter(|c| !c.builtin)
        .find(matches)
        .or_else(|| categories.iter().filter(|c| c.builtin).find(matches))
        .map(|c| c.id.clone())
        .unwrap_or_else(|| OTHER.into())
}

/// Folder where a category's files are saved.
pub fn save_dir_for(
    category: Option<&Category>,
    default_dir: &Path,
    use_category_folders: bool,
) -> PathBuf {
    match category {
        Some(c) => match &c.save_dir {
            Some(dir) => dir.clone(),
            None if use_category_folders && c.id != OTHER => default_dir.join(&c.name),
            None => default_dir.to_path_buf(),
        },
        None => default_dir.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classification() {
        let mut cats = builtin_categories();
        assert_eq!(classify(&cats, "movie.MKV"), "video");
        assert_eq!(classify(&cats, "setup.exe"), "programs");
        assert_eq!(classify(&cats, "archive.tar.gz"), "compressed");
        assert_eq!(classify(&cats, "README"), "other");
        assert_eq!(classify(&cats, "weird.xyz"), "other");
        cats.push(Category {
            id: "isos".into(),
            name: "ISOs".into(),
            extensions: vec!["iso".into()],
            ..Default::default()
        });
        assert_eq!(classify(&cats, "ubuntu.iso"), "isos");
    }

    #[test]
    fn save_dirs() {
        let cats = builtin_categories();
        let root = Path::new("/dl");
        assert_eq!(
            save_dir_for(cats.first(), root, true),
            Path::new("/dl/Video")
        );
        assert_eq!(save_dir_for(cats.last(), root, true), Path::new("/dl"));
        assert_eq!(save_dir_for(cats.first(), root, false), Path::new("/dl"));
    }
}

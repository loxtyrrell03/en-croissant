//! Transport for reviewed, immutable public Lichess indexes. Never selects a
//! database or changes lookup preferences. Callers must pin the manifest digest.
mod install;
pub mod jobs;
pub mod otb_library;
pub mod removal;
pub use install::{install, Progress, Source};
mod cache;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub const PART_BYTES: u64 = 128 * 1024 * 1024;
pub const MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
pub const OTB_ATTRIBUTION: &str = include_str!("../config/otb-data-license.txt");
pub const BROADCAST_ATTRIBUTION: &str = include_str!("../config/broadcast-data-license.txt");

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Rated,
    Broadcasts,
    Evaluations,
    Otb,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub kind: Kind,
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<String>,
    pub coverage: serde_json::Value,
    pub unpacked_bytes: u64,
    pub download_bytes: u64,
    pub files: Vec<PackFile>,
    pub parts: Vec<Part>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PackFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Part {
    pub name: String,
    pub encoding: Encoding,
    pub bytes: u64,
    pub sha256: String,
    pub decoded_bytes: u64,
    pub decoded_sha256: String,
    pub segments: Vec<Segment>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Identity,
    Zstd,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Segment {
    pub file: usize,
    pub offset: u64,
    pub length: u64,
}

fn sha(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn valid_id(value: &str) -> bool {
    (3..=80).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

impl Manifest {
    pub fn parse(bytes: &[u8], digest: &str, id: &str, kind: &Kind) -> Result<Self, String> {
        if bytes.len() as u64 > MANIFEST_BYTES || !sha(digest) || hash(bytes) != digest {
            return Err("The data pack manifest failed its integrity check.".into());
        }
        let pack: Self = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        pack.validate()?;
        if pack.id != id || &pack.kind != kind {
            return Err("The data pack does not match the selected download.".into());
        }
        Ok(pack)
    }

    pub fn validate(&self) -> Result<(), String> {
        let invalid = || "Invalid or unsupported data pack manifest.".to_string();
        if self.format != "novelty-data-pack"
            || self.version != 1
            || self.license
                != if matches!(self.kind, Kind::Broadcasts | Kind::Otb) {
                    "CC-BY-SA-4.0"
                } else {
                    "CC0-1.0"
                }
            || (self.kind == Kind::Broadcasts
                && self.attribution.as_deref() != Some(BROADCAST_ATTRIBUTION))
            || (self.kind == Kind::Otb && self.attribution.as_deref() != Some(OTB_ATTRIBUTION))
            || !valid_id(&self.id)
            || self.files.is_empty()
            || self.files.len() > 4097
            || self.parts.is_empty()
            || self.parts.len() > 999
        {
            return Err(invalid());
        }
        let mut paths = HashSet::new();
        for file in &self.files {
            let allowed = match self.kind {
                Kind::Otb => file.path == "otb-archive-index-v2.sqlite3",
                Kind::Rated => file.path == "opening-rated.sqlite3",
                Kind::Broadcasts => file.path == "opening.sqlite3",
                Kind::Evaluations => {
                    file.path == "manifest.json" || {
                        file.path
                            .strip_prefix("shards/")
                            .and_then(|s| s.strip_suffix(".bin.zst"))
                            .is_some_and(|n| n.len() == 4 && n.bytes().all(|b| b.is_ascii_digit()))
                    }
                }
            };
            if !allowed || file.bytes == 0 || !sha(&file.sha256) || !paths.insert(&file.path) {
                return Err(invalid());
            }
        }
        if self.kind == Kind::Evaluations
            && (!paths.contains(&"manifest.json".to_string()) || self.files.len() < 2)
        {
            return Err(invalid());
        }
        let mut offsets = vec![0_u64; self.files.len()];
        let (mut bytes, mut decoded) = (0_u64, 0_u64);
        for (index, part) in self.parts.iter().enumerate() {
            if part.name != format!("{}-{index:04}.part", self.id)
                || part.bytes == 0
                || part.bytes > PART_BYTES + 1024 * 1024
                || part.decoded_bytes == 0
                || part.decoded_bytes > PART_BYTES
                || !sha(&part.sha256)
                || !sha(&part.decoded_sha256)
                || part.segments.is_empty()
                || (matches!(part.encoding, Encoding::Identity)
                    && (part.bytes != part.decoded_bytes || part.sha256 != part.decoded_sha256))
            {
                return Err(invalid());
            }
            let mut covered = 0_u64;
            for segment in &part.segments {
                let offset = offsets.get_mut(segment.file).ok_or_else(invalid)?;
                if segment.length == 0 || segment.offset != *offset {
                    return Err(invalid());
                }
                *offset = offset.checked_add(segment.length).ok_or_else(invalid)?;
                if *offset > self.files[segment.file].bytes {
                    return Err(invalid());
                }
                covered = covered.checked_add(segment.length).ok_or_else(invalid)?;
            }
            if covered != part.decoded_bytes {
                return Err(invalid());
            }
            bytes = bytes.checked_add(part.bytes).ok_or_else(invalid)?;
            decoded = decoded
                .checked_add(part.decoded_bytes)
                .ok_or_else(invalid)?;
        }
        if bytes != self.download_bytes
            || decoded != self.unpacked_bytes
            || offsets
                .iter()
                .zip(&self.files)
                .any(|(offset, file)| *offset != file.bytes)
        {
            return Err(invalid());
        }
        Ok(())
    }
}

//! Streaming, bounded construction of En Croissant's existing shard format.
use super::build_control::{BudgetWriter, DiskBudget};
use super::*;
use std::{
    fs::OpenOptions,
    io::{BufRead, BufWriter, Write},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

const SPOOL_BUFFER_BYTES: usize = 32 * 1024;

pub fn build_compact_eval_database_controlled<F>(
    options: LocalEvalBuildOptions,
    control: LocalEvalBuildControl,
    progress: F,
) -> Result<LocalEvalBuildReport, LocalEvalError>
where
    F: FnMut(LocalEvalBuildProgress),
{
    build_with_source(options, control, progress, |options, control| {
        open_source(&options.source, control)
    })
}

pub(super) fn build_with_source<F, O>(
    options: LocalEvalBuildOptions,
    control: LocalEvalBuildControl,
    mut progress: F,
    open: O,
) -> Result<LocalEvalBuildReport, LocalEvalError>
where
    F: FnMut(LocalEvalBuildProgress),
    O: FnOnce(
        &LocalEvalBuildOptions,
        &LocalEvalBuildControl,
    ) -> Result<(Box<dyn Read + Send>, Option<u64>), LocalEvalError>,
{
    control.check()?;
    if control.disk_limit_bytes < 1024
        || control.disk_limit_bytes > build_control::MAX_BUILD_DISK_LIMIT_BYTES
    {
        return Err(LocalEvalError::InvalidOption(
            "Evaluation disk-space limit must be between 1024 bytes and 512 GiB.".into(),
        ));
    }
    let max_pvs = validate_max_pvs(options.max_pvs)?;
    let shard_count = validate_shard_count(options.shard_count)?;
    let source_label = options.source.label();
    let built_at = unix_now();
    let mut owned = match control.ownership {
        Some(identity) => {
            build_directory::BuildDirectory::create_with_identity(&options.output_dir, identity)?
        }
        None => build_directory::BuildDirectory::create(&options.output_dir)?,
    };
    let build_dir = owned.path.clone();
    if let Some(signal) = &control.cancel_file {
        let name = signal.file_name().ok_or_else(|| {
            LocalEvalError::InvalidOption(
                "Choose a cancellation signal file outside the build output.".into(),
            )
        })?;
        let parent = signal
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let resolved = parent.canonicalize()?.join(name);
        if resolved.starts_with(&build_dir) {
            return Err(LocalEvalError::InvalidOption("The cancellation signal must be outside the build output; its parent folder must already exist.".into()));
        }
    }
    let spool_dir = build_dir.join(SPOOL_DIR);
    let shards_dir = build_dir.join(SHARDS_DIR);
    fs::create_dir(&spool_dir)?;
    fs::create_dir(&shards_dir)?;
    let mut budget = DiskBudget {
        used: 16,
        limit: control.disk_limit_bytes,
    };

    emit_progress(
        &options.id,
        &mut progress,
        "opening",
        0.,
        0,
        0,
        0,
        None,
        false,
    );
    owned.ensure_owned()?;
    control.check()?;
    let (source, total_bytes) = open(&options, &control)?;
    let bytes_read = Arc::new(AtomicU64::new(0));
    let counting = CheckedReader {
        inner: source,
        count: bytes_read.clone(),
        control: &control,
    };
    let decoder = zstd::Decoder::new(counting)?;
    let mut reader = BufReader::with_capacity(128 * 1024, decoder);
    let mut spool = ShardSpool::new(&spool_dir, shard_count);
    let (mut lines, mut positions, mut skipped) = (0_u64, 0_u64, 0_u64);
    let mut line = Vec::new();
    emit_progress(
        &options.id,
        &mut progress,
        "ingesting",
        0.,
        positions,
        skipped,
        0,
        total_bytes,
        false,
    );
    owned.ensure_owned()?;
    control.check()?;
    let mut last_progress = Instant::now();
    loop {
        control.check()?;
        line.clear();
        let count = reader
            .by_ref()
            .take(control.max_line_bytes + 1)
            .read_until(b'\n', &mut line)?;
        control.check()?;
        if count == 0 {
            break;
        }
        lines += 1;
        if count as u64 > control.max_line_bytes {
            return Err(LocalEvalError::InvalidDatabase(format!(
                "Source line {lines} exceeds the {} byte limit.",
                control.max_line_bytes
            )));
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let text = std::str::from_utf8(&line).map_err(|error| {
            LocalEvalError::InvalidDatabase(format!("Source line {lines} is not UTF-8: {error}"))
        })?;
        match parse_compact_record(text, max_pvs) {
            Ok(Some(record)) => {
                let shard = shard_for_hash(record.hash_hi, record.hash_lo, shard_count);
                spool.push(shard, &pack_record(&record)?, &mut budget, &control)?;
                positions += 1;
            }
            Ok(None) => skipped += 1,
            Err(error) => {
                return Err(LocalEvalError::InvalidDatabase(format!(
                    "Could not parse source line {lines}: {error}"
                )))
            }
        }
        if last_progress.elapsed() >= Duration::from_millis(250) {
            let read = bytes_read.load(Ordering::Relaxed);
            emit_progress(
                &options.id,
                &mut progress,
                "ingesting",
                ingest_progress(read, total_bytes),
                positions,
                skipped,
                read,
                total_bytes,
                false,
            );
            owned.ensure_owned()?;
            control.check()?;
            last_progress = Instant::now();
        }
    }
    drop(reader);
    drop(line);
    owned.ensure_owned()?;
    spool.flush_all(&control)?;
    drop(spool.buffers);
    if positions == 0 {
        return Err(LocalEvalError::InvalidDatabase(
            "The export contains no usable evaluations.".into(),
        ));
    }
    emit_progress(
        &options.id,
        &mut progress,
        "sorting",
        92.,
        positions,
        skipped,
        bytes_read.load(Ordering::Relaxed),
        total_bytes,
        false,
    );
    let mut stored = 0;
    for shard in 0..shard_count {
        control.check()?;
        owned.ensure_owned()?;
        let input = shard_path(&spool_dir, shard);
        let (count, input_bytes) = sort_shard(
            &input,
            &shard_path(&shards_dir, shard),
            &mut budget,
            &control,
        )?;
        stored += count;
        if input_bytes > 0 {
            owned.ensure_owned()?;
            fs::remove_file(&input)?;
            budget.release(input_bytes);
        }
        if shard % 32 == 0 || shard + 1 == shard_count {
            emit_progress(
                &options.id,
                &mut progress,
                "sorting",
                92. + ((shard as f32 + 1.) / shard_count as f32) * 7.,
                stored,
                skipped,
                bytes_read.load(Ordering::Relaxed),
                total_bytes,
                false,
            );
        }
    }
    owned.ensure_owned()?;
    control.check()?;
    fs::remove_dir(&spool_dir)?;
    let manifest = LocalEvalManifest {
        format: "en-croissant-lichess-eval-compact".into(),
        version: FORMAT_VERSION,
        record_size: VARIABLE_RECORD_SIZE,
        shard_count,
        max_pvs,
        positions: stored,
        skipped,
        source: source_label.clone(),
        built_at,
        complete: true,
    };
    let bytes = serde_json::to_vec_pretty(&manifest)?;
    let pending = build_dir.join("manifest.pending");
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)?;
    let mut writer = BudgetWriter {
        inner: file,
        budget: &mut budget,
        control: &control,
    };
    writer.write_all(&bytes)?;
    writer.inner.sync_all()?;
    drop(writer);
    owned.ensure_owned()?;
    control.begin_publication()?;
    fs::rename(pending, build_dir.join(MANIFEST_FILE))?;
    owned.finish();
    clear_shard_cache();
    let final_storage_bytes = directory_size(&build_dir)?;
    emit_progress(
        &options.id,
        &mut progress,
        "ready",
        100.,
        stored,
        skipped,
        bytes_read.load(Ordering::Relaxed),
        total_bytes,
        true,
    );
    Ok(LocalEvalBuildReport {
        output_dir: options.output_dir.display().to_string(),
        source: source_label,
        positions: stored,
        skipped,
        duplicates: positions - stored,
        shard_count,
        max_pvs,
        storage_bytes: final_storage_bytes,
        built_at,
    })
}

struct CheckedReader<'a, R> {
    inner: R,
    count: Arc<AtomicU64>,
    control: &'a LocalEvalBuildControl,
}
impl<R: Read> Read for CheckedReader<'_, R> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.control.check_io()?;
        let result = self.inner.read(bytes);
        self.control.check_io()?;
        let count = result?;
        self.count.fetch_add(count as u64, Ordering::Relaxed);
        Ok(count)
    }
}

struct ShardSpool {
    dir: PathBuf,
    buffers: Vec<Vec<u8>>,
}
impl ShardSpool {
    fn new(dir: &Path, shards: u16) -> Self {
        Self {
            dir: dir.into(),
            buffers: (0..shards).map(|_| Vec::new()).collect(),
        }
    }
    fn push(
        &mut self,
        shard: u16,
        record: &[u8],
        budget: &mut DiskBudget,
        control: &LocalEvalBuildControl,
    ) -> Result<(), LocalEvalError> {
        control.check()?;
        budget.reserve(record.len() as u64)?;
        self.buffers[shard as usize].extend_from_slice(record);
        if self.buffers[shard as usize].len() >= SPOOL_BUFFER_BYTES {
            self.flush(shard, control)?;
        }
        Ok(())
    }
    fn flush(&mut self, shard: u16, control: &LocalEvalBuildControl) -> Result<(), LocalEvalError> {
        control.check()?;
        let buffer = &mut self.buffers[shard as usize];
        if buffer.is_empty() {
            return Ok(());
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(shard_path(&self.dir, shard))?;
        file.write_all(buffer)?;
        buffer.clear();
        Ok(())
    }
    fn flush_all(&mut self, control: &LocalEvalBuildControl) -> Result<(), LocalEvalError> {
        for shard in 0..self.buffers.len() as u16 {
            self.flush(shard, control)?;
        }
        Ok(())
    }
}

pub(super) fn sort_shard(
    input: &Path,
    output: &Path,
    budget: &mut DiskBudget,
    control: &LocalEvalBuildControl,
) -> Result<(u64, u64), LocalEvalError> {
    control.check()?;
    let metadata = match fs::metadata(input) {
        Ok(value) => value,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(error) => return Err(error.into()),
    };
    if metadata.len() > control.max_shard_bytes {
        return Err(LocalEvalError::InvalidDatabase(
            "A shard exceeded the bounded sorting size. Increase the shard count for this source."
                .into(),
        ));
    }
    // Bound the read as well as the earlier metadata check: the file may grow.
    let mut bytes = Vec::new();
    File::open(input)?
        .take(control.max_shard_bytes + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > control.max_shard_bytes {
        return Err(LocalEvalError::InvalidDatabase(
            "A shard exceeded the bounded sorting size. Increase the shard count for this source."
                .into(),
        ));
    }
    let mut records = Vec::<&[u8]>::new();
    let mut offset = 0;
    while offset < bytes.len() {
        control.check()?;
        let record = record_at(&bytes, bytes.len(), offset)?;
        record_hash(record)?;
        records.push(record);
        offset += record.len();
    }
    records.sort_unstable_by(|a, b| {
        record_hash(a)
            .unwrap()
            .cmp(&record_hash(b).unwrap())
            .then_with(|| b[20].cmp(&a[20]))
            .then_with(|| {
                u16::from_le_bytes(b[18..20].try_into().unwrap())
                    .cmp(&u16::from_le_bytes(a[18..20].try_into().unwrap()))
            })
            .then_with(|| {
                u32::from_le_bytes(b[22..26].try_into().unwrap())
                    .cmp(&u32::from_le_bytes(a[22..26].try_into().unwrap()))
            })
            .then_with(|| a.cmp(b))
    });
    records.dedup_by(|a, b| record_hash(a).unwrap() == record_hash(b).unwrap());
    control.check()?;
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)?;
    let writer = BudgetWriter {
        inner: BufWriter::new(file),
        budget,
        control,
    };
    let mut encoder = zstd::Encoder::new(writer, 6)?;
    let mut offsets = Vec::with_capacity(records.len());
    let mut offset = 0_u32;
    for record in &records {
        control.check()?;
        offsets.push(offset);
        encoder.write_all(record)?;
        offset += record.len() as u32;
    }
    for offset in offsets {
        encoder.write_all(&offset.to_le_bytes())?;
    }
    encoder.write_all(&(records.len() as u32).to_le_bytes())?;
    encoder.write_all(V2_SHARD_MAGIC)?;
    let mut writer = encoder.finish()?;
    writer.flush()?;
    writer.inner.get_ref().sync_all()?;
    Ok((records.len() as u64, bytes.len() as u64))
}

pub(super) fn open_source(
    source: &LocalEvalSource,
    control: &LocalEvalBuildControl,
) -> Result<(Box<dyn Read + Send>, Option<u64>), LocalEvalError> {
    control.check()?;
    match source {
        LocalEvalSource::File(path) => {
            let file = File::open(path)?;
            let size = file.metadata()?.len();
            Ok((Box::new(file), Some(size)))
        }
        LocalEvalSource::Url(url) => {
            let client = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(control.read_stall)
                .user_agent("En Croissant local evaluation builder")
                .build()?;
            let response = client
                .get(url)
                .send()
                .and_then(|response| response.error_for_status());
            control.check()?;
            let response = response?;
            let size = response.content_length();
            Ok((Box::new(response), size))
        }
    }
}

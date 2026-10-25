//! Explicit, single-use review of the official archive, then bounded streaming.
//! No network request is made by status reads or application startup.
use super::*;
use reqwest::{header, Client};
use std::{
    io::Cursor,
    path::Component,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot};

const RESERVE_BYTES: u64 = 256 * 1024 * 1024;
const REVIEW_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalDownloadReview {
    pub token: String,
    pub output_dir: String,
    pub source: String,
    pub download_bytes: u64,
    pub available_bytes: u64,
    pub disk_limit_bytes: u64,
    pub reserve_bytes: u64,
}

#[derive(Clone)]
struct Reviewed {
    view: LocalEvalDownloadReview,
    root: PathBuf,
    final_url: String,
    etag: Option<String>,
    modified: Option<String>,
    at: Instant,
}

#[derive(Default)]
struct ReviewSlot {
    generation: u128,
    review: Option<Reviewed>,
}

impl ReviewSlot {
    fn begin(&mut self) -> u128 {
        self.generation = rand::random();
        self.review = None;
        self.generation
    }

    fn finish(
        &mut self,
        generation: u128,
        review: Reviewed,
    ) -> Result<LocalEvalDownloadReview, String> {
        if generation != self.generation {
            return Err("A newer download review replaced this request. Review again.".into());
        }
        let view = review.view.clone();
        self.review = Some(review);
        Ok(view)
    }

    fn take(&mut self, token: &str, root: &Path) -> Result<Reviewed, String> {
        if !self
            .review
            .as_ref()
            .is_some_and(|review| review.view.token == token)
        {
            return Err(
                "This download review expired or was already used. Review it again.".into(),
            );
        }
        let review = self.review.take().unwrap();
        if review.at.elapsed() >= REVIEW_TTL || review.root != root {
            return Err("This download review expired. Review it again.".into());
        }
        Ok(review)
    }
}

static REVIEW: Lazy<Mutex<ReviewSlot>> = Lazy::new(|| Mutex::new(ReviewSlot::default()));

fn client_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 || attempt.url().scheme() != "https" {
                attempt.error("Evaluation archive redirect is not allowed.")
            } else {
                attempt.follow()
            }
        }))
        .user_agent("En Croissant optional evaluation download")
}

fn client() -> Result<Client, String> {
    client_builder().build().map_err(|error| error.to_string())
}

fn header_text(headers: &header::HeaderMap, name: header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

/// Resolve only the existing ancestor; review must not create the destination.
fn destination(path: &Path) -> Result<(PathBuf, PathBuf), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("Choose an absolute path to a new evaluation folder.".into());
    }
    match fs::symlink_metadata(path) {
        Ok(_) => {
            return Err(
                "That folder already exists. Choose a new folder; existing data will be kept."
                    .into(),
            )
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Could not check the destination: {error}")),
    }
    let mut ancestor = path;
    let mut missing = Vec::new();
    loop {
        match fs::symlink_metadata(ancestor) {
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                missing.push(
                    ancestor
                        .file_name()
                        .ok_or("Invalid evaluation folder.")?
                        .to_owned(),
                );
                ancestor = ancestor.parent().ok_or("Invalid evaluation folder.")?;
            }
            Err(error) => return Err(format!("Could not check the destination parent: {error}")),
        }
    }
    let volume = ancestor.canonicalize().map_err(|error| error.to_string())?;
    if !fs::metadata(&volume)
        .map_err(|error| error.to_string())?
        .is_dir()
    {
        return Err("The destination parent is not a folder.".into());
    }
    let mut resolved = volume.clone();
    for part in missing.iter().rev() {
        resolved.push(part);
    }
    Ok((resolved, volume))
}

fn space(path: &Path, limit: u64) -> Result<(PathBuf, u64), String> {
    let (resolved, volume) = destination(path)?;
    let available = fs2::available_space(volume)
        .map_err(|error| format!("Could not check free space: {error}"))?;
    if available < limit.saturating_add(RESERVE_BYTES) {
        return Err("Not enough free space for this build limit and filesystem reserve. Choose a smaller limit or another drive.".into());
    }
    Ok((resolved, available))
}

fn idle(root: &Path) -> Result<(), String> {
    if let Some(job) = get_build_job(root)? {
        if job.active {
            return Err("Another evaluation build is still running or stopping.".into());
        }
        if job.state == "interrupted" {
            return Err(
                "Remove the recorded incomplete build before reviewing a fresh download.".into(),
            );
        }
    }
    Ok(())
}

fn review_space(root: &Path, path: &Path, limit: u64) -> Result<(PathBuf, PathBuf, u64), String> {
    idle(root)?;
    let journal = root.canonicalize().map_err(|error| error.to_string())?;
    let (output, available) = space(path, limit)?;
    if output.starts_with(&journal) || journal.starts_with(&output) {
        return Err("Keep the evaluation output outside its recovery folder.".into());
    }
    Ok((journal, output, available))
}

async fn review_source(
    root: PathBuf,
    path: PathBuf,
    limit: u64,
    source: &str,
    http: &Client,
) -> Result<Reviewed, String> {
    let (root, output, available) =
        tokio::task::spawn_blocking(move || review_space(&root, &path, limit))
            .await
            .map_err(|error| error.to_string())??;
    let response = http
        .head(source)
        .header(header::ACCEPT_ENCODING, "identity")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("Could not review the archive: {error}"))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "The archive could not be reviewed (HTTP {}). Try again later.",
            response.status()
        ));
    }
    let bytes = header_text(response.headers(), header::CONTENT_LENGTH)
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or("The server did not provide an archive size. Try again later.")?;
    let etag = header_text(response.headers(), header::ETAG);
    let modified = header_text(response.headers(), header::LAST_MODIFIED);
    if etag.is_none() && modified.is_none() {
        return Err("The archive has no version information. Try again later.".into());
    }
    Ok(Reviewed {
        view: LocalEvalDownloadReview {
            token: format!("{:032x}", rand::random::<u128>()),
            output_dir: output.display().to_string(),
            source: source.into(),
            download_bytes: bytes,
            available_bytes: available,
            disk_limit_bytes: limit,
            reserve_bytes: RESERVE_BYTES,
        },
        root,
        final_url: response.url().to_string(),
        etag,
        modified,
        at: Instant::now(),
    })
}

pub(super) async fn review(
    root: PathBuf,
    output: PathBuf,
    limit_gib: u16,
) -> Result<LocalEvalDownloadReview, String> {
    let limit = LocalEvalBuildControl::for_gib(limit_gib)
        .map_err(String::from)?
        .disk_limit_bytes;
    let generation = REVIEW
        .lock()
        .map_err(|_| "Download review is unavailable.")?
        .begin();
    let reviewed = review_source(root, output, limit, DEFAULT_SOURCE_URL, &client()?).await?;
    REVIEW
        .lock()
        .map_err(|_| "Download review is unavailable.")?
        .finish(generation, reviewed)
}

/// EOF is positive only after the HTTP producer validates the entire size.
struct ChunkReader {
    receiver: mpsc::Receiver<Result<Vec<u8>, String>>,
    current: Cursor<Vec<u8>>,
    done: bool,
}
impl Read for ChunkReader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        loop {
            let count = self.current.read(bytes)?;
            if count > 0 || self.done {
                return Ok(count);
            }
            match self.receiver.blocking_recv() {
                Some(Ok(chunk)) if chunk.is_empty() => self.done = true,
                Some(Ok(chunk)) => self.current = Cursor::new(chunk),
                Some(Err(error)) => return Err(io::Error::other(error)),
                None => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "Archive ended before size verification.",
                    ))
                }
            }
        }
    }
}

async fn cancellable<T>(
    future: impl std::future::Future<Output = T>,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<T, String> {
    tokio::pin!(future);
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Evaluation download cancelled. Existing stores were kept.".into());
        }
        tokio::select! {
            result = &mut future => return Ok(result),
            _ = tokio::time::sleep(Duration::from_millis(50)) => {},
        }
    }
}

type StartReceipt = oneshot::Sender<Result<String, String>>;

async fn transfer<F>(
    review: Reviewed,
    http: Client,
    mut receipt: Option<StartReceipt>,
    shards: u16,
    progress: F,
) -> Result<LocalEvalBuildReport, String>
where
    F: FnMut(LocalEvalBuildProgress) + Send + 'static,
{
    let result = transfer_inner(review, http, &mut receipt, shards, progress).await;
    if let Some(receipt) = receipt {
        let error = result
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| "The build settled before starting.".into());
        let _ = receipt.send(Err(error));
    }
    result
}

async fn transfer_inner<F>(
    review: Reviewed,
    http: Client,
    receipt: &mut Option<StartReceipt>,
    shards: u16,
    mut progress: F,
) -> Result<LocalEvalBuildReport, String>
where
    F: FnMut(LocalEvalBuildProgress) + Send + 'static,
{
    let checked = review.clone();
    tokio::task::spawn_blocking(move || {
        if checked.at.elapsed() >= REVIEW_TTL {
            return Err("This review expired. Review the download again.".into());
        }
        let (journal, path, _) = review_space(
            &checked.root,
            Path::new(&checked.view.output_dir),
            checked.view.disk_limit_bytes,
        )?;
        if journal != checked.root || path != PathBuf::from(&checked.view.output_dir) {
            return Err("The destination changed. Review it again.".into());
        }
        Ok::<_, String>(())
    })
    .await
    .map_err(|error| error.to_string())??;
    let id = review.view.token.clone();
    let lease = build_control::BuildLease::start(&id).map_err(String::from)?;
    let control = LocalEvalBuildControl {
        disk_limit_bytes: review.view.disk_limit_bytes,
        cancel: lease.cancel.clone(),
        state: lease.state.clone(),
        ..LocalEvalBuildControl::default()
    };
    let cancel = control.cancel.clone();
    let options = LocalEvalBuildOptions {
        id: id.clone(),
        source: LocalEvalSource::Url(review.view.source.clone()),
        output_dir: PathBuf::from(&review.view.output_dir),
        max_pvs: DEFAULT_MAX_PVS,
        shard_count: shards,
    };
    let (sender, receiver) = mpsc::channel(2);
    let (opened_tx, opened_rx) = oneshot::channel();
    let root = review.root.clone();
    let total = review.view.download_bytes;
    let builder = tokio::task::spawn_blocking(move || {
        let _lease = lease;
        let mut opened = Some(opened_tx);
        build_recovery::build_recoverable_with(
            options,
            control,
            &root,
            move |event| {
                if event.phase == "opening" {
                    if let Some(opened) = opened.take() {
                        let _ = opened.send(());
                    }
                }
                progress(event);
            },
            move |options, control, progress| {
                build::build_with_source(
                    options,
                    control,
                    |mut event| {
                        if event.phase == "opening" {
                            event.compressed_bytes_total = Some(total);
                        }
                        progress(event);
                    },
                    move |_, _| {
                        Ok((
                            Box::new(ChunkReader {
                                receiver,
                                current: Cursor::new(Vec::new()),
                                done: false,
                            }),
                            Some(total),
                        ))
                    },
                )
            },
        )
        .map_err(String::from)
    });
    // The journal and OS lease must exist BEFORE even the GET headers request.
    if opened_rx.await.is_err() {
        return builder.await.map_err(|error| error.to_string())?;
    }
    if let Some(receipt) = receipt.take() {
        let _ = receipt.send(Ok(id));
    }
    let producer: Result<(), String> = async {
        let mut request = http
            .get(&review.view.source)
            .header(header::ACCEPT_ENCODING, "identity");
        if let Some(etag) = review
            .etag
            .as_ref()
            .filter(|value| !value.starts_with("W/"))
        {
            request = request.header(header::IF_MATCH, etag);
        }
        if let Some(modified) = &review.modified {
            request = request.header(header::IF_UNMODIFIED_SINCE, modified);
        }
        let mut response = cancellable(request.send(), &cancel)
            .await?
            .map_err(|error| error.to_string())?;
        if response.status() != reqwest::StatusCode::OK
            || response.url().as_str() != review.final_url
            || response.content_length() != Some(total)
            || header_text(response.headers(), header::ETAG) != review.etag
            || header_text(response.headers(), header::LAST_MODIFIED) != review.modified
        {
            return Err("The archive changed or could not be downloaded. Review it again.".into());
        }
        let mut received = 0_u64;
        while let Some(chunk) = cancellable(response.chunk(), &cancel)
            .await?
            .map_err(|error| error.to_string())?
        {
            received = received
                .checked_add(chunk.len() as u64)
                .ok_or("Archive size overflow.")?;
            if received > total {
                return Err("The archive exceeded its reviewed size. Review it again.".into());
            }
            for part in chunk.chunks(64 * 1024) {
                cancellable(sender.send(Ok(part.to_vec())), &cancel)
                    .await?
                    .map_err(|_| "Evaluation builder stopped.")?;
            }
        }
        if received != total {
            return Err("The archive ended before its reviewed size was reached.".into());
        }
        cancellable(sender.send(Ok(Vec::new())), &cancel)
            .await?
            .map_err(|_| "Evaluation builder stopped.")?;
        Ok(())
    }
    .await;
    if let Err(error) = &producer {
        let _ = sender.send(Err(error.clone())).await;
    }
    drop(sender);
    // Never report a settled cancellation/failure while the builder still owns output.
    let built = builder
        .await
        .map_err(|error| format!("Evaluation builder stopped: {error}"))?;
    let report = built?;
    producer?;
    Ok(report)
}

pub(super) async fn start<F>(root: PathBuf, token: String, progress: F) -> Result<String, String>
where
    F: FnMut(LocalEvalBuildProgress) + Send + 'static,
{
    let root =
        tokio::task::spawn_blocking(move || root.canonicalize().map_err(|error| error.to_string()))
            .await
            .map_err(|error| error.to_string())??;
    let review = REVIEW
        .lock()
        .map_err(|_| "Download review is unavailable.")?
        .take(&token, &root)?;
    launch(review, client()?, progress).await
}

async fn launch<F>(review: Reviewed, http: Client, progress: F) -> Result<String, String>
where
    F: FnMut(LocalEvalBuildProgress) + Send + 'static,
{
    let (sender, started) = oneshot::channel();
    tokio::spawn(async move {
        if let Err(error) =
            transfer(review, http, Some(sender), DEFAULT_SHARD_COUNT, progress).await
        {
            log::warn!("Reviewed evaluation download stopped: {error}");
        }
    });
    started
        .await
        .map_err(|_| "Evaluation download did not start.".to_string())?
}

#[cfg(test)]
#[path = "download_tests.rs"]
mod tests;

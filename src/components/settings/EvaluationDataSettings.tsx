import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Progress,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  commands,
  type LocalEvalBuildJob,
  type LocalEvalDbStatus,
  type LocalEvalDownloadReview,
  type LocalEvalSourceCandidate,
  type LocalEvalSourceSelection,
  type Result,
} from "@/bindings";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import { evaluationSourceEpochAtom } from "@/state/evaluationSource";
import { noteEvaluationSourceRevision } from "@/utils/evaluationSource";
import classes from "./EvaluationDataSettings.module.css";

function value<T>(response: Result<T, string>): T {
  if (response.status === "error") throw new Error(response.error);
  return response.data;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function bytes(input: bigint | number) {
  const size = Number(input);
  if (size >= 1024 ** 3)
    return `${(size / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;
  if (size >= 1024 ** 2)
    return `${(size / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
  if (size >= 1024)
    return `${(size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;
  return `${size.toLocaleString()} bytes`;
}
function displayPath(path: string) {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  return path.startsWith("\\\\?\\") ? path.slice(4) : path;
}
function freshPath(base: string) {
  return `${displayPath(base)}-download-${Date.now()}`;
}
type Checked = { choice: LocalEvalSourceCandidate; baseRevision: string; reset?: boolean };
type View = "download" | "candidate" | "cleanup" | null;

export default function EvaluationDataSettings() {
  const epoch = useAtomValue(evaluationSourceEpochAtom);
  const [selection, setSelection] = useState<LocalEvalSourceSelection | null>(null);
  const [store, setStore] = useState<LocalEvalDbStatus | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<LocalEvalBuildJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobKnown, setJobKnown] = useState(false);
  const [cancelStarting, setCancelStarting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [view, setView] = useState<View>(null);
  const [candidate, setCandidate] = useState<Checked | null>(null);
  const [cleanup, setCleanup] = useState<LocalEvalBuildJob | null>(null);
  const [output, setOutput] = useState("");
  const [quota, setQuota] = useState<string | number>(64);
  const [review, setReview] = useState<LocalEvalDownloadReview | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true),
    busyRef = useRef<string | null>(null);
  const currentSequence = useRef(0),
    jobSequence = useRef(0);
  const viewSequence = useRef(0),
    cancelStart = useRef(false);
  const startedId = useRef<string | null>(null),
    cancelSent = useRef(false);

  const refreshCurrent = useCallback(async () => {
    const owned = ++currentSequence.current;
    setLoading(true);
    try {
      const selected = value(await commands.getLocalEvalSourceSelection());
      if (alive.current && owned === currentSequence.current) setSelection(selected);
      const status = value(await commands.getLocalLichessEvalDbStatus());
      if (!alive.current || owned !== currentSequence.current) return;
      if (selected.path !== status.path)
        throw new Error("The current folder changed while it was checked. Retry the check.");
      setSelection(selected);
      setStore(status);
      setCurrentError(null);
    } catch (error) {
      if (alive.current && owned === currentSequence.current) setCurrentError(message(error));
    } finally {
      if (alive.current && owned === currentSequence.current) setLoading(false);
    }
  }, []);
  const refreshJob = useCallback(async () => {
    const owned = ++jobSequence.current;
    try {
      const snapshot = value(await commands.getLocalEvalBuildJob());
      if (!alive.current || owned !== jobSequence.current) return;
      setJob(snapshot);
      setJobError(null);
      setJobKnown(true);
      if (snapshot) setPendingId((id) => (id === snapshot.id ? null : id));
      if (
        snapshot?.id === startedId.current &&
        snapshot.active &&
        snapshot.canCancel &&
        cancelStart.current &&
        !cancelSent.current
      ) {
        cancelSent.current = true;
        try {
          const stopped = await commands.cancelLocalLichessEvalDb(snapshot.id);
          if (stopped && alive.current && owned === jobSequence.current)
            setJob({ ...snapshot, state: "cancelling" });
        } catch (error) {
          if (alive.current) setActionError(`Could not send cancellation: ${message(error)}`);
        }
      }
    } catch (error) {
      if (alive.current && owned === jobSequence.current) setJobError(message(error));
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      currentSequence.current += 1;
      jobSequence.current += 1;
    };
  }, []);
  useEffect(() => {
    void refreshCurrent();
  }, [epoch, refreshCurrent]);
  useEffect(() => {
    void refreshJob();
  }, [refreshJob]);
  useEffect(() => {
    if (!job?.active && !pendingId) return;
    const timer = window.setInterval(() => {
      void refreshJob();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job?.active, pendingId, refreshJob]);

  async function act(name: string, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = name;
    setBusy(name);
    setActionError(null);
    const owner = viewSequence.current;
    try {
      await work();
    } catch (error) {
      if (
        alive.current &&
        (owner === viewSequence.current ||
          ["start", "cancel", "cleanup", "use", "use-build"].includes(name))
      )
        setActionError(message(error));
    } finally {
      busyRef.current = null;
      if (alive.current) setBusy(null);
    }
  }
  function closeView() {
    viewSequence.current += 1;
    setView(null);
    setActionError(null);
  }
  async function chooseFolder() {
    const owner = viewSequence.current;
    await act("choose", async () => {
      if (!selection) throw new Error("Check the current folder before choosing another one.");
      const path = await open({
        directory: true,
        multiple: false,
        title: "Choose an evaluation folder",
      });
      if (!alive.current || owner !== viewSequence.current || typeof path !== "string") return;
      setCandidate(null);
      setView("candidate");
      const checked = value(await commands.validateLocalEvalSource(path, selection.revision));
      if (alive.current && owner === viewSequence.current)
        setCandidate({ choice: checked, baseRevision: selection.revision });
    });
  }
  async function useChecked(checked: LocalEvalSourceCandidate, owner = viewSequence.current) {
    const selected = value(await commands.activateLocalEvalSource(checked.token));
    noteEvaluationSourceRevision(selected.revision);
    if (!alive.current) return;
    setSelection(selected);
    setStore(checked.store);
    setCandidate(null);
    if (owner === viewSequence.current) setView(null);
    void refreshCurrent();
  }
  async function resetFolder() {
    const owner = viewSequence.current;
    await act("reset", async () => {
      if (!selection) throw new Error("Check the current folder before resetting it.");
      setCandidate(null);
      setView("candidate");
      const checked = value(await commands.validateLocalEvalSource("", selection.revision));
      if (alive.current && owner === viewSequence.current)
        setCandidate({ choice: checked, baseRevision: selection.revision, reset: true });
    });
  }
  function showDownloads() {
    viewSequence.current += 1;
    setActionError(null);
    setReview(null);
    setView("download");
    if (!output && selection) setOutput(freshPath(selection.path));
    void refreshJob();
  }
  const validQuota =
    typeof quota === "number" && Number.isInteger(quota) && quota >= 1 && quota <= 512;
  const starting = busy === "start" || (!!pendingId && job?.id !== pendingId);
  const running = !!job?.active || starting;
  const stale = !!candidate && candidate.baseRevision !== selection?.revision;
  const progress = job?.progress;
  const total = progress?.compressedBytesTotal == null ? 0 : Number(progress.compressedBytesTotal);
  const read = Number(progress?.compressedBytesRead ?? 0);
  const currentTitle =
    currentError || store?.error
      ? "Evaluation folder unavailable"
      : store?.available
        ? "Ready"
        : loading
          ? "Checking evaluation data…"
          : "Not connected";

  const jobPanel = job && (!pendingId || pendingId === job.id) && (
    <Stack gap="xs" className={classes.section}>
      <Text fw={500} role="status" aria-live="polite">
        {job.state === "ready"
          ? "Build ready"
          : job.state === "interrupted"
            ? "Build interrupted"
            : job.state === "cancelled"
              ? "Build cancelled"
              : job.state === "failed"
                ? "Build failed"
                : job.state === "cancelling"
                  ? "Stopping…"
                  : progress?.phase === "sorting"
                    ? "Sorting evaluations…"
                    : progress?.phase === "ready"
                      ? "Finishing…"
                      : "Reading evaluations…"}
      </Text>
      <Text size="xs" c="dimmed" className={classes.path}>
        {displayPath(job.outputDir)}
      </Text>
      {job.active && total > 0 && progress?.phase !== "sorting" && progress?.phase !== "ready" && (
        <>
          <Progress
            aria-label="Compressed archive bytes read"
            value={Math.min(100, (read / total) * 100)}
          />
          <Text size="xs">
            {bytes(read)} of {bytes(total)} read
          </Text>
        </>
      )}
      {job.active && (progress?.phase === "sorting" || total <= 0) && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm">
            {progress?.phase === "sorting"
              ? "Preparing the stored positions"
              : "Waiting for archive data"}
          </Text>
        </Group>
      )}
      {progress && (
        <Text size="xs" c="dimmed">
          {progress.positions.toLocaleString()} positions{" "}
          {progress.phase === "sorting" || progress.phase === "ready" ? "stored" : "read"}
        </Text>
      )}
      {job.detail && <Alert color={job.state === "failed" ? "red" : "yellow"}>{job.detail}</Alert>}
      {job.active && !job.canCancel && (
        <Text size="xs" c="dimmed">
          Finishing, or controlled in another window.
        </Text>
      )}
      <div className={classes.actions}>
        {job.active && job.canCancel && (
          <Button
            variant="default"
            disabled={!!busy || job.state === "cancelling"}
            onClick={() =>
              void act("cancel", async () => {
                const acknowledged = await commands.cancelLocalLichessEvalDb(job.id);
                if (alive.current && acknowledged)
                  setJob((current) =>
                    current?.id === job.id ? { ...current, state: "cancelling" } : current,
                  );
                await refreshJob();
              })
            }
          >
            {job.state === "cancelling" ? "Stopping…" : "Cancel build"}
          </Button>
        )}
        {job.state === "ready" && !job.active && (
          <Button
            disabled={!!busy || !selection}
            loading={busy === "use-build"}
            onClick={() =>
              void act("use-build", async () => {
                if (!selection) return;
                const owner = viewSequence.current;
                const checked = value(
                  await commands.validateLocalEvalSource(job.outputDir, selection.revision),
                );
                await useChecked(checked, owner);
              })
            }
          >
            Use evaluations
          </Button>
        )}
        {job.state === "interrupted" && !job.active && (
          <Button
            variant="default"
            disabled={!!busy}
            onClick={() => {
              setCleanup(job);
              setActionError(null);
              setView("cleanup");
            }}
          >
            Remove incomplete build
          </Button>
        )}
      </div>
    </Stack>
  );
  const form = (
    <Stack gap="sm">
      <TextInput
        label="New evaluation folder"
        value={output}
        onChange={(event) => {
          setOutput(event.currentTarget.value);
          setReview(null);
        }}
        disabled={!!busy || running}
      />
      <Button
        variant="default"
        size="compact-sm"
        disabled={!!busy || running}
        onClick={() =>
          void act("destination", async () => {
            const owner = viewSequence.current;
            const parent = await open({
              directory: true,
              multiple: false,
              title: "Choose a parent folder for the new store",
            });
            if (!alive.current || owner !== viewSequence.current || typeof parent !== "string")
              return;
            const separator = parent.includes("\\") ? "\\" : "/";
            setOutput(`${parent.replace(/[\\/]$/, "")}${separator}evaluations-${Date.now()}`);
            setReview(null);
          })
        }
      >
        Choose parent folder
      </Button>
      <NumberInput
        label={
          <Group gap={3}>
            Build-space limit (GiB)
            <PerformanceHelp label="About the evaluation build-space limit">
              Maximum disk space used by this build, including temporary work. It does not set a
              download size.
            </PerformanceHelp>
          </Group>
        }
        value={quota}
        onChange={(next) => {
          setQuota(next);
          setReview(null);
        }}
        min={1}
        max={512}
        allowDecimal={false}
        disabled={!!busy || running}
      />
      {review && (
        <div className={classes.section}>
          <Stack gap="xs">
            <Text fw={500}>Download review</Text>
            <Text size="xs" className={classes.path}>
              {displayPath(review.outputDir)}
            </Text>
            <div className={classes.facts}>
              <Text size="sm">Archive download: {bytes(review.downloadBytes)}</Text>
              <Text size="sm">Build-space limit: {bytes(review.diskLimitBytes)}</Text>
              <Text size="sm">Available on drive: {bytes(review.availableBytes)}</Text>
              <Text size="sm">Filesystem reserve: {bytes(review.reserveBytes)}</Text>
            </div>
            <Text size="xs" c="dimmed" className={classes.path}>
              Source: {review.source}
            </Text>
            <Text size="xs">
              The current evaluation store stays selected. A completed build can be selected
              separately.
            </Text>
          </Stack>
        </div>
      )}
      <div className={classes.actions}>
        <Button
          variant={review ? "default" : "filled"}
          disabled={
            !!busy ||
            running ||
            !selection ||
            !!jobError ||
            !output.trim() ||
            !validQuota ||
            job?.state === "interrupted"
          }
          loading={busy === "review"}
          onClick={() =>
            void act("review", async () => {
              const owner = viewSequence.current;
              setReview(null);
              const checked = value(
                await commands.reviewLocalEvalDownload(output.trim(), Number(quota)),
              );
              if (alive.current && owner === viewSequence.current) setReview(checked);
            })
          }
        >
          {review ? "Review again" : "Review download"}
        </Button>
        {review && (
          <Button
            disabled={!!busy || running || !!jobError}
            loading={busy === "start"}
            onClick={() =>
              void act("start", async () => {
                const token = review.token;
                startedId.current = token;
                cancelSent.current = false;
                cancelStart.current = false;
                setCancelStarting(false);
                setReview(null);
                setPendingId(token);
                let response;
                try {
                  response = await commands.startLocalEvalDownload(token);
                } catch (error) {
                  // A transport failure does not prove that the native job never started.
                  if (alive.current) await refreshJob();
                  throw error;
                }
                if (response.status === "error") {
                  if (alive.current) {
                    setPendingId(null);
                    await refreshJob();
                  }
                  throw new Error(response.error);
                }
                const id = response.data;
                startedId.current = id;
                if (alive.current) setPendingId(id);
                try {
                  if (cancelStart.current && !cancelSent.current) {
                    cancelSent.current = true;
                    await commands.cancelLocalLichessEvalDb(id);
                  }
                } finally {
                  if (alive.current) await refreshJob();
                }
              })
            }
          >
            Start download
          </Button>
        )}
      </div>
    </Stack>
  );
  return (
    <div className={classes.row}>
      <div className={classes.summary}>
        <div className={classes.description}>
          <Group gap={3}>
            <Text>Evaluation data</Text>
            <PerformanceHelp label="About evaluation data">
              Choose an existing store or review a new download. Stored evals in Engines controls
              whether its scores are used.
            </PerformanceHelp>
          </Group>
          <Text size="sm" c={currentError || store?.error ? "red" : "dimmed"}>
            {currentTitle}
            {loading && store ? " · checking…" : ""}
          </Text>
          {(selection?.path || store?.path) && (
            <Text size="xs" c="dimmed" className={classes.path}>
              {displayPath(selection?.path ?? store?.path ?? "")}
            </Text>
          )}
          {store?.available && !currentError && (
            <Text size="xs" c="dimmed">
              {store.positions.toLocaleString()} positions · {bytes(store.storageBytes)} on disk
            </Text>
          )}
          {job?.active && (
            <Text size="xs" c="dimmed">
              An evaluation build is running.
            </Text>
          )}
        </div>
        <div className={classes.actions}>
          <Button
            size="compact-sm"
            variant="default"
            disabled={!!busy || !selection}
            loading={busy === "choose"}
            onClick={() => void chooseFolder()}
          >
            Choose folder
          </Button>
          <Button
            size="compact-sm"
            variant="default"
            disabled={!!busy || !selection}
            loading={busy === "reset"}
            onClick={() => void resetFolder()}
          >
            Reset to default
          </Button>
          <Button size="compact-sm" variant="default" onClick={showDownloads}>
            Download details
          </Button>
        </div>
      </div>
      {(currentError || store?.error) && (
        <Group mt="xs" gap="xs" align="start">
          <Text role="alert" size="xs" c="red" style={{ flex: 1 }}>
            {currentError ?? store?.error}
          </Text>
          <Button size="compact-xs" variant="default" onClick={() => void refreshCurrent()}>
            Retry check
          </Button>
        </Group>
      )}
      {actionError && !view && (
        <Text role="alert" size="sm" c="red" mt="xs">
          {actionError}
        </Text>
      )}
      <Modal
        opened={view !== null}
        onClose={closeView}
        title={
          view === "candidate"
            ? "Choose evaluation data"
            : view === "cleanup"
              ? "Remove incomplete build?"
              : "Evaluation downloads"
        }
        size="lg"
        centered
      >
        <Stack gap="sm">
          {actionError && (
            <Alert color="red" role="alert">
              {actionError}
            </Alert>
          )}
          {view === "candidate" && (
            <>
              {(busy === "choose" || busy === "reset") && (
                <Group>
                  <Loader size="sm" />
                  <Text>Checking the selected folder…</Text>
                </Group>
              )}
              {candidate && (
                <div className={classes.section}>
                  <Text size="sm" className={classes.path}>
                    {displayPath(candidate.choice.store.path)}
                  </Text>
                  {candidate.choice.store.available ? (
                    <Text size="sm">
                      {candidate.choice.store.positions.toLocaleString()} positions ·{" "}
                      {bytes(candidate.choice.store.storageBytes)} on disk
                    </Text>
                  ) : (
                    <Text size="sm">No evaluations are downloaded in the default folder.</Text>
                  )}
                </div>
              )}
              {stale && busy !== "use" && (
                <Alert color="yellow">
                  The current folder changed. Choose the folder again before applying it.
                </Alert>
              )}
              <div className={classes.actions}>
                <Button variant="default" disabled={!!busy} onClick={() => void chooseFolder()}>
                  Choose another folder
                </Button>
                <Button
                  disabled={!!busy || !candidate || stale}
                  loading={busy === "use"}
                  onClick={() =>
                    void act("use", async () => {
                      if (candidate) await useChecked(candidate.choice);
                    })
                  }
                >
                  {candidate?.reset ? "Use default folder" : "Use evaluations"}
                </Button>
              </div>
            </>
          )}
          {view === "cleanup" && cleanup && (
            <>
              <Text size="sm">Remove only the incomplete files recorded for this build:</Text>
              <Text size="sm" className={classes.path}>
                {displayPath(cleanup.outputDir)}
              </Text>
              <Text size="sm">
                Completed stores and unrecognized files are kept. The current evaluation folder
                stays selected.
              </Text>
              <div className={classes.actions}>
                <Button variant="default" disabled={!!busy} onClick={() => setView("download")}>
                  Keep files
                </Button>
                <Button
                  color="red"
                  disabled={!!busy}
                  loading={busy === "cleanup"}
                  onClick={() =>
                    void act("cleanup", async () => {
                      const owner = viewSequence.current;
                      value(await commands.discardLocalEvalBuildJob(cleanup.id));
                      if (alive.current) {
                        setCleanup(null);
                        setPendingId(null);
                        if (owner === viewSequence.current) setView("download");
                        await refreshJob();
                      }
                    })
                  }
                >
                  Remove incomplete
                </Button>
              </div>
            </>
          )}
          {view === "download" && (
            <>
              {jobError && (
                <Alert color="red" role="alert">
                  <Text size="sm">Could not check the build. {jobError}</Text>
                  <Button
                    mt="xs"
                    size="compact-sm"
                    variant="default"
                    onClick={() => void refreshJob()}
                  >
                    Retry status
                  </Button>
                </Alert>
              )}
              {starting && (
                <Group>
                  <Loader size="sm" />
                  <Text>{cancelStarting ? "Stopping…" : "Starting download…"}</Text>
                  <Button
                    variant="default"
                    disabled={cancelStarting}
                    onClick={() => {
                      cancelStart.current = true;
                      setCancelStarting(true);
                      if (busyRef.current !== "start" && pendingId)
                        void act("cancel", async () => {
                          await commands.cancelLocalLichessEvalDb(pendingId);
                          await refreshJob();
                        });
                    }}
                  >
                    {cancelStarting ? "Stopping…" : "Cancel build"}
                  </Button>
                </Group>
              )}
              {!jobKnown && !jobError && (
                <Group>
                  <Loader size="xs" />
                  <Text size="sm">Checking builds…</Text>
                </Group>
              )}
              {jobError && job && (
                <Text size="xs" c="dimmed">
                  Last known build status
                </Text>
              )}
              {jobPanel}
              {jobKnown &&
                !running &&
                !jobError &&
                (job ? (
                  <details className={classes.details}>
                    <summary>Review another download</summary>
                    {form}
                  </details>
                ) : (
                  form
                ))}
              {running && (
                <Text size="xs" c="dimmed">
                  Closing this view keeps the build running.
                </Text>
              )}
            </>
          )}
          <div className={classes.actions}>
            <Button variant="default" onClick={closeView}>
              Close view
            </Button>
          </div>
        </Stack>
      </Modal>
    </div>
  );
}

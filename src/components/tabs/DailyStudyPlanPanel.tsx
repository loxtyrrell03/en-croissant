import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconBook, IconExternalLink, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { resolve } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import type { RecentFile } from "@/state/atoms";
import { getDocumentDir } from "@/utils/directories";
import {
  dailyStudyPlanSchema,
  getStudyDateKey,
  isStudyUrl,
  openingFocus,
  type DailyStudyPlan,
  type StudyResource,
  type StudyStep,
} from "@/utils/dailyStudyPlan";
import { loadStudyAdaptation, readStudyExternal, type StudyAdaptation } from "@/utils/studyJournal";
import { planForStudyDay, tacticsStudyAdvice } from "@/utils/studyPlanning";
import {
  completeStudyStep,
  currentAttempt,
  ensureStudyDay,
  nextStudyStep,
  pauseAttempt,
  restartStudyStep,
  seekStudyTimer,
  selectStudyStep,
  studyClock,
  studyDuration,
  studyTimerElapsed,
  type StudyJournal,
} from "@/utils/studySession";
import { useStudyJournal } from "@/utils/useStudyJournal";
import StudyWorkEditor, { validStudyFen } from "./StudyWorkEditor";
import StudyHistory from "./StudyHistory";
import { applyStudyDraft, pendingStudyDrafts } from "@/utils/studyDraft";
import sessionClasses from "./DailyStudySession.module.css";
import classes from "./DailyGoalsPanel.module.css";

type Props = { onOpenFile: (file: RecentFile) => void | Promise<void> };
export default function DailyStudyPlanPanel({ onOpenFile }: Props) {
  const [base, setBase] = useState<DailyStudyPlan | null>(null);
  const [root, setRoot] = useState("");
  const [loadError, setLoadError] = useState("");
  const [day, setDay] = useState(getStudyDateKey);
  const [now, setNow] = useState(Date.now);
  const [preferredMinutes, setPreferredMinutes] = useState<60 | 90>(90);
  const [active, setActive] = useState<string | null>(null);
  const [seekDraft, setSeekDraft] = useState<{ id: string; position: number } | null>(null);
  const [history, setHistory] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [openingResource, setOpeningResource] = useState<string | null>(null);
  const [editingResource, setEditingResource] = useState<StudyResource | null>(null);
  const [courseUrl, setCourseUrl] = useState("");
  const [savingCourse, setSavingCourse] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [adaptation, setAdaptation] = useState<StudyAdaptation | null>(null);
  const [adaptError, setAdaptError] = useState("");
  const [standard, setStandard] = useState(false);
  const [newSession, setNewSession] = useState(false);
  const [external, setExternal] = useState<Awaited<ReturnType<typeof readStudyExternal>>>(null);
  const { journal, busy, error, reload, update } = useStudyJournal(root, base);
  const journalReady = journal !== null;
  const load = useCallback(async () => {
    try {
      const directory = await getDocumentDir();
      const path = await resolve(directory, "daily-study-plan.json");
      if (!(await exists(path))) {
        setBase(null);
        setLoadError("");
        return;
      }
      const value = dailyStudyPlanSchema.parse(
        JSON.parse((await readTextFile(path)).replace(/^\uFEFF/, "")),
      );
      const selected = localStorage.getItem(`daily-study-minutes:${value.id}`);
      setRoot(directory);
      setBase(value);
      setPreferredMinutes(selected === "60" ? 60 : selected === "90" ? 90 : value.defaultMinutes);
      setLoadError("");
    } catch {
      setLoadError("Could not read the saved study plan. Check daily-study-plan.json and retry.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    if (root)
      void readStudyExternal(root, "10582")
        .then((s) => {
          if (!cancelled) setExternal(s);
        })
        .catch(() => {
          if (!cancelled) setExternal(null);
        });
    return () => {
      cancelled = true;
    };
  }, [root, day]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      setDay(getStudyDateKey());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setActive(null);
    setStandard(false);
    setAdaptation(null);
    setAdaptError("");
    let cancelled = false;
    if (base && root && journalReady)
      void loadStudyAdaptation(root, base, day)
        .then((a) => {
          if (!cancelled) setAdaptation(a);
        })
        .catch((e) => {
          if (!cancelled) setAdaptError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [day, root, base, journalReady]);
  const state = journal?.days[day];
  const standardPlan = base && journal ? planForStudyDay(base, day, journal) : base;
  const plan = state?.plan ?? (!standard && adaptation ? adaptation.plan : standardPlan);
  const minutes = state?.mode ?? journal?.preferredMode ?? preferredMinutes;
  const steps = plan?.steps.filter((s) => studyDuration(s, minutes) > 0) ?? [];
  const completed = state?.completed ?? [];
  const attempt = journal ? currentAttempt(journal, day) : undefined;
  const currentStep = plan?.steps.find((s) => s.id === attempt?.stepId);
  const activeStep = plan?.steps.find((s) => s.id === active);
  const elapsed = attempt ? studyTimerElapsed(attempt, now) : 0;
  const remaining = attempt ? Math.max(0, attempt.limitMs - elapsed) : 0;
  const running = attempt?.runningSince !== null && attempt?.runningSince !== undefined;
  const focus = plan ? openingFocus(plan, day) : undefined;
  const expired = useRef("");
  const rolledOver = useRef("");
  useEffect(() => {
    if (!attempt || !running || busy || remaining > 0) return;
    const key = `${attempt.id}:${attempt.runningSince}`;
    if (expired.current === key) return;
    expired.current = key;
    void update((j) => {
      const a = j.attempts.find((a) => a.id === attempt.id);
      if (a) pauseAttempt(a, Date.now());
    });
  }, [now, running, remaining, busy, attempt, update]);
  useEffect(() => {
    const key = `${day}:${journal?.revision}`;
    if (
      journal &&
      !busy &&
      rolledOver.current !== key &&
      journal.attempts.some((a) => a.day !== day && a.runningSince !== null)
    ) {
      rolledOver.current = key;
      void update(() => {});
    }
  }, [day, journal, busy, update]);
  function prepare(j: StudyJournal) {
    if (day !== getStudyDateKey())
      throw new Error("The London date changed. Please reopen today's block.");
    if (!j.days[day] && !standard && adaptation && adaptation.journalRevision !== j.revision)
      throw new Error(
        "Study history changed after today's adjustment. Reload the plan or use the standard plan.",
      );
    const s = ensureStudyDay(
      j,
      plan!,
      day,
      minutes,
      !standard && adaptation ? adaptation.reason : null,
    );
    s.tacticsAdvice ??=
      adaptation?.tacticsAdvice ??
      tacticsStudyAdvice(j, day, external?.fresh ? external.due : undefined);
    return s;
  }
  function flush(j: StudyJournal) {
    for (const a of j.attempts)
      if (pendingStudyDrafts.has(a.id) || localStorage.getItem(`study-draft:${a.id}`))
        applyStudyDraft(a);
  }
  async function choose(step: StudyStep, start = false, positionMs?: number) {
    setResourceError("");
    const saved = await update((j) => {
      const s = prepare(j);
      flush(j);
      const previous = currentAttempt(j, day);
      if (previous) pauseAttempt(previous, Date.now());
      if (s.completed.includes(step.id)) {
        const last = [...j.attempts]
          .reverse()
          .find((a) => a.sessionId === s.sessionId && a.stepId === step.id);
        if (last) s.current = last.id;
        return;
      }
      const a = selectStudyStep(j, day, step.id, Date.now());
      if (step.id === "opening" && focus) a.topic = focus.topic;
      if (positionMs !== undefined) seekStudyTimer(a, positionMs, Date.now());
      if (start && studyTimerElapsed(a, Date.now()) < a.limitMs) a.runningSince = Date.now();
    });
    if (saved) setActive(step.id);
  }
  async function saveRecord() {
    return update((j) => {
      flush(j);
      const a = currentAttempt(j, day);
      if (a) {
        a.updatedAt = Date.now();
        j.days[day].notes[a.stepId] = a.notes;
      }
    });
  }
  async function finish(step?: StudyStep) {
    if (!step && (!attempt || attempt.status === "completed")) return;
    let following: StudyStep | undefined;
    const saved = await update((j) => {
      prepare(j);
      flush(j);
      if (step && j.days[day].completed.includes(step.id)) return;
      const a = step
        ? selectStudyStep(j, day, step.id, Date.now())
        : j.attempts.find((a) => a.id === attempt!.id)!;
      if (a.work.some((w) => w.fen && !validStudyFen(w.fen)))
        throw new Error("Correct the position FEN before completing. Your draft is retained.");
      if (
        a.stepId === "transfer" &&
        (!a.annotationSaved || !a.work.some((w) => w.reference.trim() && w.work.trim()))
      )
        throw new Error(
          "Record the game, saved annotation reference and what you annotated; confirm that you saved it. Save a partial block if unfinished.",
        );
      completeStudyStep(j, day, a.id, Date.now());
      following = nextStudyStep(steps, j.days[day].completed, a.stepId);
      if (following) selectStudyStep(j, day, following.id, Date.now());
    });
    if (saved) {
      setActive(following?.id ?? null);
      setResourceError("");
    }
  }
  async function partial() {
    if (!attempt) return;
    const saved = await update((j) => {
      flush(j);
      const a = j.attempts.find((a) => a.id === attempt.id)!;
      pauseAttempt(a, Date.now());
      a.status = "partial";
      j.days[day].current = null;
    });
    if (saved) setActive(null);
  }
  async function toggle() {
    if (!attempt) return;
    await update((j) => {
      const a = j.attempts.find((a) => a.id === attempt.id)!;
      if (a.runningSince !== null) pauseAttempt(a, Date.now());
      else if (studyTimerElapsed(a, Date.now()) < a.limitMs) a.runningSince = Date.now();
    });
    setNow(Date.now());
  }
  async function seek(position: number) {
    if (!attempt) return;
    await update((j) => {
      flush(j);
      const a = currentAttempt(j, day);
      if (a?.id === attempt.id) seekStudyTimer(a, position, Date.now());
    });
    setSeekDraft(null);
    setNow(Date.now());
  }
  async function restart(step: StudyStep) {
    const saved = await update((j) => {
      prepare(j);
      flush(j);
      const a = restartStudyStep(j, day, step.id, Date.now());
      if (step.id === "opening" && focus) a.topic = focus.topic;
    });
    if (saved) {
      setSeekDraft(null);
      setActive(step.id);
      setNow(Date.now());
    }
  }
  async function switchMinutes(value: string) {
    const chosen = value === "60" ? 60 : 90;
    if (!state) {
      const saved = await update((j) => {
        j.preferredMode = chosen;
      });
      if (saved) setPreferredMinutes(chosen);
      return;
    }
    const saved = await update((j) => {
      flush(j);
      const a = currentAttempt(j, day);
      if (a) {
        pauseAttempt(a, Date.now());
        const step = j.days[day].plan.steps.find((s) => s.id === a.stepId)!;
        a.limitMs = studyDuration(step, chosen);
      }
      j.days[day].mode = chosen;
      j.preferredMode = chosen;
    });
    if (saved) {
      setPreferredMinutes(chosen);
      if (activeStep && studyDuration(activeStep, chosen) === 0) setActive(null);
    }
  }
  async function openResource(resource: StudyResource, browser = false) {
    setResourceError("");
    setOpeningResource(resource.id);
    try {
      if (!(await saveRecord())) return;
      if (resource.kind === "pgn") {
        const path = await resolve(root, resource.path);
        await onOpenFile({ path, name: resource.title, type: "game", lastOpened: Date.now() });
      } else if (isTauri() && !browser) await invoke("open_study_resource", { url: resource.url });
      else if (isTauri()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(resource.url);
      } else window.open(resource.url, "_blank", "noopener,noreferrer");
      await update((j) => {
        const a = j.attempts.find((a) => a.id === attempt?.id);
        if (a)
          a.resources.push({
            id: resource.id,
            title: resource.title,
            reference: resource.kind === "pgn" ? resource.path : resource.url,
            openedAt: Date.now(),
          });
      });
      if (resource.kind === "pgn") setActive(null);
    } catch {
      setResourceError("Could not open this resource. Try Open in browser, or check the file.");
    } finally {
      setOpeningResource(null);
    }
  }
  async function saveCourseLink() {
    if (
      !base ||
      !editingResource ||
      editingResource.kind !== "web" ||
      !isStudyUrl(courseUrl.trim())
    )
      return;
    setSavingCourse(true);
    setLinkError("");
    try {
      const path = await resolve(root, "daily-study-plan.json");
      const raw = await readTextFile(path);
      const latest = dailyStudyPlanSchema.parse(JSON.parse(raw));
      if (latest.id !== base.id) throw new Error("Plan changed");
      const next = dailyStudyPlanSchema.parse({
        ...latest,
        steps: latest.steps.map((s) => ({
          ...s,
          resources: s.resources.map((r) =>
            r.id === editingResource.id ? { ...r, url: courseUrl.trim(), linked: true } : r,
          ),
        })),
      });
      if ((await readTextFile(path)) !== raw) throw new Error("Plan changed");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, `${JSON.stringify(next, null, 2)}\n`);
      setBase(next);
      setEditingResource(null);
    } catch {
      setLinkError("Could not save the link. Reload the plan and retry.");
    } finally {
      setSavingCourse(false);
    }
  }
  async function beginAnother() {
    const saved = await update((j) => {
      flush(j);
      const previous = j.days[day];
      for (const a of j.attempts.filter(
        (a) => a.sessionId === previous.sessionId && a.status === "paused",
      )) {
        pauseAttempt(a, Date.now());
        a.status = "partial";
      }
      j.pastSessions.push({ ...structuredClone(previous), day });
      delete j.days[day];
      const nextPlan = planForStudyDay(base!, day, j);
      const next = ensureStudyDay(j, nextPlan, day, minutes);
      next.sessionNumber = previous.sessionNumber + 1;
    });
    if (saved) {
      setNewSession(false);
      setActive(null);
    }
  }
  if (!base && !loadError) return null;
  if (!base)
    return (
      <Alert color="orange" title="Study plan">
        <Text size="sm">{loadError}</Text>
        <Button size="xs" onClick={() => void load()}>
          Retry
        </Button>
      </Alert>
    );
  if (!journal || !plan)
    return (
      <Alert color={error ? "orange" : "blue"} title="Study history">
        <Text size="sm">{error || "Loading your saved study history…"}</Text>
        {error && (
          <Button size="xs" onClick={() => void reload()}>
            Retry history
          </Button>
        )}
      </Alert>
    );
  const doneMinutes = steps
    .filter((s) => completed.includes(s.id))
    .reduce((n, s) => n + studyDuration(s, minutes) / 60000, 0);
  const next = steps.find((s) => !completed.includes(s.id));
  const timer =
    attempt &&
    currentStep &&
    attempt.status === "paused" &&
    studyDuration(currentStep, minutes) > 0 ? (
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <div>
            <Text fw={700}>{attempt.title}</Text>
            <Text size="xs" c="dimmed">
              {attempt.limitMs / 60000} min timer target ·{" "}
              {remaining === 0
                ? "Time reached — mark done when ready"
                : running
                  ? "Running"
                  : "Paused"}
            </Text>
          </div>
          <Text className={sessionClasses.clock} aria-label="Block time remaining">
            {studyClock(remaining)}
          </Text>
        </Group>
        <Slider
          thumbLabel="Block timer position (seconds)"
          min={0}
          max={attempt.limitMs / 1000}
          step={1}
          value={(seekDraft?.id === attempt.id ? seekDraft.position : elapsed) / 1000}
          label={(value) => `${studyClock(value * 1000)} into block`}
          disabled={busy}
          onChange={(seconds) => setSeekDraft({ id: attempt.id, position: seconds * 1000 })}
          onChangeEnd={(seconds) => void seek(seconds * 1000)}
        />
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            disabled={busy || remaining === 0}
            onClick={() => void toggle()}
          >
            {running ? "Pause timer" : elapsed > 0 ? "Resume timer" : "Start timer"}
          </Button>
          {remaining === 0 && (
            <Button
              size="xs"
              variant="light"
              disabled={busy}
              onClick={() =>
                void update((j) => {
                  const a = j.attempts.find((a) => a.id === attempt.id)!;
                  a.limitMs += 300000;
                })
              }
            >
              Add 5 minutes
            </Button>
          )}
          {active !== attempt.stepId && (
            <Button size="xs" variant="default" onClick={() => setActive(attempt.stepId)}>
              Instructions & record
            </Button>
          )}
          <Button size="xs" disabled={busy} onClick={() => void finish()}>
            Complete & next
          </Button>
          <Button size="xs" variant="subtle" disabled={busy} onClick={() => void partial()}>
            Save partial block
          </Button>
          <Button
            size="xs"
            variant="default"
            disabled={busy}
            onClick={() => void restart(currentStep)}
          >
            Restart block
          </Button>
          <PerformanceHelp label="Timer seeking and restart">
            Click or drag the timer to change its position; skipped time is excluded from study
            history. Restart begins at zero and keeps the previous attempt and notes in history.
          </PerformanceHelp>
        </Group>
      </Stack>
    ) : null;
  return (
    <>
      <Paper withBorder p="md" mb="md" className={classes.panel}>
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={800} size="xl">
              {plan.title}
            </Text>
            <Text size="sm" c="dimmed">
              {day} · Session {state?.sessionNumber ?? 1} ·{" "}
              {steps.filter((s) => completed.includes(s.id)).length} of {steps.length} study blocks
              completed
            </Text>
          </Stack>
          <SegmentedControl
            aria-label="Daily study time"
            value={String(minutes)}
            disabled={busy}
            data={[
              { label: "60 min", value: "60" },
              { label: "90 min", value: "90" },
            ]}
            onChange={(v) => void switchMinutes(v)}
          />
        </Group>
        <Stack gap="sm" mt="sm">
          <Group gap={5}>
            <Text size="xs" c="dimmed">
              {doneMinutes} of {minutes} planned minutes marked complete
            </Text>
            <PerformanceHelp label="How study progress works">
              The top bar weights manually completed blocks by their planned minutes. The separate
              countdown records timer time, including time away from this panel until its target or
              London midnight. Click within a block to jump to that point, or use the timer slider.
              Moving the timer does not mark blocks complete or add skipped time to history.
            </PerformanceHelp>
          </Group>
          <div className={sessionClasses.rail} role="group" aria-label="Study block progress">
            {steps.map((s) => (
              <button
                key={s.id}
                type="button"
                className={sessionClasses.segment}
                style={{ flex: studyDuration(s, minutes) }}
                data-complete={completed.includes(s.id)}
                data-current={attempt?.stepId === s.id}
                disabled={busy}
                aria-label={`Jump to ${s.title}, ${studyDuration(s, minutes) / 60000} minutes${completed.includes(s.id) ? ", completed" : ""}`}
                title={`${s.title} · ${studyDuration(s, minutes) / 60000} min`}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const position =
                    event.detail > 0 && rect.width > 0
                      ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) *
                        studyDuration(s, minutes)
                      : undefined;
                  void choose(s, false, position);
                }}
              />
            ))}
          </div>
          {(state?.adaptation || (!standard && adaptation?.reason)) && (
            <Group gap="xs">
              <Text size="sm">{state?.adaptation ?? adaptation?.reason}</Text>
              {!state && (
                <Button size="xs" variant="subtle" onClick={() => setStandard(true)}>
                  Use standard plan today
                </Button>
              )}
            </Group>
          )}
          {adaptError && !state && <Alert color="orange">{adaptError}</Alert>}
          {timer}
          {!next && (
            <Text role="status" fw={700}>
              All study blocks complete for this session.
            </Text>
          )}
          {error && (
            <Alert color="orange">
              <Text size="sm">{error}</Text>
              <Button size="xs" variant="light" onClick={() => void reload()}>
                Reload history & retry
              </Button>
            </Alert>
          )}
          {resourceError && <Alert color="orange">{resourceError}</Alert>}
        </Stack>
        <Group mt="sm" justify="space-between">
          <Group gap="xs">
            {!timer && next && (
              <Button
                leftSection={<IconPlayerPlay size={16} />}
                disabled={busy}
                onClick={() => void choose(next, true)}
              >
                Start {next.title}
              </Button>
            )}
            <Button size="xs" variant="default" onClick={() => setHistory(true)}>
              Study history
            </Button>
            {state && (
              <Button
                size="xs"
                variant="subtle"
                disabled={busy}
                onClick={() => setNewSession(true)}
              >
                Start another session
              </Button>
            )}
          </Group>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconRefresh size={14} />}
            disabled={busy}
            onClick={() => void load()}
          >
            Reload plan
          </Button>
        </Group>
        <Stack gap={0} className={classes.goalList}>
          {steps.map((step) => (
            <div key={step.id} className={classes.goalRow}>
              <Checkbox
                aria-label={`Mark ${step.title} complete`}
                checked={completed.includes(step.id)}
                disabled={busy}
                onChange={(e) => {
                  if (!e.currentTarget.checked)
                    void update((j) => {
                      const state = j.days[day];
                      state.completed = state.completed.filter((id) => id !== step.id);
                      for (const a of j.attempts.filter(
                        (a) =>
                          a.sessionId === state.sessionId &&
                          a.stepId === step.id &&
                          a.status === "completed",
                      )) {
                        a.status = "partial";
                        a.completionRevokedAt = Date.now();
                      }
                    });
                  else if (step.id === "transfer") void choose(step);
                  else void finish(step);
                }}
              />
              <Stack gap={3} className={classes.goalMain}>
                <Text fw={700}>{step.title}</Text>
                <Text size="xs" c="dimmed">
                  {step.id === "opening" && focus
                    ? focus.topic
                    : (step.summary ?? step.resources.map((r) => r.title).join(" · "))}
                </Text>
              </Stack>
              <Group gap="xs" className={classes.goalActions}>
                <Badge variant="light">{studyDuration(step, minutes) / 60000} min</Badge>
                <Button
                  aria-label={`Open ${step.title}`}
                  size="xs"
                  variant="light"
                  disabled={busy}
                  onClick={() => void choose(step)}
                >
                  Open
                </Button>
                {journal.attempts.some(
                  (a) => a.sessionId === state?.sessionId && a.stepId === step.id,
                ) && (
                  <Button
                    aria-label={`Restart ${step.title}`}
                    size="xs"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => void restart(step)}
                  >
                    Restart
                  </Button>
                )}
              </Group>
            </div>
          ))}
        </Stack>
      </Paper>
      <Modal
        opened={activeStep !== undefined}
        onClose={() => {
          void saveRecord().then((saved) => {
            if (saved) setActive(null);
          });
        }}
        closeButtonProps={{ "aria-label": "Close block instructions" }}
        title={<b>{activeStep?.title}</b>}
        size="lg"
      >
        {activeStep && (
          <Stack gap="md">
            {active === attempt?.stepId && timer}
            {error && <Alert color="orange">{error}</Alert>}
            <Text size="sm">{activeStep.instructions}</Text>
            {activeStep.id === "patterns" && (
              <div>
                <Text fw={600} size="sm">
                  {state?.tacticsAdvice ??
                    tacticsStudyAdvice(journal, day, external?.fresh ? external.due : undefined)}
                </Text>
                <Text size="xs" c="dimmed">
                  {external
                    ? `Chessable snapshot: ${new Date(external.capturedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} London${external.fresh ? "" : " (stale; not used for today's advice)"}.`
                    : "No fresh Chessable snapshot. Record review and new attempts manually."}{" "}
                  Course totals do not mark this block complete.
                </Text>
              </div>
            )}
            {activeStep.id === "opening" && focus && (
              <div>
                <Text fw={700}>{focus.topic}</Text>
                <Text size="sm">{focus.instructions}</Text>
              </div>
            )}
            {activeStep.resources.map((resource) => (
              <Paper withBorder p="sm" key={resource.id}>
                <Stack gap="xs">
                  <Text fw={600}>{resource.title}</Text>
                  {resource.kind === "web" && !resource.linked && (
                    <Text size="xs" c="dimmed">
                      Exact course link not yet saved. Link your course to open it directly.
                    </Text>
                  )}
                  <Group gap="xs">
                    <Button
                      size="sm"
                      leftSection={<IconBook size={16} />}
                      loading={openingResource === resource.id}
                      disabled={busy}
                      onClick={() => void openResource(resource)}
                    >
                      {resource.kind === "pgn"
                        ? "Open positions"
                        : activeStep.id === "transfer"
                          ? "Open game"
                          : resource.linked
                            ? "Open course"
                            : "Open Chessable"}
                    </Button>
                    {resource.kind === "web" && (
                      <>
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconExternalLink size={14} />}
                          disabled={busy}
                          onClick={() => void openResource(resource, true)}
                        >
                          Open in browser
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => {
                            setEditingResource(resource);
                            setCourseUrl(resource.linked ? resource.url : "");
                            setLinkError("");
                          }}
                        >
                          Link course
                        </Button>
                      </>
                    )}
                  </Group>
                </Stack>
              </Paper>
            ))}
            {resourceError && <Alert color="orange">{resourceError}</Alert>}
            {attempt && active === attempt.stepId && (
              <StudyWorkEditor
                key={attempt.id}
                attempt={attempt}
                root={root}
                resources={activeStep.resources}
                recommendedGame={activeStep.resources.find(
                  (r) =>
                    !journal.attempts.some(
                      (a) =>
                        a.stepId === "transfer" &&
                        a.status === "completed" &&
                        a.annotationSaved &&
                        a.work.some(
                          (w) =>
                            w.resourceId === r.id ||
                            w.reference.includes(r.kind === "pgn" ? r.path : r.url),
                        ),
                    ),
                )}
                busy={busy}
                onSave={saveRecord}
              />
            )}
            {attempt?.status === "completed" && (
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  This block is already marked complete. Its saved record is retained.
                </Text>
                <Button variant="default" disabled={busy} onClick={() => void restart(activeStep)}>
                  Restart block
                </Button>
              </Stack>
            )}
          </Stack>
        )}
      </Modal>
      <StudyHistory journal={journal} opened={history} onClose={() => setHistory(false)} />
      <Modal
        opened={newSession}
        onClose={() => setNewSession(false)}
        title="Start another study session?"
        size="sm"
      >
        <Stack>
          <Text size="sm">
            This saves the current session, including unfinished work. The new session has its own
            blocks and one recent classical game to annotate. Use resume for a short break.
          </Text>
          <Button disabled={busy} onClick={() => void beginAnother()}>
            Save current & start new session
          </Button>
          <Button variant="default" onClick={() => setNewSession(false)}>
            Keep current session
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={editingResource !== null}
        onClose={() => {
          if (!savingCourse) setEditingResource(null);
        }}
        title="Link your course"
        size="md"
      >
        <Stack>
          <Text size="sm">
            Paste your owned course URL. Today's frozen plan keeps its existing reference; new
            sessions use the updated link.
          </Text>
          <Textarea
            label="Course URL"
            value={courseUrl}
            onChange={(e) => setCourseUrl(e.currentTarget.value)}
          />
          {linkError && <Alert color="orange">{linkError}</Alert>}
          <Button
            loading={savingCourse}
            disabled={!isStudyUrl(courseUrl.trim())}
            onClick={() => void saveCourseLink()}
          >
            Save course link
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

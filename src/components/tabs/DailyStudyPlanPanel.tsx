import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import {
  IconBook,
  IconCheck,
  IconExternalLink,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { resolve } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useState } from "react";
import type { RecentFile } from "@/state/atoms";
import { getDocumentDir } from "@/utils/directories";
import {
  dailyStudyPlanSchema,
  getStudyDateKey,
  isStudyUrl,
  openingFocus,
  readStudyProgress,
  studyProgressKey,
  type DailyStudyPlan,
  type StudyProgress,
  type StudyResource,
  type StudyStep,
} from "@/utils/dailyStudyPlan";
import classes from "./DailyGoalsPanel.module.css";

type Props = { onOpenFile: (file: RecentFile) => void | Promise<void> };

export default function DailyStudyPlanPanel({ onOpenFile }: Props) {
  const [plan, setPlan] = useState<DailyStudyPlan | null>(null);
  const [root, setRoot] = useState("");
  const [loadError, setLoadError] = useState("");
  const [minutes, setMinutes] = useState<60 | 90>(90);
  const [day, setDay] = useState(getStudyDateKey);
  const [progress, setProgress] = useState<StudyProgress>({ completed: [], notes: {} });
  const [active, setActive] = useState<StudyStep | null>(null);
  const [resourceError, setResourceError] = useState("");
  const [openingResource, setOpeningResource] = useState<string | null>(null);
  const [editingResource, setEditingResource] = useState<StudyResource | null>(null);
  const [courseUrl, setCourseUrl] = useState("");
  const [savingCourse, setSavingCourse] = useState(false);
  const [linkError, setLinkError] = useState("");

  const load = useCallback(async () => {
    try {
      const directory = await getDocumentDir();
      const path = await resolve(directory, "daily-study-plan.json");
      if (!(await exists(path))) {
        setPlan(null);
        setLoadError("");
        return;
      }
      const raw = await readTextFile(path);
      const value = dailyStudyPlanSchema.parse(JSON.parse(raw));
      const selected = localStorage.getItem(`daily-study-minutes:${value.id}`);
      setRoot(directory);
      setPlan(value);
      setMinutes(selected === "60" ? 60 : selected === "90" ? 90 : value.defaultMinutes);
      setLoadError("");
    } catch {
      setLoadError("Could not read the saved study plan. Check daily-study-plan.json and retry.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const clock = setInterval(() => setDay(getStudyDateKey()), 30000);
    return () => clearInterval(clock);
  }, []);
  const planId = plan?.id;
  useEffect(() => {
    if (planId) setProgress(readStudyProgress(localStorage, planId, day));
  }, [planId, day]);

  function saveProgress(next: StudyProgress) {
    if (!plan) return;
    try {
      localStorage.setItem(studyProgressKey(plan.id, day), JSON.stringify(next));
      setProgress(next);
    } catch {
      setResourceError("Your progress could not be saved. Please try again before closing.");
    }
  }
  function complete(stepId: string, checked: boolean) {
    saveProgress({
      ...progress,
      completed: checked
        ? Array.from(new Set([...progress.completed, stepId]))
        : progress.completed.filter((id) => id !== stepId),
    });
  }
  async function openResource(resource: StudyResource, browser = false) {
    setResourceError("");
    setOpeningResource(resource.id);
    try {
      if (resource.kind === "pgn") {
        const path = await resolve(root, resource.path);
        await onOpenFile({ path, name: resource.title, type: "game", lastOpened: Date.now() });
        setActive(null);
      } else if (isTauri() && !browser) {
        await invoke("open_study_resource", { url: resource.url });
      } else if (isTauri()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(resource.url);
      } else {
        window.open(resource.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      setResourceError(
        "Could not open this resource. Try Open in browser, or check the linked file.",
      );
    } finally {
      setOpeningResource(null);
    }
  }
  async function saveCourseLink() {
    if (!plan || !editingResource || !isStudyUrl(courseUrl) || editingResource.kind !== "web")
      return;
    setSavingCourse(true);
    setLinkError("");
    try {
      const path = await resolve(root, "daily-study-plan.json");
      const latest = dailyStudyPlanSchema.parse(JSON.parse(await readTextFile(path)));
      if (latest.id !== plan.id) throw new Error("The saved plan has changed");
      const next = dailyStudyPlanSchema.parse({
        ...latest,
        steps: latest.steps.map((step) => ({
          ...step,
          resources: step.resources.map((resource) =>
            resource.id === editingResource.id
              ? { ...resource, url: courseUrl.trim(), linked: true }
              : resource,
          ),
        })),
      });
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, `${JSON.stringify(next, null, 2)}\n`);
      setPlan(next);
      setActive(next.steps.find((step) => step.id === active?.id) ?? null);
      setEditingResource(null);
    } catch {
      setLinkError(
        "Could not save this course link. Your existing link is unchanged in this session.",
      );
    } finally {
      setSavingCourse(false);
    }
  }
  if (!plan && !loadError) return null;
  if (!plan)
    return (
      <Alert color="orange" title="Study plan">
        <Text size="sm">{loadError}</Text>
        <Button size="xs" onClick={() => void load()}>
          Retry
        </Button>
      </Alert>
    );
  const steps = plan.steps.filter((step) => (minutes === 60 ? step.minutes60 : step.minutes90) > 0);
  const completed = steps.filter((step) => progress.completed.includes(step.id)).length;
  const next = steps.find((step) => !progress.completed.includes(step.id));
  const focus = openingFocus(plan, day);

  return (
    <>
      <Paper withBorder p="md" mb="md" className={classes.panel}>
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={800} size="xl">
              {plan.title}
            </Text>
            <Text size="sm" c="dimmed">
              {day} · {completed} of {steps.length} study blocks completed
            </Text>
          </Stack>
          <SegmentedControl
            aria-label="Daily study time"
            value={String(minutes)}
            data={[
              { label: "60 min", value: "60" },
              { label: "90 min", value: "90" },
            ]}
            onChange={(value) => {
              const selected = value === "60" ? 60 : 90;
              setMinutes(selected);
              localStorage.setItem(`daily-study-minutes:${plan.id}`, String(selected));
            }}
          />
        </Group>
        <Group mt="sm" justify="space-between">
          <Button
            leftSection={<IconPlayerPlay size={16} />}
            disabled={!next}
            onClick={() => setActive(next ?? null)}
          >
            {next ? `Start ${next.title}` : "Study plan complete"}
          </Button>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconRefresh size={14} />}
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
                checked={progress.completed.includes(step.id)}
                onChange={(event) => complete(step.id, event.currentTarget.checked)}
              />
              <Stack gap={3} className={classes.goalMain}>
                <Text fw={700}>{step.title}</Text>
                <Text size="xs" c="dimmed">
                  {step.id === "opening" && focus
                    ? focus.topic
                    : (step.summary ??
                      (step.resources.map((resource) => resource.title).join(" · ") ||
                        "Write one lesson and schedule your retests"))}
                </Text>
              </Stack>
              <Group gap="xs" className={classes.goalActions}>
                <Badge variant="light">
                  {minutes === 60 ? step.minutes60 : step.minutes90} min
                </Badge>
                <Button
                  aria-label={`Open ${step.title}`}
                  size="xs"
                  variant="light"
                  onClick={() => {
                    setResourceError("");
                    setActive(step);
                  }}
                >
                  Open
                </Button>
              </Group>
            </div>
          ))}
        </Stack>
      </Paper>
      <Modal
        opened={active !== null}
        onClose={() => setActive(null)}
        title={<b>{active?.title}</b>}
        size="lg"
      >
        {active && (
          <Stack gap="md">
            <Text size="sm">
              {minutes === 60 ? active.minutes60 : active.minutes90} minutes · {active.instructions}
            </Text>
            {active.id === "opening" && focus && (
              <Paper withBorder p="sm">
                <Text fw={700}>{focus.topic}</Text>
                <Text size="sm">{focus.instructions}</Text>
              </Paper>
            )}
            {active.resources.map((resource) => (
              <Paper withBorder p="sm" key={resource.id}>
                <Stack gap="xs">
                  <Text fw={600}>{resource.title}</Text>
                  {resource.kind === "web" && !resource.linked && (
                    <Text size="xs" c="dimmed">
                      Link your owned course to open it directly. The current button opens
                      Chessable.
                    </Text>
                  )}
                  <Group gap="xs">
                    <Button
                      size="sm"
                      leftSection={<IconBook size={16} />}
                      loading={openingResource === resource.id}
                      onClick={() => void openResource(resource)}
                    >
                      {resource.kind === "pgn"
                        ? "Open positions"
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
            {active.resources.some((resource) => resource.kind === "web") && (
              <Text size="xs" c="dimmed">
                Sign in once in the study window; its website session stays on this PC. Use Open in
                browser for your Chrome sign-in.
              </Text>
            )}
            <Textarea
              label="What I missed / next retest"
              placeholder="Strongest reply, lesson, and retest in 48 hours / one week"
              minRows={3}
              value={progress.notes[active.id] ?? ""}
              onChange={(event) =>
                saveProgress({
                  ...progress,
                  notes: { ...progress.notes, [active.id]: event.currentTarget.value },
                })
              }
            />
            <Button
              leftSection={<IconCheck size={16} />}
              onClick={() => {
                complete(active.id, true);
                setActive(null);
              }}
            >
              Mark this block complete
            </Button>
          </Stack>
        )}
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
            Open your owned course in Chessable and paste its course or training URL.
          </Text>
          <Textarea
            aria-label="Course URL"
            label="Course URL"
            value={courseUrl}
            onChange={(event) => setCourseUrl(event.currentTarget.value)}
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

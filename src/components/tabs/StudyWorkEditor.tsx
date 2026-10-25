import {
  Alert,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  NativeSelect,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { resolve } from "@tauri-apps/api/path";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import { useEffect, useRef, useState } from "react";
import type { StudyResource } from "@/utils/dailyStudyPlan";
import { type StudyAttempt, type StudyWork } from "@/utils/studySession";
import {
  pendingStudyDrafts,
  studyDraft,
  studyDraftKey,
  studyDraftErrors,
} from "@/utils/studyDraft";

export function validStudyFen(fen: string) {
  const setup = parseFen(fen);
  return setup.isOk && Chess.fromSetup(setup.unwrap()).isOk;
}
export function exerciseChoices(raw: string, path: string) {
  return parsePgn(raw).flatMap((game, index) => {
    if (!game.headers.has("FEN")) return [];
    const pos = startingPosition(game.headers);
    if (pos.isErr) return [];
    return [
      {
        id: `${path}:${index}`,
        reference: game.headers.get("Event") ?? `Position ${index + 1}`,
        fen: makeFen(pos.unwrap().toSetup()),
        source: { path, game: index, url: game.headers.get("Source") },
      },
    ];
  });
}

type Props = {
  attempt: StudyAttempt;
  resources: StudyResource[];
  recommendedGame?: StudyResource;
  root: string;
  busy: boolean;
  onSave: () => Promise<unknown>;
};
export default function StudyWorkEditor({
  attempt,
  resources,
  recommendedGame,
  root,
  busy,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(() => studyDraft(attempt));
  const [error, setError] = useState(studyDraftErrors.get(attempt.id) ?? "");
  const [saved, setSaved] = useState(true);
  const [choices, setChoices] = useState<ReturnType<typeof exerciseChoices>>([]);
  const [loading, setLoading] = useState(false);
  const dirty = useRef(false);
  const version = useRef(0);
  const blocked = useRef(false);
  const save = useRef(onSave);
  save.current = onSave;
  const [selectedResource, setSelectedResource] = useState<string | null>(null);
  function change(next: typeof draft) {
    setDraft(next);
    pendingStudyDrafts.set(attempt.id, next);
    studyDraftErrors.delete(attempt.id);
    dirty.current = true;
    version.current++;
    blocked.current = false;
    setSaved(false);
    try {
      localStorage.setItem(studyDraftKey(attempt.id), JSON.stringify(next));
      setError("");
    } catch {
      setError("This draft could not be saved. Keep this window open and retry.");
    }
  }
  useEffect(() => {
    if (!dirty.current || busy || blocked.current) return;
    const v = version.current;
    const timer = setTimeout(() => {
      void save.current().then((result) => {
        if (result && v === version.current) {
          dirty.current = false;
          setSaved(true);
        } else if (!result) {
          blocked.current = true;
          setError(
            "Study record not saved yet. Keep the draft and use Save study record to retry.",
          );
        }
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, busy]);
  async function loadPositions(id: string | null) {
    setSelectedResource(id);
    setChoices([]);
    if (!id) return;
    const resource = resources.find((r) => r.id === id);
    if (resource?.kind !== "pgn") return;
    setLoading(true);
    setError("");
    try {
      const path = await resolve(root, resource.path);
      if ((await stat(path)).size > 5 * 1024 * 1024)
        throw new Error("This PGN is large. Paste the position FEN instead.");
      const found = exerciseChoices(await readTextFile(path), resource.path);
      setChoices(found);
      if (!found.length)
        setError(
          "This file has no saved starting positions. Enter a game reference or paste the position FEN below.",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read positions. Please retry.");
    } finally {
      setLoading(false);
    }
  }
  function add(position?: Omit<StudyWork, "id" | "work">) {
    change({
      ...draft,
      work: [...draft.work, { id: crypto.randomUUID(), reference: "", work: "", ...position }],
    });
  }
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={700}>Study record</Text>
        <Text size="xs" c="dimmed" role="status">
          {saved ? "Saved" : "Saving…"}
        </Text>
      </Group>
      <Textarea
        label="Work, lesson and next step"
        placeholder="Candidates, strongest reply, what changed your mind, or what remains unfinished"
        minRows={3}
        value={draft.notes}
        onChange={(e) => change({ ...draft, notes: e.currentTarget.value })}
      />
      {draft.work.map((item, index) => (
        <Paper key={item.id} withBorder p="sm">
          <Stack gap="xs">
            <TextInput
              label={
                attempt.stepId === "transfer"
                  ? "Game and saved annotation reference"
                  : "Position, chapter or game reference"
              }
              value={item.reference}
              placeholder="Game / move, chapter, or saved file / study link"
              onChange={(e) =>
                change({
                  ...draft,
                  work: draft.work.map((w, i) =>
                    i === index ? { ...w, reference: e.currentTarget.value } : w,
                  ),
                })
              }
            />
            <Textarea
              label="Position FEN (optional)"
              minRows={1}
              autosize
              value={item.fen ?? ""}
              error={
                item.fen && !validStudyFen(item.fen)
                  ? "Enter a legal chess position FEN; your draft is retained."
                  : undefined
              }
              onChange={(e) =>
                change({
                  ...draft,
                  work: draft.work.map((w, i) =>
                    i === index ? { ...w, fen: e.currentTarget.value, source: undefined } : w,
                  ),
                })
              }
            />
            <Textarea
              label="What I calculated, annotated or reviewed"
              value={item.work}
              minRows={2}
              onChange={(e) =>
                change({
                  ...draft,
                  work: draft.work.map((w, i) =>
                    i === index ? { ...w, work: e.currentTarget.value } : w,
                  ),
                })
              }
            />
            {item.source && (
              <Text size="xs" c="dimmed">
                {item.source.path} · position {item.source.game + 1}
              </Text>
            )}
            {!item.reference && !item.fen && !item.work && (
              <Button
                size="xs"
                variant="subtle"
                onClick={() =>
                  change({ ...draft, work: draft.work.filter((w) => w.id !== item.id) })
                }
              >
                Remove empty entry
              </Button>
            )}
          </Stack>
        </Paper>
      ))}
      <Button size="xs" variant="light" onClick={() => add()}>
        {attempt.stepId === "transfer" ? "Record game and annotations" : "Add position or chapter"}
      </Button>
      {attempt.stepId === "transfer" && recommendedGame && (
        <Stack gap={4}>
          <Text size="sm">
            Suggested: {recommendedGame.title}. No completed annotation is logged here; prior work
            elsewhere is unknown.
          </Text>
          <Button
            size="xs"
            variant="light"
            onClick={() =>
              add({
                reference: `${recommendedGame.title} — ${recommendedGame.kind === "pgn" ? recommendedGame.path : recommendedGame.url}`,
                resourceId: recommendedGame.id,
              })
            }
          >
            Use suggested game
          </Button>
        </Stack>
      )}
      {attempt.stepId === "transfer" && (
        <NativeSelect
          label="Choose the game for this session"
          value=""
          data={[
            { value: "", label: "Choose a game" },
            ...resources.map((r) => ({ value: r.id, label: r.title })),
          ]}
          onChange={(event) => {
            const id = event.currentTarget.value;
            const r = resources.find((r) => r.id === id);
            if (r)
              add({
                reference: `${r.title} — ${r.kind === "pgn" ? r.path : r.url}`,
                resourceId: r.id,
              });
          }}
        />
      )}
      {resources.some((r) => r.kind === "pgn") && (
        <Group grow align="flex-start">
          <NativeSelect
            label="Attach exercise from file"
            value={selectedResource ?? ""}
            data={[
              { value: "", label: "Choose a PGN" },
              ...resources
                .filter((r) => r.kind === "pgn")
                .map((r) => ({ value: r.id, label: r.title })),
            ]}
            onChange={(event) => void loadPositions(event.currentTarget.value)}
          />
          <NativeSelect
            label="Exact starting position"
            disabled={!choices.length}
            value=""
            data={[
              { value: "", label: loading ? "Loading…" : "Choose position" },
              ...choices.map((p, i) => ({ value: p.id, label: `${i + 1}. ${p.reference}` })),
            ]}
            onChange={(event) => {
              const id = event.currentTarget.value;
              const p = choices.find((c) => c.id === id);
              if (p) add({ reference: p.reference, fen: p.fen, source: p.source });
            }}
          />
        </Group>
      )}
      <NumberInput
        label="Extra minutes studied without this timer"
        description="Manual time only; exclude minutes already timed here."
        min={0}
        max={1440}
        value={draft.manualMinutes ?? ""}
        onChange={(n) => change({ ...draft, manualMinutes: typeof n === "number" ? n : null })}
      />
      {attempt.stepId === "patterns" && (
        <>
          <Group grow>
            <NumberInput
              label="Known patterns reviewed"
              min={0}
              allowDecimal={false}
              value={draft.reviewedPatterns ?? ""}
              onChange={(n) =>
                change({ ...draft, reviewedPatterns: typeof n === "number" ? n : null })
              }
            />
            <NumberInput
              label="Unseen patterns attempted"
              min={0}
              allowDecimal={false}
              value={draft.newPatterns ?? ""}
              onChange={(n) => change({ ...draft, newPatterns: typeof n === "number" ? n : null })}
            />
          </Group>
          <Checkbox
            label="Review felt manageable today"
            checked={draft.reviewManageable ?? false}
            onChange={(e) => change({ ...draft, reviewManageable: e.currentTarget.checked })}
          />
        </>
      )}
      {attempt.stepId === "transfer" && (
        <Checkbox
          label="I annotated this game and saved my annotations at the reference above"
          checked={draft.annotationSaved}
          onChange={(e) => change({ ...draft, annotationSaved: e.currentTarget.checked })}
        />
      )}
      {error && <Alert color="orange">{error}</Alert>}
      <Button
        size="xs"
        variant="default"
        loading={busy}
        onClick={async () => {
          const result = await onSave();
          if (result) {
            dirty.current = false;
            setSaved(true);
          }
        }}
      >
        Save study record
      </Button>
    </Stack>
  );
}

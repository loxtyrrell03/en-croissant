import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import type { WebDrawingBrush, WebGame, WebPrepLineMove } from "./model";
import type { PhoneAnnotation } from "./phoneAnnotations";
import { PHONE_DRAWING_BRUSHES } from "./phoneDrawings";
export default function PhoneAnnotationBar({
  move,
  onChange,
  game,
  drawing,
}: {
  move?: WebPrepLineMove;
  onChange: (patch: PhoneAnnotation) => void;
  game: WebGame | null;
  drawing?: {
    enabled: boolean;
    brush: WebDrawingBrush;
    onToggle: () => void;
    onBrush: (brush: WebDrawingBrush) => void;
    onClear: () => void;
    hasShapes: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState((move?.comments ?? []).join("\n"));
  function download() {
    if (!game) return;
    const url = URL.createObjectURL(new Blob([game.pgn], { type: "application/x-chess-pgn" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${game.white}-${game.black}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return (
    <Stack gap={5}>
      <Group gap={5} wrap="wrap">
        <Text size="xs" fw={600}>
          {move ? move.san : "Starting position"}
        </Text>
        {["!", "?", "!!", "??", "!?", "?!"].map((g) => (
          <Button
            key={g}
            size="compact-sm"
            variant={move?.annotations?.includes(g) ? "filled" : "subtle"}
            disabled={!move}
            aria-label={`Mark move ${g}`}
            onClick={() => onChange({ annotations: move?.annotations?.includes(g) ? [] : [g] })}
          >
            {g}
          </Button>
        ))}
        <Button
          size="compact-sm"
          variant="light"
          disabled={!move}
          onClick={() => setOpen((v) => !v)}
        >
          Note
        </Button>
        {drawing && (
          <>
            <Button
              size="compact-sm"
              variant={drawing.enabled ? "filled" : "light"}
              aria-pressed={drawing.enabled}
              onClick={drawing.onToggle}
            >
              Draw
            </Button>
            <TournamentHelp label="Board drawings">
              Turn on Draw, then tap the start and end squares for an arrow, or the same square
              twice for a circle. Repeat a mark to remove it; drawings stay with this position.
            </TournamentHelp>
          </>
        )}
        {game && (
          <Button size="compact-sm" variant="subtle" onClick={download}>
            PGN ↓
          </Button>
        )}
      </Group>
      {drawing?.enabled && (
        <Group gap={5} wrap="wrap" aria-label="Drawing tools">
          {PHONE_DRAWING_BRUSHES.map((brush) => (
            <Button
              key={brush}
              size="compact-sm"
              color={brush}
              variant={drawing.brush === brush ? "filled" : "light"}
              aria-label={`Draw ${brush}`}
              aria-pressed={drawing.brush === brush}
              onClick={() => drawing.onBrush(brush)}
            >
              {brush[0].toUpperCase() + brush.slice(1)}
            </Button>
          ))}
          <Button
            size="compact-sm"
            variant="subtle"
            disabled={!drawing.hasShapes}
            onClick={drawing.onClear}
          >
            Clear drawings
          </Button>
        </Group>
      )}
      {open && (
        <Textarea
          aria-label="Move note"
          placeholder="Your note…"
          autosize
          minRows={2}
          maxRows={3}
          value={text}
          onChange={(e) => {
            const next = e.currentTarget.value;
            setText(next);
            onChange({ comments: next ? [next] : [] });
          }}
        />
      )}
    </Stack>
  );
}

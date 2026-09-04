import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import type { WebGame, WebPrepLineMove } from "./model";
import type { PhoneAnnotation } from "./phoneAnnotations";
export default function PhoneAnnotationBar({
  move,
  onChange,
  game,
}: {
  move?: WebPrepLineMove;
  onChange: (patch: PhoneAnnotation) => void;
  game: WebGame | null;
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
          {move ? move.san : "Select a move"}
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
        {game && (
          <Button size="compact-sm" variant="subtle" onClick={download}>
            PGN ↓
          </Button>
        )}
      </Group>
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

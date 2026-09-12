import {
  Avatar,
  Badge,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import * as Flags from "mantine-flagpack";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchFidePlayers } from "@/utils/fideApi";
import { describeFidePlayer, type FidePlayer } from "@/utils/fidePlayer";
import { FideProfileLink } from "./FideProfileLink";
import COUNTRIES from "./countries.json";

const flags = Object.entries(Flags).map(([key, value]) => ({
  key: key.replace("Flag", ""),
  component: value,
}));

export default function FideInfo({
  opened,
  setOpened,
  name,
  fideId,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
  name: string;
  fideId?: string;
}) {
  const { t } = useTranslation();
  const id = fideId?.trim() ?? "";
  const query =
    /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0
      ? id
      : name.trim() === "?"
        ? ""
        : name.trim();
  return (
    <Modal title={t("Databases.FIDE.Title")} opened={opened} onClose={() => setOpened(false)}>
      {opened && <FideSearch key={query} initialQuery={query} />}
    </Modal>
  );
}

function FideSearch({ initialQuery }: { initialQuery: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialQuery);
  const [request, setRequest] = useState({ term: initialQuery });
  const [players, setPlayers] = useState<FidePlayer[]>([]);
  const [player, setPlayer] = useState<FidePlayer | null>(null);
  const [loading, setLoading] = useState(Boolean(initialQuery));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const matchesRef = useRef(new Map<number, HTMLButtonElement>());
  const returnFocus = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (!request.term) return;
    setLoading(true);
    setError(null);
    setPlayer(null);
    setPlayers([]);
    void searchFidePlayers(request.term, controller.signal)
      .then((matches) => {
        if (controller.signal.aborted) return;
        setPlayers(matches);
        if (matches.length === 1) setPlayer(matches[0]);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "FIDE lookup failed. Retry the search.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    if (!player && returnFocus.current !== null) {
      matchesRef.current.get(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  }, [player]);

  function selectPlayer(next: FidePlayer) {
    returnFocus.current = next.id;
    setPlayer(next);
  }
  useEffect(() => {
    if (player && returnFocus.current !== null) headingRef.current?.focus();
  }, [player]);

  const country = COUNTRIES.find((country) => country.ioc === player?.federation);
  const Flag = player?.federation
    ? flags.find((flag) => flag.key === country?.a2)?.component
    : undefined;
  return (
    <Stack gap="md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const term = draft.trim();
          if (!term || (loading && term === request.term)) return;
          returnFocus.current = null;
          setPlayer(null);
          setPlayers([]);
          setError(null);
          setLoading(true);
          setRequest({ term });
          inputRef.current?.focus();
        }}
      >
        <Stack gap="xs">
          <TextInput
            ref={inputRef}
            data-autofocus
            label="Name or FIDE ID"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <Button
            type="submit"
            disabled={!draft.trim() || (loading && draft.trim() === request.term)}
            style={{ alignSelf: "flex-start" }}
          >
            {error && draft.trim() === request.term ? "Retry search" : "Search"}
          </Button>
        </Stack>
      </form>
      {loading ? (
        <Center role="status">{t("Common.Loading")}</Center>
      ) : error ? (
        <Text c="red" role="alert">
          {error}
        </Text>
      ) : player ? (
        <Stack gap="md">
          {players.length > 1 && (
            <Button
              variant="subtle"
              onClick={() => setPlayer(null)}
              style={{ alignSelf: "flex-start" }}
            >
              Back to matches
            </Button>
          )}
          <Group wrap="wrap" align="flex-start">
            {player.photo?.small && <Avatar src={player.photo.small} size={80} radius="sm" />}
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Group gap="xs">
                <Text
                  ref={headingRef}
                  tabIndex={-1}
                  fz="xl"
                  fw="bold"
                  style={{ overflowWrap: "anywhere" }}
                >
                  {player.name}
                </Text>
                {player.title && <Badge>{player.title}</Badge>}
              </Group>
              <Text size="sm">FIDE {player.id}</Text>
              {country ? (
                <Group gap="xs">
                  {Flag && <Flag w={30} />}
                  <Text c="dimmed">{country.name}</Text>
                </Group>
              ) : (
                player.federation && <Text c="dimmed">{player.federation}</Text>
              )}
              {player.year && (
                <Text size="sm" c="dimmed">
                  {t("Databases.FIDE.Born", { year: player.year })}
                </Text>
              )}
              {player.inactive && (
                <Text size="sm" c="dimmed">
                  Inactive
                </Text>
              )}
            </Stack>
          </Group>
          <FideProfileLink key={player.id} playerId={player.id} />
          <Divider />
          <Group
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, calc(7rem * var(--mantine-scale))), 1fr))",
            }}
          >
            {(["standard", "rapid", "blitz"] as const).map((key) => (
              <Card key={key} p="sm">
                <Text fw="bold">{t(`Databases.FIDE.${key[0].toUpperCase() + key.slice(1)}`)}</Text>
                <Text fz="sm">{player[key] ?? t("Databases.FIDE.NotRated")}</Text>
              </Card>
            ))}
          </Group>
        </Stack>
      ) : players.length ? (
        <Stack gap="xs" role="group" aria-label="FIDE matches">
          <Text size="sm">Choose the player to view their profile.</Text>
          {players.map((candidate) => (
            <Button
              key={candidate.id}
              ref={(element) => {
                if (element) matchesRef.current.set(candidate.id, element);
                else matchesRef.current.delete(candidate.id);
              }}
              variant="default"
              h="auto"
              py="xs"
              styles={{
                inner: { justifyContent: "flex-start" },
                label: { whiteSpace: "normal", textAlign: "left" },
              }}
              onClick={() => selectPlayer(candidate)}
            >
              <Stack gap={2}>
                <Text component="span" fw={600} style={{ overflowWrap: "anywhere" }}>
                  {candidate.title ? candidate.title + " " : ""}
                  {candidate.name}
                </Text>
                <Text component="span" size="xs" c="dimmed">
                  {[`FIDE ${candidate.id}`, describeFidePlayer(candidate)]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </Stack>
            </Button>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          {request.term
            ? "No FIDE player found. Try another name or ID."
            : "Enter a name or FIDE ID to find a player."}
        </Text>
      )}
    </Stack>
  );
}

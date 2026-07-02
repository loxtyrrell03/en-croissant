import type {
  WebColor,
  WebPrepCandidateSortColumn,
  WebPrepMode,
  WebPrepMoveSortDefaults,
  WebPrepOpponentSortColumn,
  WebPrepSource,
  WebPrepTemporarySource,
  WebPrepWorkspace,
} from "./model";

export type WebPrepSetupSelection = {
  mode: WebPrepMode;
  source: WebPrepSource;
  sourceId: string | null;
  temporarySource: WebPrepTemporarySource | null;
  opponent: string;
  userColor: WebColor;
  firstLocalSourceId: string | null;
};

export const DEFAULT_WEB_PREP_MOVE_SORT_DEFAULTS: WebPrepMoveSortDefaults = {
  opponent: "games",
  candidate: "strength",
};

export const WEB_PREP_OPPONENT_SORT_OPTIONS: {
  value: WebPrepOpponentSortColumn;
  label: string;
}[] = [
  { value: "games", label: "Usage" },
  { value: "strength", label: "Smart strength" },
  { value: "results", label: "Results" },
  { value: "prep", label: "Prep coverage" },
  { value: "state", label: "State" },
  { value: "move", label: "Move" },
];

export const WEB_PREP_CANDIDATE_SORT_OPTIONS: {
  value: WebPrepCandidateSortColumn;
  label: string;
}[] = [
  { value: "strength", label: "Smart strength" },
  { value: "games", label: "Usage" },
  { value: "results", label: "WDL" },
  { value: "move", label: "Move" },
];

export function normalizeWebPrepMoveSortDefaults(
  value: Partial<WebPrepMoveSortDefaults> | null | undefined,
): WebPrepMoveSortDefaults {
  return {
    opponent: isWebPrepOpponentSortColumn(value?.opponent)
      ? value.opponent
      : DEFAULT_WEB_PREP_MOVE_SORT_DEFAULTS.opponent,
    candidate: isWebPrepCandidateSortColumn(value?.candidate)
      ? value.candidate
      : DEFAULT_WEB_PREP_MOVE_SORT_DEFAULTS.candidate,
  };
}

export function isWebPrepOpponentSortColumn(
  value: unknown,
): value is WebPrepOpponentSortColumn {
  return (
    value === "move" ||
    value === "strength" ||
    value === "games" ||
    value === "results" ||
    value === "prep" ||
    value === "state"
  );
}

export function isWebPrepCandidateSortColumn(
  value: unknown,
): value is WebPrepCandidateSortColumn {
  return value === "move" || value === "strength" || value === "games" || value === "results";
}

export function getWebPrepSelectedLocalSourceId({
  activePrep,
  selectedSource,
  draftSourceId,
}: {
  activePrep: Pick<WebPrepWorkspace, "sourceIds"> | null;
  selectedSource: WebPrepSource;
  draftSourceId: string | null;
}) {
  if (selectedSource !== "local") return null;
  return activePrep ? activePrep.sourceIds[0] ?? null : draftSourceId;
}

export function isWebOnlinePrepSource(
  source: WebPrepSource,
): source is Extract<WebPrepSource, "lichess-all" | "lichess-masters"> {
  return source === "lichess-all" || source === "lichess-masters";
}

export function getWebPrepWorkspaceName(
  prep: Pick<WebPrepWorkspace, "mode" | "opponent">,
) {
  const mode = prep.mode ?? "player";
  const opponent = prep.opponent.trim();
  if (mode === "general") return "General prep";
  return opponent ? `${opponent} prep` : "Opponent prep";
}

export function applyWebPrepModeChange(
  selection: WebPrepSetupSelection,
  nextMode: WebPrepMode,
): WebPrepSetupSelection {
  if (nextMode === "general") {
    return {
      ...selection,
      mode: "general",
      source: "lichess-all",
      sourceId: null,
      temporarySource: null,
      opponent: "",
      userColor: "white",
    };
  }

  if (isWebOnlinePrepSource(selection.source)) {
    return {
      ...selection,
      mode: "player",
      source: "local",
      sourceId: selection.firstLocalSourceId,
      temporarySource: null,
      opponent: "",
    };
  }

  return {
    ...selection,
    mode: "player",
  };
}

export function applyWebPrepSourceChange(
  selection: WebPrepSetupSelection,
  nextSource: WebPrepSource,
  nextSourceId: string | null,
  nextTemporarySource: WebPrepTemporarySource | null = selection.temporarySource,
): WebPrepSetupSelection {
  if (isWebOnlinePrepSource(nextSource)) {
    return {
      ...selection,
      mode: "general",
      source: nextSource,
      sourceId: null,
      temporarySource: null,
      opponent: "",
      userColor: selection.mode === "general" ? selection.userColor : "white",
    };
  }

  if (nextSource === "temporary") {
    return {
      ...selection,
      source: "temporary",
      sourceId: null,
      temporarySource: nextTemporarySource,
    };
  }

  const sourceId = nextSourceId ?? selection.firstLocalSourceId;
  return {
    ...selection,
    source: "local",
    sourceId,
    temporarySource: null,
    opponent: sourceId !== selection.sourceId ? "" : selection.opponent,
  };
}

export function getWebPrepWorkspacePatchFromSelection(
  _prep: WebPrepWorkspace,
  selection: WebPrepSetupSelection,
): Partial<WebPrepWorkspace> {
  const sourceIds =
    selection.source === "local" && selection.sourceId
      ? [selection.sourceId]
      : selection.source === "temporary" && selection.temporarySource
        ? [selection.temporarySource.id]
        : [];

  return {
    mode: selection.mode,
    source: selection.source,
    sourceIds,
    temporarySource: selection.source === "temporary" ? selection.temporarySource : null,
    opponent: selection.opponent,
    userColor: selection.userColor,
    name: getWebPrepWorkspaceName(selection),
  };
}

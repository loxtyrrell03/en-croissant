import type {
  WebColor,
  WebPrepMode,
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

  return {
    ...selection,
    source: "local",
    sourceId: nextSourceId ?? selection.firstLocalSourceId,
    temporarySource: null,
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

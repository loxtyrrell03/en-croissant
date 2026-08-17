import { Chessground as NativeChessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import { Box } from "@mantine/core";
import equal from "fast-deep-equal/es6";
import { useAtomValue } from "jotai";
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { boardImageAtom, boardStyleAtom, moveMethodAtom } from "@/state/atoms";
import {
  CHESS_COM_BOARD_COORD_COLORS,
  CHESS_COM_DRAW_BRUSHES,
  isChessComBoardStyle,
  type BoardStyle,
} from "@/utils/boardStyle";

const BOARD_COORDINATE_COLORS: Record<string, { white: string; black: string }> = {
  blue: { white: "#dee3e6", black: "#788a94" },
  blue2: { white: "#97b2c7", black: "#546f82" },
  blue3: { white: "#d9e0e6", black: "#315991" },
  "blue-marble": { white: "#eae6dd", black: "#7c7f87" },
  canvas2: { white: "#d7daeb", black: "#547388" },
  wood: { white: "#d8a45b", black: "#9b4d0f" },
  wood2: { white: "#a38b5d", black: "#6c5017" },
  wood3: { white: "#d0ceca", black: "#755839" },
  wood4: { white: "#caaf7d", black: "#7b5330" },
  maple: { white: "#e8ceab", black: "#bc7944" },
  maple2: { white: "#e2c89f", black: "#963" },
  leather: { white: "#d1d1c9", black: "#c28e16" },
  green: { white: "#ffd", black: "#6d8753" },
  brown: { white: "#f0d9b5", black: "#946f51" },
  "pink-pyramid": { white: "#e8e9b7", black: "#ed7272" },
  marble: { white: "#93ab91", black: "#4f644e" },
  "green-plastic": { white: "#f2f9bb", black: "#59935d" },
  grey: { white: "#b8b8b8", black: "#7d7d7d" },
  metal: { white: "#c9c9c9", black: "#727272" },
  olive: { white: "#b8b19f", black: "#6d6655" },
  newspaper: { white: "#fff", black: "#8d8d8d" },
  purple: { white: "#9f90b0", black: "#7d4a8d" },
  "purple-diag": { white: "#e5daf0", black: "#957ab0" },
  ic: { white: "#ececec", black: "#c1c18e" },
  horsey: { white: "#f0d9b5", black: "#946f51" },
  gray: { white: "#e9ecef", black: "#868e96" },
};

function getBoardCoordinateColors(boardImage: string): {
  white: string;
  black: string;
} {
  const boardKey = boardImage.replace(/\.[^/.]+$/, "");
  return (
    BOARD_COORDINATE_COLORS[boardKey] ?? {
      white: "rgba(255, 255, 255, 0.8)",
      black: "rgba(72, 72, 72, 0.8)",
    }
  );
}

export interface ChessgroundRef {
  playPremove: () => boolean;
  cancelPremove: () => void;
}

interface ChessgroundProps extends Config {
  setBoardFen?: (fen: string) => void;
  ref?: Ref<ChessgroundRef>;
}

type ManagedChessgroundConfig = Omit<ChessgroundProps, "ref" | "setBoardFen">;

function buildManagedConfig(
  props: ManagedChessgroundConfig,
  setBoardFen: ChessgroundProps["setBoardFen"],
  moveMethod: "drag" | "select" | "both",
  boardStyle: BoardStyle,
  boardElement: HTMLDivElement,
  handlers: {
    events: Required<NonNullable<Config["events"]>>;
    movableEvents: Required<NonNullable<NonNullable<Config["movable"]>["events"]>>;
    premovableEvents: Required<NonNullable<NonNullable<Config["premovable"]>["events"]>>;
    predroppableEvents: Required<NonNullable<NonNullable<Config["predroppable"]>["events"]>>;
    drawableOnChange: NonNullable<NonNullable<Config["drawable"]>["onChange"]>;
  },
): Config {
  const shouldInstallEvents = !!setBoardFen || !!props.events;
  const config: Config = {
    ...props,
    addDimensionsCssVarsTo: boardElement,
    draggable: {
      ...props.draggable,
      enabled: moveMethod !== "select",
    },
    selectable: {
      ...props.selectable,
      enabled: moveMethod !== "drag",
    },
  };

  if (shouldInstallEvents) {
    config.events = {
      ...props.events,
      ...handlers.events,
    };
  }

  if (props.movable) {
    config.movable = {
      ...props.movable,
      events: {
        ...props.movable.events,
        ...handlers.movableEvents,
      },
    };
  }

  if (props.premovable) {
    config.premovable = {
      ...props.premovable,
      events: {
        ...props.premovable.events,
        ...handlers.premovableEvents,
      },
    };
  }

  if (props.predroppable) {
    config.predroppable = {
      ...props.predroppable,
      events: {
        ...props.predroppable.events,
        ...handlers.predroppableEvents,
      },
    };
  }

  if (props.drawable) {
    config.drawable = {
      ...props.drawable,
      brushes: isChessComBoardStyle(boardStyle)
        ? {
            ...CHESS_COM_DRAW_BRUSHES,
            ...props.drawable.brushes,
          }
        : props.drawable.brushes,
      onChange: handlers.drawableOnChange,
    };
  }

  return config;
}

export function Chessground({ ref, setBoardFen, ...props }: ChessgroundProps) {
  const moveMethod = useAtomValue(moveMethodAtom);
  const boardStyle = useAtomValue(boardStyleAtom);
  const apiRef = useRef<Api | null>(null);
  const appliedConfigRef = useRef<Config | null>(null);
  const latestPropsRef = useRef<ManagedChessgroundConfig>(props);
  const latestSetBoardFenRef = useRef<ChessgroundProps["setBoardFen"]>(setBoardFen);
  const latestMoveMethodRef = useRef(moveMethod);
  const latestBoardStyleRef = useRef(boardStyle);

  const boardRef = useRef<HTMLDivElement>(null);

  latestPropsRef.current = props;
  latestSetBoardFenRef.current = setBoardFen;
  latestMoveMethodRef.current = moveMethod;
  latestBoardStyleRef.current = boardStyle;

  const clearCachedBounds = useCallback(() => {
    apiRef.current?.state.dom.bounds.clear();
  }, []);

  const handlers = useMemo(() => {
    const events: Required<NonNullable<Config["events"]>> = {
      change: () => {
        const api = apiRef.current;
        const latestSetBoardFen = latestSetBoardFenRef.current;
        if (latestSetBoardFen && api) {
          latestSetBoardFen(api.getFen());
        }
        latestPropsRef.current.events?.change?.();
      },
      move: (orig, dest, capturedPiece) => {
        latestPropsRef.current.events?.move?.(orig, dest, capturedPiece);
      },
      dropNewPiece: (piece, key) => {
        latestPropsRef.current.events?.dropNewPiece?.(piece, key);
      },
      select: (key) => {
        latestPropsRef.current.events?.select?.(key);
      },
      insert: (elements) => {
        latestPropsRef.current.events?.insert?.(elements);
      },
    };

    const movableEvents: Required<NonNullable<NonNullable<Config["movable"]>["events"]>> = {
      after: (orig, dest, metadata) => {
        latestPropsRef.current.movable?.events?.after?.(orig, dest, metadata);
      },
      afterNewPiece: (role, key, metadata) => {
        latestPropsRef.current.movable?.events?.afterNewPiece?.(role, key, metadata);
      },
    };

    const premovableEvents: Required<NonNullable<NonNullable<Config["premovable"]>["events"]>> = {
      set: (orig, dest, metadata) => {
        latestPropsRef.current.premovable?.events?.set?.(orig, dest, metadata);
      },
      unset: () => {
        latestPropsRef.current.premovable?.events?.unset?.();
      },
    };

    const predroppableEvents: Required<NonNullable<NonNullable<Config["predroppable"]>["events"]>> =
      {
        set: (role, key) => {
          latestPropsRef.current.predroppable?.events?.set?.(role, key);
        },
        unset: () => {
          latestPropsRef.current.predroppable?.events?.unset?.();
        },
      };

    const drawableOnChange: NonNullable<NonNullable<Config["drawable"]>["onChange"]> = (shapes) => {
      latestPropsRef.current.drawable?.onChange?.(shapes);
    };

    return {
      events,
      movableEvents,
      premovableEvents,
      predroppableEvents,
      drawableOnChange,
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      playPremove: () => apiRef.current?.playPremove() ?? false,
      cancelPremove: () => apiRef.current?.cancelPremove(),
    }),
    [],
  );

  useEffect(() => {
    if (boardRef.current == null || apiRef.current) return;

    const config = buildManagedConfig(
      latestPropsRef.current,
      latestSetBoardFenRef.current,
      latestMoveMethodRef.current,
      latestBoardStyleRef.current,
      boardRef.current,
      handlers,
    );
    const chessgroundApi = NativeChessground(boardRef.current, config);
    apiRef.current = chessgroundApi;
    appliedConfigRef.current = config;

    return () => {
      chessgroundApi.destroy();
      apiRef.current = null;
      appliedConfigRef.current = null;
    };
  }, [handlers]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !boardRef.current) return;

    const config = buildManagedConfig(
      props,
      setBoardFen,
      moveMethod,
      boardStyle,
      boardRef.current,
      handlers,
    );
    if (appliedConfigRef.current && equal(appliedConfigRef.current, config)) {
      return;
    }

    api.set(config);
    appliedConfigRef.current = config;
  }, [boardStyle, handlers, moveMethod, props, setBoardFen]);

  useLayoutEffect(() => {
    clearCachedBounds();
  });

  const boardImage = useAtomValue(boardImageAtom);
  const boardCoordColors = useMemo(
    () =>
      isChessComBoardStyle(boardStyle)
        ? CHESS_COM_BOARD_COORD_COLORS
        : getBoardCoordinateColors(boardImage),
    [boardImage, boardStyle],
  );

  return (
    <Box
      style={{
        aspectRatio: 1,
        width: "100%",
        "--board-image": `url('/board/${boardImage}')`,
        "--chess-com-light-square": "#eeeed2",
        "--chess-com-dark-square": "#769656",
        "--board-coord-color-white": boardCoordColors.white,
        "--board-coord-color-black": boardCoordColors.black,
      }}
      data-board-style={boardStyle}
      ref={boardRef}
      onMouseDownCapture={clearCachedBounds}
      onTouchStartCapture={clearCachedBounds}
      onContextMenuCapture={clearCachedBounds}
    />
  );
}

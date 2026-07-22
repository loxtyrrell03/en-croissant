import { parseUci } from "chessops";
import { useAtom, useAtomValue } from "jotai";
import { useContext, useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  allEnabledAtom,
  bestMovesFamily,
  enableAllAtom,
  engineHotkeysEnabledAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { getVariationLine } from "@/utils/chess";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

function normalizedEventHotkey(event: KeyboardEvent) {
  const key = event.key === " " ? "space" : event.key.toLowerCase();
  const modifiers = [
    event.ctrlKey ? "ctrl" : null,
    event.metaKey ? "meta" : null,
    event.altKey ? "alt" : null,
    event.shiftKey ? "shift" : null,
  ].filter(Boolean);

  return [...modifiers, key].join("+");
}

function matchesHotkey(event: KeyboardEvent, hotkey: string | undefined) {
  if (!hotkey) return false;
  const pressed = normalizedEventHotkey(event);
  return hotkey
    .split(",")
    .map((keys) => keys.trim().toLowerCase().replace(/\s+/g, ""))
    .some((keys) => keys === pressed);
}

export default function EngineKeyboardShortcuts() {
  const store = useContext(TreeStateContext)!;
  const rootFen = useStore(store, (s) => s.root.fen);
  const moves = useStore(
    store,
    useShallow((s) => getVariationLine(s.root, s.position)),
  );
  const bestMoves = useAtomValue(bestMovesFamily({ fen: rootFen, gameMoves: moves }));
  const [, enable] = useAtom(enableAllAtom);
  const allEnabled = useAtomValue(allEnabledAtom);
  const hotkeysEnabled = useAtomValue(engineHotkeysEnabledAtom);
  const keyMap = useAtomValue(keyMapAtom);

  const bestMoveUci = useMemo(() => {
    const [firstEngine] = Array.from(bestMoves.entries()).sort((a, b) => a[0] - b[0]);
    return firstEngine?.[1]?.[0]?.pv?.[0] ?? null;
  }, [bestMoves]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      if (isTypingTarget(event.target)) return;

      if (matchesHotkey(event, keyMap.TOGGLE_ALL_ENGINES.keys)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        enable(!allEnabled);
        return;
      }

      if (!matchesHotkey(event, keyMap.PLAY_ENGINE_BEST_MOVE.keys) || !allEnabled || !bestMoveUci) {
        return;
      }

      const move = parseUci(bestMoveUci);
      if (!move) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      store.getState().makeMove({ payload: move });
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [allEnabled, bestMoveUci, enable, hotkeysEnabled, keyMap, store]);

  return null;
}

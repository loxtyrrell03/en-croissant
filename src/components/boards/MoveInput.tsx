import { Input } from "@mantine/core";
import { useContext, useState } from "react";
import { useStore } from "zustand";
import { parseKeyboardMove } from "@/utils/chess";
import { TreeStateContext } from "../common/TreeStateContext";

export default function MoveInput({ currentFen }: { currentFen: string }) {
  const store = useContext(TreeStateContext)!;
  const makeMove = useStore(store, (s) => s.makeMove);
  const [move, setMove] = useState("");
  const [error, setError] = useState("");

  return (
    <Input
      placeholder="Enter move"
      size="xs"
      onChange={(e) => {
        setMove(e.currentTarget.value);
        setError("");
      }}
      error={error}
      value={move}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const m = move.trim();
          if (m.length > 0) {
            const parsed = parseKeyboardMove(m, currentFen);
            if (parsed) {
              makeMove({ payload: parsed });
              setMove("");
            } else {
              setError("Invalid move");
            }
          }
        }
      }}
    />
  );
}

import { Text } from "@mantine/core";
import { useContext, useEffect, useState } from "react";
import { useStore } from "zustand";
import { getOpening } from "@/utils/chess";
import { TreeStateContext } from "./TreeStateContext";

function OpeningName({ compact = false }: { compact?: boolean }) {
  const [openingName, setOpeningName] = useState("");
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);

  useEffect(() => {
    getOpening(root, position).then((v) => setOpeningName(v));
  }, [root, position]);

  return (
    <Text
      style={{ lineHeight: compact ? 1.15 : undefined, userSelect: "text" }}
      fz={compact ? "xs" : "sm"}
      truncate={compact}
    >
      {openingName}
    </Text>
  );
}

export default OpeningName;

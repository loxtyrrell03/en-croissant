import {
  IconBook,
  IconChess,
  IconFile,
  IconFileTypePdf,
  IconPuzzle,
  IconTrophy,
} from "@tabler/icons-react";
import type { FileType } from "./file";

function getFileIcon(type: FileType) {
  switch (type) {
    case "pdf":
      return IconFileTypePdf;
    case "repertoire":
      return IconBook;
    case "game":
      return IconChess;
    case "tournament":
      return IconTrophy;
    case "puzzle":
      return IconPuzzle;
    default:
      return IconFile;
  }
}

export function FileIcon({ type, ...props }: { type: FileType } & any) {
  const Icon = getFileIcon(type);
  return <Icon {...props} />;
}

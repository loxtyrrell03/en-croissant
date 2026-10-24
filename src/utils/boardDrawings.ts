import type { DrawShape } from "@lichess-org/chessground/draw";

/** Editable node annotations and temporary analysis overlays have separate owners. */
export function boardDrawings({ saved, overlays, visible = () => true, eraseOnClick, save }: {
  saved: DrawShape[];
  overlays: DrawShape[];
  visible?: (shape: DrawShape) => boolean;
  eraseOnClick: boolean;
  save: (shapes: DrawShape[]) => void;
}) {
  const shapes = saved.filter(visible);
  const hidden = saved.filter(shape => !visible(shape));
  return {
    shapes,
    autoShapes: overlays,
    eraseOnClick,
    onChange: (edited: DrawShape[]) => save([...hidden, ...edited]),
  };
}

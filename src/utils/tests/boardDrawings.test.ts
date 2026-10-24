import type { DrawShape } from "@lichess-org/chessground/draw";
import { describe, expect, test, vi } from "vitest";
import { boardDrawings } from "../boardDrawings";
import { getPGN, parsePgnTokens } from "../chess";

const arrow: DrawShape = { orig: "e2", dest: "e4", brush: "green" };
const circle: DrawShape = { orig: "d4", brush: "red" };
const plan: DrawShape = { orig: "g1", dest: "f3", brush: "plan-white" };
const engine: DrawShape = { orig: "d2", dest: "d4", brush: "blue" };

describe("saved board drawing ownership", () => {
  test("the editable layer starts with saved arrows and circles, separately from engine overlays", () => {
    const save = vi.fn();
    const drawing = boardDrawings({ saved: [arrow, circle], overlays: [engine], eraseOnClick: false, save });
    expect(drawing.shapes).toEqual([arrow, circle]);
    expect(drawing.autoShapes).toEqual([engine]);
    expect(drawing.eraseOnClick).toBe(false);
    drawing.onChange([arrow, circle, plan]);
    expect(save).toHaveBeenLastCalledWith([arrow, circle, plan]);
    expect(save.mock.calls[0][0]).not.toContain(engine);
  });
  test("redrawing a visible mark can remove it without deleting hidden saved plans", () => {
    const save = vi.fn();
    const saved = [arrow, plan, circle];
    const drawing = boardDrawings({ saved, overlays: [engine], visible: shape => shape !== plan, eraseOnClick: false, save });
    expect(drawing.shapes).toEqual([arrow, circle]);
    drawing.onChange([circle]);
    expect(save).toHaveBeenLastCalledWith([plan, circle]);
    expect(saved).toEqual([arrow, plan, circle]);
  });
  test("an explicit clear preference only clears visible editable shapes", () => {
    const save = vi.fn();
    const drawing = boardDrawings({ saved: [arrow, plan], overlays: [engine], visible: shape => shape !== plan, eraseOnClick: true, save });
    expect(drawing.eraseOnClick).toBe(true);
    drawing.onChange([]);
    expect(save).toHaveBeenLastCalledWith([plan]);
  });
  test("editing imported PGN marks keeps the earlier annotations in the next export", () => {
    const tree = parsePgnTokens([{ type: "Comment", value: "[%cal Ge2e4] [%csl Rd4]" }, { type: "Outcome", value: "*" }]);
    const drawing = boardDrawings({ saved: tree.root.shapes, overlays: [engine], eraseOnClick: false,
      save: shapes => { tree.root.shapes = shapes; } });
    drawing.onChange([...drawing.shapes, { orig: "g1", dest: "f3", brush: "blue" }]);
    const pgn = getPGN(tree.root, { headers: tree.headers, glyphs: true, comments: true, variations: true, extraMarkups: true });
    expect(pgn).toContain("Ge2e4");
    expect(pgn).toContain("Rd4");
    expect(pgn).toContain("[%csl Rd4]");
    expect(pgn).not.toContain("Rd4d4");
    expect(pgn).toContain("Bg1f3");
    expect(pgn).not.toContain("Bd2d4");
  });
  test("an older saved same-square drawing remains a PGN circle when exported", () => {
    const tree = parsePgnTokens([]);
    tree.root.shapes = [{ orig: "d4", dest: "d4", brush: "red" }];
    const pgn = getPGN(tree.root, { headers: tree.headers, glyphs: true, comments: true, variations: true, extraMarkups: true });
    expect(pgn).toContain("[%csl Rd4]");
    expect(pgn).not.toContain("[%cal");
  });
});

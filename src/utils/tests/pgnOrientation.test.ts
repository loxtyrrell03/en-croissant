import { expect, test } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import { parsePgnTokens } from "../chess";
import { pgnOrientation } from "../pgnOrientation";
import { createTab } from "../tabs";
import type { Token } from "@/bindings";

const BLACK_FEN = "7k/6pp/8/8/8/8/6PP/KR6 b - - 0 20";
function tokens(orientation?: string): Token[] {
    return [
        { type: "Header", value: { tag: "FEN", value: BLACK_FEN } },
        ...(orientation
            ? [{ type: "Header" as const, value: { tag: "Orientation", value: orientation } }]
            : []),
        { type: "San", value: "Kg8" },
        { type: "Outcome", value: "*" },
    ];
}
test.each([undefined, "sideways", " BLACK "])(
    "unmarked standalone positions face their starting mover (%s)",
    (orientation) => {
        const tree = parsePgnTokens(tokens(orientation));
        expect(tree.headers.orientation).toBe("black");
        expect(tree.root.children[0].fen.split(" ")[1]).toBe("w");
        expect(pgnOrientation(tree.root.fen, tree.headers.orientation)).toBe("black");
    },
);
test("explicit perspective wins over the starting mover; ordinary games keep their fallback", () => {
    expect(parsePgnTokens(tokens(" White ")).headers.orientation).toBe("white");
    expect(
        parsePgnTokens([{ type: "Header", value: { tag: "Orientation", value: "BLACK" } }]).headers
            .orientation,
    ).toBe("black");
    expect(pgnOrientation(INITIAL_FEN, "invalid", "black")).toBe("black");
    expect(pgnOrientation("invalid fen", undefined, "white")).toBe("white");
    expect(parsePgnTokens([], BLACK_FEN).headers.orientation).toBe("black");
});
test("opening a native tab preserves imported perspective unless the caller explicitly overrides it", async () => {
    for (const override of [undefined, "white"] as const) {
        const tree = parsePgnTokens(tokens("BLACK"));
        const id = await createTab({
            tab: { name: "Fixture", type: "analysis" },
            initialState: tree,
            headers: { ...tree.headers, orientation: override },
            setTabs: () => {},
            setActiveTab: () => {},
        });
        expect(JSON.parse(sessionStorage.getItem(id)!).state.headers.orientation).toBe(
            override ?? "black",
        );
        sessionStorage.removeItem(id);
    }
});

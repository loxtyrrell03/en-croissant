import { expect, test } from "vitest";
import type { Token } from "@/bindings";
import { ANNOTATION_INFO, type Annotation, NAG_INFO } from "../annotation";
import { hasMorePriority, mergePgnCommentText, parsePgnTokens } from "../chess";

test("NAGs are consistent", () => {
    for (const k of Object.keys(ANNOTATION_INFO)) {
        if (k === "") continue;
        const nag = ANNOTATION_INFO[k as Annotation].nag!;
        expect(NAG_INFO.get(`$${nag}`)).toBe(k);
    }
});

test("priority comparison", () => {
    expect(hasMorePriority([0, 0], [0])).toBe(false);
    expect(hasMorePriority([0], [0, 0])).toBe(true);
    expect(hasMorePriority([0], [1])).toBe(true);
    expect(hasMorePriority([1], [0])).toBe(false);
    expect(hasMorePriority([0, 0], [0, 1])).toBe(true);
    expect(hasMorePriority([0, 1], [0, 0])).toBe(false);
    expect(hasMorePriority([0, 1], [0, 2])).toBe(true);
    expect(hasMorePriority([0, 2], [0, 1])).toBe(false);
});

test("PGN comments at one position are preserved instead of overwritten", () => {
    expect(mergePgnCommentText("", " First paragraph. ")).toBe("First paragraph.");
    expect(mergePgnCommentText("First paragraph.", "Second paragraph.")).toBe(
        "First paragraph.\n\nSecond paragraph.",
    );
});

test("Chessable prose and moves survive adjacent annotation blocks", () => {
    const tokens: Token[] = [
        { type: "Header", value: { tag: "Event", value: "Course lesson" } },
        { type: "Header", value: { tag: "Result", value: "*" } },
        { type: "Comment", value: "The full lesson introduction." },
        { type: "Comment", value: "-KEY-" },
        { type: "San", value: "e4" },
        { type: "Comment", value: "First note after the move." },
        { type: "Comment", value: "Second note after the move." },
        { type: "San", value: "e5" },
        { type: "Outcome", value: "*" },
    ];

    const tree = parsePgnTokens(tokens);
    expect(tree.root.comment).toBe("The full lesson introduction.");
    expect(tree.root.children[0]?.san).toBe("e4");
    expect(tree.root.children[0]?.comment).toBe(
        "First note after the move.\n\nSecond note after the move.",
    );
    expect(tree.root.children[0]?.children[0]?.san).toBe("e5");
});

test("Chessable marker-only prose records do not replace their annotation", () => {
    const tokens: Token[] = [
        { type: "Header", value: { tag: "Event", value: "Course introduction" } },
        { type: "Header", value: { tag: "Result", value: "*" } },
        { type: "Comment", value: "A prose-only introduction with no legal move." },
        { type: "Comment", value: " -KEY- " },
        { type: "Outcome", value: "*" },
    ];

    const tree = parsePgnTokens(tokens);
    expect(tree.root.children).toHaveLength(0);
    expect(tree.root.comment).toBe("A prose-only introduction with no legal move.");
});

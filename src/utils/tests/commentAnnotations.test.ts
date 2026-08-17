import { expect, test } from "vitest";
import { hideMoveQualityComments, isMoveQualityComment } from "@/utils/commentAnnotations";

test("detects concise move-quality verdict comments", () => {
    expect(isMoveQualityComment("Bxf4 is a mistake.")).toBe(true);
    expect(isMoveQualityComment("This was a blunder")).toBe(true);
    expect(isMoveQualityComment("Great move!")).toBe(true);
    expect(isMoveQualityComment("Attack the pinned knight next.")).toBe(false);
});

test("hides move-quality paragraphs while preserving normal comments", () => {
    expect(hideMoveQualityComments("Bxf4 is a mistake.")).toBe("");
    expect(hideMoveQualityComments("Bxf4 is a mistake.\n\nAttack the pinned knight next.")).toBe(
        "Attack the pinned knight next.",
    );
});

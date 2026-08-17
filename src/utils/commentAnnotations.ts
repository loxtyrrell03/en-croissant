const QUALITY_WORD_PATTERN =
    "(?:brilliant|great|excellent|best|good|book|inaccuracy|mistake|blunder)";

const MOVE_QUALITY_COMMENT_PATTERNS = [
    new RegExp(
        `^\\s*(?:[+#?!\\s]*[A-Za-z0-9O0=+#x:\\-]+[+#?!\\s]*)?\\s*(?:is|was)\\s+(?:a|an)?\\s*${QUALITY_WORD_PATTERN}(?:\\s+move)?[.!?\\s]*$`,
        "i",
    ),
    new RegExp(
        `^\\s*(?:this\\s+)?(?:is|was)\\s+(?:a|an)?\\s*${QUALITY_WORD_PATTERN}(?:\\s+move)?[.!?\\s]*$`,
        "i",
    ),
    new RegExp(`^\\s*${QUALITY_WORD_PATTERN}(?:\\s+move)?[.!?\\s]*$`, "i"),
];

export function isMoveQualityComment(comment: string) {
    const normalized = comment.replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    return MOVE_QUALITY_COMMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hideMoveQualityComments(comment: string) {
    return comment
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph && !isMoveQualityComment(paragraph))
        .join("\n\n");
}

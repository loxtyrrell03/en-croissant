const MAX_BOOK_PASSAGES = 6;
const MAX_EXCERPT_CHARACTERS = 1100;

export function buildCodexCoachInvocation(
  prompt,
  { model = "gpt-5.6-sol", reasoningEffort = "medium" } = {},
) {
  return {
    args: [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--model",
      model,
      "-c",
      `model_reasoning_effort=\"${reasoningEffort}\"`,
      "-",
    ],
    stdin: [
      "You are the response-generation layer inside a private chess coaching app.",
      "Do not call tools, inspect files, browse, or modify anything. Use only the evidence in this prompt.",
      "Return only the final Markdown coaching answer.",
      "",
      String(prompt || ""),
    ].join("\n"),
  };
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "analyse",
  "analyze",
  "answer",
  "because",
  "before",
  "black",
  "chess",
  "could",
  "explain",
  "from",
  "game",
  "have",
  "help",
  "here",
  "move",
  "play",
  "please",
  "position",
  "should",
  "that",
  "their",
  "then",
  "there",
  "these",
  "think",
  "this",
  "what",
  "when",
  "where",
  "which",
  "white",
  "with",
  "would",
  "wrong",
]);

function pushTerms(terms, text) {
  for (const token of String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (token.length < 3 || STOP_WORDS.has(token) || terms.includes(token)) continue;
    terms.push(token);
    if (terms.length >= 32) break;
  }
}

export function buildChessBookSearchTerms({ question, scope = "whole-game", moves = [] }) {
  const terms = [];
  pushTerms(terms, question);
  for (const move of moves.slice(0, 80)) {
    pushTerms(terms, Array.isArray(move.annotations) ? move.annotations.join(" ") : "");
  }

  const normalizedQuestion = String(question || "").toLowerCase();
  const concepts = [];
  if (
    scope === "whole-game" ||
    ["review", "mistake", "blunder", "went wrong", "critical"].some((word) =>
      normalizedQuestion.includes(word),
    )
  ) {
    concepts.push("calculation", "candidates", "threats", "prophylaxis", "strategy", "decision");
  }
  if (normalizedQuestion.includes("opening")) {
    concepts.push("opening", "development", "centre", "king", "structure");
  }
  if (normalizedQuestion.includes("middlegame") || normalizedQuestion.includes("middle game")) {
    concepts.push("middlegame", "coordination", "pawn", "break", "plan");
  }
  if (normalizedQuestion.includes("endgame") || normalizedQuestion.includes("convert")) {
    concepts.push("endgame", "conversion", "activity", "king", "technique");
  }
  if (["calculate", "calculation", "tactic", "combination", "visual"].some((word) => normalizedQuestion.includes(word))) {
    concepts.push("calculation", "candidate", "forcing", "visualization", "tactics");
  }
  if (["attack", "king safety", "sacrifice"].some((word) => normalizedQuestion.includes(word))) {
    concepts.push("attack", "king", "initiative", "sacrifice");
  }
  if (["defend", "defence", "defense", "survive"].some((word) => normalizedQuestion.includes(word))) {
    concepts.push("defence", "counterplay", "prophylaxis", "resistance");
  }
  for (const concept of concepts) {
    if (!terms.includes(concept)) terms.push(concept);
  }
  if (terms.length === 0) terms.push("calculation", "strategy", "candidates", "threats");
  return terms.slice(0, 32);
}

export function searchChessBookCorpus(database, context, limit = MAX_BOOK_PASSAGES) {
  const terms = buildChessBookSearchTerms(context);
  const expression = terms.map((term) => `"${term}"`).join(" OR ");
  const candidates = database
    .prepare(
      `
      SELECT c.chunk_id, c.book_id, b.title, b.author, COALESCE(b.shelf, '') AS shelf,
             COALESCE(c.chapter_title, '') AS chapter_title, c.citation,
             c.pdf_page_start, c.pdf_page_end, c.printed_page_start, c.printed_page_end,
             c.text, COALESCE(b.local_path, '') AS local_path
      FROM chunks_fts AS f
      JOIN chunks AS c ON c.chunk_id = f.chunk_id
      JOIN books AS b ON b.book_id = c.book_id
      WHERE chunks_fts MATCH ?
      ORDER BY bm25(chunks_fts, 0.0, 6.0, 2.0, 3.0, 4.0, 2.0, 1.0)
      LIMIT 48
      `,
    )
    .all(expression);

  const passages = [];
  const perBook = new Map();
  for (const candidate of candidates) {
    const bookCount = perBook.get(candidate.book_id) ?? 0;
    if (bookCount >= 2) continue;
    perBook.set(candidate.book_id, bookCount + 1);
    passages.push({
      chunkId: String(candidate.chunk_id),
      bookId: String(candidate.book_id),
      title: String(candidate.title),
      author: String(candidate.author),
      shelf: String(candidate.shelf),
      chapterTitle: String(candidate.chapter_title),
      citation: String(candidate.citation),
      pdfPageStart: Number(candidate.pdf_page_start),
      pdfPageEnd: Number(candidate.pdf_page_end),
      printedPageStart:
        candidate.printed_page_start === null ? null : Number(candidate.printed_page_start),
      printedPageEnd:
        candidate.printed_page_end === null ? null : Number(candidate.printed_page_end),
      excerpt: String(candidate.text).replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARACTERS),
      localPath: String(candidate.local_path),
    });
    if (passages.length >= Math.max(1, Math.min(12, Number(limit) || MAX_BOOK_PASSAGES))) break;
  }
  return passages;
}

export function cloudEvaluationToWhiteCp(payload) {
  const pv = Array.isArray(payload?.pvs) ? payload.pvs[0] : null;
  if (!pv) return null;
  if (Number.isFinite(pv.cp)) return Number(pv.cp);
  if (Number.isFinite(pv.mate)) return Math.sign(Number(pv.mate)) * 100000;
  return null;
}

export function buildCriticalMoments(moves, evaluations, playerColor, limit = 5) {
  const color = playerColor === "black" ? "black" : "white";
  return moves
    .filter((move) => move.color === color)
    .map((move) => {
      const before = evaluations.get(normalizeFen(move.fenBefore));
      const after = evaluations.get(normalizeFen(move.fenAfter));
      const beforeCp = cloudEvaluationToWhiteCp(before);
      const afterCp = cloudEvaluationToWhiteCp(after);
      if (beforeCp === null || afterCp === null) return null;
      const lossCp = color === "white" ? beforeCp - afterCp : afterCp - beforeCp;
      return {
        ply: Number(move.ply),
        san: String(move.san),
        color,
        fenBefore: String(move.fenBefore),
        fenAfter: String(move.fenAfter),
        beforeCp,
        afterCp,
        lossCp,
        bestLineUci: String(before?.pvs?.[0]?.moves || "").split(/\s+/).filter(Boolean).slice(0, 10),
        replyLineUci: String(after?.pvs?.[0]?.moves || "").split(/\s+/).filter(Boolean).slice(0, 10),
        depth: Number(before?.depth) || null,
      };
    })
    .filter((moment) => moment && moment.lossCp >= 20)
    .sort((a, b) => b.lossCp - a.lossCp || a.ply - b.ply)
    .slice(0, Math.max(1, Math.min(8, Number(limit) || 5)));
}

export function buildPhoneCoachPrompt({
  question,
  pgn,
  playerColor,
  currentFen,
  currentLines,
  criticalMoments,
  bookPassages,
}) {
  const books = bookPassages.length
    ? bookPassages
        .map(
          (passage, index) =>
            `[Book ${index + 1}] ${passage.title} — ${passage.author}\nChapter: ${passage.chapterTitle || "Available excerpt"}\nCitation: ${passage.citation}\nPassage: ${passage.excerpt}`,
        )
        .join("\n\n")
    : "None retrieved. Do not invent a book citation.";
  const moments = criticalMoments.length
    ? JSON.stringify(criticalMoments, null, 2)
    : "No cache-backed whole-game critical moments were available.";
  const rootLines = Array.isArray(currentLines) && currentLines.length
    ? JSON.stringify(currentLines.slice(0, 5), null, 2)
    : "No current-position engine lines were supplied.";

  return `Role: You are a rigorous, practical chess coach.

Grounding order:
1. The supplied Stockfish evaluations and lines are authoritative for concrete verdicts and variations.
2. The retrieved chess-book passages are authoritative for attributed teaching principles.
3. The PGN says what was played, but is not engine evidence by itself.

Rules:
- Answer the user's actual question directly in the first paragraph, from ${playerColor}'s perspective.
- For a whole-game review, prioritize the supplied critical moments. Explain the human mechanism, the engine proof, what to play instead, and one training lesson.
- A positive White-relative centipawn score favours White; a negative score favours Black. lossCp is already measured as damage to ${playerColor}.
- UCI engine lines are evidence. Do not silently convert them to SAN unless certain; it is acceptable to show short UCI evidence as supplied.
- Never invent an evaluation, move line, title, author, page, quotation, or citation.
- Use a retrieved principle only when relevant. Cite it immediately as [Book N]. Paraphrase; do not reproduce long passages.
- Do not claim a book analysed this exact game unless the passage actually does.
- If the cache did not supply whole-game moments, say that limitation and restrict concrete engine claims to the current position.
- Keep the answer compact but instructive. Prefer **Direct answer**, **Critical moments**, **What to play instead**, and **Training lesson** when they help.

User question:
${String(question).slice(0, 2000)}

Player colour: ${playerColor}
Current FEN: ${String(currentFen).slice(0, 160)}

PGN:
${String(pgn || "Unavailable").slice(0, 16000)}

Cache-backed critical moments:
${moments}

Current-position engine lines:
${rootLines}

Retrieved book passages:
${books}
`;
}

export function normalizeFen(fen) {
  return String(fen || "").trim().split(/\s+/).slice(0, 4).join(" ");
}

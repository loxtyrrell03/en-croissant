const MAX_BOOK_PASSAGES = 6;
const MAX_EXCERPT_CHARACTERS = 1100;
export const MAX_COACH_MOVES = 4096;
export const MAX_COACH_PGN_CHARACTERS = 300_000;

const NUMBERED_BOOK_PLACEHOLDER = /\bbook\s*(?:(?:no\.?|number)\s*|#\s*)?\d+\b/i;

export const COACH_LIBRARY_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "categories"],
  properties: {
    overview: { type: "string" },
    categories: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "reason", "keyPlies", "bookIds", "chapterIds", "searchQueries"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          reason: { type: "string" },
          keyPlies: {
            type: "array",
            maxItems: 8,
            items: { type: "integer", minimum: 1 },
          },
          bookIds: {
            type: "array",
            maxItems: 8,
            items: { type: "string" },
          },
          chapterIds: {
            type: "array",
            maxItems: 10,
            items: { type: "string" },
          },
          searchQueries: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: { type: "string" },
          },
        },
      },
    },
  },
};

export const COACH_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "categories", "priorities"],
  properties: {
    overview: { type: "string" },
    categories: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "summary", "explanation", "positions", "bookReferences"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          summary: { type: "string" },
          explanation: { type: "string" },
          positions: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["ply", "san", "title", "explanation", "engineEvidence", "betterPlan"],
              properties: {
                ply: { type: "integer", minimum: 1 },
                san: { type: "string" },
                title: { type: "string" },
                explanation: { type: "string" },
                engineEvidence: { type: "string" },
                betterPlan: { type: "string" },
              },
            },
          },
          bookReferences: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["chunkId", "whyItMatters", "positionPly"],
              properties: {
                chunkId: { type: "string" },
                whyItMatters: { type: "string" },
                positionPly: { type: ["integer", "null"], minimum: 1 },
              },
            },
          },
        },
      },
    },
    priorities: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
  },
};

export function classifyCodexAuthentication(exitCode, output = "") {
  if (exitCode === 0) {
    return { status: "authenticated", detail: "Codex login status succeeded." };
  }

  const detail = String(output || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  if (
    /not logged in|not signed in|unauthenticated|authentication required|codex login|status.?401/i.test(
      detail,
    )
  ) {
    return { status: "signed-out", detail: detail || "Codex reported a signed-out session." };
  }
  return {
    status: "unavailable",
    detail: detail || `Codex login status exited with code ${String(exitCode)}.`,
  };
}

export function preserveConfirmedCodexAuthentication(previous, next) {
  if (next?.status === "unavailable" && previous?.status === "authenticated") {
    return {
      ...previous,
      transientDetail: next.detail,
    };
  }
  return next;
}

export function codexExitIndicatesSignedOut(exitCode, stderr) {
  return (
    exitCode !== 0 &&
    /unauthenticated|not logged|not signed|codex login|authentication required|status.?401/i.test(
      String(stderr || ""),
    )
  );
}

export function codexUsageLimitFromOutput(output) {
  const text = String(output || "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  if (
    !/you(?:'ve| have) hit your usage limit|usage limit (?:reached|exceeded)|insufficient[_ ]quota|quota (?:exhausted|exceeded)|purchase more credits|credits?.*(?:depleted|exhausted|insufficient)/i.test(
      text,
    )
  ) {
    return null;
  }
  const retryMatch = text.match(
    /try again at\s+([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)(?:\s+[A-Za-z0-9_+:/-]+)?)/i,
  );
  return {
    retryLabel: retryMatch?.[1]?.replace(/\s+/g, " ").trim() || null,
  };
}

function safeCodexUsageLimitRetryLabel(value) {
  const match = String(value || "").match(
    /^([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)(?:\s+[A-Za-z0-9_+:/-]+)?)$/i,
  );
  return match?.[1] || null;
}

export function publicChessCoachFailure(error, { analysisOnly = false } = {}) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code === "MODEL_USAGE_LIMIT") {
    const retryLabel = safeCodexUsageLimitRetryLabel(error?.retryLabel);
    return {
      status: 429,
      code,
      error: retryLabel
        ? `OpenAI Codex has reached its usage limit. Add credits or try again at ${retryLabel}.`
        : "OpenAI Codex has reached its usage limit. Add credits or try again later.",
    };
  }
  if (code === "MODEL_UNAVAILABLE") {
    if (/not signed|not logged|codex login|unauthenticated/i.test(message)) {
      return {
        status: 503,
        code,
        error: "OpenAI Codex is installed but not signed in. Run `codex login` on the gaming PC.",
      };
    }
    if (/installed|command.*not found/i.test(message)) {
      return {
        status: 503,
        code,
        error: "The PC coach needs the OpenAI Codex app or CLI installed.",
      };
    }
    return {
      status: 503,
      code,
      error: "The PC could not verify the OpenAI Codex sign-in. Please try Check PC again.",
    };
  }
  if (analysisOnly || code === "PC_ANALYSIS_FAILED") {
    return {
      status: 502,
      code: "PC_ANALYSIS_FAILED",
      error: "The gaming PC could not complete every requested position. Please try again.",
    };
  }
  return {
    status: 502,
    code: "COACH_FAILED",
    error: "The PC coach could not complete this review. Please try again.",
  };
}

export function probeCodexAuthentication({
  spawnProcess,
  commandPath,
  cwd,
  env,
  timeoutMs = 15000,
}) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawnProcess(commandPath, ["login", "status"], {
        cwd,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return resolvePromise({
        status: "unavailable",
        detail: `Codex login status could not start: ${error?.message || error}`,
      });
    }

    let output = "";
    let timeoutId;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolvePromise(result);
    };
    const appendOutput = (chunk) => {
      if (output.length < 16 * 1024) output += String(chunk);
    };
    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    child.once("error", (error) =>
      finish({
        status: "unavailable",
        detail: `Codex login status failed to start: ${error?.message || error}`,
      }),
    );
    child.once("exit", (code) => finish(classifyCodexAuthentication(code, output)));
    timeoutId = setTimeout(() => {
      child.kill();
      finish({
        status: "unavailable",
        detail: `Codex login status timed out after ${timeoutMs} ms.`,
      });
    }, timeoutMs);
  });
}

export function buildCodexCoachInvocation(
  prompt,
  { model = "gpt-5.6-sol", reasoningEffort = "medium", outputSchemaPath = "" } = {},
) {
  const structuredOutputArgs = outputSchemaPath
    ? ["--output-schema", String(outputSchemaPath)]
    : [];
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
      `model_reasoning_effort="${reasoningEffort}"`,
      ...structuredOutputArgs,
      "-",
    ],
    stdin: [
      "You are the response-generation layer inside a private chess coaching app.",
      "Do not call tools, inspect files, browse, or modify anything. Use only the evidence in this prompt.",
      outputSchemaPath
        ? "Return only one JSON object that conforms exactly to the supplied output schema."
        : "Return only the final Markdown coaching answer.",
      "",
      String(prompt || ""),
    ].join("\n"),
  };
}

export function writeProcessStdinSafely(stdin, input, onError = () => {}) {
  if (!stdin || typeof stdin.on !== "function" || typeof stdin.end !== "function") {
    onError(new Error("The model process did not expose a writable stdin stream."));
    return () => {};
  }
  const reportError = (error) => {
    try {
      onError(error instanceof Error ? error : new Error(String(error)));
    } catch {
      // The permanent stream listener must never turn a handled pipe failure
      // into an uncaught exception in the home server.
    }
  };
  stdin.on("error", reportError);
  try {
    stdin.end(input);
  } catch (error) {
    reportError(error);
  }
  return () => {
    try {
      if (!stdin.destroyed && typeof stdin.destroy === "function") stdin.destroy();
    } catch (error) {
      reportError(error);
    }
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
  for (const token of String(text || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || []) {
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
  if (
    ["calculate", "calculation", "tactic", "combination", "visual"].some((word) =>
      normalizedQuestion.includes(word),
    )
  ) {
    concepts.push("calculation", "candidate", "forcing", "visualization", "tactics");
  }
  if (["attack", "king safety", "sacrifice"].some((word) => normalizedQuestion.includes(word))) {
    concepts.push("attack", "king", "initiative", "sacrifice");
  }
  if (
    ["defend", "defence", "defense", "survive"].some((word) => normalizedQuestion.includes(word))
  ) {
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

export function getChessBookLibraryInventory(database) {
  const bookRows = database
    .prepare(
      `
      SELECT b.book_id AS book_id, b.title AS book_title, b.author AS author,
             COALESCE(b.shelf, '') AS shelf,
             COUNT(DISTINCT CASE WHEN ch.accessible_in_excerpt = 1 THEN ch.chapter_id END)
               AS accessible_chapters
      FROM books AS b
      LEFT JOIN chapters AS ch ON ch.book_id = b.book_id
      GROUP BY b.book_id, b.title, b.author, b.shelf
      ORDER BY b.shelf, b.title
      `,
    )
    .all();
  const chapterRows = database
    .prepare(
      `
      SELECT ch.chapter_id AS chapter_id, ch.book_id AS book_id,
             ch.title AS chapter_title, ch.number AS chapter_number,
             ch.printed_page_start AS printed_page_start,
             ch.pdf_page_start AS pdf_page_start, ch.pdf_page_end AS pdf_page_end
      FROM chapters AS ch
      WHERE ch.accessible_in_excerpt = 1
        AND EXISTS (SELECT 1 FROM chunks AS c WHERE c.chapter_id = ch.chapter_id)
      ORDER BY ch.book_id, ch.order_index
      `,
    )
    .all();

  return {
    books: bookRows.map((row) => ({
      bookId: String(row.book_id),
      title: String(row.book_title),
      author: String(row.author),
      shelf: String(row.shelf),
      accessibleChapterCount: Number(row.accessible_chapters) || 0,
    })),
    chapters: chapterRows.map((row) => ({
      chapterId: String(row.chapter_id),
      bookId: String(row.book_id),
      title: String(row.chapter_title),
      number: row.chapter_number === null ? "" : String(row.chapter_number),
      printedPageStart: row.printed_page_start === null ? null : Number(row.printed_page_start),
      pdfPageStart: row.pdf_page_start === null ? null : Number(row.pdf_page_start),
      pdfPageEnd: row.pdf_page_end === null ? null : Number(row.pdf_page_end),
    })),
  };
}

function oneLine(value, limit = 400) {
  return String(value ?? "")
    .replace(/[|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function completeCoachPgn(value) {
  const pgn = String(value || "").trim();
  if (pgn.length > MAX_COACH_PGN_CHARACTERS) {
    throw new Error(
      `Coach PGN is too large (${pgn.length} characters; maximum ${MAX_COACH_PGN_CHARACTERS}).`,
    );
  }
  return pgn || "Unavailable";
}

function positiveCoachInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeChessCoachRequestPayload(payload, { createRequestId } = {}) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid coach request.");
  const question = String(payload.question || "")
    .trim()
    .slice(0, 2000);
  const currentFen = String(payload.currentFen || "")
    .trim()
    .slice(0, 160);
  const pgn = completeCoachPgn(payload.pgn);
  if (!question) throw new Error("A coach question is required.");
  if (!currentFen) throw new Error("The current FEN is required.");

  const rawMoves = Array.isArray(payload.moves) ? payload.moves : [];
  if (rawMoves.length > MAX_COACH_MOVES) {
    throw new Error(
      `Coach game has too many moves (${rawMoves.length}; maximum ${MAX_COACH_MOVES}).`,
    );
  }
  const moves = rawMoves.map((move, index) => {
    const fenBefore = String(move?.fenBefore || "")
      .trim()
      .slice(0, 160);
    const fenAfter = String(move?.fenAfter || "")
      .trim()
      .slice(0, 160);
    if (!fenBefore || !fenAfter) {
      throw new Error(
        `Coach move ${index + 1} is missing its complete before/after position data.`,
      );
    }
    return {
      ply: positiveCoachInteger(move?.ply, index + 1),
      color: move?.color === "black" ? "black" : "white",
      san: String(move?.san || `Ply ${index + 1}`).slice(0, 32),
      uci: String(move?.uci || "").slice(0, 12),
      fenBefore,
      fenAfter,
      annotations: Array.isArray(move?.annotations)
        ? move.annotations.slice(0, 8).map((item) => String(item).slice(0, 200))
        : [],
    };
  });
  for (let index = 1; index < moves.length; index += 1) {
    if (normalizeFen(moves[index - 1].fenAfter) !== normalizeFen(moves[index].fenBefore)) {
      throw new Error(
        `Coach move ${index + 1} does not continue from the preceding game position.`,
      );
    }
  }
  const currentLines = (Array.isArray(payload.currentLines) ? payload.currentLines : [])
    .slice(0, 5)
    .map((line) => ({
      depth: Number(line?.depth) || null,
      eval: String(line?.eval || "").slice(0, 32),
      score: line?.score ?? null,
      sanMoves: Array.isArray(line?.sanMoves) ? line.sanMoves.slice(0, 16) : [],
      uciMoves: Array.isArray(line?.uciMoves) ? line.uciMoves.slice(0, 16) : [],
    }));
  const fallbackRequestId =
    typeof createRequestId === "function"
      ? createRequestId()
      : `coach-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let persistence = null;
  if (payload.persistence !== undefined && payload.persistence !== null) {
    if (typeof payload.persistence !== "object" || Array.isArray(payload.persistence)) {
      throw new Error("Invalid coach persistence context.");
    }
    const storageKey = String(payload.persistence.storageKey || "");
    const contextKey = String(payload.persistence.contextKey || "").trim();
    const lineContextKey = String(payload.persistence.lineContextKey || "").trim();
    if (
      !storageKey ||
      storageKey.length > 256 * 1024 ||
      !contextKey ||
      contextKey.length > 384 * 1024 ||
      !lineContextKey ||
      lineContextKey.length > 256 * 1024
    ) {
      throw new Error("Invalid coach persistence context.");
    }
    persistence = { storageKey, contextKey, lineContextKey };
  }
  return {
    requestId: /^[a-z0-9_-]{8,100}$/i.test(String(payload.requestId || ""))
      ? String(payload.requestId)
      : fallbackRequestId,
    question,
    currentFen,
    pgn,
    playerColor: payload.playerColor === "black" ? "black" : "white",
    scope: payload.scope === "position" ? "position" : "whole-game",
    moves,
    currentLines,
    persistence,
  };
}

export function formatChessBookLibraryInventory(inventory) {
  const books = (inventory?.books || []).map(
    (book) =>
      `BOOK|${oneLine(book.bookId, 100)}|${oneLine(book.title)}|${oneLine(book.author, 200)}|${oneLine(book.shelf, 200)}|accessible_chapters=${Number(book.accessibleChapterCount) || 0}`,
  );
  const chapters = (inventory?.chapters || []).map((chapter) => {
    const printed = chapter.printedPageStart === null ? "?" : chapter.printedPageStart;
    const pdf =
      chapter.pdfPageStart === null
        ? "?"
        : chapter.pdfPageEnd && chapter.pdfPageEnd !== chapter.pdfPageStart
          ? `${chapter.pdfPageStart}-${chapter.pdfPageEnd}`
          : chapter.pdfPageStart;
    return `CHAPTER|${oneLine(chapter.chapterId, 100)}|book=${oneLine(chapter.bookId, 100)}|${oneLine(chapter.number, 40)} ${oneLine(chapter.title)}|printed=${printed}|pdf=${pdf}`;
  });
  return [...books, ...chapters].join("\n");
}

export function buildLibraryPlannerPrompt({
  question,
  pgn,
  playerColor,
  scope,
  currentFen,
  moveAnalysis,
  inventory,
}) {
  return `Role: You are the chess-library editor and syllabus planner for a rigorous private coach.

You must decide which coaching categories are genuinely relevant to this specific game or position, then select the exact books and accessible chapters that the final coach should consult. The category names and their order are your decision; do not use a fixed checklist. Choose between one and six categories and omit aspects that have no useful lesson.

Evidence rules:
- The complete PC Stockfish trace below is authoritative for concrete chess verdicts.
- Scores are White-relative. Each position records whether it came from the PC cloud store or a live PC search and its depth; treat small differences across unlike depths cautiously.
- Use the PGN and FENs to recognize the exact opening position, pawn structure, piece placement, transition, and practical plans.
- Select only IDs printed in the library inventory. A CHAPTER entry means its text is actually accessible in the lawful local corpus. Never invent an ID or select a table-of-contents-only chapter.
- Prefer exact chapter IDs over broad book IDs. Every category should have focused search queries that would find the most relevant page-bounded lesson inside the selected material.
- Give opening coverage materially more attention when the opening produced an instructive inaccuracy, unfamiliar structure, misplaced piece, missed break, or plan error. Tie it to exact move numbers and positions, not generic opening advice.
- Categories may be specific, for example “Dutch opening structure”, “Calculation at move 31”, “Rook endgame technique”, or “Defensive decision-making”. Choose the clearest short tab label.

User question: ${oneLine(question, 2000)}
Player: ${playerColor}
Scope: ${scope}
Current FEN: ${oneLine(currentFen, 180)}

PGN:
${completeCoachPgn(pgn)}

Complete PC analysis trace (one record per played move):
${JSON.stringify(moveAnalysis || [], null, 2)}

Available library inventory (${inventory?.books?.length || 0} books; ${inventory?.chapters?.length || 0} accessible chapters):
${formatChessBookLibraryInventory(inventory)}
`;
}

function parseStructuredObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value || "").trim();
  if (!text) throw new Error("The coach returned an empty structured response.");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("The coach returned invalid structured JSON.");
  }
}

function uniqueStrings(values, allowed = null, limit = 12) {
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || "").trim();
    if (!normalized || result.includes(normalized) || (allowed && !allowed.has(normalized))) {
      continue;
    }
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function safeCategoryId(value, fallback, used) {
  const stem =
    String(value || fallback || "lesson")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "lesson";
  let candidate = stem;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${stem.slice(0, 42)}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

export function normalizeLibraryPlan(value, inventory, moves = []) {
  const parsed = parseStructuredObject(value);
  const books = new Map((inventory?.books || []).map((book) => [book.bookId, book]));
  const chapters = new Map(
    (inventory?.chapters || []).map((chapter) => [chapter.chapterId, chapter]),
  );
  const availableBooks = new Set(
    [...books.values()]
      .filter((book) => Number(book.accessibleChapterCount) > 0)
      .map((book) => book.bookId),
  );
  const allowedChapters = new Set(chapters.keys());
  const validPlies = new Set(
    (moves || []).map((move) => Number(move.ply)).filter(Number.isInteger),
  );
  const usedIds = new Set();
  const categories = [];
  for (const [index, raw] of (Array.isArray(parsed.categories)
    ? parsed.categories
    : []
  ).entries()) {
    if (!raw || typeof raw !== "object" || categories.length >= 6) continue;
    const label = oneLine(raw.label, 80);
    const reason = oneLine(raw.reason, 1200);
    if (!label || !reason) continue;
    const chapterIds = uniqueStrings(raw.chapterIds, allowedChapters, 10);
    const bookIds = uniqueStrings(raw.bookIds, availableBooks, 8);
    for (const chapterId of chapterIds) {
      const bookId = chapters.get(chapterId)?.bookId;
      if (bookId && !bookIds.includes(bookId)) bookIds.push(bookId);
    }
    const keyPlies = Array.from(
      new Set(
        (Array.isArray(raw.keyPlies) ? raw.keyPlies : [])
          .map(Number)
          .filter(
            (ply) =>
              Number.isInteger(ply) && ply > 0 && (validPlies.size === 0 || validPlies.has(ply)),
          ),
      ),
    ).slice(0, 8);
    const searchQueries = uniqueStrings(raw.searchQueries, null, 6)
      .map((query) => oneLine(query, 240))
      .filter(Boolean);
    if (searchQueries.length === 0) searchQueries.push(`${label} ${reason}`.slice(0, 240));
    if (chapterIds.length === 0 && bookIds.length === 0) continue;
    categories.push({
      id: safeCategoryId(raw.id, label || `lesson-${index + 1}`, usedIds),
      label,
      reason,
      keyPlies,
      bookIds: bookIds.slice(0, 8),
      chapterIds,
      searchQueries,
    });
  }
  if (categories.length === 0) {
    throw new Error("The AI library planner did not return any usable coaching categories.");
  }
  if (!categories.some((category) => category.chapterIds.length || category.bookIds.length)) {
    throw new Error("The AI library planner did not select any available books or chapters.");
  }
  return {
    overview: oneLine(parsed.overview, 1600) || "The AI selected the most relevant lessons.",
    categories,
  };
}

function passageFromRow(row) {
  return {
    chunkId: String(row.chunk_id),
    bookId: String(row.book_id),
    title: String(row.book_title),
    author: String(row.author),
    shelf: String(row.shelf),
    chapterTitle: String(row.chapter_title),
    citation: String(row.citation),
    pdfPageStart: Number(row.pdf_page_start),
    pdfPageEnd: Number(row.pdf_page_end),
    printedPageStart: row.printed_page_start === null ? null : Number(row.printed_page_start),
    printedPageEnd: row.printed_page_end === null ? null : Number(row.printed_page_end),
    excerpt: String(row.text).replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARACTERS),
    localPath: String(row.local_path),
  };
}

function getScopedPassageCandidates(database, category) {
  const clauses = [];
  const parameters = [];
  if (category.chapterIds.length) {
    clauses.push(`c.chapter_id IN (${category.chapterIds.map(() => "?").join(", ")})`);
    parameters.push(...category.chapterIds);
  } else if (category.bookIds.length) {
    clauses.push(`c.book_id IN (${category.bookIds.map(() => "?").join(", ")})`);
    parameters.push(...category.bookIds);
  }
  if (clauses.length === 0) return [];
  return database
    .prepare(
      `
      SELECT c.chunk_id, c.book_id, c.chapter_id, b.title AS book_title, b.author,
             COALESCE(b.shelf, '') AS shelf, COALESCE(c.chapter_title, '') AS chapter_title,
             c.citation, c.pdf_page_start, c.pdf_page_end, c.printed_page_start,
             c.printed_page_end, c.text, COALESCE(b.local_path, '') AS local_path
      FROM chunks AS c
      JOIN books AS b ON b.book_id = c.book_id
      WHERE ${clauses.join(" OR ")}
      ORDER BY c.book_id, c.pdf_page_start, c.sequence_in_page
      LIMIT 240
      `,
    )
    .all(...parameters);
}

function passageRelevanceScore(row, category) {
  const haystack =
    `${row.book_title} ${row.author} ${row.shelf} ${row.chapter_title} ${row.text}`.toLowerCase();
  const terms = [];
  for (const query of [category.label, category.reason, ...category.searchQueries]) {
    pushTerms(terms, query);
  }
  let score = category.chapterIds.includes(String(row.chapter_id)) ? 30 : 0;
  if (category.bookIds.includes(String(row.book_id))) score += 8;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length >= 7 ? 3 : 1;
  }
  if (String(row.chapter_title || "").trim()) score += 1;
  return score;
}

export function retrievePlannedBookPassages(
  database,
  plan,
  { perCategory = 3, totalLimit = 18 } = {},
) {
  const passageById = new Map();
  const categoryPassageIds = {};
  for (const category of plan.categories) {
    const candidates = getScopedPassageCandidates(database, category)
      .map((row) => ({ row, score: passageRelevanceScore(row, category) }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          Number(left.row.pdf_page_start) - Number(right.row.pdf_page_start),
      );

    const selected = [];
    const selectedChapters = new Set();
    for (const candidate of candidates) {
      const chapterId = String(candidate.row.chapter_id || "");
      if (!chapterId || selectedChapters.has(chapterId)) continue;
      selected.push(candidate.row);
      selectedChapters.add(chapterId);
      if (selected.length >= Math.min(perCategory, category.chapterIds.length || perCategory)) {
        break;
      }
    }
    for (const candidate of candidates) {
      if (selected.length >= perCategory) break;
      if (selected.some((row) => row.chunk_id === candidate.row.chunk_id)) continue;
      selected.push(candidate.row);
    }

    categoryPassageIds[category.id] = [];
    for (const row of selected) {
      const passage = passageFromRow(row);
      categoryPassageIds[category.id].push(passage.chunkId);
      if (!passageById.has(passage.chunkId) && passageById.size < totalLimit) {
        passageById.set(passage.chunkId, passage);
      }
    }
    categoryPassageIds[category.id] = categoryPassageIds[category.id].filter((chunkId) =>
      passageById.has(chunkId),
    );
  }
  return { passages: [...passageById.values()], categoryPassageIds };
}

export function buildStructuredPhoneCoachPrompt({
  question,
  pgn,
  playerColor,
  currentFen,
  scope,
  moveAnalysis,
  analysisCoverage,
  libraryPlan,
  bookPassages,
  categoryPassageIds,
}) {
  const sources = bookPassages.map((passage) => ({
    chunkId: passage.chunkId,
    bookId: passage.bookId,
    title: passage.title,
    author: passage.author,
    shelf: passage.shelf,
    chapterTitle: passage.chapterTitle,
    citation: passage.citation,
    excerpt: passage.excerpt,
  }));
  const plannedCategories = libraryPlan.categories.map((category) => ({
    ...category,
    availableChunkIds: categoryPassageIds[category.id] || [],
  }));
  return `Role: You are a rigorous, practical chess coach writing a structured review for ${playerColor}.

The PC has already analyzed every requested unique position. The AI library editor has already chosen the relevant categories, books, and accessible chapters. Your job is to synthesize those two evidence classes into clear, category-tab content.

Grounding rules:
- PC Stockfish is authoritative for evaluations, tactical claims, and better moves. Scores are White-relative. State the source/depth when it matters and avoid treating small cross-depth changes as exact.
- The supplied page-bounded book excerpts are authoritative for attributed lessons. Refer to books by their complete real title and chapter title in prose, never by a number such as “Book 3”.
- Every bookReferences.chunkId must exactly match a supplied chunkId available to that planned category. Never invent a title, author, chapter, page, quotation, chunk ID, evaluation, or line.
- Paraphrase source lessons. Do not reproduce long excerpts and do not claim an author analyzed this exact game.
- Keep the AI-selected category IDs, labels, and order. Do not add a fixed generic section.
- Each category explanation should connect concrete positions to the human decision, the engine evidence, the better plan, and the cited teaching lesson.
- A position ply identifies the move just played: ply 1 is White's first move. Use only plies in the supplied trace.
- When an opening category was selected, be unusually specific: identify the exact relevant move/position, the pawn structure and piece placement, thematic plans and breaks, what the played move misunderstood, and how the selected opening chapter applies. Do not settle for generic development principles.
- Use Markdown inside explanation fields sparingly. Do not put category headings inside them because the UI provides tabs.
- Answer the user's question directly in overview and finish with a short ordered priorities list.

User question: ${oneLine(question, 2000)}
Scope: ${scope}
Current FEN: ${oneLine(currentFen, 180)}

PGN:
${completeCoachPgn(pgn)}

PC analysis coverage:
${JSON.stringify(analysisCoverage, null, 2)}

Complete move-by-move PC trace:
${JSON.stringify(moveAnalysis || [], null, 2)}

AI-selected library plan:
${JSON.stringify({ overview: libraryPlan.overview, categories: plannedCategories }, null, 2)}

Permitted source passages:
${JSON.stringify(sources, null, 2)}
`;
}

function cleanText(value, limit) {
  return String(value ?? "")
    .split("\u0000")
    .join("")
    .trim()
    .slice(0, limit);
}

export function assertNoNumberedBookPlaceholders(value) {
  let offendingText = "";
  const visit = (candidate) => {
    if (offendingText) return;
    if (typeof candidate === "string") {
      if (NUMBERED_BOOK_PLACEHOLDER.test(candidate)) offendingText = candidate;
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (candidate && typeof candidate === "object") {
      for (const item of Object.values(candidate)) visit(item);
    }
  };
  visit(value);
  if (offendingText) {
    throw new Error(
      "The coach used a numbered book placeholder instead of an actual book and chapter title.",
    );
  }
  return value;
}

export function normalizeStructuredCoachReview(
  value,
  { libraryPlan, bookPassages, moves = [], categoryPassageIds = {} },
) {
  const parsed = parseStructuredObject(value);
  const passageIds = new Set(bookPassages.map((passage) => passage.chunkId));
  const moveByPly = new Map((moves || []).map((move) => [Number(move.ply), move]));
  const rawById = new Map(
    (Array.isArray(parsed.categories) ? parsed.categories : [])
      .filter((category) => category && typeof category === "object")
      .map((category) => [String(category.id || ""), category]),
  );
  const categories = [];
  for (const planned of libraryPlan.categories) {
    const raw = rawById.get(planned.id);
    if (!raw) {
      throw new Error(`The coach omitted the AI-planned review category ${planned.label}.`);
    }
    const permittedForCategory = new Set(categoryPassageIds[planned.id] || []);
    const positions = [];
    for (const position of Array.isArray(raw.positions) ? raw.positions : []) {
      const ply = Number(position?.ply);
      if (!Number.isInteger(ply) || !moveByPly.has(ply) || positions.length >= 8) continue;
      const move = moveByPly.get(ply);
      positions.push({
        ply,
        san: cleanText(move.san, 40),
        title: cleanText(position.title, 160) || `After ${move.san}`,
        explanation: cleanText(position.explanation, 2400),
        engineEvidence: cleanText(position.engineEvidence, 1200),
        betterPlan: cleanText(position.betterPlan, 1600),
      });
    }
    const bookReferences = [];
    for (const reference of Array.isArray(raw.bookReferences) ? raw.bookReferences : []) {
      const chunkId = String(reference?.chunkId || "");
      if (
        !passageIds.has(chunkId) ||
        !permittedForCategory.has(chunkId) ||
        bookReferences.some((item) => item.chunkId === chunkId) ||
        bookReferences.length >= 8
      ) {
        continue;
      }
      const rawPly = reference.positionPly;
      const positionPly =
        rawPly === null || rawPly === undefined || !moveByPly.has(Number(rawPly))
          ? null
          : Number(rawPly);
      bookReferences.push({
        chunkId,
        whyItMatters: cleanText(reference.whyItMatters, 1200),
        positionPly,
      });
    }
    if (permittedForCategory.size > 0 && bookReferences.length === 0) {
      throw new Error(`The coach omitted the required named book reference for ${planned.label}.`);
    }
    categories.push({
      id: planned.id,
      label: planned.label,
      summary: cleanText(raw.summary, 500) || planned.reason,
      explanation: cleanText(raw.explanation, 8000),
      positions,
      bookReferences,
    });
  }
  if (categories.length === 0) {
    throw new Error("The coach did not return any of the AI-planned review categories.");
  }
  const review = {
    overview: cleanText(parsed.overview, 3000) || libraryPlan.overview,
    categories,
    priorities: uniqueStrings(parsed.priorities, null, 6).map((priority) =>
      cleanText(priority, 500),
    ),
  };
  return assertNoNumberedBookPlaceholders(review);
}

export function structuredCoachReviewToMarkdown(review, bookPassages) {
  const passageById = new Map(bookPassages.map((passage) => [passage.chunkId, passage]));
  const parts = [review.overview];
  for (const category of review.categories) {
    parts.push(`## ${category.label}\n\n${category.explanation}`);
    for (const reference of category.bookReferences) {
      const passage = passageById.get(reference.chunkId);
      if (!passage) continue;
      parts.push(
        `**${passage.title}${passage.chapterTitle ? ` — ${passage.chapterTitle}` : ""}:** ${reference.whyItMatters}`,
      );
    }
  }
  if (review.priorities.length) {
    parts.push(
      `## Priorities\n\n${review.priorities.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

export function buildCoachPositionRecords({ moves = [], scope = "whole-game", currentFen = "" }) {
  const candidates =
    scope === "position" || moves.length === 0
      ? [{ fen: currentFen, ply: null, kind: "current" }]
      : moves.flatMap((move) => [
          { fen: move.fenBefore, ply: Math.max(0, Number(move.ply) - 1), kind: "before" },
          { fen: move.fenAfter, ply: Number(move.ply), kind: "after" },
        ]);
  const seen = new Set();
  const positions = [];
  for (const candidate of candidates) {
    const fen = String(candidate.fen || "").trim();
    const key = normalizeFen(fen);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    positions.push({ ...candidate, fen, key });
  }
  return positions;
}

function abortError() {
  const error = new Error("The coach review was cancelled.");
  error.name = "AbortError";
  return error;
}

export async function collectPcCoachPositionEvaluations({
  positions,
  queryCloud,
  queryLive,
  signal,
  liveAttempts = 4,
  liveRetryDelayMs = 400,
  onProgress = () => {},
}) {
  const evaluations = new Map();
  const livePositions = [];
  let cloudHits = 0;
  for (const [index, position] of positions.entries()) {
    if (signal?.aborted) throw abortError();
    const evaluation = await queryCloud(position.fen, signal);
    if (evaluation) {
      evaluations.set(position.key, evaluation);
      cloudHits += 1;
    } else {
      livePositions.push(position);
    }
    onProgress({ phase: "cloud", completed: index + 1, total: positions.length });
  }

  let liveAnalyses = 0;
  if (livePositions.length > 0) {
    onProgress({ phase: "live", completed: 0, total: livePositions.length });
  }
  for (const [index, position] of livePositions.entries()) {
    if (signal?.aborted) throw abortError();
    let evaluation = null;
    let lastError = null;
    for (let attempt = 0; attempt < Math.max(1, liveAttempts) && !evaluation; attempt += 1) {
      try {
        evaluation = await queryLive(position.fen, signal);
      } catch (error) {
        if (signal?.aborted) throw abortError();
        lastError = error;
        if (attempt + 1 < Math.max(1, liveAttempts) && liveRetryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, liveRetryDelayMs));
          if (signal?.aborted) throw abortError();
        }
      }
    }
    if (!evaluation) {
      const error = new Error(
        `PC Stockfish could not analyze cache miss ${index + 1} of ${livePositions.length}: ${lastError?.message || "no evaluation was returned"}`,
      );
      error.position = position;
      throw error;
    }
    evaluations.set(position.key, evaluation);
    liveAnalyses += 1;
    onProgress({ phase: "live", completed: index + 1, total: livePositions.length });
  }
  return { evaluations, livePositions, cloudHits, liveAnalyses };
}

export function normalizeSavedWebCoachReview(value, expectedLineContextKey = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lineContextKey = String(value.lineContextKey || "").trim();
  const contextKey = String(value.contextKey || "").trim();
  const question = String(value.question || "").trim();
  const savedAt = Number(value.savedAt);
  if (
    value.version !== 1 ||
    !lineContextKey ||
    lineContextKey.length > 256 * 1024 ||
    (expectedLineContextKey && lineContextKey !== expectedLineContextKey) ||
    !contextKey ||
    contextKey.length > 384 * 1024 ||
    !question ||
    question.length > 16 * 1024 ||
    !Number.isFinite(savedAt) ||
    savedAt <= 0 ||
    (value.scope !== "position" && value.scope !== "whole-game") ||
    (value.playerColor !== "white" && value.playerColor !== "black") ||
    !value.response ||
    typeof value.response !== "object" ||
    Array.isArray(value.response)
  ) {
    return null;
  }
  return {
    version: 1,
    contextKey,
    lineContextKey,
    scope: value.scope,
    playerColor: value.playerColor,
    question,
    response: value.response,
    savedAt,
  };
}

export function normalizeWebCoachReviewStore(value) {
  const records =
    value?.version === 1 && value.records && typeof value.records === "object" ? value.records : {};
  return { version: 1, records: { ...records } };
}

export function normalizeCloudCoachEvaluation(payload, fen = "") {
  const pv = Array.isArray(payload?.pvs) ? payload.pvs[0] : null;
  if (!pv) return null;
  const whiteCp = Number.isFinite(pv.cp) ? Number(pv.cp) : null;
  const whiteMate = Number.isFinite(pv.mate) ? Number(pv.mate) : null;
  if (whiteCp === null && whiteMate === null) return null;
  return {
    fen: String(fen || payload?.fen || ""),
    source: "pc-cloud",
    depth: Number(payload?.depth) || null,
    nodes: Number.isFinite(Number(payload?.knodes)) ? Number(payload.knodes) * 1000 : null,
    nps: null,
    whiteCp,
    whiteMate,
    pvUci: String(pv.moves || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 16),
    terminal: false,
  };
}

export function parseStockfishCoachInfo(line, fen = "") {
  const text = String(line || "").trim();
  if (!text.startsWith("info ") || /\b(?:lowerbound|upperbound)\b/.test(text)) return null;
  const depthMatch = text.match(/\bdepth\s+(\d+)/);
  const multipvMatch = text.match(/\bmultipv\s+(\d+)/);
  const scoreMatch = text.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!depthMatch || !scoreMatch || Number(multipvMatch?.[1] || 1) !== 1) return null;
  const sideToMove =
    String(fen || "")
      .trim()
      .split(/\s+/)[1] === "b"
      ? "black"
      : "white";
  const sign = sideToMove === "black" ? -1 : 1;
  const rawScore = Number(scoreMatch[2]);
  const pvText = text.match(/\bpv\s+(.+)$/)?.[1] || "";
  if (!pvText.trim()) return null;
  return {
    fen: String(fen || ""),
    source: "pc-live",
    depth: Number(depthMatch[1]),
    nodes: Number(text.match(/\bnodes\s+(\d+)/)?.[1]) || null,
    nps: Number(text.match(/\bnps\s+(\d+)/)?.[1]) || null,
    whiteCp: scoreMatch[1] === "cp" ? rawScore * sign : null,
    whiteMate: scoreMatch[1] === "mate" ? rawScore * sign : null,
    pvUci: pvText.split(/\s+/).filter(Boolean).slice(0, 16),
    terminal: false,
  };
}

function evaluationToWhiteCp(evaluation) {
  if (!evaluation) return null;
  if (Number.isFinite(evaluation.whiteCp)) return Number(evaluation.whiteCp);
  if (Number.isFinite(evaluation.whiteMate)) {
    const mate = Number(evaluation.whiteMate);
    if (mate === 0) return 0;
    return Math.sign(mate) * Math.max(90000, 100000 - Math.min(9999, Math.abs(mate)));
  }
  return null;
}

function publicCoachEvaluation(evaluation) {
  if (!evaluation) return null;
  return {
    whiteCp: Number.isFinite(evaluation.whiteCp) ? Number(evaluation.whiteCp) : null,
    whiteMate: Number.isFinite(evaluation.whiteMate) ? Number(evaluation.whiteMate) : null,
    depth: Number(evaluation.depth) || null,
    source: String(evaluation.source || "pc"),
    nodes: Number.isFinite(evaluation.nodes) ? Number(evaluation.nodes) : null,
    pvUci: Array.isArray(evaluation.pvUci) ? evaluation.pvUci.slice(0, 12) : [],
    terminal: Boolean(evaluation.terminal),
  };
}

export function buildCoachMoveAnalysis(moves, evaluations, playerColor) {
  const selectedColor = playerColor === "black" ? "black" : "white";
  return (moves || []).map((move) => {
    const before = evaluations.get(normalizeFen(move.fenBefore)) || null;
    const after = evaluations.get(normalizeFen(move.fenAfter)) || null;
    const beforeCp = evaluationToWhiteCp(before);
    const afterCp = evaluationToWhiteCp(after);
    const moverLossCp =
      beforeCp === null || afterCp === null
        ? null
        : move.color === "black"
          ? afterCp - beforeCp
          : beforeCp - afterCp;
    return {
      ply: Number(move.ply),
      moveNumber: Math.ceil(Number(move.ply) / 2),
      color: move.color === "black" ? "black" : "white",
      san: String(move.san),
      uci: String(move.uci || ""),
      fenBefore: String(move.fenBefore),
      fenAfter: String(move.fenAfter),
      before: publicCoachEvaluation(before),
      after: publicCoachEvaluation(after),
      moverLossCp: moverLossCp === null ? null : Math.round(moverLossCp),
      playerLossCp:
        move.color === selectedColor && moverLossCp !== null ? Math.round(moverLossCp) : null,
      annotations: Array.isArray(move.annotations) ? move.annotations.slice(0, 8) : [],
    };
  });
}

export function buildPcCoachAnalysisResult({
  scope = "whole-game",
  currentFen = "",
  moves = [],
  positions = [],
  evaluations = new Map(),
  playerColor = "white",
  cloudHits = 0,
  liveAnalyses = 0,
  liveDepth = 18,
}) {
  const wholeGameMoveAnalysis = buildCoachMoveAnalysis(moves, evaluations, playerColor);
  const moveAnalysis =
    scope === "position"
      ? [
          {
            kind: "current-position",
            fen: currentFen,
            evaluation: publicCoachEvaluation(evaluations.get(normalizeFen(currentFen)) || null),
          },
        ]
      : wholeGameMoveAnalysis;
  const failed = positions.reduce(
    (count, position) => count + (evaluations.has(position.key) ? 0 : 1),
    0,
  );
  const analysisCoverage = {
    totalPositions: scope === "position" ? 1 : Math.max(1, moves.length + 1),
    uniquePositions: positions.length,
    cloudHits: Number(cloudHits) || 0,
    liveAnalyses: Number(liveAnalyses) || 0,
    failed,
    liveDepth: Number(liveDepth) || 18,
  };
  const selectedColor = playerColor === "black" ? "black" : "white";
  const criticalMoments = wholeGameMoveAnalysis
    .filter(
      (move) =>
        move.color === selectedColor &&
        Number.isFinite(move.playerLossCp) &&
        move.playerLossCp >= 20,
    )
    .sort((left, right) => right.playerLossCp - left.playerLossCp || left.ply - right.ply)
    .slice(0, 8)
    .map((move) => ({
      ply: move.ply,
      san: move.san,
      color: move.color,
      beforeCp: move.before?.whiteCp ?? 0,
      afterCp: move.after?.whiteCp ?? 0,
      lossCp: move.playerLossCp,
      depth: move.before?.depth ?? null,
      bestLineUci: move.before?.pvUci ?? [],
      replyLineUci: move.after?.pvUci ?? [],
    }));
  return {
    moveAnalysis,
    wholeGameMoveAnalysis,
    criticalMoments,
    analysisCoverage,
  };
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
        bestLineUci: String(before?.pvs?.[0]?.moves || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 10),
        replyLineUci: String(after?.pvs?.[0]?.moves || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 10),
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
          (passage) =>
            `Source ID: ${passage.chunkId || passage.title}\nTitle: ${passage.title}\nAuthor: ${passage.author}\nChapter: ${passage.chapterTitle || "Available excerpt"}\nCitation: ${passage.citation}\nPassage: ${passage.excerpt}`,
        )
        .join("\n\n")
    : "None retrieved. Do not invent a book citation.";
  const moments = criticalMoments.length
    ? JSON.stringify(criticalMoments, null, 2)
    : "No cache-backed whole-game critical moments were available.";
  const rootLines =
    Array.isArray(currentLines) && currentLines.length
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
- Use a retrieved principle only when relevant. Name the complete real book title and chapter immediately; never display a numbered placeholder such as “Book 3”. Paraphrase; do not reproduce long passages.
- Do not claim a book analysed this exact game unless the passage actually does.
- If the cache did not supply whole-game moments, say that limitation and restrict concrete engine claims to the current position.
- Keep the answer compact but instructive. Prefer **Direct answer**, **Critical moments**, **What to play instead**, and **Training lesson** when they help.

User question:
${String(question).slice(0, 2000)}

Player colour: ${playerColor}
Current FEN: ${String(currentFen).slice(0, 160)}

PGN:
${completeCoachPgn(pgn)}

Cache-backed critical moments:
${moments}

Current-position engine lines:
${rootLines}

Retrieved book passages:
${books}
`;
}

export function normalizeFen(fen) {
  return String(fen || "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
}

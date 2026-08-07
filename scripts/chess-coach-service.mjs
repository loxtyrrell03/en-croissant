import {
  deriveCoachReviewEvidence,
  formatCoachTraceForPrompt,
  formatDerivedSummaryForPrompt,
  formatKeyMomentsForPrompt,
  formatOpeningIdentificationForPrompt,
  materializeCoachSanLine,
} from "./chess-coach-derived.mjs";

const MAX_BOOK_PASSAGES = 6;
const MAX_EXCERPT_CHARACTERS = 2400;
export const MAX_COACH_MOVES = 4096;
export const MAX_COACH_PGN_CHARACTERS = 300_000;
export const MAX_STATS_AGGREGATE_BYTES = 200 * 1024;

export const DEFAULT_COACH_MODEL_SELECTION = Object.freeze({
  provider: "openai",
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
});

export const COACH_MODEL_OPTIONS = Object.freeze(
  [
    {
      provider: "openai",
      model: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      command: "codex",
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
    },
    {
      provider: "openai",
      model: "gpt-5.6-terra",
      label: "GPT-5.6 Terra",
      command: "codex",
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
    },
    {
      provider: "openai",
      model: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      command: "codex",
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
    },
    {
      provider: "gemini",
      model: "gemini-3.1-pro",
      label: "Gemini 3.1 Pro",
      command: "agy",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "high",
    },
    {
      provider: "gemini",
      model: "gemini-3.5-flash",
      label: "Gemini 3.5 Flash",
      command: "agy",
      reasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    },
    {
      provider: "gemini",
      model: "gemini-3.6-flash",
      label: "Gemini 3.6 Flash",
      command: "agy",
      reasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    },
  ].map((option) => Object.freeze(option)),
);

export function normalizeCoachModelSelection(model, reasoningEffort, { strict = true } = {}) {
  const requestedModel = String(model || DEFAULT_COACH_MODEL_SELECTION.model).trim();
  const option = COACH_MODEL_OPTIONS.find((candidate) => candidate.model === requestedModel);
  if (!option) {
    if (!strict) return { ...DEFAULT_COACH_MODEL_SELECTION };
    throw new Error(`Unsupported Coach model: ${requestedModel || "(empty)"}.`);
  }
  const requestedReasoning = String(reasoningEffort || option.defaultReasoningEffort).trim();
  if (!option.reasoningEfforts.includes(requestedReasoning)) {
    if (!strict) {
      return {
        provider: option.provider,
        model: option.model,
        reasoningEffort: option.defaultReasoningEffort,
      };
    }
    throw new Error(
      `${option.label} does not support ${requestedReasoning || "that"} reasoning. ` +
        `Choose ${option.reasoningEfforts.join(", ")}.`,
    );
  }
  return {
    provider: option.provider,
    model: option.model,
    reasoningEffort: requestedReasoning,
  };
}

const NUMBERED_BOOK_PLACEHOLDER = /\bbook\s*(?:(?:no\.?|number)\s*|#\s*)?\d+\b/i;

export const COACH_LIBRARY_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "openingClassification", "categories"],
  properties: {
    overview: { type: "string" },
    openingClassification: {
      type: "object",
      additionalProperties: false,
      required: [
        "relevant",
        "initialMoveOrder",
        "resultingFamily",
        "classificationPly",
        "transposition",
        "explanation",
      ],
      properties: {
        relevant: { type: "boolean" },
        initialMoveOrder: { type: "string" },
        resultingFamily: { type: "string" },
        classificationPly: {
          anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
        },
        transposition: { type: "boolean" },
        explanation: { type: "string" },
      },
    },
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
        required: [
          "id",
          "label",
          "summary",
          "explanation",
          "positions",
          "verifiedLines",
          "bookReferences",
        ],
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
          verifiedLines: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["startPly", "title", "purpose", "moves"],
              properties: {
                startPly: { type: "integer", minimum: 0 },
                title: { type: "string" },
                purpose: { type: "string" },
                moves: {
                  type: "array",
                  minItems: 1,
                  maxItems: 12,
                  items: { type: "string" },
                },
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

export const COACH_QUALITATIVE_PASS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "gameStory", "openingPlan", "phaseCommentary", "teachingPriorities"],
  properties: {
    overview: { type: "string" },
    gameStory: { type: "string" },
    openingPlan: {
      type: "object",
      additionalProperties: false,
      required: [
        "positionIdentity",
        "strategicStory",
        "plansForPlayer",
        "plansForOpponent",
        "piecePlacement",
        "pawnBreaks",
        "exchanges",
        "futureChecklist",
      ],
      properties: {
        positionIdentity: { type: "string" },
        strategicStory: { type: "string" },
        plansForPlayer: { type: "array", maxItems: 8, items: { type: "string" } },
        plansForOpponent: { type: "array", maxItems: 8, items: { type: "string" } },
        piecePlacement: { type: "array", maxItems: 10, items: { type: "string" } },
        pawnBreaks: { type: "array", maxItems: 8, items: { type: "string" } },
        exchanges: { type: "array", maxItems: 8, items: { type: "string" } },
        futureChecklist: { type: "array", maxItems: 8, items: { type: "string" } },
      },
    },
    phaseCommentary: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["phase", "summary", "keyPlies", "themes"],
        properties: {
          phase: { type: "string" },
          summary: { type: "string" },
          keyPlies: { type: "array", maxItems: 8, items: { type: "integer", minimum: 1 } },
          themes: { type: "array", maxItems: 8, items: { type: "string" } },
        },
      },
    },
    teachingPriorities: { type: "array", maxItems: 8, items: { type: "string" } },
  },
};

export const COACH_CATEGORY_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "summary", "explanation", "positions", "verifiedLines", "bookReferences"],
  properties: {
    id: { type: "string" },
    summary: { type: "string" },
    explanation: { type: "string" },
    positions: COACH_REVIEW_SCHEMA.properties.categories.items.properties.positions,
    verifiedLines: COACH_REVIEW_SCHEMA.properties.categories.items.properties.verifiedLines,
    bookReferences: COACH_REVIEW_SCHEMA.properties.categories.items.properties.bookReferences,
  },
};

export const STATS_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "strengths", "weaknesses", "focusAreas", "themes"],
  properties: {
    overview: { type: "string" },
    strengths: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    weaknesses: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    focusAreas: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "drill"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          drill: { type: "string" },
        },
      },
    },
    themes: {
      type: "array",
      minItems: 2,
      maxItems: 5,
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

export function classifyAgyAuthentication(exitCode, output = "") {
  const text = String(output || "").trim();
  if (exitCode === 0) {
    try {
      const payload = JSON.parse(text);
      if (payload?.status === "SUCCESS") {
        return { status: "authenticated", detail: "Antigravity usage status succeeded." };
      }
    } catch {
      // Fall through to the conservative output classifier.
    }
  }
  const detail = text.replace(/\s+/g, " ").slice(0, 1000);
  if (/not logged|not signed|authenticate|authentication|oauth/i.test(detail)) {
    return { status: "signed-out", detail: detail || "Antigravity reported a signed-out session." };
  }
  return {
    status: "unavailable",
    detail: detail || `Antigravity usage status exited with code ${String(exitCode)}.`,
  };
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
    if (error?.provider === "gemini") {
      if (/not signed|not logged|authenticate|oauth/i.test(message)) {
        return {
          status: 503,
          code,
          error: "Antigravity is installed but not signed in. Open Antigravity once and sign in.",
        };
      }
      if (/installed|command.*not found/i.test(message)) {
        return {
          status: 503,
          code,
          error: "The PC coach needs the Antigravity CLI installed for Gemini models.",
        };
      }
      return {
        status: 503,
        code,
        error: "The PC could not verify the Antigravity sign-in. Please try Check PC again.",
      };
    }
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
      error: "The gaming PC could not produce usable opening-boundary evidence. Please try again.",
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

export function probeAgyAuthentication({ spawnProcess, commandPath, cwd, env, timeoutMs = 25000 }) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawnProcess(commandPath, ["--print", "/usage", "--output-format", "json"], {
        cwd,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return resolvePromise({
        status: "unavailable",
        detail: `Antigravity usage status could not start: ${error?.message || error}`,
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
      if (output.length < 64 * 1024) output += String(chunk);
    };
    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    child.once("error", (error) =>
      finish({
        status: "unavailable",
        detail: `Antigravity usage status failed to start: ${error?.message || error}`,
      }),
    );
    child.once("exit", (code) => finish(classifyAgyAuthentication(code, output)));
    timeoutId = setTimeout(() => {
      child.kill();
      finish({
        status: "unavailable",
        detail: `Antigravity usage status timed out after ${timeoutMs} ms.`,
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

export function buildAgyPromptSchema(prompt, outputSchema = null) {
  const instructions = String(prompt || "");
  if (outputSchema && typeof outputSchema === "object" && !Array.isArray(outputSchema)) {
    const schema = JSON.parse(JSON.stringify(outputSchema));
    schema.description = [
      String(schema.description || "").trim(),
      "Complete chess-coaching instructions and evidence follow. Treat them as the user request. Do not call tools, inspect files, browse, or modify anything.",
      instructions,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { schema, unwrapAnswer: false };
  }
  return {
    schema: {
      type: "object",
      additionalProperties: false,
      description: [
        "Return the final answer to the complete chess-coaching request below. Do not call tools, inspect files, browse, or modify anything.",
        instructions,
      ].join("\n\n"),
      properties: {
        answer: {
          type: "string",
          description: "The requested final coaching or planner response.",
        },
      },
      required: ["answer"],
    },
    unwrapAnswer: true,
  };
}

export function buildAgyCoachInvocation({
  model,
  reasoningEffort,
  outputSchemaPath,
  timeoutMs = 190000,
}) {
  if (!outputSchemaPath) throw new Error("Antigravity Coach requires a prompt-bearing schema.");
  return {
    args: [
      "--model",
      model,
      "--effort",
      reasoningEffort,
      "--sandbox",
      "--disable-slash-commands",
      "--print-timeout",
      `${Math.max(30, Math.ceil(timeoutMs / 1000))}s`,
      "--output-format",
      "json",
      "--json-schema",
      String(outputSchemaPath),
      "--print",
      "Follow the complete chess-coaching request embedded in the supplied output schema description. Use only that evidence, do not call tools, and return the schema-conforming answer.",
    ],
    stdin: "",
  };
}

export function parseAgyCoachOutput(stdout, { unwrapAnswer = false } = {}) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || "").trim());
  } catch (error) {
    throw new Error(`Antigravity returned invalid JSON: ${error?.message || error}`);
  }
  if (payload?.status !== "SUCCESS") {
    throw new Error(String(payload?.error || "Antigravity did not complete the Coach request."));
  }
  let structured = payload?.structured_output;
  if (structured === undefined && typeof payload?.response === "string") {
    try {
      structured = JSON.parse(payload.response);
    } catch {
      structured = undefined;
    }
  }
  if (unwrapAnswer) {
    const answer = typeof structured?.answer === "string" ? structured.answer.trim() : "";
    if (!answer) throw new Error("Antigravity returned an empty Coach answer.");
    return answer;
  }
  if (structured !== undefined) return JSON.stringify(structured);
  const response = String(payload?.response || "").trim();
  if (!response) throw new Error("Antigravity returned an empty Coach answer.");
  return response;
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
  const modelSelection = normalizeCoachModelSelection(payload.model, payload.reasoningEffort);

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
    ...modelSelection,
    persistence,
  };
}

const STATS_TIME_CLASSES = new Set(["bullet", "blitz", "rapid", "classical", "daily"]);

export function normalizeStatsReportRequestPayload(payload, { createRequestId } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid stats-report request.");
  }
  const username = String(payload.username || "")
    .trim()
    .slice(0, 80);
  if (!username) throw new Error("A player username is required.");
  const timeClass = String(payload.timeClass || "")
    .trim()
    .toLowerCase();
  if (!STATS_TIME_CLASSES.has(timeClass)) {
    throw new Error("A valid time class is required.");
  }
  const aggregate = payload.aggregate;
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) {
    throw new Error("A stats aggregate object is required.");
  }
  const aggregateBytes = Buffer.byteLength(JSON.stringify(aggregate), "utf8");
  if (aggregateBytes > MAX_STATS_AGGREGATE_BYTES) {
    throw new Error(
      `The stats aggregate is too large (${aggregateBytes} bytes; maximum ${MAX_STATS_AGGREGATE_BYTES}).`,
    );
  }
  const fallbackRequestId =
    typeof createRequestId === "function"
      ? createRequestId()
      : `stats-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    requestId: /^[a-z0-9_-]{8,100}$/i.test(String(payload.requestId || ""))
      ? String(payload.requestId)
      : fallbackRequestId,
    periodLabel: oneLine(payload.periodLabel, 80) || "Recent games",
    source: payload.source === "lichess" ? "lichess" : "chesscom",
    username,
    timeClass,
    question: String(payload.question || "")
      .trim()
      .slice(0, 2000),
    aggregate,
  };
}

function statsFigure(value, digits = 0) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = parsed.toFixed(digits);
  return digits > 0 ? rounded.replace(/\.?0+$/, "") : rounded;
}

function statsSigned(value, digits = 0) {
  const figure = statsFigure(value, digits);
  if (figure === null) return null;
  return Number(value) >= 0 ? `+${figure}` : figure;
}

function statsPercent(value, digits = 0) {
  const figure = statsFigure(value, digits);
  return figure === null ? null : `${figure}%`;
}

function statsField(label, value) {
  return value === null || value === undefined || value === "" ? null : `${label}=${value}`;
}

function formatStatsStreak(streak) {
  const length = statsFigure(streak?.len);
  const type = oneLine(streak?.type, 8);
  if (length === null || !type) return null;
  const noun = Number(streak.len) === 1 ? type : type === "loss" ? "losses" : `${type}s`;
  return `${length} ${noun}`;
}

function statsLine(tag, fields) {
  const rendered = fields.filter((field) => field !== null);
  return rendered.length ? `${tag}|${rendered.join("|")}` : null;
}

function statsOpeningLines(tag, openings) {
  return (Array.isArray(openings) ? openings : [])
    .slice(0, 8)
    .map((opening) =>
      statsLine(tag, [
        oneLine(opening?.name, 80) || "Unknown opening",
        statsField("eco", oneLine(opening?.eco, 8)),
        statsField("games", statsFigure(opening?.games)),
        statsField(
          "record",
          Number.isFinite(Number(opening?.wins))
            ? `${statsFigure(opening?.wins)}W/${statsFigure(opening?.draws)}D/${statsFigure(opening?.losses)}L`
            : null,
        ),
        statsField("score", statsPercent(opening?.scorePct)),
      ]),
    );
}

export function formatStatsAggregateDigest(aggregate) {
  const record = aggregate?.record;
  const perf = aggregate?.perf;
  const rating = aggregate?.rating;
  const form = aggregate?.form;
  const time = aggregate?.time;
  const openings = aggregate?.openings;
  const mistakes = aggregate?.mistakes;
  const opponents = aggregate?.opponents;
  const providerQuality = aggregate?.providerQuality;
  const highlights = aggregate?.highlights;
  const patterns = aggregate?.patterns;
  const situations = mistakes?.situations;
  const comparisonPlayer = mistakes?.pairedPlayer || mistakes?.player;
  const lines = [
    statsLine("RECORD", [
      statsField("games", statsFigure(record?.games)),
      statsField("wins", statsFigure(record?.wins)),
      statsField("draws", statsFigure(record?.draws)),
      statsField("losses", statsFigure(record?.losses)),
      statsField("score", statsPercent(record?.scorePct)),
    ]),
    statsLine("PERFORMANCE", [
      statsField("perf", statsFigure(perf?.perf)),
      statsField("sd", statsFigure(perf?.sd)),
      Array.isArray(perf?.ci68)
        ? statsField("likely_range_68", `${statsFigure(perf.ci68[0])}-${statsFigure(perf.ci68[1])}`)
        : null,
      Array.isArray(perf?.ci95)
        ? statsField("range_95", `${statsFigure(perf.ci95[0])}-${statsFigure(perf.ci95[1])}`)
        : null,
      statsField("rated_opponents", statsFigure(perf?.gamesWithOpp)),
      statsField(
        "prob_above_current_rating",
        statsPercent(perf?.probAboveCurrent === null ? null : Number(perf?.probAboveCurrent) * 100),
      ),
    ]),
    statsLine("RATING", [
      statsField("start", statsFigure(rating?.start)),
      statsField("end", statsFigure(rating?.end)),
      statsField("delta", statsSigned(rating?.delta)),
    ]),
    statsLine("OPPONENTS", [
      statsField("games_with_ratings", statsFigure(opponents?.gamesWithOpponentRating)),
      statsField("coverage", statsPercent(opponents?.opponentRatingCoveragePct)),
      statsField("average_rating", statsFigure(opponents?.avgOpponentRating)),
      statsField("median_rating", statsFigure(opponents?.medianOpponentRating)),
      statsField(
        "rating_range",
        opponents?.minOpponentRating != null && opponents?.maxOpponentRating != null
          ? `${statsFigure(opponents.minOpponentRating)}-${statsFigure(opponents.maxOpponentRating)}`
          : null,
      ),
      statsField("average_rating_gap", statsSigned(opponents?.avgRatingGap)),
      statsField("actual_score", statsPercent(opponents?.scorePct)),
      statsField("elo_expected_score", statsPercent(opponents?.expectedScorePct)),
      statsField("score_minus_expected_pp", statsSigned(opponents?.scoreDeltaPct, 1)),
    ]),
    ...(Array.isArray(opponents?.bands) ? opponents.bands : [])
      .slice(0, 16)
      .map((band) =>
        statsLine("OPPONENT_BAND", [
          oneLine(band?.label, 24),
          band?.containsCurrentRating ? "contains_player_rating=true" : null,
          statsField("games", statsFigure(band?.games)),
          statsField("avg_opponent", statsFigure(band?.avgOpponentRating)),
          statsField("score", statsPercent(band?.scorePct)),
          statsField("expected", statsPercent(band?.expectedScorePct)),
          statsField("delta_pp", statsSigned(band?.scoreDeltaPct, 1)),
          statsField("analysis_coverage", statsPercent(band?.analysisCoveragePct)),
          statsField("your_mistakes_per_game", statsFigure(band?.mistakesPerAnalyzedGame, 2)),
          statsField(
            "opponent_mistakes_per_game",
            statsFigure(band?.opponentMistakesPerAnalyzedGame, 2),
          ),
          statsField("your_blunders_per_game", statsFigure(band?.blundersPerAnalyzedGame, 2)),
          statsField(
            "opponent_blunders_per_game",
            statsFigure(band?.opponentBlundersPerAnalyzedGame, 2),
          ),
          band?.providerQualityMethod
            ? statsField("provider_quality_source", oneLine(band.providerQualityMethod, 20))
            : null,
          statsField("provider_quality_games", statsFigure(band?.providerAnalyzedGames)),
          statsField(
            "provider_your_mistakes_per_game",
            statsFigure(band?.providerMistakesPerGame, 2),
          ),
          statsField(
            "provider_opponent_mistakes_per_game",
            statsFigure(band?.opponentProviderMistakesPerGame, 2),
          ),
          statsField(
            "provider_your_blunders_per_game",
            statsFigure(band?.providerBlundersPerGame, 2),
          ),
          statsField(
            "provider_opponent_blunders_per_game",
            statsFigure(band?.opponentProviderBlundersPerGame, 2),
          ),
        ]),
      ),
    statsLine("FORM", [
      statsField("trend_per_week", statsSigned(form?.slopePerWeek, 1)),
      form?.streak ? statsField("current_streak", formatStatsStreak(form.streak)) : null,
      statsField("sessions", statsFigure(form?.sessions)),
      statsField("net_rating_last_10_games", statsSigned(form?.net10)),
      form ? statsField("tilt_risk", form.tilt ? "YES" : "no") : null,
      statsField("latest_session_net", statsSigned(form?.latestSessionNet)),
      statsField("latest_session_games", statsFigure(form?.latestSessionGames)),
    ]),
    time
      ? statsLine("TIME", [
          statsField("avg_move_seconds", statsFigure(time.avgMoveSeconds, 1)),
          statsField("median_move_seconds", statsFigure(time.medianMoveSeconds, 1)),
          statsField("fast_moves", statsPercent(time.fastMovePct, 1)),
          statsField("scramble_moves_under_12pct_clock", statsPercent(time.scramblePct, 1)),
          statsField("timeout_losses", statsFigure(time.timeoutLosses)),
          statsField("timeout_share_of_losses", statsPercent(time.timeoutLossPct)),
          statsField("avg_clock_left_at_game_end", statsPercent(time.avgRemainingPctAtEnd)),
          statsField("avg_opening_move_seconds", statsFigure(time.byPhaseSeconds?.opening, 1)),
          statsField(
            "avg_middlegame_move_seconds",
            statsFigure(time.byPhaseSeconds?.middlegame, 1),
          ),
          statsField("avg_endgame_move_seconds", statsFigure(time.byPhaseSeconds?.endgame, 1)),
          statsField("games_with_clocks", statsFigure(time.gamesWithClocks)),
        ])
      : "TIME|no clock data in these games",
    ...["ahead", "even", "behind"].map((state) => {
      const bucket = time?.clockBalanceAtMove20?.[state];
      return bucket && Number(bucket.games) > 0
        ? statsLine("CLOCK_BALANCE_MOVE_20", [
            state,
            statsField("games", statsFigure(bucket.games)),
            statsField("score", statsPercent(bucket.scorePct, 1)),
          ])
        : null;
    }),
    ...(Array.isArray(time?.clockCurve) ? time.clockCurve : []).map((checkpoint) =>
      statsLine("CLOCK_REMAINING", [
        statsField("move", statsFigure(checkpoint?.move)),
        statsField("games", statsFigure(checkpoint?.games)),
        statsField("player", statsPercent(checkpoint?.playerRemainingPct, 1)),
        statsField("opponent", statsPercent(checkpoint?.opponentRemainingPct, 1)),
      ]),
    ),
    ...statsOpeningLines("OPENING_WHITE", openings?.white),
    ...statsOpeningLines("OPENING_BLACK", openings?.black),
    ...(openings?.best ? statsOpeningLines("OPENING_BEST", [openings.best]) : []),
    ...(openings?.worst ? statsOpeningLines("OPENING_WORST", [openings.worst]) : []),
    mistakes
      ? statsLine("MISTAKES", [
          statsField("analyzed_games", statsFigure(mistakes.analyzedGames)),
          statsField("paired_games", statsFigure(mistakes.pairedGames)),
          statsField("analysis_coverage", statsPercent(mistakes.analysisCoveragePct)),
          statsField("avg_accuracy", statsPercent(mistakes.avgAccuracy, 1)),
          statsField("avg_acpl", statsFigure(mistakes.avgAcpl, 1)),
          statsField("blunders_per_game", statsFigure(mistakes.blundersPerGame, 2)),
          statsField("mistakes_per_game", statsFigure(mistakes.mistakesPerGame, 2)),
          statsField("inaccuracies_per_game", statsFigure(mistakes.inaccuraciesPerGame, 2)),
        ])
      : "MISTAKES|no analyzed games in this period",
    comparisonPlayer
      ? statsLine("MOVE_QUALITY_PLAYER", [
          statsField("games", statsFigure(comparisonPlayer.games)),
          statsField("sample", mistakes?.pairedPlayer ? "paired" : "player_only"),
          statsField("accuracy", statsPercent(comparisonPlayer.avgAccuracy, 1)),
          statsField("acpl", statsFigure(comparisonPlayer.avgAcpl, 1)),
          statsField("inaccuracies_per_game", statsFigure(comparisonPlayer.inaccuraciesPerGame, 2)),
          statsField("mistakes_per_game", statsFigure(comparisonPlayer.mistakesPerGame, 2)),
          statsField("blunders_per_game", statsFigure(comparisonPlayer.blundersPerGame, 2)),
          statsField("errors_per_100_moves", statsFigure(comparisonPlayer.errorsPer100Moves, 2)),
          statsField("clean_games", statsPercent(comparisonPlayer.cleanGamePct, 1)),
        ])
      : null,
    mistakes?.opponents
      ? statsLine("MOVE_QUALITY_OPPONENTS_IN_THESE_GAMES", [
          statsField("games", statsFigure(mistakes.opponents.games)),
          statsField("accuracy", statsPercent(mistakes.opponents.avgAccuracy, 1)),
          statsField("acpl", statsFigure(mistakes.opponents.avgAcpl, 1)),
          statsField(
            "inaccuracies_per_game",
            statsFigure(mistakes.opponents.inaccuraciesPerGame, 2),
          ),
          statsField("mistakes_per_game", statsFigure(mistakes.opponents.mistakesPerGame, 2)),
          statsField("blunders_per_game", statsFigure(mistakes.opponents.blundersPerGame, 2)),
          statsField("errors_per_100_moves", statsFigure(mistakes.opponents.errorsPer100Moves, 2)),
          statsField("clean_games", statsPercent(mistakes.opponents.cleanGamePct, 1)),
        ])
      : null,
    mistakes?.peerBenchmark
      ? statsLine("ESTIMATED_RATING_BAND_MODEL", [
          oneLine(mistakes.peerBenchmark.ratingBandLabel, 24),
          statsField("matched_games", statsFigure(mistakes.peerBenchmark.samples)),
          statsField("expected_accuracy", statsPercent(mistakes.peerBenchmark.expectedAccuracy, 1)),
          statsField("expected_acpl", statsFigure(mistakes.peerBenchmark.expectedAcpl, 1)),
          statsField(
            "player_accuracy_delta_pp",
            statsSigned(mistakes.peerBenchmark.accuracyDelta, 1),
          ),
          statsField("player_acpl_delta", statsSigned(mistakes.peerBenchmark.acplDelta, 1)),
          "model_baseline_not_live_population=true",
        ])
      : null,
    providerQuality
      ? statsLine("PROVIDER_ACCURACY", [
          statsField("provider", oneLine(providerQuality.provider, 20)),
          statsField("player_samples", statsFigure(providerQuality.playerSamples)),
          statsField("opponent_samples", statsFigure(providerQuality.opponentSamples)),
          statsField("player_accuracy", statsPercent(providerQuality.avgPlayerAccuracy, 1)),
          statsField("opponent_accuracy", statsPercent(providerQuality.avgOpponentAccuracy, 1)),
          statsField("paired_delta_pp", statsSigned(providerQuality.accuracyDelta, 1)),
          statsField("player_acpl", statsFigure(providerQuality.avgPlayerAcpl, 1)),
          statsField("opponent_acpl", statsFigure(providerQuality.avgOpponentAcpl, 1)),
          statsField("player_error_samples", statsFigure(providerQuality.playerErrorSamples)),
          statsField(
            "player_mistakes_per_game",
            statsFigure(providerQuality.playerMistakesPerGame, 2),
          ),
          statsField(
            "player_blunders_per_game",
            statsFigure(providerQuality.playerBlundersPerGame, 2),
          ),
          statsField(
            "opponent_mistakes_per_game",
            statsFigure(providerQuality.opponentMistakesPerGame, 2),
          ),
          statsField(
            "opponent_blunders_per_game",
            statsFigure(providerQuality.opponentBlundersPerGame, 2),
          ),
          "separate_from_engine_accuracy=true",
        ])
      : null,
    mistakes
      ? statsLine("MISTAKES_BY_PHASE", [
          ...["opening", "middlegame", "endgame"].map((phase) => {
            const bucket = mistakes.byPhase?.[phase];
            if (!bucket) return null;
            const share = statsPercent(bucket.share === null ? null : Number(bucket.share) * 100);
            return statsField(
              phase,
              `${statsFigure(bucket.blunders)} blunders${share ? ` (${share})` : ""}`,
            );
          }),
        ])
      : null,
    ...["opening", "middlegame", "endgame"].map((phase) => {
      const quality = mistakes?.phaseQuality?.[phase];
      return quality
        ? statsLine("PHASE_QUALITY", [
            phase,
            statsField("moves", statsFigure(quality.moves)),
            statsField("accuracy", statsPercent(quality.avgAccuracy, 1)),
            statsField("acpl", statsFigure(quality.avgAcpl, 1)),
          ])
        : null;
    }),
    situations
      ? statsLine("POSITION_OUTCOMES", [
          statsField("analyzed_games", statsFigure(situations.games)),
          statsField("winning_positions_plus_3", statsFigure(situations.winningChances)),
          statsField("converted", statsFigure(situations.convertedWinningChances)),
          statsField("conversion", statsPercent(situations.conversionPct, 1)),
          statsField("losing_positions_minus_3", statsFigure(situations.losingChances)),
          statsField("saved", statsFigure(situations.savedLosingChances)),
          statsField("save_rate", statsPercent(situations.savePct, 1)),
          statsField(
            "average_eval_after_move_15",
            situations.avgMove15EvalCp == null
              ? null
              : statsSigned(Number(situations.avgMove15EvalCp) / 100, 2),
          ),
          statsField("opening_exit_win_chance", statsPercent(situations.avgOpeningExitWinPct, 1)),
        ])
      : null,
    ...["advantage", "defence", "balanced", "critical", "fast", "longThink", "timeTrouble"].map(
      (key) => {
        const bucket = situations?.[key];
        return bucket && Number(bucket.moves) > 0
          ? statsLine("DECISION_CONTEXT", [
              key,
              statsField("moves", statsFigure(bucket.moves)),
              statsField("accuracy", statsPercent(bucket.accuracy, 1)),
              statsField("errors", statsFigure(bucket.errors)),
              statsField("error_rate", statsPercent(bucket.errorPct, 1)),
            ])
          : null;
      },
    ),
    ...["better", "equal", "worse"].map((key) => {
      const bucket = situations?.endgames?.[key];
      return bucket && Number(bucket.games) > 0
        ? statsLine("ENDGAME_ENTRY", [
            key,
            statsField("games", statsFigure(bucket.games)),
            statsField("score", statsPercent(bucket.scorePct, 1)),
          ])
        : null;
    }),
    ...(Array.isArray(mistakes?.worstGames) ? mistakes.worstGames : [])
      .slice(0, 3)
      .map((worst) =>
        statsLine("WORST_ANALYZED_GAME", [
          statsField("opening", oneLine(worst?.entry?.openingName, 80)),
          statsField("accuracy", statsPercent(worst?.entry?.stats?.accuracy, 1)),
          statsField("blunders", statsFigure(worst?.entry?.counts?.blunder)),
          statsField("result", oneLine(worst?.entry?.result, 8)),
        ]),
      ),
    ...(Array.isArray(aggregate?.weekly) ? aggregate.weekly : [])
      .slice(0, 26)
      .map((week) =>
        statsLine("WEEK", [
          oneLine(week?.label, 40) || "Week",
          statsField("games", statsFigure(week?.games)),
          statsField("score", statsPercent(week?.scorePct)),
          statsField("perf", statsFigure(week?.perf)),
          statsField("rating_end", statsFigure(week?.ratingEnd)),
        ]),
      ),
    statsLine("HIGHLIGHTS", [
      highlights?.bestWin
        ? statsField(
            "best_win",
            `beat ${oneLine(highlights.bestWin.oppName, 40) || "unknown"}${
              statsFigure(highlights.bestWin.opp) ? ` (${statsFigure(highlights.bestWin.opp)})` : ""
            }`,
          )
        : null,
      statsField("longest_win_streak", statsFigure(highlights?.longestWinStreak)),
      highlights?.mostPlayedOpponent
        ? statsField(
            "most_played_opponent",
            `${oneLine(highlights.mostPlayedOpponent.name, 40)} - ${statsFigure(highlights.mostPlayedOpponent.games)} games - ${statsPercent(highlights.mostPlayedOpponent.scorePct)} score`,
          )
        : null,
      highlights?.worstLoss
        ? statsField(
            "lowest_rated_loss",
            `lost to ${oneLine(highlights.worstLoss.oppName, 40) || "unknown"}${
              statsFigure(highlights.worstLoss.opp)
                ? ` (${statsFigure(highlights.worstLoss.opp)})`
                : ""
            }`,
          )
        : null,
      statsField("upset_wins", statsFigure(highlights?.upsetWins)),
      statsField("upset_opportunities", statsFigure(highlights?.upsetOpportunities)),
      statsField("upset_win_rate", statsPercent(highlights?.upsetRatePct, 1)),
      statsField("post_loss_score", statsPercent(highlights?.postLossScorePct, 1)),
    ]),
    ...(Array.isArray(patterns?.byColor) ? patterns.byColor : []).map((pattern) =>
      statsLine("COLOR_PATTERN", [
        oneLine(pattern?.label, 20),
        statsField("games", statsFigure(pattern?.games)),
        statsField(
          "record",
          `${statsFigure(pattern?.wins)}W/${statsFigure(pattern?.draws)}D/${statsFigure(pattern?.losses)}L`,
        ),
        statsField("score", statsPercent(pattern?.scorePct, 1)),
      ]),
    ),
    ...(Array.isArray(patterns?.byWeekday) ? patterns.byWeekday : []).map((pattern) =>
      statsLine("WEEKDAY_PATTERN", [
        oneLine(pattern?.label, 20),
        statsField("games", statsFigure(pattern?.games)),
        statsField(
          "record",
          `${statsFigure(pattern?.wins)}W/${statsFigure(pattern?.draws)}D/${statsFigure(pattern?.losses)}L`,
        ),
        statsField("score", statsPercent(pattern?.scorePct, 1)),
      ]),
    ),
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildStatsReportPrompt({
  periodLabel,
  source,
  username,
  timeClass,
  question,
  aggregate,
}) {
  const sourceLabel = source === "lichess" ? "Lichess" : "Chess.com";
  return `Role: You are a personal chess coach writing a periodic performance report for ${oneLine(username, 80)}, who plays ${oneLine(timeClass, 20)} on ${sourceLabel}. The report covers the period ${oneLine(periodLabel, 80)}.

The digest below is the complete and authoritative set of facts about this player's period. Write a personalized coaching report grounded ONLY in these numbers.

Rules:
- Every claim must be grounded in the digest. Never invent a game, opening, number, or trend that is not listed there.
- Name the actual openings and cite the actual figures (records, percentages, rating points, seconds) from the digest.
- No generic chess advice. Delete any sentence that could appear unchanged in another player's report; each observation must reference the specific number or opening that motivated it.
- overview: 150-300 words of Markdown addressed directly to the player, summarizing how the period went, the headline numbers, and the single most important thing to fix.
- strengths and weaknesses: 2-4 each. The title is a short concrete claim; the detail cites the digest figures that prove it.
- focusAreas: 2-3, ordered by priority with the most important first. Each detail explains why this area costs the most points right now, and each drill is one concrete practice exercise the player can do this week, tied to that exact weakness (for example a specific opening to review, a time-management rule for the next 10 games, or an endgame drill).
- themes: 2-5 short strings naming recurring patterns across the period (for example "losses cluster in time scrambles" or "strong with White in the Italian").
- A line such as "TIME|no clock data" or "MISTAKES|no analyzed games" means that evidence is missing: say nothing about that area rather than speculating.
- Treat ESTIMATED_RATING_BAND_MODEL as a calibrated model baseline, never as a measured live peer percentile. When MOVE_QUALITY_PLAYER says sample=paired, it uses the exact same games as MOVE_QUALITY_OPPONENTS_IN_THESE_GAMES; sample=player_only means no direct opponent comparison is available. Provider accuracy uses a different formula and must not be blended with engine accuracy.
- Digest legend: scores/percentages are from the player's perspective; PERFORMANCE is an opponent-rating-based performance estimate with its likely range; OPPONENT_BAND delta is actual score minus Elo expectation in percentage points; FORM trend is rating points per week; errors are mistakes plus blunders; MISTAKES_BY_PHASE shares are the distribution of blunders across game phases; WEEK rows run oldest to newest.

Player's focus question: ${question ? oneLine(question, 2000) : "None. Cover whatever the numbers say matters most."}

Stats digest for ${oneLine(periodLabel, 80)}:
${formatStatsAggregateDigest(aggregate)}
`;
}

export function normalizeStatsReport(value) {
  const parsed = parseStructuredObject(value);
  const overview = cleanText(parsed.overview, 4000);
  if (!overview) throw new Error("The stats coach returned an empty overview.");
  const readSections = (rawSections, limit, withDrill) => {
    const sections = [];
    for (const raw of Array.isArray(rawSections) ? rawSections : []) {
      if (!raw || typeof raw !== "object" || sections.length >= limit) continue;
      const title = cleanText(raw.title, 160);
      const detail = cleanText(raw.detail, 1200);
      if (!title || !detail) continue;
      const drill = withDrill ? cleanText(raw.drill, 600) : "";
      sections.push(drill ? { title, detail, drill } : { title, detail });
    }
    return sections;
  };
  const strengths = readSections(parsed.strengths, 4, false);
  const weaknesses = readSections(parsed.weaknesses, 4, false);
  const focusAreas = readSections(parsed.focusAreas, 3, true);
  const themes = uniqueStrings(parsed.themes, null, 5).map((theme) => cleanText(theme, 160));
  if (strengths.length === 0 || weaknesses.length === 0 || focusAreas.length === 0) {
    throw new Error("The stats coach returned an incomplete report.");
  }
  return { overview, strengths, weaknesses, focusAreas, themes };
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

function openingLineMoves(database, lineId) {
  return database
    .prepare(
      `
      SELECT move_index, ply, san, uci, fen_before, fen_after,
             source_pdf_page, source_printed_page, source_chunk_id, confidence
      FROM opening_line_moves
      WHERE line_id=?
      ORDER BY move_index
      `,
    )
    .all(lineId)
    .map((move) => ({
      moveIndex: Number(move.move_index),
      ply: Number(move.ply),
      san: String(move.san),
      uci: String(move.uci),
      fenBefore: String(move.fen_before),
      fenAfter: String(move.fen_after),
      sourcePdfPage: Number(move.source_pdf_page),
      sourcePrintedPage:
        move.source_printed_page === null ? null : Number(move.source_printed_page),
      sourceChunkId: move.source_chunk_id ? String(move.source_chunk_id) : null,
      confidence: Number(move.confidence),
    }));
}

export function findExactOpeningBookMatches(database, moves, { limit = 18 } = {}) {
  const gameMoves = (Array.isArray(moves) ? moves : [])
    .map((move) => ({
      ply: Number(move?.ply),
      beforeKey: normalizeFen(move?.fenBefore),
      playedUci: String(move?.uci || "").toLowerCase(),
      san: String(move?.san || ""),
    }))
    .filter(
      (move) =>
        Number.isInteger(move.ply) && move.ply > 0 && move.beforeKey.split(/\s+/).length === 4,
    );
  if (gameMoves.length === 0) return [];
  const positionKeys = [...new Set(gameMoves.map((move) => move.beforeKey))];
  const gameMoveByPosition = new Map(gameMoves.map((move) => [move.beforeKey, move]));
  const gameUciByPly = new Map(gameMoves.map((move) => [move.ply, move.playedUci]));
  try {
    const rows = database
      .prepare(
        `
        SELECT
          move.line_id, move.move_index, move.ply AS book_ply, move.san AS book_san,
          move.uci AS book_uci, move.fen_before_key, move.source_chunk_id AS match_chunk_id,
          move.source_pdf_page, move.source_printed_page, move.confidence AS move_confidence,
          line.book_id, COALESCE(chunk.chapter_id, line.chapter_id) AS chapter_id,
          line.line_kind, line.pgn, line.uci_line, line.confidence,
          line.complete_game, line.source_chunk_id, line.move_count,
          book.title, book.author, COALESCE(book.shelf, '') AS shelf,
          COALESCE(chapter.title, '') AS chapter_title,
          COALESCE(chunk.citation, '') AS citation
        FROM opening_line_moves AS move
        JOIN opening_lines AS line ON line.line_id=move.line_id
        JOIN books AS book ON book.book_id=line.book_id
        LEFT JOIN chunks AS chunk ON chunk.chunk_id=COALESCE(move.source_chunk_id, line.source_chunk_id)
        LEFT JOIN chapters AS chapter
          ON chapter.chapter_id=COALESCE(chunk.chapter_id, line.chapter_id)
        WHERE move.fen_before_key IN (${positionKeys.map(() => "?").join(", ")})
        `,
      )
      .all(...positionKeys);
    const bestByLine = new Map();
    for (const row of rows) {
      const gameMove = gameMoveByPosition.get(String(row.fen_before_key));
      if (!gameMove) continue;
      const playedMoveMatched =
        Boolean(gameMove.playedUci) &&
        gameMove.playedUci === String(row.book_uci || "").toLowerCase();
      const bookUcis = String(row.uci_line || "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      let sharedForwardPlies = 0;
      while (
        bookUcis[Number(row.move_index) + sharedForwardPlies] &&
        bookUcis[Number(row.move_index) + sharedForwardPlies] ===
          gameUciByPly.get(gameMove.ply + sharedForwardPlies)
      ) {
        sharedForwardPlies += 1;
      }
      let sharedHistoryPlies = 0;
      while (
        Number(row.move_index) - sharedHistoryPlies - 1 >= 0 &&
        gameMove.ply - sharedHistoryPlies - 1 >= 1 &&
        bookUcis[Number(row.move_index) - sharedHistoryPlies - 1] ===
          gameUciByPly.get(gameMove.ply - sharedHistoryPlies - 1)
      ) {
        sharedHistoryPlies += 1;
      }
      const sharedPlies = sharedHistoryPlies + sharedForwardPlies;
      if (gameMoves.length > 1 && gameMove.ply === 1 && sharedPlies < 2) continue;
      if (!playedMoveMatched && sharedHistoryPlies < 2 && gameMove.ply < 5) continue;
      const shallowDivergence = !playedMoveMatched && gameMove.ply <= 4;
      const transposedPosition =
        gameMove.ply >= 5 && sharedHistoryPlies < Math.min(2, Math.max(0, gameMove.ply - 1));
      const score =
        (transposedPosition ? 3000 : playedMoveMatched ? 1200 : shallowDivergence ? 2500 : 2000) +
        Math.min(30, gameMove.ply) * 150 +
        sharedPlies * 100 +
        Number(row.book_ply || 0) +
        Math.min(40, Number(row.move_count || 0)) +
        Number(row.move_confidence || 0) * 10;
      const current = bestByLine.get(String(row.line_id));
      if (current && current.score >= score) continue;
      bestByLine.set(String(row.line_id), {
        row,
        gameMove,
        playedMoveMatched,
        sharedHistoryPlies,
        sharedForwardPlies,
        sharedPlies,
        score,
      });
    }
    const diverse = [];
    const seenTeachingPoints = new Set();
    const perBook = new Map();
    for (const candidate of [...bestByLine.values()].sort(
      (left, right) => right.score - left.score,
    )) {
      const signature = [
        candidate.row.book_id,
        String(candidate.row.chapter_title || candidate.row.chapter_id || "")
          .toLowerCase()
          .trim(),
        candidate.gameMove.ply,
        candidate.row.book_uci,
      ].join("|");
      const bookCount = perBook.get(String(candidate.row.book_id)) || 0;
      if (seenTeachingPoints.has(signature) || bookCount >= 3) continue;
      seenTeachingPoints.add(signature);
      perBook.set(String(candidate.row.book_id), bookCount + 1);
      diverse.push(candidate);
      if (diverse.length >= limit) break;
    }
    return diverse.map(
      ({
        row,
        gameMove,
        playedMoveMatched,
        sharedHistoryPlies,
        sharedForwardPlies,
        sharedPlies,
      }) => ({
        lineId: String(row.line_id),
        bookId: String(row.book_id),
        title: String(row.title),
        author: String(row.author),
        shelf: String(row.shelf),
        chapterId: row.chapter_id ? String(row.chapter_id) : null,
        chapterTitle: String(row.chapter_title),
        citation: String(row.citation) || `PDF page ${Number(row.source_pdf_page) || "unknown"}`,
        sourceChunkId: row.match_chunk_id
          ? String(row.match_chunk_id)
          : row.source_chunk_id
            ? String(row.source_chunk_id)
            : null,
        lineKind: String(row.line_kind),
        pgn: String(row.pgn),
        confidence: Number(row.confidence),
        completeGame: Boolean(row.complete_game),
        matchedGamePly: gameMove.ply,
        matchedBookMoveIndex: Number(row.move_index),
        matchedBookPly: Number(row.book_ply),
        playedSan: gameMove.san,
        playedUci: gameMove.playedUci,
        bookMoveSan: String(row.book_san),
        bookMoveUci: String(row.book_uci),
        playedMoveMatched,
        sharedHistoryPlies,
        sharedForwardPlies,
        sharedPlies,
        moves: openingLineMoves(database, String(row.line_id)),
      }),
    );
  } catch (error) {
    if (/no such table: opening_(?:lines|line_moves)/i.test(String(error?.message || error))) {
      return [];
    }
    throw error;
  }
}

export function pawnStructureKey(fen) {
  const boardField =
    String(fen || "")
      .trim()
      .split(/\s+/)[0] || "";
  const ranks = boardField.split("/");
  if (ranks.length !== 8) return "";
  let key = "";
  for (const rank of ranks) {
    let expanded = "";
    for (const character of rank) {
      if (/^[1-8]$/.test(character)) expanded += ".".repeat(Number(character));
      else expanded += character === "P" || character === "p" ? character : ".";
    }
    if (expanded.length !== 8) return "";
    key += expanded;
  }
  return key.length === 64 ? key : "";
}

export function findPawnStructureBookMatches(
  database,
  moves,
  { limit = 12, currentFen = "" } = {},
) {
  const positions = [];
  for (const move of Array.isArray(moves) ? moves : []) {
    const ply = Number(move?.ply);
    if (!Number.isInteger(ply) || ply < 1) continue;
    for (const [fen, positionPly] of [
      [move?.fenBefore, ply - 1],
      [move?.fenAfter, ply],
    ]) {
      const pawnKey = pawnStructureKey(fen);
      const pawnCount = (pawnKey.match(/[Pp]/g) || []).length;
      if (!pawnKey || pawnCount < 4 || positionPly < 2 || positionPly > 40) continue;
      positions.push({ fen: String(fen), pawnKey, positionPly });
    }
  }
  const currentFields = String(currentFen || "")
    .trim()
    .split(/\s+/);
  const fullmove = Number(currentFields[5]);
  const currentPositionPly =
    Number.isInteger(fullmove) && fullmove > 0
      ? (fullmove - 1) * 2 + (currentFields[1] === "b" ? 1 : 0)
      : 0;
  const currentPawnKey = pawnStructureKey(currentFen);
  const currentPawnCount = (currentPawnKey.match(/[Pp]/g) || []).length;
  if (
    currentPawnKey &&
    currentPawnCount >= 4 &&
    currentPositionPly >= 2 &&
    currentPositionPly <= 40
  ) {
    positions.push({
      fen: String(currentFen),
      pawnKey: currentPawnKey,
      positionPly: currentPositionPly,
    });
  }
  const deepestByKey = new Map();
  for (const position of positions) {
    const existing = deepestByKey.get(position.pawnKey);
    if (!existing || existing.positionPly < position.positionPly) {
      deepestByKey.set(position.pawnKey, position);
    }
  }
  if (deepestByKey.size === 0) return [];
  try {
    const keys = [...deepestByKey.keys()];
    const rows = database
      .prepare(
        `
        SELECT anchor.anchor_id, anchor.book_id, anchor.chapter_id,
               anchor.source_chunk_id, anchor.label, anchor.fen, anchor.pawn_key,
               anchor.source_order, anchor.confidence, book.title, book.author,
               COALESCE(book.shelf, '') AS shelf,
               COALESCE(chapter.title, anchor.label, '') AS chapter_title,
               COALESCE(chunk.citation, '') AS citation,
               COALESCE(chunk.text, '') AS excerpt
        FROM structure_anchors AS anchor
        JOIN books AS book ON book.book_id=anchor.book_id
        LEFT JOIN chapters AS chapter ON chapter.chapter_id=anchor.chapter_id
        LEFT JOIN chunks AS chunk ON chunk.chunk_id=anchor.source_chunk_id
        WHERE anchor.pawn_key IN (${keys.map(() => "?").join(", ")})
        `,
      )
      .all(...keys);
    const candidates = rows
      .map((row) => {
        const position = deepestByKey.get(String(row.pawn_key));
        return position
          ? {
              anchorId: String(row.anchor_id),
              bookId: String(row.book_id),
              title: String(row.title),
              author: String(row.author),
              shelf: String(row.shelf),
              chapterId: row.chapter_id ? String(row.chapter_id) : null,
              chapterTitle: String(row.chapter_title),
              sourceChunkId: row.source_chunk_id ? String(row.source_chunk_id) : null,
              citation: String(row.citation),
              label: String(row.label),
              matchedGamePly: position.positionPly,
              gameFen: position.fen,
              anchorFen: String(row.fen),
              pawnKey: String(row.pawn_key),
              confidence: Number(row.confidence),
              excerpt: String(row.excerpt).replace(/\s+/g, " ").trim().slice(0, 2400),
              score: position.positionPly * 100 + Number(row.confidence) * 20,
            }
          : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
    const selected = [];
    const seen = new Set();
    const perBook = new Map();
    for (const candidate of candidates) {
      const signature = `${candidate.bookId}|${candidate.chapterId || candidate.label}|${candidate.pawnKey}`;
      const bookCount = perBook.get(candidate.bookId) || 0;
      if (seen.has(signature) || bookCount >= 3) continue;
      seen.add(signature);
      perBook.set(candidate.bookId, bookCount + 1);
      const { score: _score, ...match } = candidate;
      selected.push(match);
      if (selected.length >= limit) break;
    }
    return selected;
  } catch (error) {
    if (/no such table: structure_anchors/i.test(String(error?.message || error))) return [];
    throw error;
  }
}

function formatPawnStructureMatches(matches) {
  if (!matches?.length) return "No exact pawn-structure plan chapter matched this game.";
  return matches
    .map(
      (match) =>
        `STRUCTURE_PLAN|book=${oneLine(match.bookId, 100)}|chapter=${oneLine(match.chapterId || "", 100)}|game_position_after_ply=${match.matchedGamePly}|label=${oneLine(match.label, 140)}|${oneLine(match.title)}|${oneLine(match.chapterTitle)}|${oneLine(match.citation, 180)}|PLAN_NOTE=${oneLine(match.excerpt, 2400)}`,
    )
    .join("\n");
}

function formatExactOpeningMatches(matches) {
  if (!matches?.length) return "No exact indexed book-line position matched this game.";
  return matches
    .map((match) => {
      const shallowDivergence = !match.playedMoveMatched && match.matchedGamePly <= 4;
      const relation = shallowDivergence
        ? "shallow_move_order_divergence"
        : match.sharedHistoryPlies < Math.min(2, Math.max(0, match.matchedGamePly - 1))
          ? "transposed_position"
          : match.playedMoveMatched
            ? "same_continuation"
            : "later_divergence";
      return `EXACT_LINE|relation=${relation}|book=${oneLine(match.bookId, 100)}|chapter=${oneLine(match.chapterId || "", 100)}|game_ply=${match.matchedGamePly}|book_ply=${match.matchedBookPly}|history_plies=${match.sharedHistoryPlies}|forward_plies=${match.sharedForwardPlies}|played=${oneLine(match.playedSan || match.playedUci, 30)}|book_move=${oneLine(match.bookMoveSan, 30)}|same_move=${match.playedMoveMatched ? "yes" : "no"}|${oneLine(match.title)}|${oneLine(match.chapterTitle)}|${oneLine(match.citation, 180)}|PGN=${oneLine(match.pgn, 1200)}`;
    })
    .join("\n");
}

export function buildGeminiQualitativePassPrompt({ question, pgn, playerColor, scope }) {
  return `Role: You are the first human-style chess coach in a multi-pass review.

Read the PGN as a strong coach would when first sitting down with the player. Produce the narrative spine, strategic interpretation, and practical teaching priorities that later specialist agents should follow.

Strict isolation rules:
- Your only chess evidence is the PGN printed below and the player's side. You have no engine output, no Stockfish, no cloud evaluations, no opening database, and no book excerpts.
- Do not guess numeric evaluations, engine best moves, forced wins, or tactical certainty. Phrase uncertain tactical observations as questions for a later evidence pass to verify.
- Do not write a move-by-move engine report. Explain the flow of the game, changes in plans, piece coordination, recurring decisions, and what a human player should learn.
- The openingPlan is future-facing. Its main question is not "what happened?" but "when I reach this kind of position again, where should my pieces go, which pawn breaks should I prepare, which exchanges help me, what is the opponent trying to do, and what should I check before choosing a move?"
- Be specific to the position reached in this PGN. If the opening name is uncertain or the game transposes, describe the pawn structure and piece placement instead of forcing a label.
- Use exact numbered game moves only when they are present in the PGN. Keep hypothetical continuations out of prose; later agents will build and legality-check board lines.

User question: ${oneLine(question, 2000)}
Player: ${playerColor}
Scope: ${scope}

PGN only:
${completeCoachPgn(pgn)}
`;
}

export function normalizeGeminiQualitativePass(value, moves = []) {
  const parsed = parseStructuredObject(value);
  const validPlies = new Set(
    (moves || []).map((move) => Number(move.ply)).filter(Number.isInteger),
  );
  const opening =
    parsed.openingPlan && typeof parsed.openingPlan === "object" ? parsed.openingPlan : {};
  const phaseCommentary = (Array.isArray(parsed.phaseCommentary) ? parsed.phaseCommentary : [])
    .slice(0, 5)
    .flatMap((phase) => {
      if (!phase || typeof phase !== "object") return [];
      const summary = cleanText(phase.summary, 2400);
      if (!summary) return [];
      return [
        {
          phase: oneLine(phase.phase, 80) || "Game phase",
          summary,
          keyPlies: [
            ...new Set(
              (Array.isArray(phase.keyPlies) ? phase.keyPlies : [])
                .map(Number)
                .filter((ply) => Number.isInteger(ply) && validPlies.has(ply)),
            ),
          ].slice(0, 8),
          themes: uniqueStrings(phase.themes, null, 8).map((theme) => oneLine(theme, 300)),
        },
      ];
    });
  const list = (candidate, limit = 8) =>
    uniqueStrings(candidate, null, limit).map((item) => cleanText(item, 600));
  const result = {
    overview: cleanText(parsed.overview, 3000),
    gameStory: cleanText(parsed.gameStory, 5000),
    openingPlan: {
      positionIdentity: cleanText(opening.positionIdentity, 1000),
      strategicStory: cleanText(opening.strategicStory, 2400),
      plansForPlayer: list(opening.plansForPlayer),
      plansForOpponent: list(opening.plansForOpponent),
      piecePlacement: list(opening.piecePlacement, 10),
      pawnBreaks: list(opening.pawnBreaks),
      exchanges: list(opening.exchanges),
      futureChecklist: list(opening.futureChecklist),
    },
    phaseCommentary,
    teachingPriorities: list(parsed.teachingPriorities),
  };
  if (!result.overview || !result.gameStory) {
    throw new Error("Gemini 3.1 Pro did not return a usable PGN-only coaching pass.");
  }
  return result;
}

export function buildCategorySpecialistPrompt({
  question,
  pgn,
  playerColor,
  category,
  qualitativePass,
  passages,
  moveAnalysis,
  derivedEvidence = null,
  moves = [],
}) {
  const isOpening = /opening|pawn structure|structure plan|repertoire|development/i.test(
    `${category.label} ${category.reason}`,
  );
  return `Role: You are one Gemini 3.6 Flash specialist in a multi-agent chess coaching team.

Draft only the category assigned to you. Gemini 3.1 Pro's PGN-only pass is the editorial spine: preserve its human explanation and priorities, then sharpen them with the scoped book passages and verified evidence below. Stockfish is a fact checker for concrete tactical/evaluation claims, not the organizing voice.

Category: ${category.label}
Category ID (copy exactly): ${category.id}
Why it was selected: ${category.reason}
Opening/structure specialist: ${isOpening ? "yes" : "no"}

Rules:
- Cite only supplied chunkIds and name the real book and chapter in prose.
- Use only exact numbered game moves from Allowed game moves. Do not invent a numbered move.
- Put every hypothetical continuation in verifiedLines, never loose in prose. Each line starts from the position after startPly (0 means the initial position) and contains SAN moves for deterministic legality checking.
- Return 1-3 short, useful verifiedLines. Prefer lines that visualize a plan, piece route, pawn break, or critical mechanism; avoid long engine dumps.
- positions may refer only to exact game plies and should explain why that position teaches this category.
- If concrete engine evidence conflicts with the qualitative pass, correct the concrete claim while keeping the useful human framing.
${
  isOpening
    ? "- At least 60% of this category must teach what to do in future positions of this type: the player's plan, opponent counterplay, ideal piece squares and routes, thematic breaks and their preparation, desirable exchanges, and an if-then checklist. Use this game only as the worked example; do not make retelling it the focus."
    : "- Teach a transferable decision process, using this game's positions as worked examples rather than merely recounting the moves."
}

User question: ${oneLine(question, 2000)}
Player: ${playerColor}
PGN:
${completeCoachPgn(pgn)}

Gemini 3.1 Pro PGN-only coaching pass:
${JSON.stringify(qualitativePass, null, 2)}

Allowed game moves:
${JSON.stringify(
  moves.map((move) => ({ ply: Number(move.ply), san: String(move.san || "") })),
  null,
  2,
)}

Verified opening-prefix engine trace (fact checking only):
${formatCoachTraceForPrompt(moveAnalysis, derivedEvidence)}

Derived key-moment facts:
${formatKeyMomentsForPrompt(derivedEvidence)}

Scoped book passages:
${JSON.stringify(
  passages.map((passage) => ({
    chunkId: passage.chunkId,
    title: passage.title,
    author: passage.author,
    chapterTitle: passage.chapterTitle,
    citation: passage.citation,
    excerpt: passage.excerpt,
    exactOpeningLines: (passage.openingLines || []).map((line) => ({
      pgn: line.pgn,
      matchedGamePly: line.matchedGamePly,
      playedSan: line.playedSan,
      bookMoveSan: line.bookMoveSan,
      playedMoveMatched: line.playedMoveMatched,
    })),
  })),
  null,
  2,
)}
`;
}

export function normalizeCategorySpecialistDraft(
  value,
  { category, permittedChunkIds = [], moves = [] },
) {
  const parsed = parseStructuredObject(value);
  const permitted = new Set(permittedChunkIds);
  const validPlies = new Set((moves || []).map((move) => Number(move.ply)));
  return {
    id: category.id,
    label: category.label,
    summary: cleanText(parsed.summary, 800),
    explanation: cleanText(parsed.explanation, 9000),
    positions: (Array.isArray(parsed.positions) ? parsed.positions : [])
      .filter((position) => validPlies.has(Number(position?.ply)))
      .slice(0, 8),
    verifiedLines: (Array.isArray(parsed.verifiedLines) ? parsed.verifiedLines : [])
      .filter((line) => line && typeof line === "object")
      .slice(0, 3)
      .map((line) => ({
        startPly: Number(line.startPly),
        title: cleanText(line.title, 180),
        purpose: cleanText(line.purpose, 1200),
        moves: (Array.isArray(line.moves) ? line.moves : [])
          .slice(0, 12)
          .map((move) => cleanText(move, 40))
          .filter(Boolean),
      })),
    bookReferences: (Array.isArray(parsed.bookReferences) ? parsed.bookReferences : [])
      .filter((reference) => permitted.has(String(reference?.chunkId || "")))
      .slice(0, 8),
  };
}

export function buildLibraryPlannerPrompt({
  question,
  pgn,
  playerColor,
  scope,
  currentFen,
  moveAnalysis,
  inventory,
  exactOpeningMatches = [],
  structureMatches = [],
  derivedEvidence = null,
  qualitativePass = null,
}) {
  return `Role: You are the chess-library editor and syllabus planner for a rigorous private coach.

You must decide which coaching categories are genuinely relevant to this specific game or position, then select the exact books and accessible chapters that the final coach should consult. The category names and their order are your decision; do not use a fixed checklist. Choose between one and six categories and omit aspects that have no useful lesson.

Evidence rules:
- Gemini 3.1 Pro's PGN-only coaching pass below is the editorial spine. Use its human story, opening-plan questions, and teaching priorities to decide what the library should support. It contains no engine or book evidence, so concrete claims still require the verified trace or retrieved sources.
- The PC Stockfish trace below intentionally covers only the contiguous cached opening through its first gap, plus at most one live boundary evaluation. It is authoritative only for positions actually present in that trace. Later moves in the PGN were deliberately not swept and are not engine evidence.
- Scores are White-relative. Each position records whether it came from the PC cloud store or a live PC search and its depth; treat small differences across unlike depths cautiously.
- A transposition-aware opening-family anchor computed from an exact position table may be supplied below. When present, refine it only to a more specific compatible sub-variation; never override the reached position with a label forced from the initial move order.
- If no deterministic identification matched, classify the opening from the deepest stable opening position, central pawn structure, and piece placement reached in the game—not from move one or the first book line that happens to match. Explicitly detect transpositions and name the resulting opening family.
- openingClassification is mandatory. Record the initial move order separately from the resulting family, identify the ply where the position's real opening identity became clear, and explain any transposition.
- A move such as 1.Nf3 does not make the resulting game a Réti. If White soon occupies the centre with d4/c4 or reaches a Queen's Gambit, Catalan, King's Indian, Grünfeld, or other mainline position by transposition, select the book/chapter for that resulting position.
- The derived key moments below carry an evidence-based tactical/positional/mixed assessment plus concrete SAN, mate, forcing-move, and material signals. Validate the label against those supplied facts and engine lines. Forced material loss or mate needs calculation/tactics material; a quiet concession with no tactical signal needs positional/strategic material. If the evidence is uncertain, select material that can teach both layers instead of forcing a false explanation.
- Judge which lessons matter by teaching value, not raw eval loss: a decisive swing in a holdable position outranks further losses in an already-lost position, and a motif repeated across several moves deserves one category with several keyPlies rather than scattered mentions.
- Select only IDs printed in the library inventory. A CHAPTER entry means its text is actually accessible in the lawful local corpus. Never invent an ID or select a table-of-contents-only chapter.
- Prefer exact chapter IDs over broad book IDs. Every category should have focused search queries that would find the most relevant page-bounded lesson inside the selected material.
- EXACT_LINE records are legality-checked, position-indexed lines recovered from installed book pages, but they are evidence for their listed position—not automatic labels for the whole opening. A shallow_move_order_divergence may describe only how the game left that repertoire and must not outrank a later transposed structure. A transposed_position is an exact position match reached by a different move order.
- STRUCTURE_PLAN records are deterministic matches on the complete White-and-Black pawn placement. Prefer their named plan chapter when the current pieces and move timing make its lesson applicable. They establish a strategic map, not a tactical verdict: validate every standard plan against the exact piece placement, whose move it is, and Stockfish evidence.
- Never call leaving an arbitrary repertoire a mistake, or imply that the player intended that repertoire. Only criticize a move when the PC evidence or a genuinely applicable resulting-position lesson supports the criticism.
- For an opening category, select books and chapters for resultingFamily. Use an initial move-order book only when its lesson remains relevant after the transposition. Prefer STRUCTURE_PLAN chapters and other material that teaches the reached structure's plans for both sides, ideal and misplaced pieces, thematic pawn breaks, useful and harmful exchanges, manoeuvres, and counterplay.
- Plan opening coverage before choosing variations. The final lesson should lead with the position's strategic map; use the shortest concrete line needed to prove or illustrate a plan, not as the outline of the explanation.
- For a whole-game review, include a plan-led opening category unless the PGN contains no discernible opening position or the user explicitly excludes the opening. The category must primarily answer what the player should do next time, not recap what they did this time.
- Give opening coverage materially more attention when the opening produced an instructive inaccuracy, unfamiliar structure, misplaced piece, missed break, or plan error. Tie it to exact move numbers and positions, not generic opening advice.
- Categories may be specific, for example “Dutch opening structure”, “Calculation at move 31”, “Rook endgame technique”, or “Defensive decision-making”. Choose the clearest short tab label.

User question: ${oneLine(question, 2000)}
Player: ${playerColor}
Scope: ${scope}
Current FEN: ${oneLine(currentFen, 180)}

PGN:
${completeCoachPgn(pgn)}

Gemini 3.1 Pro PGN-only coaching pass:
${qualitativePass ? JSON.stringify(qualitativePass, null, 2) : "Not available for this scope."}

Exact-position opening-family anchor (transposition-aware):
${formatOpeningIdentificationForPrompt(derivedEvidence?.openingIdentification)}

Derived review summary:
${formatDerivedSummaryForPrompt(derivedEvidence) || "No derived summary was computed."}

Key moments with derived tactical/positional evidence:
${formatKeyMomentsForPrompt(derivedEvidence)}

Fast opening-prefix PC analysis trace:
${formatCoachTraceForPrompt(moveAnalysis, derivedEvidence)}

Exact position matches in indexed opening-book lines:
${formatExactOpeningMatches(exactOpeningMatches)}

Exact pawn-structure matches in plan-led course chapters:
${formatPawnStructureMatches(structureMatches)}

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
  const rawOpening =
    parsed.openingClassification && typeof parsed.openingClassification === "object"
      ? parsed.openingClassification
      : {};
  const requestedClassificationPly = Number(rawOpening.classificationPly);
  const classificationPly =
    Number.isInteger(requestedClassificationPly) &&
    requestedClassificationPly > 0 &&
    (validPlies.size === 0 || validPlies.has(requestedClassificationPly))
      ? requestedClassificationPly
      : null;
  return {
    overview: oneLine(parsed.overview, 1600) || "The AI selected the most relevant lessons.",
    openingClassification: {
      relevant: rawOpening.relevant === true,
      initialMoveOrder: oneLine(rawOpening.initialMoveOrder, 300),
      resultingFamily: oneLine(rawOpening.resultingFamily, 300),
      classificationPly,
      transposition: rawOpening.transposition === true,
      explanation: oneLine(rawOpening.explanation, 1200),
    },
    categories,
  };
}

function passageFromRow(row) {
  const rawText = String(row.text);
  const sourcePage = rawText.match(/^Source page:\s*(https:\/\/\S+)\s*/i);
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
    excerpt: rawText
      .replace(/^Source page:\s*https:\/\/\S+\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_EXCERPT_CHARACTERS),
    localPath: String(row.local_path),
    sourceUrl: sourcePage ? sourcePage[1] : "",
    openingLines: [],
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

function passageRelevanceScore(row, category, exactOpeningMatches = [], structureMatches = []) {
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
  for (const match of exactOpeningMatches) {
    const shallowDivergence = !match.playedMoveMatched && match.matchedGamePly <= 4;
    if (shallowDivergence) continue;
    if (match.sourceChunkId && match.sourceChunkId === String(row.chunk_id)) score += 500;
    else if (
      match.chapterId &&
      match.chapterId === String(row.chapter_id) &&
      match.bookId === String(row.book_id)
    ) {
      score += 200;
    } else if (match.bookId === String(row.book_id)) {
      score += 40;
    }
  }
  for (const match of structureMatches) {
    if (match.sourceChunkId && match.sourceChunkId === String(row.chunk_id)) score += 700;
    else if (
      match.chapterId &&
      match.chapterId === String(row.chapter_id) &&
      match.bookId === String(row.book_id)
    ) {
      score += 300;
    } else if (match.bookId === String(row.book_id)) {
      score += 60;
    }
  }
  return score;
}

export function retrievePlannedBookPassages(
  database,
  plan,
  { perCategory = 3, totalLimit = 18, exactOpeningMatches = [], structureMatches = [] } = {},
) {
  const passageById = new Map();
  const categoryPassageIds = {};
  for (const category of plan.categories) {
    const candidates = getScopedPassageCandidates(database, category)
      .map((row) => ({
        row,
        score: passageRelevanceScore(row, category, exactOpeningMatches, structureMatches),
      }))
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
      passage.openingLines = exactOpeningMatches
        .filter(
          (match) =>
            match.sourceChunkId === passage.chunkId ||
            (match.bookId === passage.bookId &&
              (!match.chapterId || match.chapterId === String(row.chapter_id || ""))),
        )
        .slice(0, 3);
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
  derivedEvidence = null,
  exactOpeningMatches = [],
  structureMatches = [],
  qualitativePass = null,
  specialistDrafts = [],
  moves = [],
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
    exactOpeningLines: (passage.openingLines || []).map((line) => ({
      lineId: line.lineId,
      lineKind: line.lineKind,
      pgn: line.pgn,
      matchedGamePly: line.matchedGamePly,
      matchedBookPly: line.matchedBookPly,
      playedSan: line.playedSan,
      bookMoveSan: line.bookMoveSan,
      playedMoveMatched: line.playedMoveMatched,
      sharedPlies: line.sharedPlies,
      citation: line.citation,
    })),
  }));
  const plannedCategories = libraryPlan.categories.map((category) => ({
    ...category,
    availableChunkIds: categoryPassageIds[category.id] || [],
  }));
  const teamBrief = qualitativePass
    ? "Gemini 3.1 Pro has already produced a PGN-only human coaching pass without seeing Stockfish, cloud evaluations, databases, or books. Treat that pass as the editorial spine: its game story, strategic questions, and practical priorities should shape the review. Gemini 3.6 Flash specialists have independently drafted the selected categories. Your job is to edit their work into one coherent answer, not restart from an engine line."
    : "This is a targeted current-position review, so no whole-game qualitative or category-specialist pass was run. Build the answer directly from the supplied position, books, and verified evidence.";
  return `Role: You are a rigorous, practical chess coach writing a structured review for ${playerColor}.

${teamBrief}

The PC has read the contiguous cached opening through its first gap and checked at most that one boundary with live Stockfish. Later game positions were intentionally skipped for speed. Use this evidence as a concrete accuracy guardrail, not as the narrative outline.

Grounding rules:
- PC Stockfish is authoritative for evaluations, tactical claims, and better moves. Scores are White-relative. State the source/depth when it matters and avoid treating small cross-depth changes as exact.
- Preserve the Gemini 3.1 Pro pass's human explanation wherever evidence does not contradict it. If a concrete claim conflicts with verified evidence, correct that claim quietly while retaining the useful strategic framing.
- Treat only positions present in the opening-prefix trace as engine-verified. The rest of the PGN is game context, not a hidden full-game engine scan; never invent later evaluations, critical moments, or refutations.
- The supplied page-bounded book excerpts are authoritative for attributed lessons. Refer to books by their complete real title and chapter title in prose, never by a number such as “Book 3”.
- Every bookReferences.chunkId must exactly match a supplied chunkId available to that planned category. Never invent a title, author, chapter, page, quotation, chunk ID, evaluation, or line.
- Paraphrase source lessons. Do not reproduce long excerpts and do not claim an author analyzed this exact game.
- exactOpeningLines are legality-checked move trees recovered from the cited book pages. Use them for concrete comparison at matchedGamePly, including whether the player followed the cited continuation or diverged. Do not substitute an uncited database line.
- STRUCTURE_PLAN records are exact pawn-placement matches to plan-led course chapters. Treat them as the strategic default map, then test that map against this game's exact piece placement, tempi, move order, and engine evidence. State why a standard plan works now, needs preparation, or is wrong here.
- The exact-position opening-family anchor below controls the family actually reached; the plan's openingClassification may refine it to a compatible sub-variation. Do not rename a transposed d4/c4 position after an earlier 1.Nf3 repertoire, and do not portray departure from an arbitrary repertoire as an error.
- Every derived key moment carries an evidence-based nature assessment and concrete facts. Check the label against the supplied SAN lines: explain a tactical mistake tactically — quote the punishing line, name what it wins, and name the motif (loose piece, fork, pin, overloaded defender, back rank, mate net). Explain a positional mistake positionally — name the structural or planning cost (weak square, bad piece, lost tempo, wrong pawn break, king safety, worse endgame). Never explain a forced material loss in vague positional language. For mixed or low-confidence cases, explain both layers or resolve the uncertainty from the supplied engine lines; concrete engine facts always outrank the heuristic label.
- Quote engine variations using the SAN continuations supplied in the key moments verbatim. Do not re-derive, extend, or translate UCI yourself, and do not quote a line that is not supplied.
- Weigh lessons by the derived context flags: a decisiveSwing moment in a holdable position is the headline; alreadyLosing moments matter less; a missed-punishment motif means the player let the opponent's error go unpunished — say so plainly.
- Keep the AI-selected category IDs, labels, and order. Do not add a fixed generic section.
- Each category explanation should connect concrete positions to the human decision, the engine evidence, the better plan, and the cited teaching lesson.
- Use the matching Gemini 3.6 Flash specialist draft as the starting point for each category. Merge, shorten, and correct; do not flatten all specialists into the same engine-report voice.
- A position ply identifies the move just played: ply 1 is White's first move. Use only plies in the supplied trace.
- When an opening category was selected, lead with a plan-first strategic map before any variation: name the structure; give both sides' plans and counterplay; identify ideal and misplaced pieces; explain thematic breaks, exchanges, and manoeuvres; then show the smallest concrete line needed as proof or illustration. Do not narrate a book line move by move as the explanation.
- In an opening category, devote at least 60% of the explanation to future positions of this type: where the player's pieces belong and how they get there, which breaks to prepare and when, which exchanges help, what the opponent is trying to achieve, and a compact if-then checklist. This game is the worked example, not the subject of a move-by-move recap.
- Make that strategic map specific to the played position: identify the exact move/ply and current squares that make each standard plan viable, premature, or unavailable; say what the played move misunderstood and how the selected chapter applies. Compare against exact book lines only after the plan explanation, naming relevant follow/diverge plies without implying that repertoire departure is itself an error.
- Be personal and memorable, never generic: anchor every lesson to this game's exact squares, pieces, and move numbers, and give each key moment one short transferable takeaway phrased from this game (for example “the knight on d5 had no retreat once ...c6 came — check retreat squares before advancing”). Delete any sentence that could appear unchanged in a review of a different game.
- Use Markdown inside explanation fields sparingly. Do not put category headings inside them because the UI provides tabs.
- Keep overview to two or three short paragraphs: the human story and the main lesson, not an evaluation ledger.
- Every numbered move in prose must exactly match Allowed game moves. Put every hypothetical continuation in verifiedLines, never as loose SAN inside a paragraph. Each category needs 1-3 concise verifiedLines so every proposed move can be legality-checked and shown on a board.
- Answer the user's question directly in overview and finish with a short ordered priorities list. Each priority must name the habit to train, tie it to a move from this game, and give one concrete practice method.

User question: ${oneLine(question, 2000)}
Scope: ${scope}
Current FEN: ${oneLine(currentFen, 180)}

PGN:
${completeCoachPgn(pgn)}

Gemini 3.1 Pro PGN-only coaching pass (editorial spine, not concrete evidence):
${qualitativePass ? JSON.stringify(qualitativePass, null, 2) : "Not available for this scope."}

Allowed game moves:
${JSON.stringify(
  moves.map((move) => ({ ply: Number(move.ply), san: String(move.san || "") })),
  null,
  2,
)}

PC analysis coverage:
${JSON.stringify(analysisCoverage, null, 2)}

Exact-position opening-family anchor (transposition-aware):
${formatOpeningIdentificationForPrompt(derivedEvidence?.openingIdentification)}

Derived review summary:
${formatDerivedSummaryForPrompt(derivedEvidence) || "No derived summary was computed."}

Key moments with derived tactical/positional evidence (SAN lines here are the quotable engine lines):
${formatKeyMomentsForPrompt(derivedEvidence)}

Fast opening-prefix PC trace:
${formatCoachTraceForPrompt(moveAnalysis, derivedEvidence)}

Exact position matches in indexed opening-book lines:
${formatExactOpeningMatches(exactOpeningMatches)}

Exact pawn-structure matches in plan-led course chapters:
${formatPawnStructureMatches(structureMatches)}

AI-selected library plan:
${JSON.stringify(
  {
    overview: libraryPlan.overview,
    openingClassification: libraryPlan.openingClassification,
    categories: plannedCategories,
  },
  null,
  2,
)}

Gemini 3.6 Flash category specialist drafts:
${specialistDrafts.length ? JSON.stringify(specialistDrafts, null, 2) : "No specialist draft was available; write from the other supplied evidence."}

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

const NUMBERED_SAN_REFERENCE =
  /(^|[\s([{"'“])(\d{1,3})(\.(?:\.\.)?|…)\s*((?:O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)[!?]{0,2})/g;

function normalizedReferencedSan(value) {
  return String(value || "")
    .replace(/[!?]+$/g, "")
    .replaceAll("0-0-0", "O-O-O")
    .replaceAll("0-0", "O-O");
}

export function assertNumberedGameMovesAreExact(value, moves = []) {
  const moveByPly = new Map((moves || []).map((move) => [Number(move.ply), move]));
  const visit = (candidate) => {
    if (typeof candidate === "string") {
      NUMBERED_SAN_REFERENCE.lastIndex = 0;
      let match;
      while ((match = NUMBERED_SAN_REFERENCE.exec(candidate))) {
        const moveNumber = Number(match[2]);
        const blackMove = match[3] === "..." || match[3] === "…";
        const ply = (moveNumber - 1) * 2 + (blackMove ? 2 : 1);
        const expected = moveByPly.get(ply);
        const referencedSan = normalizedReferencedSan(match[4]);
        if (!expected || normalizedReferencedSan(expected.san) !== referencedSan) {
          throw new Error(
            expected
              ? "The coach referenced " +
                  moveNumber +
                  (blackMove ? "..." : ".") +
                  referencedSan +
                  ", but the exact game move is " +
                  expected.san +
                  "."
              : "The coach referenced a move outside the supplied game at move " + moveNumber + ".",
          );
        }
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (candidate && typeof candidate === "object") {
      for (const [key, item] of Object.entries(candidate)) {
        if (key !== "verifiedLines" && key !== "moves") visit(item);
      }
    }
  };
  visit(value);
  return value;
}

function normalizeVerifiedCoachLines(rawLines, moves, currentFen, categoryLabel) {
  const moveByPly = new Map((moves || []).map((move) => [Number(move.ply), move]));
  const rootFen = String(moves?.[0]?.fenBefore || currentFen || "").trim();
  const lines = [];
  let invalid = 0;
  for (const raw of Array.isArray(rawLines) ? rawLines : []) {
    if (!raw || typeof raw !== "object" || lines.length >= 3) continue;
    const startPly = Number(raw.startPly);
    if (!Number.isInteger(startPly) || startPly < 0) {
      invalid += 1;
      continue;
    }
    const startFen =
      startPly === 0 ? rootFen : String(moveByPly.get(startPly)?.fenAfter || "").trim();
    const materialized = materializeCoachSanLine(startFen, raw.moves, 12);
    if (!startFen || !materialized) {
      invalid += 1;
      continue;
    }
    lines.push({
      startPly,
      title: cleanText(raw.title, 180) || "Plan on the board",
      purpose: cleanText(raw.purpose, 1200),
      startFen,
      moves: materialized.moves,
    });
  }
  if (lines.length === 0) {
    throw new Error(
      invalid > 0
        ? "The move-verification pass rejected every proposed line for " + categoryLabel + "."
        : "The coach omitted a board-ready line for " + categoryLabel + ".",
    );
  }
  return lines;
}

export function normalizeStructuredCoachReview(
  value,
  { libraryPlan, bookPassages, moves = [], currentFen = "", categoryPassageIds = {} },
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
    const verifiedLines = normalizeVerifiedCoachLines(
      raw.verifiedLines,
      moves,
      currentFen,
      planned.label,
    );
    categories.push({
      id: planned.id,
      label: planned.label,
      summary: cleanText(raw.summary, 500) || planned.reason,
      explanation: cleanText(raw.explanation, 8000),
      positions,
      verifiedLines,
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
  assertNoNumberedBookPlaceholders(review);
  return assertNumberedGameMovesAreExact(review, moves);
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
  stopAfterFirstCloudMiss = false,
  allowLiveFailure = false,
  onProgress = () => {},
}) {
  const evaluations = new Map();
  const livePositions = [];
  const checkedPositions = [];
  let cloudHits = 0;
  let stoppedAtCloudBoundary = false;
  let boundaryPly = null;
  for (const [index, position] of positions.entries()) {
    if (signal?.aborted) throw abortError();
    const evaluation = await queryCloud(position.fen, signal);
    checkedPositions.push(position);
    if (evaluation) {
      evaluations.set(position.key, evaluation);
      cloudHits += 1;
    } else {
      livePositions.push(position);
      if (stopAfterFirstCloudMiss) {
        stoppedAtCloudBoundary = true;
        boundaryPly = Number.isFinite(Number(position.ply)) ? Number(position.ply) : null;
      }
    }
    onProgress({ phase: "cloud", completed: index + 1, total: positions.length });
    if (stoppedAtCloudBoundary) break;
  }

  let liveAnalyses = 0;
  let liveFailures = 0;
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
      liveFailures += 1;
      if (allowLiveFailure) {
        onProgress({ phase: "live", completed: index + 1, total: livePositions.length });
        continue;
      }
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
  const evaluatedPositions = checkedPositions.filter((position) => evaluations.has(position.key));
  return {
    evaluations,
    evaluatedPositions,
    checkedPositions,
    livePositions,
    cloudHits,
    liveAnalyses,
    liveFailures,
    stoppedAtCloudBoundary,
    boundaryPly,
    skippedPositions: Math.max(0, positions.length - evaluatedPositions.length),
  };
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
  totalPositions = null,
  skippedPositions = 0,
  stoppedAtCloudBoundary = false,
  boundaryPly = null,
  openingBook = null,
}) {
  const allMoveAnalysis = buildCoachMoveAnalysis(moves, evaluations, playerColor);
  const firstUnverifiedMove = allMoveAnalysis.findIndex((move) => !move.before || !move.after);
  const wholeGameMoveAnalysis =
    firstUnverifiedMove < 0 ? allMoveAnalysis : allMoveAnalysis.slice(0, firstUnverifiedMove);
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
    totalPositions:
      Number.isFinite(Number(totalPositions)) && Number(totalPositions) > 0
        ? Number(totalPositions)
        : scope === "position"
          ? 1
          : Math.max(1, moves.length + 1),
    uniquePositions: positions.length,
    cloudHits: Number(cloudHits) || 0,
    liveAnalyses: Number(liveAnalyses) || 0,
    failed,
    liveDepth: Number(liveDepth) || 18,
    skippedPositions: Math.max(0, Number(skippedPositions) || 0),
    stoppedAtCloudBoundary: Boolean(stoppedAtCloudBoundary),
    boundaryPly:
      boundaryPly !== null && boundaryPly !== undefined && Number.isFinite(Number(boundaryPly))
        ? Number(boundaryPly)
        : null,
    complete: failed === 0 && Math.max(0, Number(skippedPositions) || 0) === 0,
  };
  const selectedColor = playerColor === "black" ? "black" : "white";
  const derived = deriveCoachReviewEvidence({
    moveAnalysis: wholeGameMoveAnalysis,
    playerColor: selectedColor,
    scope,
    currentFen,
    openingBook,
  });
  const derivedByPly = new Map((derived?.moves || []).map((entry) => [entry.ply, entry]));
  const criticalMoments = wholeGameMoveAnalysis
    .filter((move) => {
      if (move.color !== selectedColor) return false;
      const winProbLoss = derivedByPly.get(move.ply)?.winProbLoss;
      return (
        (Number.isFinite(move.playerLossCp) && move.playerLossCp >= 20) ||
        (Number.isFinite(winProbLoss) && winProbLoss >= 8)
      );
    })
    .sort((left, right) => {
      const leftWinProbLoss = derivedByPly.get(left.ply)?.winProbLoss ?? -1;
      const rightWinProbLoss = derivedByPly.get(right.ply)?.winProbLoss ?? -1;
      return (
        rightWinProbLoss - leftWinProbLoss ||
        (right.playerLossCp ?? 0) - (left.playerLossCp ?? 0) ||
        left.ply - right.ply
      );
    })
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
      winProbLoss: derivedByPly.get(move.ply)?.winProbLoss ?? null,
      severity: derivedByPly.get(move.ply)?.severity ?? null,
    }));
  return {
    moveAnalysis,
    wholeGameMoveAnalysis,
    criticalMoments,
    analysisCoverage,
    derived,
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
    : "No cache-backed opening-prefix critical moments were available.";
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
- For a whole-game review, prioritize any supplied opening-prefix critical moments. Explain the human mechanism, the engine proof, what to play instead, and one training lesson. Do not pretend later moves were engine-checked.
- A positive White-relative centipawn score favours White; a negative score favours Black. lossCp is already measured as damage to ${playerColor}.
- UCI engine lines are evidence. Do not silently convert them to SAN unless certain; it is acceptable to show short UCI evidence as supplied.
- Never invent an evaluation, move line, title, author, page, quotation, or citation.
- Use a retrieved principle only when relevant. Name the complete real book title and chapter immediately; never display a numbered placeholder such as “Book 3”. Paraphrase; do not reproduce long passages.
- Do not claim a book analysed this exact game unless the passage actually does.
- For an opening explanation, lead with the reached structure's plans for both sides, piece placement, thematic breaks, exchanges, and counterplay. Tie each plan to the exact pieces and squares in this position, and use concrete variations only as short proof or illustration.
- If the opening cache did not supply a relevant moment, say that limitation and restrict concrete engine claims to supplied positions.
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

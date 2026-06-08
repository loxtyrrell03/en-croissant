import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const MODEL = process.env.COACH_EVAL_MODEL ?? "gemini-3.1-pro-preview";
const GEMINI =
  process.env.COACH_EVAL_COMMAND ??
  (process.platform === "win32" && process.env.APPDATA
    ? `${process.env.APPDATA}\\npm\\gemini.cmd`
    : "gemini");
const OUT_DIR = "tmp/coach-style-eval";

const coachRs = await readFile("src-tauri/src/coach.rs", "utf8");
const styleGuide =
  coachRs.match(/const COACH_STYLE_GUIDE: &str = r#"([\s\S]*?)"#;/)?.[1] ??
  "Explain chess concepts first, then use engine evidence as proof.";

const cases = [
  {
    id: "practical-counterplay-choice",
    source:
      "0041 Jonathan Rubeck vs Lachlan: annotation compared engine-best Bxh3 with practical b5 that kills d5/f5 counterplay.",
    question: "Why might b5 be the right practical choice even if Bxh3 is the top engine move?",
    evidence: [
      "Root line 1: Bxh3, eval -3.25 depth 17: Bxh3 Nxe5 Qg5 Nf3+ Qxf3. Black is objectively winning, but White gets activity on d5/f5 and the bishop pair in a more open position.",
      "Root line 2: b5, eval -3.03 depth 17: b5 axb5 axb5. Black forces trades, creates an e6 pawn that controls d5/f5, and greatly reduces White's knight counterplay.",
      "Private board facts: both moves are legal; after b5 the e6 pawn controls d5 and f5; after Bxh3 White's knight can use e5/d5/f5 routes in the supplied line.",
    ],
    must: ["counterplay", "d5", "f5", "practical", "trade"],
    nice: ["bishop pair", "messy", "risk", "calculate"],
  },
  {
    id: "tempo-pressure-f2",
    source:
      "Kam Choo yin vs Lachlan: annotation says immediate fxe4 wins a tempo for Ng4, threatens Nxf2/Bb6, and f2 pressure is too much.",
    question: "What is the point of the immediate fxe4 here?",
    evidence: [
      "Targeted line: fxe4, eval -1.10 depth 17: fxe4 dxe4 Ng4. Black wins a tempo for Ng4.",
      "Targeted continuation: fxe4 dxe4 Ng4 h3 Nxf2 Rxf2 Bb6. The pressure on f2 overloads White's rook and king-side defenders.",
      "Private board facts: Ng4 attacks f2; Bb6 pins the rook on f2 in the supplied continuation.",
    ],
    must: ["tempo", "Ng4", "f2", "Bb6", "pin"],
    nice: ["pressure", "overload", "rook"],
  },
  {
    id: "defended-queen-blunder-check",
    source:
      "Welsh Open Dale Westcott game: annotation says the planned Nd4 follow-up failed because the queen was defended; trust positional instinct but verify tactics.",
    question: "Why was my planned Nd4 follow-up not working, and what should I learn?",
    evidence: [
      "Targeted line after Nd4: Nd4, eval -1.22 depth 17: Nd4 Qxd4. The queen is defended, so Black does not win it.",
      "Better line: Qc4, eval +0.70 depth 17: Qc4 Be5 f4. White threatens g3 to win the bishop and can deflect the queen from f7 after Bxf4.",
      "Private board facts: the queen on d4 is defended in the Nd4 line; Qc4 creates a threat of g3 against the bishop.",
    ],
    must: [
      "queen",
      ["defended", "not actually loose", "defender"],
      "Nd4",
      "Qc4",
      ["verify", "verification"],
    ],
    nice: ["CCT", "candidate", "positional instinct", "deflect"],
  },
  {
    id: "rushed-break-keep-tension",
    source:
      "Jia Arn Yeung game: annotation says a thematic central break was rushed; keep tension/Ne4 clamp instead of forcing because opponent was underestimated.",
    question: "What was wrong with my thematic central break, and what was the better plan?",
    evidence: [
      "Played break line: exd5, eval +0.02 depth 17: exd5 c5. Black equalises comfortably and forces trades.",
      "Better line: Ne4, eval +0.55 depth 17: Ne4. White keeps central tension, creates a clamp, and Black cannot easily remove the pawn without concessions.",
      "Private board facts: after exd5 c5 the centre opens and pieces trade; after Ne4 White keeps the clamp and the bishop pair remains active.",
    ],
    must: ["tension", "c5", "equalises", "Ne4", "clamp"],
    nice: ["rushed", "thematic", "force", "trades"],
  },
  {
    id: "fortress-candidate-expansion",
    source:
      "Jia Arn Yeung endgame: annotation says Ka1 held a fortress; only looking at bishop moves missed candidate expansion and endgame fortress theme.",
    question: "What should I train from this endgame miss?",
    evidence: [
      "Mistake line: bishop move, eval -5.26 depth 17: Bf3 Kd4. Black releases the knight and wins.",
      "Holding line: Ka1, eval -0.04 depth 17: Ka1. White shuffles the king; if the kingside liquidates and White gives the bishop for a pawn, the remaining setup is a fortress.",
      "Private board facts: Ka1 is legal; the bishop-only candidate set misses the king-shuffle defensive resource.",
    ],
    must: ["Ka1", "fortress", "candidate", "king", "bishop"],
    nice: ["shuffle", "endgame", "defensive resource", "train"],
  },
  {
    id: "piece-trade-outpost-quality",
    source:
      "Steve Cunliffe game: annotation says trading knight for bishop was wrong because the knight had future outposts while the bishop targeted little.",
    question: "Why was trading the knight for the bishop a strategic mistake?",
    evidence: [
      "Played trade line: Nxb5 axb5, eval -0.25 depth 17. White gives up the knight and Black keeps a stable structure.",
      "Better plan: h4, eval +0.35 depth 17. White keeps the knight, prepares slow improvement, and preserves access to central and kingside outposts.",
      "Private board facts: the knight has routes to e3/f5/d5; the bishop being captured is not attacking an important target.",
    ],
    must: ["knight", "bishop", "outpost", "h4", "trade"],
    nice: ["potential", "slow", "target", "strategic"],
  },
  {
    id: "pawn-break-deflection-backward-pawn",
    source:
      "Russel Dodington game: annotation says immediate c5 is thematic; Bxf6 deflects the knight and Rxc5 pressures the backward c7 pawn.",
    question: "Why is c5 the move in this structure even if it looks like Black wins a pawn?",
    evidence: [
      "Candidate line: c5, eval +0.70 depth 17: c5 dxc5 Bxf6. White uses an in-between capture to deflect the knight.",
      "Continuation: c5 dxc5 Bxf6 Qxf6 Rxc5. White recovers the pawn and adds pressure to the backward c7 pawn.",
      "Private board facts: Bxf6 removes the knight defender; after Rxc5 the rook attacks c7.",
    ],
    must: ["c5", "Bxf6", "deflect", "Rxc5", "c7"],
    nice: ["backward", "in-between", "structure", "pawn break"],
  },
  {
    id: "future-pin-prophylaxis",
    source:
      "Lucas Zheng game: annotation says Qb8 prepares b5 and Ba6 pin/skewer after queenside opens; Qc2 avoids the potential pin.",
    question: "Why was Qc2 a better prophylactic move here?",
    evidence: [
      "Black resource: Qb8, eval equal depth 17, preparing the b5 pawn break.",
      "If White ignores it: Qb8 Rc1 b5 axb5 axb5. Once the queenside opens, Ba6 creates a pin/skewer motif along the diagonal and eyes White's queen.",
      "Better move: Qc2, eval +0.35 depth 17. White sidesteps the future Ba6 pin while keeping normal development.",
      "Private board facts: Qc2 moves the queen away from the vulnerable diagonal; b5 opens queenside lines for Ba6.",
    ],
    must: ["Qc2", "Qb8", "b5", "Ba6", "pin"],
    nice: ["prophylactic", "skewer", "queenside", "diagonal"],
  },
  {
    id: "weak-square-pawn-push",
    source:
      "Andrew Divetta game: annotation says g4 weakens f4; Qf4 double-attacks e4, and g5 fails because Bxe4 comes with tempo and a fork.",
    question: "Why is g4 not a good attacking move here?",
    evidence: [
      "Played idea: g4, eval -0.40 depth 17. It weakens the f4 square.",
      "Refutation line: g4 Qf4. Black occupies f4 and double-attacks the e4 pawn.",
      "If White continues: g4 Qf4 g5 Bxe4. Black captures with tempo and forks the queen and knight, then can remove the defender of g5 with Bxf3.",
      "Private board facts: Qf4 attacks e4; Bxe4 hits the queen/knight fork motif in the supplied line.",
    ],
    must: ["g4", "f4", "Qf4", "e4", "tempo"],
    nice: ["weakens", "double", "fork", "defender"],
  },
  {
    id: "candidate-verification-concrete-resource",
    source:
      "Michael Binx game: annotation notes Qe7 was best; after g5 Ne8, White cannot take h6 because the queen attacks h4.",
    question: "Is Qe7 actually safe against the g5 idea, and how should I verify it?",
    evidence: [
      "Best move: Qe7, eval +1.05 depth 17. This keeps Black coordinated.",
      "Feared line: Qe7 g5 Ne8. White cannot take h6 because Black's queen is then attacking h4.",
      "Private board facts: after Qe7 g5 Ne8, Qxh4 is a concrete resource; the h6 pawn is tactically protected by counterplay against h4.",
    ],
    must: ["Qe7", "g5", "Ne8", "h6", "h4"],
    nice: ["verify", "calculate", "counterplay", "candidate"],
  },
  {
    id: "space-advantage-trade-pieces",
    source:
      "Prabu Vismith game: annotation says Nxd5 was best, Bc6 made it work, and trading pieces is good when White has a space advantage.",
    question: "Why does Nxd5 work, and what is the strategic lesson?",
    evidence: [
      "Best line: Nxd5, eval +0.45 depth 17: Nxd5 Bc6 Qxd6.",
      "The tactical point is Bc6, which makes the capture work and lets White emerge with the better position after trades.",
      "Private board facts: White has more space; piece trades reduce Black's cramped counterplay.",
    ],
    must: ["Nxd5", "Bc6", "Qxd6", "space", "trade"],
    nice: ["cramped", "tactical point", "pieces", "advantage"],
  },
  {
    id: "opponent-candidate-verification",
    source:
      "Oliver Harrison game: annotation says the follow-up was played too quickly without considering Qb3, which defended the knight and pressed f7.",
    question: "What was the thinking error before I played the obvious follow-up?",
    evidence: [
      "Played follow-up: d5, eval -0.20 depth 17. It was played quickly because the continuation looked obvious.",
      "Opponent resource: Qb3, eval +0.60 depth 17. White defends the knight and adds pressure to f7.",
      "Private board facts: Qb3 defends the knight and attacks f7; Black's planned follow-up no longer wins material cleanly.",
    ],
    must: ["Qb3", "knight", "f7", ["candidate", "fresh scan"], ["verify", "check"]],
    nice: ["obvious", "opponent", "complex", "knife"],
  },
  {
    id: "endgame-king-invasion",
    source:
      "Mike Gale game: annotation says better was to invade with the king; if fxg5 Black gets isolated pawns, otherwise Kg6 invades.",
    question: "What was the endgame plan I should have found?",
    evidence: [
      "Best plan: Kg6, eval +0.80 depth 17. The king invades and forces Black to make a concession.",
      "If Black plays fxg5, Black is left with two isolated pawns.",
      "If Black waits, White's king reaches g6 and the position becomes strategically winning.",
      "Private board facts: the king route to g6 is available; fxg5 damages Black's structure.",
    ],
    must: ["king", "Kg6", "fxg5", "isolated", "pawns"],
    nice: ["invade", "endgame", "concession", "structure"],
  },
];

function buildPrompt(testCase) {
  return `You are testing the En Croissant AI Coach final-answer behavior.

Use this exact coaching style guide from the app:
${styleGuide}

Grounding rules:
- Treat supplied evidence as the source of truth for concrete lines and board facts.
- Do not mention tools, prompts, hidden targets, tests, or evidence machinery.
- Answer the user directly.
- Explain the human chess mechanism before or alongside the line.
- Include concrete moves from the supplied evidence.
- Finish with a practical training takeaway only when it naturally fits.

User question:
${testCase.question}

Supplied evidence:
${testCase.evidence.map((line) => `- ${line}`).join("\n")}

Write the coach answer now.`;
}

function scoreAnswer(testCase, answer) {
  const lower = answer.toLowerCase();
  const termMatches = (term) => {
    const alternatives = Array.isArray(term) ? term : [term];
    return alternatives.some((alternative) => lower.includes(alternative.toLowerCase()));
  };
  const hit = (terms) => terms.filter(termMatches);
  const mustHits = hit(testCase.must);
  const niceHits = hit(testCase.nice);
  const implementationLeak =
    /\b(tool call|tool result|prompt|hidden target|test case|supplied evidence|private board facts)\b/i.test(
      answer,
    );
  const unwantedPsychology =
    /(fear|feared|afraid|ego|tilt|tilted|frustrated|underestimated|underestimating|psychological|time pressure|low time|likely assuming|assuming|assumed|blinded|bias|momentum bias)/i.test(
      answer,
    );
  const engineDump =
    /(eval|depth|stockfish|engine)/i.test(answer) &&
    !/(because|so|therefore|means|point|idea|counterplay|tempo|defend|weak|pin|clamp|fortress)/i.test(
      answer,
    );

  return {
    mustHits,
    niceHits,
    mustScore: `${mustHits.length}/${testCase.must.length}`,
    niceScore: `${niceHits.length}/${testCase.nice.length}`,
    implementationLeak,
    unwantedPsychology,
    engineDump,
    pass:
      mustHits.length >= Math.max(3, testCase.must.length - 1) &&
      !implementationLeak &&
      !unwantedPsychology &&
      !engineDump,
  };
}

function runGemini(prompt) {
  return new Promise((resolve, reject) => {
    const commandArgs = [
      "--skip-trust",
      "--approval-mode",
      "plan",
      "--output-format",
      "text",
      "--model",
      MODEL,
      "--prompt",
      "Use the complete chess coaching request supplied on stdin.",
    ];
    const child =
      process.platform === "win32"
        ? spawn(
            "cmd.exe",
            ["/d", "/c", `${GEMINI} ${commandArgs.map((arg) => `"${arg}"`).join(" ")}`],
            {
              stdio: ["pipe", "pipe", "pipe"],
            },
          )
        : spawn(GEMINI, commandArgs, {
            stdio: ["pipe", "pipe", "pipe"],
          });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Gemini timed out after 90000ms`));
    }, 90_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Gemini exited ${code}: ${stderr || stdout}`));
      }
    });
    child.stdin.end(prompt);
  });
}

await mkdir(OUT_DIR, { recursive: true });

const results = [];
for (const testCase of cases) {
  const prompt = buildPrompt(testCase);
  const started = Date.now();
  const { stdout, stderr } = await runGemini(prompt);
  const answer = stdout.trim();
  const score = scoreAnswer(testCase, answer);
  results.push({
    id: testCase.id,
    source: testCase.source,
    question: testCase.question,
    elapsedMs: Date.now() - started,
    answer,
    score,
    stderr: stderr.trim(),
  });
  console.log(
    `${score.pass ? "PASS" : "FAIL"} ${testCase.id} must=${score.mustScore} nice=${score.niceScore}`,
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  model: MODEL,
  command: GEMINI,
  results,
};
const outputPath = `${OUT_DIR}/latest.json`;
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

const passed = results.filter((result) => result.score.pass).length;
console.log(`\n${passed}/${results.length} coach-style probes passed.`);
console.log(`Report: ${outputPath}`);

if (passed !== results.length) {
  process.exitCode = 1;
}

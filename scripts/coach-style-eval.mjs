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
    must: ["queen", "defended", "Nd4", "Qc4", "verify"],
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
  const hit = (terms) => terms.filter((term) => lower.includes(term.toLowerCase()));
  const mustHits = hit(testCase.must);
  const niceHits = hit(testCase.nice);
  const implementationLeak =
    /(tool|prompt|hidden target|test case|supplied evidence|private board facts)/i.test(answer);
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
    engineDump,
    pass:
      mustHits.length >= Math.max(3, testCase.must.length - 1) &&
      !implementationLeak &&
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

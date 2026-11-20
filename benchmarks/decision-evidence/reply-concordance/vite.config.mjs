import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "053ca262";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const assessment = "src/utils/tacticalMotifs/decisionAssessment.ts";
const routes = "src/utils/tacticalMotifs/decisionAllowedRoutes.ts";
const paths = [
  worker,
  assessment,
  routes,
  ...["causalTactics", "mistakeReviewAdapter", "tacticalMistakeEpisode"].map(
    (name) => `src/utils/tacticalMotifs/${name}.ts`,
  ),
];
const mode = process.env.REPLY_CONCORDANCE_ARM;

function overlay(source) {
  const requestedGap = Number(process.env.REPLY_CONCORDANCE_GAP || 65);
  const at = "            const corroboratedChoices = playedCorroborated && betterCorroborated;";
  if (source.split(at).length !== 2) throw new Error("Corroboration gate changed");
  const select = `
            const alternateReply = (line: DecisionEngineLine, probe: DecisionReplyProbe | undefined) => {
                if (!probe || line.cp === null || line.mate != null) return;
                const main = probe.lines[0];
                if (!main || main.cp === null || main.mate != null) return;
                return probe.lines.slice(1).find((reply) =>
                    reply.pvUci[0] === line.pvUci[1] &&
                    reply.depth === main.depth && reply.cp !== null && reply.mate == null &&
                    main.cp! - reply.cp <= ${requestedGap} &&
                    Math.abs(line.cp! + reply.cp) <= 90,
                );
            };
            const playedMatched = corroboratedChoices ? alternateReply(playedLine, playedProbe) : undefined;
            const betterMatched = corroboratedChoices ? alternateReply(comparedBest, betterProbe) : undefined;
            const hasMatched = !!(playedMatched || betterMatched);
            const replayMatched = <T>(verify: (fen: string, best: DecisionEngineLine, played: DecisionEngineLine,
                bestReply: DecisionEngineLine, playedReply: DecisionEngineLine) => T | null): T | null =>
                hasMatched ? verify(input.fen, comparedBest, playedLine,
                    betterMatched ?? betterProbe!.lines[0], playedMatched ?? playedProbe!.lines[0]) : null;
  `;
  source = source.replace(at, at + select);
  if (mode === "positional" || mode === "combined") {
    for (const [name, func] of [
      ["shelter", "compareLostKingShelter"],
      ["rookPressure", "compareRookPressure"],
      ["pawnStructure", "comparePawnStructure"],
    ]) {
      const start = source.indexOf(`            const ${name} = corroboratedChoices`);
      const end = source.indexOf("                : null;", start);
      if (start < 0 || end < start) throw new Error("Missing positional anchor");
      const section = source.slice(start, end);
      const close = section.lastIndexOf("                  )");
      if (close < 0 || !section.includes(func)) throw new Error("Missing positional call");
      source =
        source.slice(0, start) +
        section.slice(0, close) +
        `                  ) ?? replayMatched(${func})\n` +
        source.slice(end);
    }
  }
  if (["tactical", "combined", "guarded"].includes(mode)) {
    for (const func of mode === "guarded"
      ? ["compareAllowedDecisionRoutes"]
      : ["comparePawnInterception", "compareAllowedDecisionRoutes"]) {
      const start = source.indexOf(` = ${func}(\n`);
      const boundary = /^ {16}\);/m;
      const tail = source.slice(start);
      const end = tail.search(boundary);
      if (start < 0 || end < 0) throw new Error("Missing tactical anchor");
      source =
        source.slice(0, start + end) +
        tail.slice(end).replace(
          "                );",
          mode === "guarded"
            ? `                ) ?? (playedMatched ? compareAllowedDecisionRoutes(
                        input.fen, comparedBest, playedLine, betterProbe!.lines[0],
                        playedMatched, input.history, "verified", true,
                    ) : null);`
            : `                ) ?? replayMatched((fen, best, played, bestReply, playedReply) =>
                        ${func}(fen, best, played, bestReply, playedReply, input.history)
                    );`,
        );
    }
  }
  if (mode && !["positional", "tactical", "combined", "guarded"].includes(mode))
    throw new Error("Unknown arm");
  return source;
}

const pinned = new Map(
  paths.map((path) => {
    let code = execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8" });
    if (path === worker) {
      const end = code.indexOf("\nself.onmessage =");
      if (end < 0) throw new Error("Missing worker entry");
      code = code.slice(0, end) + "\nexport { classify };";
    }
    if (path === assessment && mode) code = overlay(code);
    if (path === routes && mode === "guarded") {
      const anchor = "            if (index % 2 === 0 || !step.capture) continue;";
      if (code.split(anchor).length !== 2) throw new Error("Missing capture proof anchor");
      code = code
        .replace(
          "import { replayTacticalLine,",
          "import { replayTacticalLine, tacticalExchangeGain, MIN_TACTICAL_CAPTURE_GAIN,",
        )
        .replace(' = "verified",', ' = "verified",\n    requireDirectGain = false,')
        .replace(
          anchor,
          anchor +
            "\n            if (requireDirectGain && tacticalExchangeGain(step.before, step.move) < MIN_TACTICAL_CAPTURE_GAIN) continue;",
        );
    }
    return [resolve(path).replaceAll("\\", "/"), code];
  }),
);
export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "reply-concordance",
      enforce: "pre",
      load(id) {
        return pinned.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};

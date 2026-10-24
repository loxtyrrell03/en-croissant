import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "package.json"));
const { Chess } = await import(pathToFileURL(require.resolve("chessops/chess")));
const { parseFen, makeFen } = await import(pathToFileURL(require.resolve("chessops/fen")));
const { parseUci } = await import(pathToFileURL(require.resolve("chessops/util")));
const { makeSan } = await import(pathToFileURL(require.resolve("chessops/san")));
const sha = value => createHash("sha256").update(value).digest("hex");
const specification = [
    ["rare-causal-cohort-v2-inputs.json", ["QZDg7vtX", "Z1Tw5YR3"]],
    ["quiet-game-context-development.json", ["C9q6jvtW", "Gectvn7R"]],
];
const adjacent = process.argv.includes("--adjacent-white");
const reachedPlies = adjacent ? [16, 34, 46] : [15, 33, 45], sources = [], games = [], cases = [], omitted = [];
for (const [name, ids] of specification) {
    const bytes = readFileSync(resolve(root, "benchmarks/tactical-relevance", name));
    const source = JSON.parse(bytes);
    sources.push({ name, sha256: sha(bytes) });
    for (const id of ids) {
        const game = source.games.find(candidate => (candidate.gameId ?? candidate.id) === id);
        if (!game || !game.sourceGameUrl.startsWith("https://lichess.org/")) throw Error("Missing retained public game");
        games.push({ id, sourceGroup: `game:${id}`, sourceGameUrl: game.sourceGameUrl,
            sourceSha256: game.sourceSha256, startFen: game.startFen, moves: game.moves });
        const position = Chess.fromSetup(parseFen(game.startFen).unwrap()).unwrap();
        const frames = [];
        for (const uci of game.moves) {
            const move = parseUci(uci);
            if (!move || !position.isLegal(move)) throw Error(`Illegal retained move ${id}:${uci}`);
            const quietAlternatives = [];
            for (const [from, destinations] of position.allDests()) for (const to of destinations) {
                const piece = position.board.get(from), candidate = { from, to };
                if (position.board.has(to) || (piece.role === "pawn" && (to === position.epSquare || to < 8 || to >= 56))) continue;
                const child = position.clone(); child.play(candidate);
                if (child.isCheck()) continue;
                const uci = `${String.fromCharCode(97 + from % 8)}${1 + Math.floor(from / 8)}${String.fromCharCode(97 + to % 8)}${1 + Math.floor(to / 8)}`;
                quietAlternatives.push({ uci, san: makeSan(position, candidate), selectionHash: sha(`ordinary-precision-v1:${id}:${frames.length}:${uci}`) });
            }
            quietAlternatives.sort((a,b) => a.selectionHash.localeCompare(b.selectionHash));
            frames.push({ fen: makeFen(position.toSetup()), uci, san: makeSan(position, move), quietAlternatives: quietAlternatives.filter(candidate => candidate.uci !== uci).slice(0,2) });
            position.play(move);
        }
        for (const ply of reachedPlies) {
            if (!frames[ply]) { omitted.push({ id, ply, reason: "No following played move" }); continue; }
            const frame = frames[ply], previous = frames[ply - 1];
            cases.push({ id: `context:${id}:ply${ply}`, sourceGroup: `game:${id}`, sourceGameUrl: game.sourceGameUrl,
                ply, fen: frame.fen, previousFen: previous.fen, previousMoveUci: previous.uci,
                sourceUci: frames.slice(ply, ply + 12).map(item => item.uci),
                sourceSan: frames.slice(ply, ply + 12).map(item => item.san),
                quietAlternatives: frame.quietAlternatives,
                history: { fen: game.startFen, moves: game.moves.slice(0, ply) } });
        }
    }
}
console.log(JSON.stringify({ schemaVersion: 1,
    scope: `Fixed reached plies${reachedPlies.join(",")} in two retained cohort-v2 games plus the lexicographically first two retained quiet-context games. No classifier, engine, move-quality, capture/check, rating, result or label filter. These are further positions from reused public puzzle-source games, not independent games, owner games, holdout or population accuracy. The selection was frozen before this tranche's classifier output. Played continuations are legal observations, not assumed optimal or forced.`,
    tranche: adjacent ? "Adjacent White-to-move follow-up, separately declared after the first Black-to-move tranche's observations; dependent neighboring boards, not independent contexts." : "Initial Black-to-move tranche",
    priorContextCheck: "No matching game/ply IDs found in recorded public tactical benchmark files before selection; all four game groups were already used. Ordinary Chess.com owner-game fixtures explicitly excluded.",
    alternativeScope: "Up to two distinct noncapturing nonchecking legal alternatives per board, chosen by fixed SHA256 ordering before classifier output. These are deliberate quiet-move precision challenges, not engine recommendations or assumed good moves; no continued source route is attached to an alternative root.",
    reachedPlies, sources, games, cases, omitted }, null, 2));

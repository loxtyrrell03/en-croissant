import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { compareStrategicAssets } from "./experiment";

test("replays both strategic evidence variants", () => {
    const raw = readFileSync(process.env.ASSET_INPUT!, "utf8");
    const rows = raw.startsWith("[") ? JSON.parse(raw) : raw.trim().split("\n").map(JSON.parse);
    expect(rows.length).toBeGreaterThan(0);
    const output = rows.map((input) => {
        const pair = input.comparisonCandidates ?? input.candidates;
        const better = pair[0];
        const played = pair.find(
            (line, index) => index > 0 && line.pvUci[0] === input.playedMoveUci,
        );
        const reply = (move) => input.replyProbes?.find((p) => p.moveUci === move)?.lines[0];
        const control = reply(better?.pvUci[0]);
        const actual = reply(played?.pvUci[0]);
        const args = [input.fen, better, played, control, actual, input.history];
        const start = performance.now();
        const linked =
            better && played && actual && control
                ? compareStrategicAssets(...args, "linked")
                : null;
        const ms = performance.now() - start;
        const repeated =
            better && played && actual && control
                ? compareStrategicAssets(...args, "repeated")
                : null;
        return { id: input.id, repeated, linked, ms };
    });
    writeFileSync(process.env.ASSET_OUTPUT!, JSON.stringify(output), { flag: "wx" });
}, 240_000);

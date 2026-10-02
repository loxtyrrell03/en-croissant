import { afterAll, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { probeKingPawnEndgame } from "../../src/utils/tacticalMotifs/kpkBitbase";
import { validateTablebaseRecord } from "../../src/utils/tacticalMotifs/tablebaseEvidence";
import evidence from "./dvs4f-zugzwang-evidence.json";
import {
    generateCertificate,
    verifyCertificate,
    reflectedFen,
    reflectedMove,
    DEFAULT_LIMITS,
    type EndgameCertificate,
} from "./endgame-composition-prototype";

const records = evidence.records.map((row) => ({ fen: row.fen, result: row.result }));
const rootFen = evidence.rootFen,
    rootMove = evidence.line[0];
const report: unknown[] = [];
afterAll(() => {
    if (process.env.ENDGAME_COMPOSITION_REPORT)
        writeFileSync(
            process.env.ENDGAME_COMPOSITION_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    scope: "Benchmark-only bounded endgame composition; supplied public leaves; no provider calls",
                    limits: DEFAULT_LIMITS,
                    report,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    if (process.env.ENDGAME_COMPOSITION_CERTIFICATE && certificate)
        writeFileSync(
            process.env.ENDGAME_COMPOSITION_CERTIFICATE,
            JSON.stringify(certificate, null, 2),
            { flag: "wx" },
        );
});
const atClock = (fen: string, clock: number) => {
    const fields = fen.split(" ");
    fields[4] = String(clock);
    return fields.join(" ");
};
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const legalQuiet = (pos: Chess) =>
    [...pos.allDests()].flatMap(([from, tos]) => [...tos].map((to) => ({ from, to })));
let certificate: EndgameCertificate | null = null;

test("general generator recovers the proved root without supplied strategy or principal variation", () => {
    const start = performance.now(),
        generated = generateCertificate(rootFen, rootMove, records);
    report.push({
        case: "original",
        elapsedMs: performance.now() - start,
        ...generated,
        certificate: generated.certificate
            ? {
                  actualNodes: generated.certificate.actual.nodes.length,
                  passNodes: generated.certificate.passed.nodes.length,
                  bytes: JSON.stringify(generated.certificate).length,
              }
            : null,
    });
    expect(generated.reason).toBeUndefined();
    expect(generated.certificate).not.toBeNull();
    certificate = generated.certificate;
    const verifyStart = performance.now(),
        checked = verifyCertificate(rootFen, rootMove, certificate!, records);
    report.push({
        case: "independent-verification",
        elapsedMs: performance.now() - verifyStart,
        ...checked,
    });
    expect(checked.valid).toBe(true);
});

for (const reflected of [false, true])
    for (const clock of [97, 98])
        test(`clock and colour, clock=${clock}, reflected=${reflected}`, () => {
            const original = atClock(rootFen, clock),
                fen = reflected ? reflectedFen(original) : original,
                move = reflected ? reflectedMove(rootMove) : rootMove;
            const start = performance.now(),
                generated = generateCertificate(fen, move, records);
            report.push({
                case: `clock:${clock}:${reflected}`,
                elapsedMs: performance.now() - start,
                stats: generated.stats,
                reason: generated.reason,
                proved: !!generated.certificate,
            });
            expect(Boolean(generated.certificate)).toBe(clock === 97);
        });

for (const move of ["a6a7", "a6b7"])
    test(`drawing alternative ${move} cannot inherit the winning certificate`, () => {
        const generated = generateCertificate(rootFen, move, records);
        report.push({
            case: move,
            stats: generated.stats,
            reason: generated.reason,
            proved: !!generated.certificate,
        });
        expect(generated.certificate).toBeNull();
    });

test("tiny search budgets fail closed", () => {
    expect(
        generateCertificate(rootFen, rootMove, records, { generationOperations: 1 }).certificate,
    ).toBeNull();
    expect(
        generateCertificate(rootFen, rootMove, records, { generationNodes: 1 }).certificate,
    ).toBeNull();
});

test("root identity and low verification budgets cannot borrow a valid certificate", () => {
    expect(certificate).not.toBeNull();
    expect(verifyCertificate(atClock(rootFen, 98), rootMove, certificate!, records).valid).toBe(
        false,
    );
    expect(verifyCertificate(rootFen, "a6a7", certificate!, records).valid).toBe(false);
    expect(verifyCertificate(rootFen, rootMove, certificate!, records, 1).valid).toBe(false);
});

const tamperers: [string, (copy: EndgameCertificate) => void][] = [
    [
        "missing actual opponent reply",
        (c) => {
            c.actual.nodes[c.actual.entry].edges.pop();
        },
    ],
    [
        "duplicate actual opponent reply",
        (c) => {
            c.actual.nodes[c.actual.entry].edges.push({
                ...c.actual.nodes[c.actual.entry].edges[0],
            });
        },
    ],
    [
        "illegal actual move",
        (c) => {
            c.actual.nodes[c.actual.entry].edges[0].uci = "a1a8";
        },
    ],
    [
        "winning self cycle",
        (c) => {
            c.actual.nodes[c.actual.entry].edges[0].to = c.actual.entry;
        },
    ],
    [
        "missing pass opponent reply",
        (c) => {
            c.passed.nodes[c.passed.entry].edges.pop();
        },
    ],
    [
        "missing defender strategy choice",
        (c) => {
            c.passed.nodes.find((n) => !n.leaf && n.fen.split(" ")[1] === "w")!.edges = [];
        },
    ],
    [
        "forged terminal pass root",
        (c) => {
            c.passed.nodes[c.passed.entry].leaf = { kind: "terminal" };
            c.passed.nodes[c.passed.entry].edges = [];
        },
    ],
    [
        "turn changed inside strategy",
        (c) => {
            const node = c.passed.nodes[c.passed.entry];
            node.fen = node.fen.replace(" b ", " w ");
        },
    ],
    [
        "clock changed inside strategy",
        (c) => {
            const node = c.passed.nodes[c.passed.entry];
            node.fen = node.fen.replace(" 0 1", " 99 1");
        },
    ],
    [
        "wrong exact leaf clock",
        (c) => {
            const node = c.passed.nodes.find((n) => n.leaf?.kind === "tablebase")!;
            node.fen = node.fen.replace(/ 0 (\d+)$/, " 1 $1");
        },
    ],
    [
        "nonexistent source record",
        (c) => {
            const node = c.actual.nodes.find((n) => n.leaf?.kind === "tablebase")!;
            (node.leaf as { record: number }).record = 99;
        },
    ],
    [
        "wrong colour transformation",
        (c) => {
            const node = c.actual.nodes.find((n) => n.leaf?.kind === "tablebase")!;
            (node.leaf as { reflected: boolean }).reflected = true;
        },
    ],
    [
        "unsupported local leaf",
        (c) => {
            const node = c.actual.nodes.find((n) => n.leaf?.kind === "tablebase")!;
            node.leaf = { kind: "kpk" };
        },
    ],
    [
        "leaf given outgoing credit",
        (c) => {
            const node = c.actual.nodes.find((n) => n.leaf)!;
            node.edges = [{ uci: "a1a8", to: c.actual.entry }];
        },
    ],
    [
        "unreachable spare proof",
        (c) => {
            c.passed.nodes.push(structuredClone(c.passed.nodes[0]));
        },
    ],
    [
        "oversized graph",
        (c) => {
            while (c.passed.nodes.length <= DEFAULT_LIMITS.certificateNodes)
                c.passed.nodes.push(structuredClone(c.passed.nodes[0]));
        },
    ],
    [
        "oversized reply array",
        (c) => {
            c.actual.nodes[0].edges = Array(33).fill(c.actual.nodes[0].edges[0]);
        },
    ],
    [
        "out of range edge",
        (c) => {
            c.passed.nodes[c.passed.entry].edges[0].to = 100000;
        },
    ],
    [
        "null edge",
        (c) => {
            c.actual.nodes[0].edges[0] = null as never;
        },
    ],
    [
        "malformed move",
        (c) => {
            c.passed.nodes[0].edges[0].uci = {} as never;
        },
    ],
    [
        "missing edge target",
        (c) => {
            c.passed.nodes[0].edges[0].to = undefined as never;
        },
    ],
    [
        "unreachable winning node",
        (c) => {
            c.actual.nodes.push(structuredClone(c.actual.nodes[0]));
        },
    ],
    [
        "noninteger edge",
        (c) => {
            c.actual.nodes[c.actual.entry].edges[0].to = 0.5;
        },
    ],
    [
        "invented promotion",
        (c) => {
            const node = c.passed.nodes.find((n) => n.edges.some((e) => e.uci === "b5b4"))!;
            node.edges.find((e) => e.uci === "b5b4")!.uci = "b5b4q";
        },
    ],
];
for (const [name, tamper] of tamperers)
    test(`certificate rejects ${name}`, () => {
        expect(certificate).not.toBeNull();
        const copy = structuredClone(certificate!);
        tamper(copy);
        const checked = verifyCertificate(rootFen, rootMove, copy, records);
        report.push({ case: `tamper:${name}`, valid: checked.valid, reason: checked.reason });
        expect(checked.valid).toBe(false);
    });

const recordTamperers: [string, (copy: typeof records) => void][] = [
    [
        "missing record",
        (r) => {
            r.pop();
        },
    ],
    [
        "duplicate envelope",
        (r) => {
            r.push(structuredClone(r[0]));
        },
    ],
    [
        "wrong category",
        (r) => {
            r[0].result.category = "win";
        },
    ],
    [
        "missing legal reply",
        (r) => {
            r[0].result.moves.pop();
        },
    ],
    [
        "false terminal flag",
        (r) => {
            r[0].result.checkmate = true;
        },
    ],
    [
        "wrong clock identity",
        (r) => {
            r[0].fen = r[0].fen.replace(" 0 ", " 100 ");
        },
    ],
    [
        "oversized record envelope",
        (r) => {
            while (r.length <= 32) r.push(structuredClone(r[0]));
        },
    ],
];
for (const [name, tamper] of recordTamperers)
    test(`exact oracle envelope rejects ${name}`, () => {
        expect(certificate).not.toBeNull();
        const changed = structuredClone(records);
        tamper(changed);
        const checked = verifyCertificate(rootFen, rootMove, certificate!, changed);
        report.push({ case: `record:${name}`, valid: checked.valid, reason: checked.reason });
        expect(checked.valid).toBe(false);
    });

test("closed pass cycles are nonvacuous and do not make the finite win cyclic", () => {
    expect(certificate).not.toBeNull();
    const cyclic = (graph: EndgameCertificate["actual"]) => {
        const active = new Set<number>(),
            done = new Set<number>();
        const visit = (id: number): boolean => {
            if (active.has(id)) return true;
            if (done.has(id)) return false;
            active.add(id);
            if (graph.nodes[id].edges.some((edge) => visit(edge.to))) return true;
            active.delete(id);
            done.add(id);
            return false;
        };
        return visit(graph.entry);
    };
    expect(cyclic(certificate!.actual)).toBe(false);
    expect(cyclic(certificate!.passed)).toBe(true);
});

test("caller limits cannot increase either fixed bound", () => {
    expect(
        generateCertificate(rootFen, rootMove, records, {
            generationOperations: DEFAULT_LIMITS.generationOperations + 1,
        }).certificate,
    ).toBeNull();
    expect(
        verifyCertificate(
            rootFen,
            rootMove,
            certificate!,
            records,
            DEFAULT_LIMITS.verificationOperations + 1,
        ).valid,
    ).toBe(false);
});

test.each([false, true])(
    "same general certificate uses an existing local KPK leaf without provider data, reflected=%s",
    (reflected) => {
        const original = "8/8/8/5k2/8/4K3/5P2/8 w - - 1 69",
            move = "e3f3";
        const fen = reflected ? reflectedFen(original) : original,
            uci = reflected ? reflectedMove(move) : move;
        const generated = generateCertificate(fen, uci, []);
        report.push({
            case: `kpk:${reflected}`,
            stats: generated.stats,
            reason: generated.reason,
            proved: !!generated.certificate,
        });
        expect(generated.certificate).not.toBeNull();
        expect(generated.certificate!.actual.nodes[0].leaf?.kind).toBe("kpk");
        expect(generated.certificate!.passed.nodes[0].leaf?.kind).toBe("kpk");
    },
);

test("a winning KPK ending in both turns is not zugzwang", () => {
    const generated = generateCertificate("2k5/8/1K6/2P5/8/8/8/8 w - - 0 1", "b6c6", []);
    report.push({
        case: "both-turns-win",
        stats: generated.stats,
        reason: generated.reason,
        proved: !!generated.certificate,
    });
    expect(generated.certificate).toBeNull();
    expect(generated.reason).toBe("Exact pass position is losing for the defender");
});

test("a correctly rebound clock identity still cannot suppress the opponent draw claim", () => {
    const changed = structuredClone(certificate!);
    changed.rootFen = atClock(rootFen, 98);
    for (const node of changed.actual.nodes) {
        const clock = Number(node.fen.split(" ")[4]);
        if (clock > 0) node.fen = atClock(node.fen, clock + 97);
    }
    const checked = verifyCertificate(changed.rootFen, rootMove, changed, records);
    expect(checked.valid).toBe(false);
    expect(checked.reason).toContain("Defender draw claim");
});

for (const kind of ["kpk", "tablebase"] as const)
    for (const borrowedClock of [0, 1])
        test(`a quiet pass edge cannot borrow a ${kind} leaf at clock ${borrowedClock}`, () => {
            const root = "8/8/8/5k2/8/4K3/5P2/8 w - - 1 69";
            const generated = generateCertificate(root, "e3f3", []);
            expect(generated.certificate).not.toBeNull();
            const changed = structuredClone(generated.certificate!);
            const passed = position(changed.passed.nodes[0].fen);
            const moves = legalQuiet(passed).map((move) => {
                const after = passed.clone();
                after.play(move);
                return { move, after, known: probeKingPawnEndgame(after) };
            });
            const quietDraw = moves.find(
                (row) =>
                    passed.board.get(row.move.from)?.role === "king" && row.known && !row.known.win,
            );
            expect(quietDraw).toBeDefined();
            const first = quietDraw!;
            const leafPos = position(atClock(makeFen(first.after.toSetup()), borrowedClock));
            // Synthetic transport envelope derived entirely from the independent
            // local KPK solver, not represented as a fetched provider response.
            const flags = (pos: Chess) => ({
                checkmate: pos.isCheckmate(),
                stalemate: pos.isStalemate(),
                insufficient_material: pos.isInsufficientMaterial(),
                variant_win: false,
                variant_loss: false,
            });
            const category = (pos: Chess) => {
                if (pos.isCheckmate()) return "loss";
                if (pos.isEnd()) return "draw";
                const result = probeKingPawnEndgame(pos)!;
                return result.win ? (result.pawnSide === pos.turn ? "win" : "loss") : "draw";
            };
            const record = {
                fen: makeFen(leafPos.toSetup()),
                result: {
                    ...flags(leafPos),
                    category: category(leafPos),
                    moves: legalQuiet(leafPos).map((move) => {
                        const after = leafPos.clone();
                        after.play(move);
                        return { uci: makeUci(move), category: category(after), ...flags(after) };
                    }),
                },
            };
            expect(validateTablebaseRecord(record, record.fen)).not.toBeNull();
            const ordered = [first, ...moves.filter((row) => row !== first)];
            changed.passed = {
                entry: 0,
                nodes: [
                    {
                        fen: atClock(makeFen(passed.toSetup()), 0).replace(/ \d+$/, " 1"),
                        edges: ordered.map((row, index) => ({
                            uci: makeUci(row.move),
                            to: index + 1,
                        })),
                    },
                    ...ordered.map((row, index) => ({
                        fen: index === 0 ? record.fen : makeFen(row.after.toSetup()),
                        edges: [],
                        leaf:
                            kind === "kpk"
                                ? { kind: "kpk" as const }
                                : { kind: "tablebase" as const, record: 0, reflected: false },
                    })),
                ],
            };
            const checked = verifyCertificate(
                root,
                "e3f3",
                changed,
                kind === "tablebase" ? [record] : [],
            );
            expect(checked.valid).toBe(false);
            expect(checked.reason).toContain("Unproved pass leaf or changed draw clock");
        });

test("exact terminal oracle facts retain checkmate priority over a high draw clock", () => {
    const fen = "k7/pPP5/2K5/8/8/8/8/8 b - - 150 1";
    const pos = position(fen);
    expect(pos.isCheckmate()).toBe(true);
    const record = {
        fen,
        result: {
            category: "loss",
            checkmate: true,
            stalemate: false,
            insufficient_material: false,
            variant_win: false,
            variant_loss: false,
            moves: [],
        },
    };
    expect(validateTablebaseRecord(record, fen)?.outcome).toBe(-1);
    // The composer deliberately does not explain a root that is already over.
    expect(generateCertificate(fen, "a8b8", [record]).certificate).toBeNull();
});

test("an already automatic draw cannot be revived by a resetting pawn move", () => {
    const fen = "8/8/8/5k2/8/4K3/5P2/8 w - - 150 69";
    const before = position(fen);
    const pawnMove = { from: 13, to: 21 };
    expect(before.isLegal(pawnMove)).toBe(true);
    before.play(pawnMove);
    expect(before.halfmoves).toBe(0);
    const generated = generateCertificate(fen, "f2f3", []);
    expect(generated.certificate).toBeNull();
    expect(generated.reason).toContain("Unsupported root");
});

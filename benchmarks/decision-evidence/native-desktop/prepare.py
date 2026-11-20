import argparse
import json
from pathlib import Path
import chess
import chess.pgn

parser = argparse.ArgumentParser(description="Prepare the isolated native Decision Evidence checks.")
parser.add_argument("qa", type=Path, help="Task-owned directory containing an archived source subfolder")
parser.add_argument("stockfish", type=Path, help="Local Stockfish 19 executable")
args = parser.parse_args()
qa = args.qa.resolve()
source = qa / "source"
if (source / ".git").exists() or not (source / "src-tauri" / "tauri.conf.json").is_file():
    parser.error("source must be a committed archive inside the QA directory")
if not args.stockfish.is_file():
    parser.error("Stockfish executable not found")
paths = {key: qa / "runtime-fixtures" / folder for key, folder in {
    "document-dir": "documents", "databases-dir": "databases",
    "engines-dir": "engines", "puzzles-dir": "puzzles",
}.items()}
for folder in paths.values():
    folder.mkdir(parents=True, exist_ok=True)
settings = {"type": "local", "id": "decision-stockfish-19", "name": "Stockfish 19 QA",
            "version": "19", "path": str(args.stockfish.resolve()), "enabled": True,
            "go": {"t": "Depth", "c": 18},
            "settings": [{"name": "Threads", "value": 1}, {"name": "Hash", "value": 64}, {"name": "MultiPV", "value": 3}]}
(paths["engines-dir"] / "engines.json").write_text(json.dumps([settings]), encoding="utf-8")
entries = json.dumps({key: str(folder) for key, folder in paths.items()})
(source / "public" / "__decision-native-qa.html").write_text(
    "<!doctype html><meta charset=utf-8><script>"
    f"for (const [key, value] of Object.entries({entries})) localStorage.setItem(key, JSON.stringify(value));"
    'location.replace("index.html");</script>', encoding="utf-8")
config = qa / "tauri.qa.json"
cfg = {
    "identifier": "org.encroissant.decision.qa",
    "app": {"windows": [{
        "height": 880, "label": "main", "title": "En Croissant Decision Evidence QA",
        "width": 1280, "visible": False, "url": "__decision-native-qa.html",
    }]},
}
config.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")

fixtures = source / "benchmarks" / "decision-evidence"
def load(folder, filename):
    return json.loads((fixtures / folder / filename).read_text(encoding="utf-8-sig"))

def fixture(label, fen, line):
    board = chess.Board(fen)
    game = chess.pgn.Game()
    game.setup(board)
    game.headers["Event"] = label
    game.headers["White"] = label
    game.headers["Black"] = "Stockfish QA Fixture"
    node = game
    for san in line:
        move = board.parse_san(san)
        node = node.add_variation(move)
        board.push(move)
    (paths["document-dir"] / (label + ".pgn")).write_text(str(game) + "\n", encoding="utf-8")

def history_fixture(label, history, follow=()):
    board = chess.Board(history["fen"])
    legal = []
    for uci in [*history["moves"], *follow]:
        move = board.parse_uci(uci)
        legal.append(board.san(move))
        board.push(move)
    fixture(label, history["fen"], legal)

fixture("Bavarian Refutation", load("sibling-refutation", "fixture.json")["bavaria"]["input"]["fen"], ["Qc8", "Nxb5"])
fixture("Exact Rook Ending", load("exact-endgame-decisions", "witness.json")["fen"], ["Kf1", "e2+"])
amsterdam = load("settled-exchange-plans", "fixture.json")["amsterdam"]
board = chess.Board(amsterdam["history"]["fen"])
sans = []
for uci in [*amsterdam["history"]["moves"], amsterdam["recordedMove"]]:
    move = board.parse_uci(uci)
    sans.append(board.san(move))
    board.push(move)
fixture("Amsterdam Exchange", amsterdam["history"]["fen"], sans)

for folder, scenarios in (
    ("checking-capture-order", (
        ("position", "Finnish Capture Order"), ("mistake", "Asian Capture Order"),
        ("counterattack", "Sardinia Capture Order"),
    )),
    ("checking-order-defences", (
        ("sameReply", "Berjaya Checking Defence"), ("removeAttacker", "La Roda Checking Defence"),
    )),
    ("quiet-reply-counterplay", (("heldout", "Quiet Counterattack"),)),
    ("cached-capture-selection", (
        ("amager", "Amager Defender Capture"), ("ganja", "Ganja Defender Capture"),
    )),
):
    if not (fixtures / folder / "fixture.json").is_file():
        continue
    order = load(folder, "fixture.json")
    for scope, label in scenarios:
        if scope not in order:
            continue
        target = order[scope]["input"]
        follow = [target["playedMoveUci"]] if "playedMoveUci" in target else []
        history_fixture(label, target["history"], follow)
passer_roles = fixtures / "passer-role-contrasts" / "runtime-fixture.json"
if passer_roles.is_file():
    plans = load("passer-role-contrasts", "runtime-fixture.json")
    for key, label in (("chile", "Chile Passed Pawn"), ("handoff", "Passed Pawn Handoff"), ("direct", "Direct Pawn Blockade")):
        target = plans[key]
        history_fixture(label, target["history"], target["candidates"][0]["pvUci"][:1])
ray_trade = fixtures / "shared-ray-mistakes" / "retained-tactic.json"
if ray_trade.is_file():
    target = load("shared-ray-mistakes", "retained-tactic.json")
    history_fixture("Rear-Piece Trade", target["history"], [target["playedMoveUci"]])
aligned = fixtures / "shared-ray-mistakes" / "candidate-regression.json"
if aligned.is_file():
    cases = load("shared-ray-mistakes", "candidate-regression.json")
    for key, label in (("cachedExchange", "Aligned Queen and Rook"), ("promotionExchange", "Promotion Diverts the Knight")):
        target = cases.get(key)
        if target:
            history_fixture(label, target["history"], [target["playedMoveUci"]])
annotation = fixtures / "annotation-transfer" / "fixtures.json"
if annotation.is_file():
    target = load("annotation-transfer", "fixtures.json")["pawnLock"]
    history_fixture("Played Pawn Lock", target["history"], [target["playedMoveUci"]])
capture_route = fixtures / "capture-route-structure" / "fixtures.json"
if capture_route.is_file():
    cases = load("capture-route-structure", "fixtures.json")
    for key, title in (("candidates", "Knight Keeps the Pawn Chain"), ("clubCup", "Queen Keeps the Pawn Chain")):
        target = cases[key]
        history_fixture(title, target["history"], [target["playedMoveUci"]])
castle = fixtures / "castling-interruption" / "fixtures.json"
if castle.is_file():
    target = load("castling-interruption", "fixtures.json")["checked"]
    history_fixture("Castle Before the Check", target["history"], [target["playedMoveUci"]])
deferred_capture = fixtures / "deferred-pawn-capture" / "transfer.json"
if deferred_capture.is_file():
    cases = load("deferred-pawn-capture", "transfer.json")
    target = next(row for row in cases if row["id"] == "00fdf80b1db70bd6")
    history_fixture("Pawn Capture Can Wait", target["history"])
repetition_retry = fixtures / "native-desktop" / "repetition-retry.json"
if repetition_retry.is_file():
    target = load("native-desktop", "repetition-retry.json")
    history_fixture("Repetition Search Recovery", target["history"], [target["playedMoveUci"]])
print("Isolated app settings and legal PGN fixtures prepared.")

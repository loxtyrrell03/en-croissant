import assert from "node:assert/strict";
import test from "node:test";
import {
  LC0_PROFILE_OPTIONS,
  lc0ProfileDetails,
  normalizeLc0Profile,
  selectLc0Network,
} from "../lc0-network-routing.mjs";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("manual LC0 profiles expose every supported odds choice", () => {
  assert.deepEqual(
    LC0_PROFILE_OPTIONS.map((profile) => profile.value),
    ["none", "knight", "rook", "double_knight", "rook_and_knight", "queen_for_knight", "queen"],
  );
  assert.equal(lc0ProfileDetails("queen").family, "lqo");
  assert.equal(lc0ProfileDetails("rook").family, "t1");
  assert.equal(normalizeLc0Profile("unknown"), "none");
});

test("automatic routing keeps normal positions on BT4", () => {
  assert.deepEqual(selectLc0Network({ fen: INITIAL_FEN, autoNetwork: true }), {
    mode: "none",
    family: "bt4",
    label: "Standard strength",
    playerColor: null,
    reason: "unsupported_material_topology",
  });
});

test("automatic routing selects T1 for either side's exact piece-odds topology", () => {
  const whiteKnightOdds = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1";
  const blackRookOdds = "1nbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQk - 0 1";

  assert.match(selectLc0Network({ fen: whiteKnightOdds, autoNetwork: true }).label, /Knight odds/);
  assert.equal(selectLc0Network({ fen: whiteKnightOdds, autoNetwork: true }).playerColor, "white");
  assert.equal(selectLc0Network({ fen: blackRookOdds, autoNetwork: true }).mode, "rook");
  assert.equal(selectLc0Network({ fen: blackRookOdds, autoNetwork: true }).playerColor, "black");
});

test("automatic routing selects LQO for queen odds and exits after material recovery", () => {
  const queenOdds = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1";
  const recovered = "rnbqk1nr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1";

  assert.equal(selectLc0Network({ fen: queenOdds, autoNetwork: true }).family, "lqo");
  assert.equal(selectLc0Network({ fen: queenOdds, autoNetwork: true }).mode, "queen");
  assert.equal(selectLc0Network({ fen: recovered, autoNetwork: true }).family, "bt4");
});

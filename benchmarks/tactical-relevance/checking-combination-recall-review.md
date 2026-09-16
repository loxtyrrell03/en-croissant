# Mixed checking combinations and promotion-fork recall

Adapter **121 / live pipeline 126** recovers the missing Qa6+ opportunity in
the fixed six-game owner audit. It also recovers a public opening attack and
a quiet mating attack. These are development improvements, not completion of
the broad recall/accuracy goal or a representative accuracy estimate.

## The chess and the main lesson

After the reviewed ...b5, **Qa6+** opens a forcing attack. The defences have
different mechanisms: a queen offer can lead to a checking promotion fork;
one king move permits a mating line; another needs **Bf4+, ...Bd6, Re7**, a
quiet move creating a mating threat. Calling Qxd8+ a free-rook win would be
wrong because the queen can be taken. Conversely, the old requirement that
one checking piece immediately win one named target missed the combination.

The new bounded certificate covers all three legal first replies and their
selected continuations. It uses 29,201 of 32,768 operations and gives a local
330-cp material lower bound. That is not the full-position engine evaluation,
the exact optimal gain, or a claim that the example PV is the best route.
Its illustrative branches include a different checking route from the first
engine PV; all selected attacking decisions were independently searched.

The live primary is **Forcing Attack**. The comparison with ...gxf6 separately
establishes that Qa6 then loses its check and permits ...bxa6. The earlier move
therefore gains an explained allowed tactic without claiming that ...b5 caused
the entire already-bad position. On the following actual mistake, allowing
**Rd1+ and mate in two remains primary**; missing Qa6+ is the secondary lesson.
The promotion fork and supporting mating threat are classified on their own
reached boards, not drawn prematurely on the starting board.

## General changes and limits

- A noncapturing opening check can nominate a short checking combination ending
  in a piece capture. The supplied line orders candidates but cannot certify a
  payoff. The fallback runs only after the established checking proofs fail.
- Connected allies may join a mating attack with check. Unrelated quiet captures
  still cannot fund it. One quiet mating setup may be verified at an absolutely
  pinned position when an existing participant supplies the new mating threat.
- Existing liability, countercheck, terminal-position and all-defence checks
  remain. Quiet setup and checking branches share the new fallback's operation
  budget. This is additional bounded work, not zero added CPU cost; application
  deadlines are unchanged.
- Exact-board/balance/participant leaf caching avoids repeatedly proving the
  same quiet setup at each iterative checking depth. Custom/invalid budgets
  cannot borrow a cached success. Longer lines can still exhaust the bound.
- A seventh-rank forking pawn now uses actual legal promotion captures instead
  of constructing an illegal promotion-less move. All four promotion roles are
  considered. A capture ending in stalemate cannot supply a winning-promotion
  leaf. The ordinary drawn-exchange policy remains separate.

## Broader relevance review

The public opening Qh5+ now explains a forcing attack at the root while keeping
its queen-for-bishop recapture at the later ply. The Lichess 0rcU4 quiet move now
has a **Mating Attack** certificate; the bounded proof does not pretend to prove
the engine's exact mate-in-four distance. Supporting deflection remains later.

The old ordinary-game mate test initially failed because the promotion fix
restored the **root king/knight fork**, not because irrelevant later rook forks
returned. The actual knight capture is part of the underpromotion mating line;
the mate remains primary, and the independent later rook-fork suppression still
passes. Tests now distinguish these mechanisms instead of expecting no forks
at any ply. The four initial broad-suite failures and earlier private diagnostics
are retained rather than presented as an initially clean run.

The first simplified promotion controls accidentally left their king in check;
legal replay exposed the error before engine verification. The corrected
fixtures preserve the failure conditions. An earlier legal Qa7+/Qa8+ nomination
also exhausted the combination budget in the simplified board; a shorter legal
checking nomination verifies it. This demonstrates bounded-search sensitivity,
not a claim that the older route is unsound or that every PV suffix is equivalent.

## Evidence and verification

Final fresh engine batches contain **770 completed depth-16 searches**, including
roots, every first defence, selected certificate decisions and colour/rank
reflections. All selected winning decision witnesses have positive centipawn
estimates or winning mate; finite-depth search is corroboration, not exact
whole-game minimax proof. Initial root/control searches remain separately stored.
The allow-listed public receipt has **448 searches**, excludes all owner/course
boards, and checks the current constructed certificate's selected decisions.

Exact-input replay changes two of 122 second-owner result rows for the same
opportunity, not two recovered tactics. All 217 first-owner rows remain unchanged.
One of 246 private course/generated-game results gains a supporting ply-three
Rxe7 mating attack in one engine variation; its root stays unexplained. The
other 245 full results, all private primary lists and all twenty rare-theme
results stay unchanged. Empty and unchanged outputs are not certified correct.

The broad source selection passes **2,389 tests** with 171 optional skips. A
subsequent 46-check focused run includes exact fresh-witness correspondence,
owner primary/secondary assertions and the public engine receipt. TypeScript,
scoped lint, shared-review/frontend builds, ten service checks and two development
cache/recovery checks pass. Twenty compiled-controller groups pass, including
twelve new constructed/reflected controls; all 339 owner scans match source.
Six of 1,043 prior public primary lists change, covering the recovered quiet
mating attack's input variants and opening-check context. The remaining 1,037
lists are unchanged, not certified correct. Public computation/transfer
median/p95/max is **39/193/853 ms**, excluding engine, startup and native UI.
Worker `liveTactics.worker-Fyhu5jbD.js` has SHA-256
`0cb427bfad528fb1a9846b2732ea2dd22945e8312682b80974cc1c37edc4e224`.

The first cold-HTTP run stopped on the outdated quiet-mate empty-result assertion,
not a startup timeout. After the reviewed expectation update and six new inputs,
all **135 cold-HTTP cases** pass. First/max startup is **1,533/2,047 ms** and maximum
computation/transfer is **1,241 ms**. This passing run does not resolve the earlier
load-sensitive twenty-second failures. No native interaction or reliability
certification is claimed. The initial compiled run likewise retained the old
quiet-mate expectation; its owner parity groups passed before the final rerun.

Authoritative private receipts under `Documents/OnCrescent Tactical Benchmarks/`:
`checking-combination-diagnostic5-20260916.json`,
`checking-combination-engine4-20260916.json`,
`checking-combination-extra-engine-20260916.json`,
`adapter121-tests-final.json`, `adapter121-private-initial.json`,
`adapter121-rare-final.json`, and both `chesscom-*-adapter121-initial.json`
whole-game replays. Paid material and owner identities remain outside Git.
Compiled receipts are `adapter121-worker-{public,capture,discovery,preparation,
game,drawing,owner,disjoint}-final.json`, `adapter121-worker-tests-final.json`
and `adapter121-dev-cold-verified.json`.

The neighbouring Qxc6+ requiring quiet allied Rd1 remains an actual recall gap.
Persistent pawn opportunities, longer quiet combinations, broader rare-theme
coverage and primary selection remain incomplete. The known development-worker
cold-start failure is not fixed by this classifier change. Standalone delivery
is tracked separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`; owner data and phone
services are not changed.

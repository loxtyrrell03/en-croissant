# Promotion threats without borrowing a later queen

Adapter **158 / live pipeline 165** recovers a real owner-game pawn push which
previously had no theme. This is one recovered root mechanism, not completion
of broad tactical recall or a population accuracy result.

## Chess judgment and contrary evidence

The real **...f2** threatens to promote on Black's next move. All seven legal
replies allow f1=Q with retained material; against the competing b7 push,
promotion comes with check. Fresh root and held-move searches find forced
mate, and each selected promotion remains winning in a separate search.
The local certificate reports 800 cp of material, not the engine's mate
distance or a proof of the entire ending.

The preceding owner move receives existing-danger wording: ...f2 remains
available after the better king move too. It is not falsely blamed for
creating the threat. The owner actually played ...f2, so this game does not
manufacture a missed-opportunity card. Separately constructed missed choices
test that legitimate missed promotion threats survive review, save and reload
in both colours; equivalent and still-available choices are not called missed.

Another real **...h2** remains a coverage gap. Ra6+ delays its promotion and
requires an additional king move. Nineteen immediately promoting branches do
not certify the twentieth checking defence. The new next-turn rule abstains
instead of treating that check as a quiet pass.

Full-game review caught a draft priority regression: f7+ forks a king and
knight, then collecting the knight also promotes. The already verified fork
remains primary when every promotion branch collects its current targets
without improving the material bound; the duplicate threat badge is omitted.
The constructed counterpart is still losing overall despite this local fork.
Fresh Stockfish confirms that distinction; it is not called a winning game.

Constructed controls cover king/knight captures of the pushed pawn, blocking
rooks, checks, competing promotions and an off-square queen loss. Two important
abstentions are not negative whole-position judgments: the competing-pawn
example can win by capturing that pawn before promoting, and sacrificing the
old queen can retain a winning position without gaining new material. An early
pawn advance may also win the ending without being an immediate promotion
threat. An initial proposed knight move was rejected because it newly defended
the advance square; that defence is retained as a regression.

## Rule and display boundaries

A noncapturing pawn push to the penultimate rank must cover every legal reply,
including all defensive promotions. The same pawn must then have a legal,
material-retaining promotion. Entry-reply captures and promotion gains are
debited; existing promotion proofs check recaptures, friendly-piece liabilities,
terminal refutations and counterchecks. Nested failures consume their entire
reserved allowance within one 32,768-operation envelope. No worker or engine
deadline is enlarged and no new network lookup is introduced.

The root says **Promotion Threat**, with the pawn's move and actual verified
promotion routes. The promotion remains on its own ply as **Promotion Payoff**,
without counting the gain twice. This certificate connects at most three
plies; it does not append unrelated queen attacks later in a Stockfish line.
Checks that merely delay the push do not establish a prevented mistake cause.

These are bounded local proofs, not complete game solving. Longer checks,
quiet preparations, arbitrary pawn races, exact endgame outcomes and the
previously recorded queen-ending promotion remain incomplete.

## Source and engine verification

- The same **27 games / 1,319 contexts** change in exactly two full rows: the
  recovered root and its preceding existing-danger explanation. The other
  1,317 rows, including the recovered fork priority, are unchanged apart from
  versions and timing. This is one recovery, not two independent tactics.
- All **246 private-course** and **twenty rare-theme** full results remain
  unchanged. This is regression stability, not certification of their accuracy.
- **163 final fresh depth-16 searches** comprise 102 public constructed
  decisions/branches and 61 private real-game decisions/branches. Search counts
  are not puzzle counts. The public receipt is `promotion-threat-stockfish-18.json`.
- Independent python-chess verification checks eight exported certificates,
  all **32 root replies**, board identity, promotion legality and pawn identity.
  Removing a reply fails the verifier. It does not verify retention arithmetic
  or independently solve the ending.
- The final selected suite passes **2,879 tests** with 345 conditional skips.
  Thirty opted-in source checks, 127 source/React checks (three skips),
  33 generated-service checks (one optional engine skip), two development-cache
  scenarios, TypeScript, scoped lint and review/frontend builds pass. The
  initial diagnostic engine request omitted an optional sample path; the
  harness now accepts explicit-FEN requests and the final requests complete.

Authoritative private receipts use `promotion-threat158-` under
`Documents/OnCrescent Tactical Benchmarks/`: `owner-final`, `tests-final2`,
`public-engine-final2`, `owner-engine-final`, `private`, `rare`,
`public-probes-final4` and `owner-probes-final`, dated `20260917`.
The earlier five-row draft differential preserves the rejected fork priority;
it is not the final result. Paid and owner positions remain outside Git.

Compiled-controller validation and clean desktop delivery are pending in this
source milestone and will be recorded below and in
`docs/TACTICAL_DESKTOP_DELIVERY.md`. Owner stores are not automatically rescanned;
no app or phone service has been restarted. Broader recall, primary-theme
accuracy and native interaction/load-sensitive startup remain open.

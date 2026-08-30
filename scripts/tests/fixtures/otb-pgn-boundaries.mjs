const firstEventlessGame = `[Site "Board 1"]
[Date "2026.08.30"]
[White "Alpha"]
[Black "Beta"]
[Result "1-0"]

1. e4 e5 1-0`;

const secondEventlessGame = `[Round "2"]
[Date "2026.08.30"]
[White "Gamma"]
[Black "Delta"]
[Result "1/2-1/2"]

1. d4 d5 1/2-1/2`;

const reorderedEventGame = `[White "Epsilon"]
[Event "Header order variant"]
[Black "Zeta"]
[Result "*"]

1. c4 {Archive annotation
[Event "Comment text, not a game"]
still the same annotation} e5 *`;

const reorderedEventlessGame = `[White "Eta"]
[Black "Theta"]
[Site "Board 4"]
[Result "*"]

1. Nf3 ; [Event "Semicolon text, not a game"]
1... d5 *`;

const zeroMoveGame = `[White "Quiet"]
[Black "Still"]
[Result "*"]

*`;

const headerlessGame = `1. c4 e5 2. Nc3 Nf6 *`;

export const otbPgnBoundaryFixtures = [
  {
    name: "consecutive Eventless games",
    input: `${firstEventlessGame}\n\n${secondEventlessGame}`,
    expected: [
      {
        pgn: firstEventlessGame,
        event: "?",
        white: "Alpha",
        black: "Beta",
        result: "1-0",
      },
      {
        pgn: secondEventlessGame,
        event: "?",
        white: "Gamma",
        black: "Delta",
        result: "1/2-1/2",
      },
    ],
  },
  {
    name: "reordered Event headers and comment lookalikes",
    input: `${reorderedEventGame}\n\n${reorderedEventlessGame}`,
    expected: [
      {
        pgn: reorderedEventGame,
        event: "Header order variant",
        white: "Epsilon",
        black: "Zeta",
        result: "*",
      },
      {
        pgn: reorderedEventlessGame,
        event: "?",
        white: "Eta",
        black: "Theta",
        result: "*",
      },
    ],
  },
  {
    name: "zero-move and headerless games",
    input: `${headerlessGame}\n\n${zeroMoveGame}`,
    expected: [
      {
        pgn: headerlessGame,
        event: "?",
        white: "?",
        black: "?",
        result: "*",
      },
      {
        pgn: zeroMoveGame,
        event: "?",
        white: "Quiet",
        black: "Still",
        result: "*",
      },
    ],
  },
];

export const consecutiveEventlessPgnFixture = otbPgnBoundaryFixtures[0];

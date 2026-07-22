CREATE TABLE Info (
    Name TEXT UNIQUE NOT NULL,
    Value TEXT
);

CREATE TABLE Events (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE
);

CREATE TABLE Sites (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE
);

CREATE TABLE Players (
    ID INTEGER PRIMARY KEY,
    Name TEXT UNIQUE,
    Elo INTEGER
);

CREATE TABLE Games (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    EventID INTEGER,
    SiteID INTEGER,
    Date TEXT,
    UTCTime TEXT,
    Round INTEGER,
    WhiteID INTEGER,
    WhiteElo INTEGER,
    BlackID INTEGER,
    BlackElo INTEGER,
    WhiteMaterial INTEGER,
    BlackMaterial INTEGER,
    Result INTEGER,
    TimeControl TEXT,
    ECO TEXT,
    PlyCount INTEGER,
    FEN TEXT,
    Moves BLOB,
    PawnHome BLOB,
    FOREIGN KEY(EventID) REFERENCES Events,
    FOREIGN KEY(SiteID) REFERENCES Sites,
    FOREIGN KEY(WhiteID) REFERENCES Players,
    FOREIGN KEY(BlackID) REFERENCES Players
);

CREATE TABLE MistakeReviewMoveEvals (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    GameID INTEGER NOT NULL,
    Ply INTEGER NOT NULL,
    MoveNumber INTEGER NOT NULL,
    PlayerID INTEGER NOT NULL,
    PlayerColor TEXT NOT NULL,
    SideToMove TEXT NOT NULL,
    FEN TEXT NOT NULL,
    NormalizedFEN TEXT NOT NULL,
    FENAfter TEXT NOT NULL,
    PlayedUCI TEXT NOT NULL,
    PlayedSAN TEXT NOT NULL,
    BestUCI TEXT,
    BestSAN TEXT,
    PVUCI TEXT NOT NULL DEFAULT '',
    PVSAN TEXT NOT NULL DEFAULT '',
    CpBefore INTEGER NOT NULL,
    CpAfter INTEGER,
    CpLoss INTEGER,
    WinProbabilityDrop REAL,
    RequestedDepth INTEGER NOT NULL,
    ReachedDepth INTEGER NOT NULL,
    AnalysisMode TEXT NOT NULL,
    AnalysisStage TEXT NOT NULL,
    FastDepth INTEGER NOT NULL DEFAULT 0,
    MultiPV INTEGER NOT NULL DEFAULT 1,
    EngineName TEXT NOT NULL,
    MoveTimeSeconds REAL,
    ClockBeforeSeconds REAL,
    ClockAfterSeconds REAL,
    CreatedAt INTEGER NOT NULL,
    UpdatedAt INTEGER NOT NULL,
    UNIQUE(GameID, Ply, PlayerID, AnalysisMode, AnalysisStage, RequestedDepth, EngineName),
    FOREIGN KEY(GameID) REFERENCES Games(ID) ON DELETE CASCADE,
    FOREIGN KEY(PlayerID) REFERENCES Players(ID) ON DELETE CASCADE
);

INSERT INTO Players (ID, Name, Elo) VALUES (0, 'Unknown', NULL);
INSERT INTO Events (ID, Name) VALUES (0, 'Unknown');
INSERT INTO Sites (ID, Name) VALUES (0, 'Unknown');

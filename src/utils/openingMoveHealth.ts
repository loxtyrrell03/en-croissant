export type OpeningMoveHealthSide = "white" | "black";

export type OpeningMoveHealthSidePreference = OpeningMoveHealthSide | "sideToMove";

export type OpeningMoveHealthStatus = "strong" | "ok" | "watch" | "weak" | "sample";

export type OpeningMoveHealthInput = {
    move: string;
    white: number;
    draw: number;
    black: number;
};

export type OpeningMoveHealth = {
    move: string;
    status: OpeningMoveHealthStatus;
    label: string;
    score: number;
    games: number;
    share: number;
    confidence: number;
    side: OpeningMoveHealthSide;
    sideScore: number;
    positionScore: number;
    scoreGap: number;
    referenceRank: number | null;
    referenceShare: number | null;
    referenceScore: number | null;
    topReferenceMove: string | null;
    topReferenceShare: number | null;
    popularityGap: number | null;
    referenceScoreGap: number | null;
    reasons: string[];
};

type ReferenceMoveHealth = OpeningMoveHealthInput & {
    games: number;
    share: number;
    sideScore: number;
};

const MIN_CONFIDENT_GAMES = 4;

export function getOpeningMoveHealthMap(
    openings: OpeningMoveHealthInput[],
    side: OpeningMoveHealthSide,
    referenceOpenings?: OpeningMoveHealthInput[],
) {
    const playableOpenings = openings.filter(isPlayableOpening);
    const totalGames = playableOpenings.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);
    const positionScore =
        totalGames > 0
            ? playableOpenings.reduce(
                  (sum, opening) => sum + getSideScore(opening, side) * getOpeningTotal(opening),
                  0,
              ) / totalGames
            : 0.5;
    const reference = buildReferenceMoveData(referenceOpenings, side);

    return new Map(
        playableOpenings.map((opening) => [
            opening.move,
            getOpeningMoveHealth(opening, totalGames, positionScore, side, reference),
        ]),
    );
}

export function resolveOpeningMoveHealthSide(
    preference: OpeningMoveHealthSidePreference,
    sideToMove: OpeningMoveHealthSide,
) {
    return preference === "sideToMove" ? sideToMove : preference;
}

export function getOpeningTotal(opening: OpeningMoveHealthInput) {
    return opening.white + opening.draw + opening.black;
}

export function getSideScore(opening: OpeningMoveHealthInput, side: OpeningMoveHealthSide) {
    const total = getOpeningTotal(opening);
    if (total <= 0) return 0.5;

    const decisiveWins = side === "white" ? opening.white : opening.black;
    return (decisiveWins + opening.draw * 0.5) / total;
}

function getOpeningMoveHealth(
    opening: OpeningMoveHealthInput,
    totalGames: number,
    positionScore: number,
    side: OpeningMoveHealthSide,
    reference: ReturnType<typeof buildReferenceMoveData>,
): OpeningMoveHealth {
    const games = getOpeningTotal(opening);
    const share = totalGames > 0 ? games / totalGames : 0;
    const confidence = clamp(games / 12, 0, 1);
    const sideScore = getSideScore(opening, side);
    const scoreGap = positionScore - sideScore;
    const resultComponent = clamp(0.5 + (sideScore - positionScore) * 1.8, 0, 1);
    const sampleComponent = clamp(games / 10, 0, 1);

    const referenceMove = reference.byMove.get(opening.move) ?? null;
    const referenceRank = referenceMove ? reference.sorted.indexOf(referenceMove) + 1 : null;
    const topReferenceMove = reference.sorted[0] ?? null;
    const topReferenceShare = topReferenceMove?.share ?? null;
    const referenceShare = referenceMove?.share ?? null;
    const referenceScore = referenceMove?.sideScore ?? null;
    const popularityGap =
        reference.hasData && topReferenceShare !== null
            ? Math.max(0, topReferenceShare - (referenceShare ?? 0))
            : null;
    const referenceScoreGap =
        reference.hasData && topReferenceMove
            ? Math.max(0, (referenceScore ?? topReferenceMove.sideScore) - sideScore)
            : null;

    const referenceComponent = getReferenceComponent({
        hasReference: reference.hasData,
        referenceRank,
        popularityGap,
        referenceScoreGap,
    });
    const rawScore = reference.hasData
        ? resultComponent * 0.48 + referenceComponent * 0.37 + sampleComponent * 0.15
        : resultComponent * 0.75 + sampleComponent * 0.25;
    const regressedScore = rawScore * confidence + 0.5 * (1 - confidence);
    const score = Math.round(clamp(regressedScore * 100, 0, 100));
    const status = getHealthStatus(score, games);

    return {
        move: opening.move,
        status,
        label: getHealthLabel(status),
        score,
        games,
        share,
        confidence,
        side,
        sideScore,
        positionScore,
        scoreGap,
        referenceRank,
        referenceShare,
        referenceScore,
        topReferenceMove: topReferenceMove?.move ?? null,
        topReferenceShare,
        popularityGap,
        referenceScoreGap,
        reasons: getHealthReasons({
            games,
            side,
            sideScore,
            positionScore,
            referenceRank,
            popularityGap,
            referenceScoreGap,
            hasReference: reference.hasData,
        }),
    };
}

function buildReferenceMoveData(
    referenceOpenings: OpeningMoveHealthInput[] | undefined,
    side: OpeningMoveHealthSide,
) {
    const openings = (referenceOpenings ?? []).filter(isPlayableOpening);
    const totalGames = openings.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);
    const sorted = openings
        .map<ReferenceMoveHealth>((opening) => {
            const games = getOpeningTotal(opening);
            return {
                ...opening,
                games,
                share: totalGames > 0 ? games / totalGames : 0,
                sideScore: getSideScore(opening, side),
            };
        })
        .sort(
            (a, b) =>
                b.games - a.games || b.sideScore - a.sideScore || a.move.localeCompare(b.move),
        );
    const byMove = new Map(sorted.map((opening) => [opening.move, opening]));

    return {
        hasData: totalGames > 0,
        sorted,
        byMove,
    };
}

function getReferenceComponent({
    hasReference,
    referenceRank,
    popularityGap,
    referenceScoreGap,
}: {
    hasReference: boolean;
    referenceRank: number | null;
    popularityGap: number | null;
    referenceScoreGap: number | null;
}) {
    if (!hasReference) return 0.5;

    let rankComponent = 0.15;
    if (referenceRank === 1) {
        rankComponent = 0.95;
    } else if (referenceRank !== null && referenceRank <= 3) {
        rankComponent = 0.75;
    } else if (referenceRank !== null && referenceRank <= 5) {
        rankComponent = 0.55;
    } else if (referenceRank !== null) {
        rankComponent = 0.35;
    }

    return clamp(
        rankComponent - (popularityGap ?? 0) * 0.65 - (referenceScoreGap ?? 0) * 0.45,
        0,
        1,
    );
}

function getHealthStatus(score: number, games: number): OpeningMoveHealthStatus {
    if (games < MIN_CONFIDENT_GAMES) return "sample";
    if (score < 42) return "weak";
    if (score < 58) return "watch";
    if (score >= 72) return "strong";
    return "ok";
}

function getHealthLabel(status: OpeningMoveHealthStatus) {
    switch (status) {
        case "strong":
            return "Strong";
        case "ok":
            return "OK";
        case "watch":
            return "Watch";
        case "weak":
            return "Weak";
        case "sample":
            return "Sample";
    }
}

function getHealthReasons({
    games,
    side,
    sideScore,
    positionScore,
    referenceRank,
    popularityGap,
    referenceScoreGap,
    hasReference,
}: {
    games: number;
    side: OpeningMoveHealthSide;
    sideScore: number;
    positionScore: number;
    referenceRank: number | null;
    popularityGap: number | null;
    referenceScoreGap: number | null;
    hasReference: boolean;
}) {
    const reasons: string[] = [];
    const scoreDelta = sideScore - positionScore;

    if (games < MIN_CONFIDENT_GAMES) {
        reasons.push("Low sample, score is pulled toward neutral");
    } else if (scoreDelta <= -0.1) {
        reasons.push(`${capitalize(side)} scores well below the position average`);
    } else if (scoreDelta >= 0.1) {
        reasons.push(`${capitalize(side)} scores above the position average`);
    }

    if (hasReference) {
        if (referenceRank === null) {
            reasons.push("Outside the loaded reference moves");
        } else if (referenceRank <= 3) {
            reasons.push(`Matches reference choice #${referenceRank}`);
        } else {
            reasons.push(`Reference choice #${referenceRank}`);
        }

        if ((popularityGap ?? 0) >= 0.15) {
            reasons.push("Large popularity gap from the top reference move");
        }
        if ((referenceScoreGap ?? 0) >= 0.1) {
            reasons.push("Reference results are materially stronger");
        }
    }

    if (reasons.length === 0) {
        reasons.push("Results and move choice are close to the position baseline");
    }

    return reasons;
}

function isPlayableOpening(opening: OpeningMoveHealthInput) {
    return opening.move !== "Total" && opening.move !== "*" && getOpeningTotal(opening) > 0;
}

function capitalize(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

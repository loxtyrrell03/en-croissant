export type AiCoachSurfaceScope = "position" | "whole-game";

export function getDefaultAiCoachScope(
    hasLoadedGame: boolean,
    moveCount: number,
): AiCoachSurfaceScope {
    return hasLoadedGame || moveCount > 4 ? "whole-game" : "position";
}

export function getDefaultAiCoachQuestion(scope: AiCoachSurfaceScope): string {
    return scope === "whole-game"
        ? "Review this game for me. What went wrong, what should I learn, and which book lessons matter most?"
        : "Explain this position, the best plan, and the most relevant lesson from my chess library.";
}

export function toNativeAiCoachScope(scope: AiCoachSurfaceScope): "current_line" | "whole_game" {
    return scope === "whole-game" ? "whole_game" : "current_line";
}

export function fromNativeAiCoachScope(scope: string): AiCoachSurfaceScope {
    return scope === "whole_game" ? "whole-game" : "position";
}

import { useStartPracticeGame } from "./useStartPracticeGame";

export function usePracticeAgainstBot() {
    return useStartPracticeGame("bot");
}

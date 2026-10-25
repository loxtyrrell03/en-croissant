import { useMemo } from "react";
import {
    displayExplorerGameDates,
    displayLocalGameDates,
    type GameDateRange,
} from "@/utils/gameDateRange";
import { useCalendarDay } from "./useCalendarDay";

export function useLocalGameDates<
    T extends { dateRange?: GameDateRange; start_date?: string; end_date?: string },
>(options: T): T {
    const today = useCalendarDay();
    return useMemo(
        () => displayLocalGameDates(options, new Date(`${today}T12:00:00`)),
        [options, today],
    );
}
export function useExplorerGameDates<
    T extends { dateRange?: GameDateRange; since?: Date; until?: Date },
>(options: T, precision: "month" | "year"): T {
    const today = useCalendarDay();
    return useMemo(
        () => displayExplorerGameDates(options, precision, new Date(`${today}T12:00:00`)),
        [options, precision, today],
    );
}

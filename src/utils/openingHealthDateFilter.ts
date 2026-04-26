export type OpeningHealthDateRange =
    | "all"
    | "3months"
    | "6months"
    | "year"
    | "2years"
    | "5years"
    | "custom";

export type OpeningHealthDateBounds = {
    range: OpeningHealthDateRange;
    startDate: string | null;
    endDate: string | null;
};

export const OPENING_HEALTH_DATE_RANGE_OPTIONS: {
    value: OpeningHealthDateRange;
    label: string;
}[] = [
    { value: "all", label: "All dates" },
    { value: "3months", label: "Last 3 months" },
    { value: "6months", label: "Last 6 months" },
    { value: "year", label: "Last 1 year" },
    { value: "2years", label: "Last 2 years" },
    { value: "5years", label: "Last 5 years" },
    { value: "custom", label: "Custom dates" },
];

export function getOpeningHealthDateBounds(
    range: OpeningHealthDateRange,
    customStartDate?: string | null,
    customEndDate?: string | null,
    now = new Date(),
): OpeningHealthDateBounds {
    if (range === "all") {
        return { range, startDate: null, endDate: null };
    }

    if (range === "custom") {
        return {
            range,
            startDate: normalizeOpeningHealthDateInput(customStartDate),
            endDate: normalizeOpeningHealthDateInput(customEndDate),
        };
    }

    const start = new Date(now);
    switch (range) {
        case "3months":
            start.setMonth(start.getMonth() - 3);
            break;
        case "6months":
            start.setMonth(start.getMonth() - 6);
            break;
        case "year":
            start.setFullYear(start.getFullYear() - 1);
            break;
        case "2years":
            start.setFullYear(start.getFullYear() - 2);
            break;
        case "5years":
            start.setFullYear(start.getFullYear() - 5);
            break;
    }

    return {
        range,
        startDate: formatOpeningHealthDbDate(start),
        endDate: formatOpeningHealthDbDate(now),
    };
}

export function openingHealthDateBoundsAreValid(bounds: OpeningHealthDateBounds) {
    return !bounds.startDate || !bounds.endDate || bounds.startDate <= bounds.endDate;
}

export function openingHealthDateBoundsAreActive(bounds: OpeningHealthDateBounds) {
    return Boolean(bounds.startDate || bounds.endDate);
}

export function openingHealthDateMatches(
    value: string | null | undefined,
    bounds: OpeningHealthDateBounds,
) {
    if (!openingHealthDateBoundsAreActive(bounds)) return true;

    const date = normalizeOpeningHealthDateInput(value);
    if (!date) return false;
    if (bounds.startDate && date < bounds.startDate) return false;
    if (bounds.endDate && date > bounds.endDate) return false;
    return true;
}

export function normalizeOpeningHealthDateInput(value: string | null | undefined) {
    const date = parseOpeningHealthDate(value);
    return date ? formatOpeningHealthDbDate(date) : null;
}

export function openingHealthDbDateToInput(value: string | null | undefined) {
    const date = parseOpeningHealthDate(value);
    return date ? formatOpeningHealthInputDate(date) : "";
}

export function formatOpeningHealthDateFilter(bounds: OpeningHealthDateBounds) {
    if (!openingHealthDateBoundsAreActive(bounds)) return "All dates";
    const start = bounds.startDate?.replaceAll(".", "-");
    const end = bounds.endDate?.replaceAll(".", "-");
    if (start && end) return `${start} to ${end}`;
    if (start) return `From ${start}`;
    return `Through ${end}`;
}

export function formatOpeningHealthDbDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
}

function formatOpeningHealthInputDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseOpeningHealthDate(value: string | null | undefined) {
    const match = value?.match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }

    return date;
}

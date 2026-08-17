// Lazy-loaded opening book (EloGuard lib/book.js, generated from
// lichess-org/chess-openings, CC0) plus the review-core.js matchBook
// SAN-prefix matcher. The data module is ~350 KB, so it is only imported
// on first use and shared through a singleton promise.

export type StatsOpeningBook = readonly (readonly [string, string, string])[];

export type StatsBookMatch = {
    plies: number;
    eco: string | null;
    name: string | null;
};

let bookPromise: Promise<StatsOpeningBook> | null = null;

export async function getOpeningBook(): Promise<StatsOpeningBook> {
    if (!bookPromise) {
        bookPromise = import("./statsOpeningBookData").then((module) => module.default);
    }
    return bookPromise;
}

type StatsBookIndex = {
    prefixes: Set<string>;
    lines: Map<string, { eco: string; name: string }>;
};

const bookIndexCache = new WeakMap<object, StatsBookIndex>();

function getBookIndex(book: StatsOpeningBook): StatsBookIndex {
    const cached = bookIndexCache.get(book as object);
    if (cached) return cached;

    const index: StatsBookIndex = { prefixes: new Set(), lines: new Map() };
    for (const [eco, name, line] of book) {
        const sans = line.split(" ");
        let prefix = "";
        for (let i = 0; i < sans.length; i++) {
            prefix = i === 0 ? sans[0] : `${prefix} ${sans[i]}`;
            index.prefixes.add(prefix);
        }
        index.lines.set(line, { eco, name });
    }
    bookIndexCache.set(book as object, index);
    return index;
}

// Exact port of review-core.js matchBook (:233-247): walk the SAN prefix as
// long as it stays inside the book; the reported opening is the deepest
// prefix that is itself a complete book line.
export function matchBook(sans: string[], book: StatsOpeningBook): StatsBookMatch {
    const index = getBookIndex(book);
    let plies = 0;
    let opening: { eco: string; name: string } | null = null;
    let prefix = "";
    for (let i = 0; i < sans.length; i++) {
        prefix = i === 0 ? sans[0] : `${prefix} ${sans[i]}`;
        if (!index.prefixes.has(prefix)) break;
        plies = i + 1;
        const hit = index.lines.get(prefix);
        if (hit) opening = hit;
    }
    return { plies, eco: opening ? opening.eco : null, name: opening ? opening.name : null };
}

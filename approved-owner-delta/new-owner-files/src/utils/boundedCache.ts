export class BoundedMap<K, V> {
    private readonly entries = new Map<K, V>();

    constructor(private readonly maxEntries: number) {}

    get size() {
        return this.entries.size;
    }

    has(key: K) {
        return this.entries.has(key);
    }

    get(key: K) {
        const value = this.entries.get(key);
        if (value !== undefined || this.entries.has(key)) {
            this.entries.delete(key);
            this.entries.set(key, value as V);
        }
        return value;
    }

    set(key: K, value: V) {
        this.entries.delete(key);
        this.entries.set(key, value);
        trimMap(this.entries, this.maxEntries);
        return this;
    }

    delete(key: K) {
        return this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }
}

export class BoundedSet<T> {
    private readonly entries = new Set<T>();

    constructor(private readonly maxEntries: number) {}

    get size() {
        return this.entries.size;
    }

    has(value: T) {
        return this.entries.has(value);
    }

    add(value: T) {
        this.entries.delete(value);
        this.entries.add(value);
        trimSet(this.entries, this.maxEntries);
        return this;
    }

    delete(value: T) {
        return this.entries.delete(value);
    }

    clear() {
        this.entries.clear();
    }
}

export function withLimitedMapEntry<K, V>(
    source: Map<K, V>,
    key: K,
    value: V,
    maxEntries: number,
    deleteKeys: K[] = [],
) {
    const next = new Map(source);
    for (const deleteKey of deleteKeys) {
        next.delete(deleteKey);
    }
    next.delete(key);
    next.set(key, value);
    trimMap(next, maxEntries);
    return next;
}

export function withLimitedRecordEntry<T>(
    source: Record<string, T>,
    key: string,
    value: T,
    maxEntries: number,
) {
    const next: Record<string, T> = { ...source };
    delete next[key];
    next[key] = value;

    const overflow = Object.keys(next).length - maxEntries;
    if (overflow > 0) {
        for (const staleKey of Object.keys(next).slice(0, overflow)) {
            delete next[staleKey];
        }
    }

    return next;
}

function trimMap<K, V>(map: Map<K, V>, maxEntries: number) {
    const overflow = map.size - maxEntries;
    if (overflow <= 0) return;

    let removed = 0;
    for (const key of map.keys()) {
        map.delete(key);
        removed++;
        if (removed >= overflow) break;
    }
}

function trimSet<T>(set: Set<T>, maxEntries: number) {
    const overflow = set.size - maxEntries;
    if (overflow <= 0) return;

    let removed = 0;
    for (const value of set.values()) {
        set.delete(value);
        removed++;
        if (removed >= overflow) break;
    }
}

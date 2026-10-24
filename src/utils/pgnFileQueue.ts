const pending = new Map<string, Promise<void>>();

export function pgnPathKey(path: string) {
    const clean = path
        .replaceAll("\\", "/")
        .replace(/^\/\/\?\/UNC\//i, "//")
        .replace(/^\/\/\?\//, "");
    return /^(?:[a-z]:\/|\/\/)/i.test(clean) ? clean.toLowerCase() : clean;
}

/** Include the caller's binding/count updates in ordering, not just native IO. */
export function withPgnFileTask<T>(path: string, work: () => Promise<T>): Promise<T> {
    const key = pgnPathKey(path);
    const result = (pending.get(key) ?? Promise.resolve()).then(work);
    const tail = result.then(
        () => {},
        () => {},
    );
    pending.set(key, tail);
    void tail.then(() => {
        if (pending.get(key) === tail) pending.delete(key);
    });
    return result;
}

// A process-local epoch separates cached/pending reads from different native stores.
let revision: string | undefined;
let epoch = 0;
const listeners = new Set<(epoch: number) => void>();
export function getEvaluationSourceEpoch() {
    return epoch;
}
export function noteEvaluationSourceRevision(value: string) {
    if (value === revision) return;
    revision = value;
    epoch += 1;
    for (const listener of listeners) listener(epoch);
}
export function subscribeEvaluationSource(listener: (epoch: number) => void) {
    listeners.add(listener);
    listener(epoch);
    return () => {
        listeners.delete(listener);
    };
}

const activeCoachJobs = new Set<string>();
let appExitRequested = false;

export function beginAiCoachBackgroundJob(requestId: string): void {
    if (requestId) activeCoachJobs.add(requestId);
}

export function requestExitAfterAiCoach(): boolean {
    if (activeCoachJobs.size === 0) return false;
    appExitRequested = true;
    return true;
}

export function finishAiCoachBackgroundJob(requestId: string): boolean {
    activeCoachJobs.delete(requestId);
    if (!appExitRequested || activeCoachJobs.size > 0) return false;
    appExitRequested = false;
    return true;
}

export function hasActiveAiCoachBackgroundJob(): boolean {
    return activeCoachJobs.size > 0;
}

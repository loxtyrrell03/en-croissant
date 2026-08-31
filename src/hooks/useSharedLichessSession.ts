import { notifications } from "@mantine/notifications";
import { listen } from "@tauri-apps/api/event";
import { atom, useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect } from "react";
import { commands } from "@/bindings";
import { sessionsAtom } from "@/state/atoms";
import { getLichessAccount } from "@/utils/lichess/api";
import {
    loadSharedLichessCredential,
    saveSharedLichessCredential,
} from "@/utils/sharedLichessAuth";

const LICHESS_AUTH_TIMEOUT_MS = 120_000;

type LichessExplorerAuthState = {
    waiting: boolean;
    error: string | null;
    requestId: number | null;
    connectedAt: number | null;
};

const lichessExplorerAuthStateAtom = atom<LichessExplorerAuthState>({
    waiting: false,
    error: null,
    requestId: null,
    connectedAt: null,
});

let nextLichessAuthRequestId = 0;

export function useSharedLichessSession() {
    const [, setSessions] = useAtom(sessionsAtom);
    const [authState, setAuthState] = useAtom(lichessExplorerAuthStateAtom);

    useEffect(() => {
        let active = true;

        void loadSharedLichessCredential()
            .then(async (credential) => {
                if (!credential || !active) return;
                const account = await getLichessAccount({ token: credential.token, silent: true });
                if (!account || !active) return;

                setSessions((current) => {
                    const existing = current.find(
                        (session) =>
                            session.lichess?.username.toLowerCase() ===
                            credential.username.toLowerCase(),
                    );
                    const alreadyCurrent =
                        existing?.lichess?.accessToken === credential.token &&
                        existing.lichess.account.id === account.id;
                    if (alreadyCurrent) return current;

                    return [
                        ...current.filter(
                            (session) =>
                                session.lichess?.username.toLowerCase() !==
                                credential.username.toLowerCase(),
                        ),
                        {
                            lichess: {
                                accessToken: credential.token,
                                username: credential.username,
                                account,
                            },
                            player: existing?.player || credential.username,
                            updatedAt: credential.updatedAt,
                        },
                    ];
                });
            })
            .catch((error) => {
                console.warn("Shared Lichess sign-in is unavailable.", error);
            });

        return () => {
            active = false;
        };
    }, [setSessions]);

    useEffect(() => {
        let active = true;
        let unlisten: (() => void) | null = null;

        void listen<string>("access_token", async ({ payload: token }) => {
            if (!active) return;
            try {
                const account = await getLichessAccount({ token });
                if (!account) throw new Error("Could not read the authorized Lichess account.");

                setSessions((current) => {
                    const existing = current.find(
                        (session) =>
                            session.lichess?.username.toLowerCase() ===
                            account.username.toLowerCase(),
                    );
                    return [
                        ...current.filter(
                            (session) =>
                                session.lichess?.username.toLowerCase() !==
                                account.username.toLowerCase(),
                        ),
                        {
                            lichess: {
                                accessToken: token,
                                username: account.username,
                                account,
                            },
                            player: existing?.player || account.username,
                            updatedAt: Date.now(),
                        },
                    ];
                });
                void saveSharedLichessCredential(token).catch((error) => {
                    console.warn("Could not save the shared Lichess sign-in.", error);
                });
                setAuthState({
                    waiting: false,
                    error: null,
                    requestId: null,
                    connectedAt: Date.now(),
                });
                notifications.show({
                    title: "Lichess connected",
                    message:
                        "Lichess All and Masters are retrying with your authenticated session.",
                    color: "green",
                });
            } catch (caught) {
                if (!active) return;
                setAuthState((current) => ({
                    ...current,
                    waiting: false,
                    error: caught instanceof Error ? caught.message : String(caught),
                    requestId: null,
                }));
            }
        }).then((cleanup) => {
            if (active) unlisten = cleanup;
            else cleanup();
        });

        return () => {
            active = false;
            unlisten?.();
        };
    }, [setAuthState, setSessions]);

    useEffect(() => {
        if (!authState.waiting || authState.requestId === null) return undefined;
        const requestId = authState.requestId;
        const timeout = window.setTimeout(() => {
            setAuthState((current) =>
                current.requestId === requestId
                    ? {
                          ...current,
                          waiting: false,
                          error: "No Lichess authorization was received. You can try again.",
                          requestId: null,
                      }
                    : current,
            );
        }, LICHESS_AUTH_TIMEOUT_MS);
        return () => window.clearTimeout(timeout);
    }, [authState.requestId, authState.waiting, setAuthState]);
}

/** Shared, single-listener OAuth state used by every explorer surface. */
export function useLichessExplorerAuth() {
    const sessions = useAtomValue(sessionsAtom);
    const [state, setState] = useAtom(lichessExplorerAuthStateAtom);
    const token = sessions.find((session) => session.lichess?.accessToken)?.lichess?.accessToken;
    const preferredUsername =
        sessions.find((session) => session.lichess?.username)?.lichess?.username ?? "";

    const connect = useCallback(async () => {
        const requestId = ++nextLichessAuthRequestId;
        setState((current) => ({
            ...current,
            waiting: true,
            error: null,
            requestId,
        }));
        try {
            const result = await commands.authenticate(preferredUsername.trim());
            if (result.status === "ok") return;
            setState((current) =>
                current.requestId === requestId
                    ? {
                          ...current,
                          waiting: false,
                          error: String(result.error),
                          requestId: null,
                      }
                    : current,
            );
        } catch (caught) {
            setState((current) =>
                current.requestId === requestId
                    ? {
                          ...current,
                          waiting: false,
                          error: caught instanceof Error ? caught.message : String(caught),
                          requestId: null,
                      }
                    : current,
            );
        }
    }, [preferredUsername, setState]);

    return {
        token,
        connect,
        waiting: state.waiting,
        error: state.error,
        connectedAt: state.connectedAt,
    };
}

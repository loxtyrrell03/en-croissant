import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { sessionsAtom } from "@/state/atoms";
import { getLichessAccount } from "@/utils/lichess/api";
import { loadSharedLichessCredential } from "@/utils/sharedLichessAuth";

export function useSharedLichessSession() {
  const [, setSessions] = useAtom(sessionsAtom);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;

    void loadSharedLichessCredential()
      .then(async (credential) => {
        if (!credential || !active) return;
        const account = await getLichessAccount({ token: credential.token, silent: true });
        if (!account || !active) return;

        setSessions((current) => {
          const existing = current.find(
            (session) =>
              session.lichess?.username.toLowerCase() === credential.username.toLowerCase(),
          );
          const alreadyCurrent =
            existing?.lichess?.accessToken === credential.token &&
            existing.lichess.account.id === account.id;
          if (alreadyCurrent) return current;

          return [
            ...current.filter(
              (session) =>
                session.lichess?.username.toLowerCase() !== credential.username.toLowerCase(),
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
}

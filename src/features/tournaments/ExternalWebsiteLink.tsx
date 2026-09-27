import { useEffect, useRef, useState, type ReactNode } from "react";
import { desktopApi, isNativeDesktop } from "@/features/tournaments/platform";

/** Use the system browser on desktop and an ordinary link on the web. */
export function ExternalWebsiteLink({ url, children, className }: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  const pending = useRef<{ url: string } | null>(null);
  const currentUrl = useRef(url);
  currentUrl.current = url;
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ url: string; message: string } | null>(null);
  useEffect(() => () => { pending.current = null; }, []);
  return <>
    <a className={className} href={url} target="_blank" rel="noopener noreferrer"
      aria-disabled={opening === url || undefined} aria-busy={opening === url || undefined}
      onClick={async event => {
        if (!isNativeDesktop()) return;
        event.preventDefault();
        if (pending.current?.url === url) return;
        const request = { url };
        pending.current = request;
        setOpening(url);
        setFailure(null);
        try {
          // The existing command validates public HTTP(S) addresses. Retain
          // its legacy name for compatibility with installed native versions.
          await desktopApi.openTournamentWebsite(url);
        } catch (caught) {
          if (pending.current === request && currentUrl.current === url) {
            setFailure({ url, message: caught instanceof Error ? caught.message : String(caught) });
          }
        } finally {
          if (pending.current === request) {
            pending.current = null;
            setOpening(null);
          }
        }
      }}>{children}</a>
    {failure?.url === url && <span role="alert">Could not open browser: {failure.message}</span>}
  </>;
}

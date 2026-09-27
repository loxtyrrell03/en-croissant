import { useEffect, useId, useRef } from "react";
import type { DownloadRemovalReview } from "@/features/tournaments/platform";
import css from "./DownloadRemovalDialog.module.css";

export function DownloadRemovalDialog({ review, name, busy, onCancel, onConfirm }: {
  review: DownloadRemovalReview | null; name: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { if (review) ref.current?.showModal(); else if (ref.current?.open) ref.current.close(); }, [review]);
  const otb = review?.id === "otb-library";
  const bytes = review?.bytes ?? 0;
  const size = bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return <dialog ref={ref} className={css.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id={titleId}>Remove {name}?</h3>
    <p>Permanently delete {size} of downloaded files{otb ? " and turn off automatic downloads" : ""}. You can download them again later.</p>
    <p>Your imported Library games stay.</p>
    {!otb && <p>If this copy is in use, its downloaded lookups will stop.</p>}
    {review?.shared && <p>These files are outside managed downloads. Other apps using the same files will also lose access.</p>}
    {!!review?.paths.length && <details><summary>{review.paths.length > 1 ? "Folders and copies to remove" : "File location"}</summary>{review.paths.map(path => <p key={path} className={css.path}>{path}</p>)}</details>}
    <div className={css.actions}><button type="button" disabled={busy} autoFocus onClick={onCancel}>Cancel</button><button type="button" className={css.remove} disabled={busy} onClick={onConfirm}>{busy ? "Removing…" : "Remove downloaded files"}</button></div>
  </dialog>;
}

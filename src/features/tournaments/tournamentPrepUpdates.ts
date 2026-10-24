import { loadTournamentPreps, saveTournamentPreps, type TournamentPrepRecord } from "./tournamentPrepStore";

let updateTail: Promise<unknown> = Promise.resolve();
/** Serialize source refreshes and manual edits through a fresh read. An
 * in-flight settings write must not let an older pending snapshot win. */
export function updateTournamentPrep(
  id: string,
  update: (record: TournamentPrepRecord) => TournamentPrepRecord | null,
): Promise<TournamentPrepRecord | null> {
  const operation = updateTail.then(async () => {
    const records = await loadTournamentPreps();
    const current = records[id];
    if (!current) return null;
    const next = update(current);
    if (!next) return null;
    await saveTournamentPreps({ ...records, [id]: next });
    return next;
  });
  updateTail = operation.catch(() => undefined);
  return operation;
}

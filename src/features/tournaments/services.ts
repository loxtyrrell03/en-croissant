import { startOtbDownloadManager } from "./downloads/otbDownloads";
import { registerTournamentPrepAutoUpdateJob } from "./tournamentPrepSync";
let started=false;
/** One owner per app. Closing a workspace must not abandon a download queue. */
export function startTournamentServices(){
  if(started)return;started=true;
  registerTournamentPrepAutoUpdateJob();startOtbDownloadManager();
}

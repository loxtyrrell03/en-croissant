import { useEffect } from "react";
import { OtbDownloadControl } from "./downloads/OtbDownloadControl";
import { startTournamentServices } from "./services";
import styles from "./TournamentSurface.module.css";
export function OtbDownloadsPanel({fromYear,sourceEnabled,onEnableSource}:{fromYear:number;sourceEnabled:boolean;onEnableSource:()=>void}){
  useEffect(startTournamentServices,[]);
  return <details className={styles.surface}><summary>Local games & download settings</summary><OtbDownloadControl fromYear={fromYear} sourceEnabled={sourceEnabled} onEnableSource={onEnableSource}/></details>;
}

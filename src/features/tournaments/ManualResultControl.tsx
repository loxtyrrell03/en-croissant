import type { TournamentPairing, TournamentSnapshot } from "@/features/tournaments/platform";
import { HelpTip } from "@/features/tournaments/ui";
import { canEnterManualResult, manualResultInput, type ManualGameResult, type ManualTournamentResult } from "./manualTournamentResults";
import styles from "./TournamentTrackerView.module.css";

export function ManualResultControl({ snapshot, pairing, manual, busy, onChange }: {
  snapshot: TournamentSnapshot;
  pairing: TournamentPairing;
  manual?: ManualTournamentResult;
  busy: boolean;
  onChange?: (input: ManualTournamentResult, result: ManualGameResult | null) => Promise<void>;
}) {
  if (!onChange || !canEnterManualResult(snapshot, pairing)) return null;
  const white = snapshot.players.find(p => p.startNumber === pairing.whiteStartNumber)!;
  const black = snapshot.players.find(p => p.startNumber === pairing.blackStartNumber)!;
  return <label className={styles.manualResult}>
    <span>{manual ? "Manual result" : "Use a result"}<HelpTip label={`Manual result for ${white.name} vs ${black.name}`}>
      Use an assumed result for pairing predictions. The organiser’s official result automatically replaces it.
    </HelpTip></span>
    <select aria-label={`Manual result for ${white.name} vs ${black.name}`} value={manual?.result ?? ""} disabled={busy}
      onChange={event => {
        const result = (event.target.value || null) as ManualGameResult | null;
        void onChange(manualResultInput(snapshot, pairing, result ?? "1-0"), result);
      }}>
      <option value="">{manual ? "Clear manual result" : "Choose result…"}</option>
      <option value="1-0">White wins · 1–0</option>
      <option value="1/2-1/2">Draw · ½–½</option>
      <option value="0-1">Black wins · 0–1</option>
    </select>
  </label>;
}

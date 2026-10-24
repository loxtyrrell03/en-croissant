import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
    DEFAULT_GAME_REPORT_SETTINGS,
    normalizeGameReportSettings,
    type GameReportSettings,
} from "@/utils/gameAnalysisSettings";

const stored = atomWithStorage<unknown>(
    "report-settings",
    DEFAULT_GAME_REPORT_SETTINGS,
    undefined,
    { getOnInit: true },
);
export const reportSettingsAtom = atom(
    (get) => normalizeGameReportSettings(get(stored)),
    (_get, set, value: GameReportSettings) => set(stored, normalizeGameReportSettings(value)),
);

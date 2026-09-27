// The handoff is scoped to En Croissant. Host adapters consume its exact source.
export type PrepPanelVariant="side"|"under";
export const PREP_KEYS={mode:"encroissant.tournamentPrep.mode",player:"encroissant.tournamentPrep.player",playerColor:"encroissant.tournamentPrep.playerColor"};
export const sourceKeyForVariant=(variant:PrepPanelVariant)=>`encroissant.tournamentPrep.source.${variant}`;

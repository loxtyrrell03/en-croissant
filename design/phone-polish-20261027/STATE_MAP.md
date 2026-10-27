# Phone surface and state map

| Surface | Main task and controls | Required states and behavior |
| --- | --- | --- |
| Shell | Existing six pages, service status | Preserve selected page, On/Off choices and drafts. Allow navigation wrapping at enlarged text. Show connection failure/retry without remounting unrelated content. |
| Board / Moves | Mainline and variation moves, navigation, paste PGN/FEN | Alternative legal moves create/select variations. Original mainline, comments and drawings remain. Returning to mainline is explicit. Loading sync cannot reset an open game. |
| Board / Database | Source, player, side, results, dates | Source full width; player and side use separate responsive rows. Keep loading, empty and unavailable distinct. Do not present missing sample data as zero. |
| Board / Prep | Player/general, source, import, strength, builder | Source and mode each have their own row. Player/side stack; numeric filters align in two columns. Dates full width. Start remains nearby and visibly disabled only when required setup is missing. |
| Prep running | Training moves, next action, stop/reset | Preserve active setup, root position and progress. Stop/cancel does not delete imported games. Source failure retains previous ready data and explicit retry. |
| Board / Analysis | Live/report/plans, resources, search limits | Preserve approved inline resources and search controls, saved values, enabled state, running ownership and progress. Errors wrap fully; status changes do not flash the board. |
| Board / Coach | Position guidance and actions | Keep task action close to guidance. Preserve unavailable/loading/empty states and the current position. |
| Import | Visible paste editor, FEN/PGN, choose file | Put manual import first. Preserve draft while changing pages, show parse errors beside editor, and provide explicit Import/Open action. Empty/invalid inputs cannot replace the current game. |
| Files | Search, active/archive selection, open, archive/unarchive | Label synchronized scope. Archive changes reflect shared Novelty dev state when supported; show pending/error honestly. Preserve games. Inherited folder archives explain their source. |
| Files / sync | Last successful check, retry, conflict review | Surface the specific failure. Keep offline edits. Never silently discard one side of a conflict. A healthy endpoint alone is not proof that files and archive states match. |
| Events | Discovery, followed events, tracker, Prep | Keep Stop following accessible and separate from delete. Retain existing confirmation and imported games. Loading/cancel/failure stays next to the operation. |
| Review | Position, hint, feedback, next action | Stable board and progress. Secondary setup folds without losing controls or drafts. Preserve current review if another page loads. |
| Stats | Account, scope, dates, results | Label every count/percentage with scope. Keep wins/draws/losses visible including 0%. Missing values stay unavailable; preserve custom dates. |
| Help | Adjacent question mark | Reuse existing focus/touch/hover help. Viewport bounded, dismissible by Escape/outside tap. Essential errors and decisions stay visible. |
| Narrow / enlarged text | All controls at 320/390/760px | Use whole-word wrapping and minimum 44px targets. No horizontal page overflow, overlap, hidden actions or fixed heights clipping errors. Retain all page destinations and board tools. |

A preserves the existing inline interaction model. B adds step ownership and
back/next draft retention. C adds editor drafts and Apply/Cancel ownership.
Shared recovery, preservation, help and responsive requirements apply to all.

Required runtime validation: actual rendered pages with isolated synthetic APIs
and storage, actual move-tree changes and serialization, source selection, manual
PGN/FEN import, archive/unarchive handoff, pending sync/retry, and navigation with
unsaved edits. Separately verify canonical delivery and live authoritative data;
PC-browser checks do not establish physical iPhone behavior.

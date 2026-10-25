# Recoverable appearance and layout reset

Native Help now opens Reset appearance and layout in the existing Mantine dialog
style. The legacy menu action ID remains compatible. It replaces the old broad
confirmation that cleared all local/session storage and reloaded the document.
The exact former action reproduced removal of synthetic accounts/progress and
unsaved workspace data, plus a forced reload; no owner store was exercised.
Novelty source references are f68a34de and92e6a372.

## Scope and ownership

Only these reviewed browser-owned presentation keys participate:

| Key | Scope | Runtime owner |
| --- | --- | --- |
| board-style | Default/Chess.com board style | boardStyleAtom |
| piece-set | Native piece artwork | pieceSetAtom |
| board-image | Native board background | boardImageAtom |
| font-size | App text size, percent; reset100 | fontSizeAtom |
| board-manual-size | Board size, pixels/automatic | boardManualSizeAtom |
| boardWorkspaceLayout | Pane width percent and heights in pixels | workspaceLayoutAtom |

All readers/writers were checked: these keys have no native settings mirror.
The pane atom moves unchanged from BoardsPage into state/store/workspaceLayout,
so the workspace and reset share the same actual atom. Its dimensions and
existing drag behavior are unchanged. Each reset/restore updates the current
Jotai store directly, without reload, tab close, save diversion or data migration.
Games, annotations, sessions, progress, source selections, paths, engines, theme,
language, sound choices, native title-bar choice and unrelated settings remain.
This is an exact key manifest, never prefix matching or a global storage clear.

## Recovery contract

A complete raw-value undo record is written and read back before any appearance
mutation. No new reset can overwrite an unresolved backup. Missing values and
original bytes are retained; invalid original JSON can be restored byte-for-byte
while the runtime uses a safe presentation default. Unknown/newer/corrupt backup
formats block reset/restore/discard and remain untouched.

Board/pane drags can have a newer buffered value than disk. The snapshot includes
that value. Applying only a manifest key finishes it synchronously and removes
its pending buffered write, so a later drag timer cannot undo reset or restore.
Unrelated pending writes retain their normal lifecycle. Failed resets try to
restore every prior key independently; the durable backup remains for retry.
Restore removes the undo copy only after all six keys pass readback. Keep current
is an explicit user action that removes just that validated backup. This is a
single-document synchronous operation, not a cross-process storage lock.

## Dialog states

| State | Action and behavior |
| --- | --- |
| Customized, no backup | Reset appearance writes the undo record, then applies defaults |
| Already default | Reset disabled; Close remains available |
| Backup present | Restore previous or Keep current; no second reset |
| Backup/storage unreadable | Visible alert, Retry lookup and Close; no destructive fallback |
| Partial reset/restore failure | Alert retains backup/retry path and dialog; no success notice |
| Success | Visible result; focus follows the next action; Close preserves workspace |

The small replacement uses native Mantine Modal/Group/Button/Text controls and
existing theme tokens. Buttons wrap with natural widths; no equal-width clipping.
Error text receives focus, and a replaced action moves focus to its successor.
Initial focus and dismissal use the existing dialog behavior. State checks run
against actual controls/atoms; no HTML screenshot is claimed as browser proof.

## Verification and delivery

Three old-action consequences reproduced in isolated synthetic storage. Eight
new preference cases and three actual-modal cases cover preservation, immediate
runtime values, backup write/readback failure, partial reset, pending drags,
remount/restore failure/retry, exact/absent values, corrupt/newer backup blocking,
malformed original values, resolved backup ownership and focus/close/retry.
All48 related checks across seven files, full types and eight-file lint pass with
zero warnings/errors. The new focus fixture waits for the native dialog's delayed
initial focus before testing action/error focus.

Clean source cfc2a7f3 passes499 selected checks/69 files and full types. Native
packaging succeeds in2m53s with22 existing warnings. The exact App/reset,
workspace-layout and BoardsPage compressed assets are embedded; all102 Stockfish
engine/source resources match104581828 bytes, and eight owned product files match
primary1635480b. Only two known generated outputs were restored, leaving clean
source. The47868416-byte executable has SHA-256
e66658c11e3e6f7c8eeab67527781f59925bc53fb74c14b30acae664ace606f2.
See the delivery JSON for the compact receipt. The phone has no
corresponding Help storage-wipe menu; its root-owned workspace writer is retained,
and this native-only replacement requires no phone publication. Live phone source
remains41668e2b. A fresh browser inventory still reports local browser use disabled
in Work settings. Rendered320/390px/doubled-text/native-window/device checks remain
separate. No owner reset, profile maintenance, runtime restart or hosting change
was performed during these fixtures. The wider history goal remains active.

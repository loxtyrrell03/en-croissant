# Novelty's compact Actions menu target decision

Novelty a717698b replaces its under-board Save/Annotate/Import/More controls with
one Actions button. It also allows its custom PanelPaste editor to be opened
from that menu, shares its trigger anchor and bounds the floating editor above
or below that anchor. Custom menu items gain a coarse-pointer minimum height.
These are changes to Novelty's own toolbar and popover architecture.

En Croissant's active `BoardsPage` loads `BoardAnalysis`, which supplies
`BoardControls` to `GameNotation`. Its vertical icon controls and notation actions
are separate from the under-board mode switch/Coach header. There is no matching
four-button Save/Annotate/Import/More row or PanelMoreMenu/PanelPaste component.
Copy PGN remains the notation action with its existing ownership/error behavior.
The new native keyboard ownership guard separately covers existing menus and
focused controls; this review does not replace that guard.

The phone's owner-selected compact navigation and Analysis A have direct move
annotations, Note/Draw/PGN controls and a separate Import workspace. Pasted PGN
uses the normal page's bounded autosizing textarea, rather than a floating
short-panel editor. Consolidating these controls into another menu would change
the selected En layout. Preserve that layout and its existing action wiring.

No shared model, command, parser, save or clipboard behavior is introduced by
this particular Novelty delta. Its target decision is to retain En's native
presentation. Broader acquisition, copy/FEN, save/export and help behavior retain
their separate audit rows and evidence; this review does not certify all those
actions or new rendered/touch behavior. No owner source or application state was
changed to inspect the two source architectures.

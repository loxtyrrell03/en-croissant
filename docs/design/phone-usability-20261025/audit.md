# Phone usability audit — 25 October 2026

The owner selected A (Compact tabs). Its implementation and verification are
recorded in ../../PHONE_USABILITY_2026-10-25.md. B and C remain alternatives.

The supplied iPhone screenshot matches the rendered live route at 390px. The
Stop following action is wired, but appears only inside Tracking, beyond the
visible portion of a horizontally scrolling tab strip. The independent fix
puts it before the event title, available from every tracker tab. Confirmation
retains imported games. Deleting games stays a separate, explicit operation.

## Scope and intended improvements

| Surface | Current friction | Design coverage |
| --- | --- | --- |
| Global shell | Six top destinations, an additional Import control, persistent service explanation; no top safe-area inset in the sticky header | Three distinct navigation arrangements; all six destinations remain reachable; compact PC status with adjacent accessible help; safe-area padding |
| Board | Five secondary tools, engine/settings/move controls compete at narrow widths | Board stays central; reachable tools and primary analysis action; no lost drawings, annotations or workspace |
| Database / Prep | Long source labels, many filters, ambiguous acquisition versus opening | Full-width source choice; user-colour labels retained; filters folded; Import games / Build preparation / Open Prep distinguish states |
| Analysis / Coach | Many controls and explanatory rows | Primary Start/Stop beside actual status; labelled engine evidence; optional limits and plan settings |
| Tournaments | Nested top tools wrap into a second row; long entry selector; Tracking obscured; completed-event comparison dominates initial view | Stop following visible; compact event identity; all tracker destinations reachable; detail-first player prediction design retained |
| Discovery / setup | Filters, following list, source link and selected identity are separate states | Search, geography, date, event preview and entry selection; explicit Follow tournament |
| Players / predictions | List, selected player, next/past predictions, uncaptured history and official comparison | Existing chosen player direction retained; full-width detail; unknown forecasts stay unknown; no invented historical forecasts |
| Results / Tracking | Round selector, manual result, auto-update and deletion options | Round and result labels; assumptions separate from official results; keep-games unfollow separated from deleting databases |
| Import | Online import plus PGN files/paste and separate tournament OTB tooling | Clear Online / PGN / OTB routes; source, identity and date before Import; progress, cancellation, failure and retry beside job |
| Review | Setup, shared automation, due cards, session, solution and review history | Start review; existing board-based session; settings, pause/resume, answer/solution and history preserved |
| Files | Hosted / local sources, folders, game lists, database filter and archive states | Source scope, search, folder breadcrumb, Open games / Open Prep; archive and import remain reachable |
| Stats | Source, account, time class, rated/date controls plus Overview / Strength / Report | Short account row, editable period, scoped labelled metrics; filter/detail disclosure; empty account action |
| Global states | Loading, unreachable services, save failure and update warnings | Visible retry without losing work; service choice preserved; no reload/reset as recovery |

## Required interaction and responsive checks after selection

- 320, 360, 390 and 430px; enlarged text; landscape/tablet and existing desktop.
- Top/bottom safe areas, every navigation destination, long names, no page-wide
  horizontal overflow; tables may scroll inside their labelled container.
- Hover, focus and tap help, close/Escape, bounded popovers and visible focus.
- Follow, refresh, choose entry, stop/cancel, unfollow Cancel/Confirm, failed-save
  retry, retained games and reopening discovery. Use synthetic fixtures for
  destructive tests; never unfollow the owner's real event for QA.
- Board tools, PGN/online/OTB import routes, Review setup/session, Files folders
  and details, Stats sections and custom ranges. Preserve stored preferences,
  unfinished games, source selection and explicit PC On/Off choice.
- Actual deployed shell/assets, HTTPS workspace/library/tournament APIs and
  connected render must be checked separately from source tests. PC browser
  verification does not establish physical-iPhone verification.

## Options and state sheets

`comparison.svg` compares the tournament screen. Each A/B/C option has a pages
sheet (six pages), details sheet (setup and nested tools) and states sheet
(loading, empty, error/retry, progress/cancel, unfollow confirmation, settings,
help and failed save). All data is illustrative. Editable text and geometry
use the current Mantine dark surfaces, blue controls and existing board colours.

These are visual prototypes; they do not imply completed application wiring.
A keeps the current six-page structure and is the least disruptive choice.
B moves primary navigation to the thumb area and puts Import/Stats in More.
C uses a page switcher and frees the most space for each task.

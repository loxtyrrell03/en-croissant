# Daily study plans

The desktop Home Daily Goals area also reads an optional `daily-study-plan.json`
from the configured EnCroissant documents directory. No file means no additional
panel. Loading a plan preserves existing review goals, review decks and history.
The plan contains 60- and 90-minute allocations, instructions, optional summaries,
local PGN resources and HTTPS course links. Both allocations must sum correctly;
step IDs must be unique. Invalid saved plans display a Retry action.

Each block opens its instructions and resources. PGNs use the normal in-app file
workflow. Course buttons open an En Croissant study window; Open in browser uses
the normal browser and its existing login. A course whose exact URL is not yet
known explicitly says Link course rather than pretending to be linked. Changes
read the latest saved plan before updating only that resource ID. No purchased
course contents are copied or downloaded.

Study windows use the app's persistent `study-browser` WebView profile. They have
no native app capabilities; the native opener accepts only normal HTTPS links to
Chessable, Lichess or Chess.com and only requests from the main app window.
Authentication is the website's normal login. The app never collects passwords,
copies Chrome cookies or stores credentials in plan JSON. Browser-provider login
may require Open in browser; retained sessions remain subject to website expiry.

Completion is an explicit user checkmark, not a claim of measured study time or
automatic Chessable progress. Notes and checks are saved per plan and London
calendar day under separate local-storage keys. Changing the time allocation
does not erase progress; Reload plan refreshes externally edited course links.
Opening topics can remain fixed for several numbered weeks from `startDate`.

Verification: seven focused schema and mounted-React checks, native study-URL
validation, full TypeScript checking and the production frontend build pass.
The actual panel was rendered in a private browser preview, including opening
details at 390px with no horizontal overflow. Preview proof is separate from
native course-window, authenticated-course and physical-phone verification.
This desktop extension does not change or publish the hosted phone app.

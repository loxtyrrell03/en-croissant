# Database result labels

`components/common/WdlResultBar.tsx` owns the result display used by desktop
Database, Prep, opening review, opening health and the phone's Database/Prep
rows. Percentages have separate label space above the proportional bar, so
small and zero segments remain visible. Narrow cells wrap labels instead of
clipping them. Existing database/prep colours and decimal precision are retained.

Black-perspective Database rows keep their existing result order and explicitly
name the winning colour in accessible text and each label's title. No completed
results show dashes; invalid/missing counts are unavailable, rather than a false
zero percentage. The component forwards its DOM reference and target events so
existing review tooltips continue working.

Nine component checks cover tiny/zero segments, dense mode, Black perspective,
phone precision/palette, empty/invalid results and review tooltip wiring. Whole
TypeScript and scoped native/result lint pass. The WebApp's 25 existing lint
warnings match its unchanged baseline exactly. Actual components render in
Chrome at 390px in light/dark themes and at 320px with doubled text, including
the phone's minimum 3.9rem bar width, without clipped labels or page overflow.
This is source/component proof; runtime delivery is recorded in the parity
delivery receipt separately.

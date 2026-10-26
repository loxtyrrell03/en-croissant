# Resource-control surface and state map

| Surface/state | Required behavior |
| --- | --- |
| Native current engine | Resource-only changes affect the intended local engine/tab. Keep its current lines, search mode, defaults/sync and On/Off choices. |
| Native Engines profile | Reuse resource behavior for the selected profile's defaults; preserve other UCI options and save-failure ownership. |
| Phone PC engine | Recommendations and bounds come from the PC that runs analysis. Existing fixed presets/custom values stay explicit until changed. |
| Phone-managed engine | Keep supported single-thread/WASM limits; do not imply that phone hardware can configure the PC. |
| LCZero | Preserve its separate GPU network/batch/cache behavior. Generic Threads/Hash controls only apply to supported CPU options. |
| Setup/first use | Recommend device Balanced for genuinely new settings after a bounded capability read; never infer first use from unreadable settings or default-looking saved values. |
| Existing/legacy/custom | Display exact saved values, including non-power-of-two values and values beyond a new recommendation. Selection does not silently overwrite them. |
| Loading | Keep current controls/values stable while checking device details. Device reads start no engine or benchmark. |
| Unavailable/retry | State unavailable clearly, allow retry and use conservative recommendations; missing memory is not zero memory. |
| Preset change | Change CPU and hash only. Resolve supported engine bounds and included-engine budget; do not change lines, depth/time/nodes or engine choice. |
| Slider/exact field | Draft during a gesture. Release or completed keyboard edit commits to the intended edit scope; exact input accepts valid whole numbers with visible units. |
| Cancellation | Escape, pointer cancellation, lost capture/window blur discard the unfinished gesture. B/C additionally retain their editor draft until Apply; Cancel discards it. |
| Applying/search | Apply once after ownership checks. Preserve the selected game/position. A stopped, removed, replaced or focus-paused engine must not be revived. |
| Failed save/apply | Keep current and previous settings separate; show the error next to Retry/Restore previous. A failed preference write cannot be described as saved. |
| Another included engine | Refresh recommendations from a device snapshot and engine count, without moving sliders or changing current choices automatically. |
| Insufficient aggregate budget | If minimum threads/hash cannot fit the snapshot budget, explain that a recommendation is unavailable and disable preset application; keep existing explicit settings readable and unchanged. |
| Changed profile/tab | Late capability, validation, save and apply replies belong to the captured owner and cannot overwrite its replacement. |
| PC Off/offline | Existing service On/Off is authoritative. Keep saved choices, expose connection/retry near controls, and start no worker merely to read resources. |
| Help | Adjacent question marks support hover/focus/tap, viewport bounds, outside-tap and Escape dismissal. Errors and required choices stay visible. |
| Narrow/large text | Stack where needed at320/390px and narrow desktop widths. Values, labels, help and apply/cancel remain reachable. Static diagrams are not runtime proof. |

All examples use an invented20-thread/32-GiB computer and one included CPU engine.
10 threads and1024 MiB are an example recommendation, not this owner's measured
machine configuration. Native and phone delivery, actual search behavior,
preference writes and rendered-device evidence require separate verification.

Direction A is selected. Its completed field/preset edit applies once without a
second confirmation. B/C's dialog/editor draft behavior remains an alternative,
not the selected implementation. Preserve native per-tab/default ownership.

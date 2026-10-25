# Engine logo recovery

Native engine names and Add engine cards use the same compact image component.
It tries a user's chosen image, then an inline bundled mark for recognized
Stockfish/LCZero programs, then the existing CPU/cloud icon. Native executable
names and explicit PC engine kinds still identify an engine when its owner
changes the display name. Cloud tablebase labels and unrelated forks keep their
generic service/program icon.

File paths use the native asset converter. HTTP, image data, blob and native
asset URLs are already image sources and are used directly. Image lookup errors
and image decode/load errors both recover. Profile/image identity owns loading
and error state: an old file reply or image error cannot replace a newer
profile's image. Navigation back retries the custom image; failure never
rewrites the stored image choice. The marks are inline PNG data, so no remote
logo fetch or public asset cache is needed for the fallback.

Artwork bytes are copied unchanged from Novelty commit `497f656b`. Attribution
and the existing permission limits remain in `src/assets/engines/README.md`.
This change reuses En Croissant's current sizing and CPU/cloud icons.

Three failures were reproduced after extracting the previous engine-name image
presentation: no bundled mark, no recovery from a broken custom image, and a
data URL incorrectly passed through file conversion. Twelve actual component
checks now cover those cases, local lookup failure, two-stage fallback, delayed
replies/errors, changed images, navigation retry, executable/PC identity and
generic service/fork icons. Combined with existing catalog/registration controls,
all 40 checks across three files pass. Full types and five-file lint pass with
one unchanged engine-options effect warning and no errors. Clean combined package verification is recorded below.

The phone selects managed engines through text controls rather than native
engine profile/catalog cards, and does not expose custom engine images. Its
Live/Plans/report engine selection remains unchanged; this desktop image
recovery behavior has no corresponding phone image state to port.

Clean combined source `0a0056a6` passes all 107 engine checks across nine files
and full types. Setup's broader clean run passes 549 related checks/71 files;
the six native configuration checks include actual Stockfish 19. The complete
desktop build passes with 22 existing native warnings. Its 47,864,320-byte EXE
has SHA-256 `50b7e48da6a76ff973860fb6517453c362452fc8c94c1083a8274db5fe1916d9`.
The exact engine-page asset, including both inline marks and setup controls,
matches its Brotli-compressed Tauri asset and those compressed bytes are found
in the executable. Both native setup commands are present. All 102 bundled
engine/source files (104,581,828 bytes) match the verified stage, and all 25 owned
committed files match primary. Only two known generated build outputs were
restored afterward; the delivery checkout is clean. The Dev server serves the
new component; this is source/package evidence, not rendered-window proof.
No phone service, PC engine helper or owner profile was manually changed.

# Compression notices in En Croissant

Novelty `d230b44f` added complete compression grants to About and the native
distribution. En's existing About dialog and native resource mapping omitted
them. Its root Cargo.lock also pins older versions, so Novelty's version labels
cannot be copied unchanged.

The native application uses zstd 0.13.2, zstd-safe 7.2.1 and
zstd-sys 2.0.13+zstd.1.5.6. The manifest records the exact MIT wrapper grants and
BSD-3-Clause bundled C grant. Both independent existing Cargo registry copies
contain identical source bytes; the retained notice files match their SHA-256
hashes. No dependency was upgraded or downloaded. Licence bytes use LF in Git.

About now has a collapsed Compression library notices disclosure in the existing
Mantine dialog. The complete text wraps, can receive focus and scrolls within
a bounded area. The existing close button has an explicit accessible name.
The standalone THIRD_PARTY_NOTICES.txt is mapped into native distributions.
The normal Tauri before-build hook verifies versions, exact grant bytes,
complete distributed text and resource mapping before compiling the frontend.
Run the check directly with `node scripts/verify-compression-notices.mjs`.

Five Node checks cover the current record and failures for changed versions,
modified/omitted grant text, lost resource mapping and omitted bundled C notice.
One actual About component workflow checks disclosure, complete text, focus,
wrapping and closing. These six checks and full TypeScript pass independently
in primary and delivery checkouts; scoped four-file lint has no warnings/errors.
Native packaging is the next step. Browser-rendered narrow/touch and native-window
proof are unavailable while browser control remains disabled.

This record covers the root native lockfile's compression dependencies. The
phone frontend has no native About entry point and receives no Rust compression
code. Its separately compiled hosted helper uses a different Cargo.lock
(zstd 0.13.3, zstd-safe 7.3.0, zstd-sys 2.1.0+zstd.1.5.7); its distribution
notices remain a separate audit item. The existing Stockfish source/licence
resources are retained. This is not a complete third-party dependency inventory.

The existing Dev watcher relaunched after the native resource configuration
changed. No manual Dev restart or owner corpus/profile/service operation was
performed; the hosted phone publication is unchanged by this native source slice.

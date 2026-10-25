# Windows native command transport

Novelty d52f614e and its current working source route Windows Tauri commands
through WebView2's native message bridge. En previously retained the pinned
Tauri2.10.2 default: first try fetch against the IPC custom protocol, then switch
to native postMessage if that fetch rejects. A resolved response instead chooses
the success/error callback from its Tauri-Response header.

An isolated fixture executes the actual pinned ipc-protocol.js and
process-ipc-message-fn.js. A rejected synthetic fetch reaches native fallback;
a resolved, unrelated403 reaches the error callback without delivering the
native command. There is no real HTTP request in this fixture. This reproduces
the routing failure class, rather than claiming an observed live En outage or
changing a localhost service to provoke one.

## Native integration and wire contract

The actual main.rs builder now installs windows-ipc.js through invoke_system
behind target_os=windows. Its authenticated native envelope matches the pinned
Tauri fallback: command, callback/error IDs, payload, options/headers, frame key
and customProtocolIpcBlocked=true. Tauri's builder substitutes __INVOKE_KEY__ at
runtime. The key stays in the script closure, outside postMessage.toString().
Map, Uint8Array, ArrayBuffer, nested arrays and Tauri's __TAURI_TO_IPC_KEY__
channel serialization retain their current wire representation. Caller options
are copied. Commands, including channel fetches, do not attempt HTTP first.
A native bridge error is surfaced without replay/fallback, which avoids a
transport-level duplicate of a mutating command.

The shim matches Novelty's current source after line-ending normalization and
retains Tauri's MIT/Apache attribution. An isolated comparison produces the same
native message from the actual pinned fallback and the shim; only the initial
HTTP attempt differs. Keep the envelope and serialization aligned when updating
the pinned Tauri version. Do not remove authentication or add automatic retries.

Other native platforms retain Tauri's default transport. The phone is an ordinary
browser/server client and does not run this native builder; its intended HTTPS
requests remain separate. No phone publication, route, port, server identity,
profile, database or session migration is needed. Novelty's accompanying
download-specific403 explanation has no matching En special-case string/handler
in the inspected source, so no foreign download-control copy is introduced.

## Verification and delivery

Seven portable Node fixtures cover authenticated single delivery, binary/map/
channel serialization, bridge failure, null/missing options, frozen caller
options, channel fetches and the actual Windows-only builder selection. Both
primary and clean checkouts pass them. The existing CI test job runs them as a
separate node --test step, since normal Vitest discovery excludes scripts/tests.
The two changed JavaScript files pass scoped lint with zero warnings/errors;
an explicit task lint config clears the normal src-tauri ignore for this check.

Native compilation/package evidence and target-specific boundaries are tracked
in NOVELTY_SYNC_2026-10-24_DELIVERY.json. Frontend source is unchanged from the
previous independent531-check milestone; these Node checks exercise a different
transport boundary and are not presented as another frontend suite run. Actual
native-window response/rendering and physical-device proof remain separate.

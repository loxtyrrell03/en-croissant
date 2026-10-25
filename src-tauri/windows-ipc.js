// Use WebView2's native message bridge on Windows. IPC must never fall through
// to an unrelated HTTP server listening on localhost. This is the same message
// envelope and serialization used by Tauri 2's postMessage fallback.
// Serialization adapted from Tauri (MIT / Apache-2.0), copyright 2019-2024
// Tauri Programme within The Commons Conservancy.
(() => {
  const invokeKey = __INVOKE_KEY__;
  Object.defineProperty(window.__TAURI_INTERNALS__, "postMessage", {
    value(message) {
      const { cmd, callback, error, payload, options } = message;
      const encoded = JSON.stringify({
        cmd, callback, error, payload,
        options: { ...options, customProtocolIpcBlocked: true },
        __TAURI_INVOKE_KEY__: invokeKey,
      }, (_key, value) => {
        if (value instanceof Map) return Object.fromEntries(value.entries());
        if (value instanceof Uint8Array) return Array.from(value);
        if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
        if (value !== null && typeof value === "object" && "__TAURI_TO_IPC_KEY__" in value) {
          return value.__TAURI_TO_IPC_KEY__();
        }
        return value;
      });
      window.ipc.postMessage(encoded);
    },
  });
})();

// src/lib/callErrors.js
//
// Agora's SDK (and the browser WebRTC APIs underneath it) don't always
// throw human-readable errors — the most common real-world case,
// especially inside the Android WebView, is failing to get microphone/
// camera access and surfacing that as a bare internal TypeError like
// "Cannot read properties of undefined (reading 'replace')" instead of a
// proper permission error. This turns that into something a person can
// actually act on, instead of a raw stack-trace fragment landing in a UI
// banner.
//
// Used by both calling engines (lib/call.js — in-thread calls, and
// lib/directCall.js — staff/dealer direct calls) in their join/publish
// catch blocks, so the two never drift into showing different wording for
// the same underlying failure.
const RAW_JS_ERROR_PATTERNS = [
  /cannot read propert/i,
  /is not a function/i,
  /is not defined/i,
  /undefined is not an object/i,
  /null is not an object/i,
];

export function friendlyCallError(e) {
  const msg = e?.message || "";
  const name = e?.name || "";
  const code = e?.code || "";
  const raw = [name, code, msg].filter(Boolean).join(" · ") || "no error details available";

  // Agora SDK's own permission-related error codes/messages, plus the raw
  // browser DOMException names getUserMedia throws when mic/camera access
  // is blocked.
  if (
    /PERMISSION_DENIED|NotAllowedError|Permission denied|DEVICE_NOT_FOUND/i.test(String(code)) ||
    /NotAllowedError|Permission denied|permission dismissed/i.test(msg) ||
    name === "NotAllowedError"
  ) {
    return { friendly: "Couldn't access the microphone/camera. Check that this app has Microphone (and Camera, for video calls) permission — Android Settings → Apps → SJO ERP → Permissions — then try the call again.", raw };
  }

  if (/NotFoundError|DEVICE_NOT_FOUND/i.test(msg) || name === "NotFoundError") {
    return { friendly: "No microphone was found on this device.", raw };
  }

  // A bare internal exception (from the SDK or a WebView quirk) rather than
  // a real, readable error message — don't show the stack-trace fragment
  // as the primary message, but keep it available as `raw` for debugging.
  if (!msg || RAW_JS_ERROR_PATTERNS.some((p) => p.test(msg))) {
    return { friendly: "Couldn't connect the call. Check your internet connection and that Microphone permission is allowed for this app, then try again.", raw };
  }

  return { friendly: msg, raw };
}

// api/_lib/cors.js
//
// Shared CORS handling for every /api/* endpoint the native Android app
// (Capacitor) calls. The WebView loads the bundled JS from its own local
// sandbox origin (https://localhost), NOT from this Vercel domain — so
// every fetch() it makes here is a genuine cross-origin request, unlike
// the web/PWA build where the page and this API share the same origin.
//
// Without these headers, the browser's preflight OPTIONS request fails
// silently and the real POST is never sent at all — the client-side
// fetch() throws "Failed to fetch" before the request ever reaches this
// server, so nothing shows up in Vercel's logs either. This was first
// diagnosed and fixed for api/agora-token.js and api/payments/create-qr.js
// (each with its own inline copy); this helper generalizes that fix so
// every other endpoint gets it too, instead of it being copy-pasted (and
// forgotten) per-file.
//
// "*" is fine on all of these — each endpoint enforces auth itself via
// resolveCaller()/accessToken, not via origin-checking, so an open CORS
// policy doesn't expose anything extra.
export function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Call at the very top of every handler, before any other logic:
//   import { applyCors } from "./_lib/cors.js"; (adjust path depth)
//   export default async function handler(req, res) {
//     if (applyCors(req, res)) return; // preflight handled, stop here
//     ...
//   }
export function applyCors(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

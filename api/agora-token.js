// api/agora-token.js
//
// Vercel Serverless Function — mints a short-lived Agora RTC token so the
// browser can join a call channel. The Agora App Certificate (secret) only
// ever lives here as a server-side env var; the browser only ever gets the
// App ID (public) and the token this returns.
//
// Body: { accessToken, channel }
// Channel is just the chat_thread id — anyone allowed into that chat thread
// (staff, the dealer, or their sub-staff) is allowed to call on it, so this
// reuses the same resolveCaller() check as the other admin endpoints rather
// than needing a separate "is this person in this thread" lookup.
//
// Required Vercel env vars (Project Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (already set for the login endpoints)
//   AGORA_APP_ID                              (Agora Console → your project → App ID, public)
//   AGORA_APP_CERTIFICATE                     (Agora Console → your project → enable a Certificate — keep secret)
//
// NOTE: "agora-token" ships as a CommonJS module (module.exports = {...}),
// and Node's ESM loader can't always statically detect every named export
// from a CJS module built that way — `import { RtcTokenBuilder, RtcRole }
// from "agora-token"` throws "Named export 'RtcRole' not found" at MODULE
// LOAD TIME (before this handler even runs), which crashed every single
// request here with FUNCTION_INVOCATION_FAILED. Importing the default
// export and destructuring from it avoids that.
//
// CORS: the Android app (Capacitor) loads its bundled JS from the WebView's
// own local sandbox origin (https://localhost), NOT from this domain — so
// every request it makes here is a genuine cross-origin request from the
// browser's point of view, unlike the web/PWA build where the page and
// this API share the same origin. Without explicit CORS headers, the
// browser fetch() call inside the app fails with an opaque
// "TypeError: Failed to fetch" before the response body is ever readable,
// even though this function ran successfully server-side. The headers
// below, plus responding to the preflight OPTIONS request, are what let
// that cross-origin call through.
import agoraToken from "agora-token";
import { resolveCaller } from "./_lib/adminAuth.js";

const { RtcTokenBuilder, RtcRole } = agoraToken;

const AGORA_APP_ID = (process.env.AGORA_APP_ID || "").trim();
const AGORA_APP_CERTIFICATE = (process.env.AGORA_APP_CERTIFICATE || "").trim();
const TOKEN_TTL_SECONDS = 3600; // 1 hour — plenty for any single call

function setCorsHeaders(res) {
  // "*" is fine here — this endpoint requires a valid Supabase accessToken
  // in the body to do anything, so an open CORS policy doesn't itself
  // expose anything; auth is enforced by resolveCaller() below, not by
  // origin-checking.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Preflight — the browser sends this automatically before the real POST
  // on a cross-origin request; it just needs a 2xx response with the CORS
  // headers above, no body required.
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    return res.status(500).json({ error: "Server isn't configured with AGORA_APP_ID / AGORA_APP_CERTIFICATE" });
  }

  try {
    const { accessToken, channel } = req.body || {};
    if (!channel) return res.status(400).json({ error: "channel is required" });

    const caller = await resolveCaller(accessToken);
    if (!caller) return res.status(403).json({ error: "Not signed in" });

    // uid 0 = a "wildcard" token — the client picks its own numeric uid at
    // join time rather than this token being locked to one. Standard pattern
    // when the server doesn't need to track a stable per-user Agora uid.
    const uid = 0;

    // IMPORTANT: this build of `agora-token` (2.0.5, backed internally by
    // RtcTokenBuilder2) takes 7 arguments, and the LAST TWO are DURATIONS
    // in seconds (e.g. 3600), not an absolute Unix timestamp. Passing an
    // absolute epoch value here (~1.7 billion) — which is what an earlier
    // version of this file did — doesn't throw an error, it just silently
    // produces a corrupted token. That token then fails on the CLIENT side
    // with a confusing, seemingly-unrelated "AgoraRTCError
    // CAN_NOT_GET_GATEWAY_SERVER: invalid vendor key, can not find appid"
    // the moment it tries to join a channel — even though the App ID
    // itself is completely fine. Confirmed via Agora's own Web Demo +
    // Console-generated temp token, which worked with the exact same App
    // ID, proving this endpoint's generated token was the actual problem.
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      String(channel),
      uid,
      RtcRole.PUBLISHER,
      TOKEN_TTL_SECONDS, // tokenExpire
      TOKEN_TTL_SECONDS  // privilegeExpire
    );

    res.json({ token, appId: AGORA_APP_ID, uid });
  } catch (e) {
    // Whatever this is, surface it as a normal JSON 500 instead of letting
    // it crash the function opaquely.
    console.error("agora-token failed:", e);
    res.status(500).json({ error: e.message || "Unexpected server error" });
  }
}

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
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { resolveCaller } from "./_lib/adminAuth.js";

const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;
const TOKEN_TTL_SECONDS = 3600; // 1 hour — plenty for any single call

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    return res.status(500).json({ error: "Server isn't configured with AGORA_APP_ID / AGORA_APP_CERTIFICATE" });
  }

  const { accessToken, channel } = req.body || {};
  if (!channel) return res.status(400).json({ error: "channel is required" });

  const caller = await resolveCaller(accessToken);
  if (!caller) return res.status(403).json({ error: "Not signed in" });

  // uid 0 = a "wildcard" token — the client picks its own numeric uid at
  // join time rather than this token being locked to one. Standard pattern
  // when the server doesn't need to track a stable per-user Agora uid.
  const uid = 0;
  const privilegeExpiredTs = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    String(channel),
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs
  );

  res.json({ token, appId: AGORA_APP_ID, uid });
}

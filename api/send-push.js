// api/send-push.js
//
// Vercel Serverless Function — the client-facing entry point for sending a
// real push notification. Verifies whoever's calling is actually signed in
// (resolveCaller), then hands off to _lib/push.js's sendPushNotification(),
// which is the actual FCM-sending logic — shared with server-to-server
// callers like api/payments/webhook.js that have no signed-in user to
// check at all.
//
// Body: { accessToken, targetType, targetId, title, body, data }
//   targetType/targetId — 'staff' | 'dealer' | 'dealer_staff' + that row's id,
//   OR targetType: 'all_staff' to broadcast to every staff device (used for
//   "a dealer sent a message" — any staff member might pick it up).
//
// Required Vercel env vars (Project Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (already set for the login endpoints)
//   FIREBASE_SERVICE_ACCOUNT                  (see below — not set yet)
//
// FIREBASE_SERVICE_ACCOUNT: the JSON key for a Firebase service account with
// permission to send via FCM for the sharmajikaoffice-242eb project
// (android/app/google-services.json). Get it from:
//   Firebase Console → Project Settings → Service Accounts → Generate new
//   private key
// That downloads a .json file — paste its ENTIRE contents as the value of
// this env var (Vercel handles multi-line values fine). Nothing will send
// until this is set; every other piece (token capture, the DB table, the
// Android manifest/gradle wiring) is already in place.
import { resolveCaller, supabaseAdmin } from "./_lib/adminAuth.js";
import { applyCors } from "./_lib/cors.js";
import { sendPushNotification } from "./_lib/push.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight handled

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Server isn't configured with SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const { accessToken, targetType, targetId, title, body, data } = req.body || {};
    if (!targetType || (!targetId && targetType !== "all_staff")) {
      return res.status(400).json({ error: "targetType and targetId are required" });
    }
    if (!title) return res.status(400).json({ error: "title is required" });

    const caller = await resolveCaller(accessToken);
    if (!caller) return res.status(403).json({ error: "Not signed in" });

    const result = await sendPushNotification({ targetType, targetId, title, body, data });
    if (result.reason && result.sent === 0 && result.failed === 0) {
      return res.json({ sent: 0, reason: result.reason });
    }
    return res.json({ sent: result.sent, failed: result.failed });
  } catch (e) {
    console.error("send-push failed:", e);
    return res.status(500).json({ error: e.message || "Unexpected server error" });
  }
}

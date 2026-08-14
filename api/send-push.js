// api/send-push.js
//
// Vercel Serverless Function — the only place a real push notification
// actually gets sent from. Looks up the target identity's device token(s)
// in `push_tokens` (populated by src/lib/push.js on sign-in) and asks
// Firebase Cloud Messaging to deliver it.
//
// Sent as an FCM "notification" payload (not just "data") on purpose —
// Android's Google Play Services handle those directly via its own
// background service and put them straight in the system tray / lock
// screen, even when the app process isn't running at all. A data-only
// payload would need the app already alive to do anything with it, which
// defeats the point.
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

let firebaseApp = null;
async function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  // Lazy import so the function doesn't fail to even load if the
  // firebase-admin package were ever missing — it degrades to "not sent".
  const { default: admin } = await import("firebase-admin");
  if (admin.apps.length) {
    firebaseApp = admin.apps[0];
    return firebaseApp;
  }
  const serviceAccount = JSON.parse(raw);
  firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return firebaseApp;
}

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

    let query = supabaseAdmin.from("push_tokens").select("token");
    query = targetType === "all_staff" ? query.eq("owner_type", "staff") : query.eq("owner_type", targetType).eq("owner_id", targetId);
    const { data: rows, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const tokens = (rows || []).map((r) => r.token);
    if (!tokens.length) return res.json({ sent: 0, reason: "No registered device for this target" });

    const app = await getFirebaseApp();
    if (!app) return res.json({ sent: 0, reason: "FIREBASE_SERVICE_ACCOUNT not configured on the server yet" });

    const { default: admin } = await import("firebase-admin");

    // Calls need a data-only message: if a `notification` block is present,
    // Google Play Services deliver it straight to the system tray itself
    // and our own FirebaseMessagingService.onMessageReceived() never fires
    // for a killed app — which is exactly the case an incoming call most
    // needs to handle, since that's when the lock-screen full-screen UI has
    // to be built natively instead of relying on the default tray entry.
    // Every other push kind (chat, drafts) keeps the old notification-block
    // behavior — simplest path, no custom UI needed there.
    const isCall = data?.kind === "call";

    const message = {
      tokens,
      ...(isCall
        ? {}
        : { notification: { title, body: body || "" } }),
      data: {
        ...Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
        // Data-only messages carry no title/body of their own — the native
        // side (FirebaseMessagingService) needs these to build its own
        // full-screen call notification, so pass them through explicitly.
        ...(isCall ? { title, body: body || "" } : {}),
      },
      android: {
        priority: "high",
        // Don't let a stale ring arrive after the caller's own 30s timeout
        // (RING_TIMEOUT_MS in src/lib/call.js) has already given up.
        ...(isCall ? { ttl: 30000 } : {}),
        // Chat/draft pushes (not calls — those are data-only above and
        // rendered by native code instead): target the high-priority
        // "Calls & Messages" channel created client-side in
        // src/lib/push.js. Without an explicit channelId, Android falls
        // back to Capacitor's bare default channel, which has no light
        // color and a plain "default" sound rather than the punchier
        // "urgent" one — that's what made pushes feel dim/slow before.
        ...(isCall
          ? {}
          : {
              notification: {
                channelId: "calls_messages",
                priority: "max",
                visibility: "public",
                defaultVibrateTimings: false,
                vibrateTimingsMillis: [0, 250, 150, 250],
                lightSettings: {
                  color: { red: 1, green: 0.23, blue: 0.18, alpha: 1 },
                  lightOnDurationMillis: 300,
                  lightOffDurationMillis: 300,
                },
              },
            }),
      },
    };

    const result = await admin.messaging().sendEachForMulticast(message);
    // Prune tokens Firebase says are dead (app uninstalled, etc.) so this
    // table doesn't slowly fill up with stale entries.
    const deadTokens = result.responses
      .map((r, i) => (!r.success && /registration-token-not-registered/.test(r.error?.code || "")) ? tokens[i] : null)
      .filter(Boolean);
    if (deadTokens.length) await supabaseAdmin.from("push_tokens").delete().in("token", deadTokens);
    return res.json({ sent: result.successCount, failed: result.failureCount });
  } catch (e) {
    // Covers the whole handler now, not just the FCM call — a bad token,
    // a malformed FIREBASE_SERVICE_ACCOUNT JSON, anything: always a normal
    // JSON 500 instead of an opaque FUNCTION_INVOCATION_FAILED crash.
    console.error("send-push failed:", e);
    return res.status(500).json({ error: e.message || "Unexpected server error" });
  }
}

// api/_lib/push.js
//
// Core "send a push via FCM" logic, shared by:
//   - api/send-push.js — the client-facing endpoint (dealer/staff already
//     signed in, calls this after resolveCaller() checks their token)
//   - server-to-server callers like api/payments/webhook.js, which run with
//     no signed-in user at all (Cashfree calls that endpoint directly) but
//     already hold the service-role key, so there's nothing left to check.
//
// Pulled out of send-push.js so the webhook doesn't have to fake an
// accessToken just to reach the same FCM-sending code.
import { supabaseAdmin } from "./adminAuth.js";

let firebaseApp = null;
async function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const { default: admin } = await import("firebase-admin");
  if (admin.apps.length) {
    firebaseApp = admin.apps[0];
    return firebaseApp;
  }
  const serviceAccount = JSON.parse(raw);
  firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return firebaseApp;
}

// targetType: 'staff' | 'dealer' | 'dealer_staff' + targetId, OR
// targetType: 'all_staff' to broadcast to every staff device.
// Returns { sent, failed, reason? } — never throws; a push failure should
// never break whatever real action triggered it.
export async function sendPushNotification({ targetType, targetId, title, body, data }) {
  try {
    if (!supabaseAdmin) return { sent: 0, failed: 0, reason: "Server isn't configured with SUPABASE_SERVICE_ROLE_KEY" };
    if (!targetType || (!targetId && targetType !== "all_staff")) return { sent: 0, failed: 0, reason: "targetType/targetId required" };
    if (!title) return { sent: 0, failed: 0, reason: "title required" };

    let query = supabaseAdmin.from("push_tokens").select("token");
    query = targetType === "all_staff" ? query.eq("owner_type", "staff") : query.eq("owner_type", targetType).eq("owner_id", targetId);
    const { data: rows, error } = await query;
    if (error) return { sent: 0, failed: 0, reason: error.message };

    const tokens = (rows || []).map((r) => r.token);
    if (!tokens.length) return { sent: 0, failed: 0, reason: "No registered device for this target" };

    const app = await getFirebaseApp();
    if (!app) return { sent: 0, failed: 0, reason: "FIREBASE_SERVICE_ACCOUNT not configured on the server yet" };

    const { default: admin } = await import("firebase-admin");

    // Calls need a data-only message (see send-push.js's longer comment on
    // this) -- everything else (chat, drafts, payments) uses a normal
    // notification block.
    const isCall = data?.kind === "call";

    const message = {
      tokens,
      ...(isCall ? {} : { notification: { title, body: body || "" } }),
      data: {
        ...Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
        ...(isCall ? { title, body: body || "" } : {}),
      },
      android: {
        priority: "high",
        ...(isCall ? { ttl: 30000 } : {}),
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
    const deadTokens = result.responses
      .map((r, i) => (!r.success && /registration-token-not-registered/.test(r.error?.code || "")) ? tokens[i] : null)
      .filter(Boolean);
    if (deadTokens.length) await supabaseAdmin.from("push_tokens").delete().in("token", deadTokens);
    return { sent: result.successCount, failed: result.failureCount };
  } catch (e) {
    console.error("sendPushNotification failed:", e);
    return { sent: 0, failed: 0, reason: e.message || "Unexpected error" };
  }
}

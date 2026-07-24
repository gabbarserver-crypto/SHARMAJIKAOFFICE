// src/lib/push.js
//
// Real, lock-screen-capable push notifications for the native Android app —
// the piece notify.js explicitly says it can't do (see the comment at the
// top of that file). This is the "app is closed / phone is locked" half.
//
// How it fits together:
//   1. registerForPush(identity) — called once from App.jsx right after
//      sign-in — asks Android for notification permission, gets an FCM
//      device token from Google, and upserts it into the `push_tokens`
//      table (supabase/add_push_tokens.sql) against whoever's signed in.
//   2. Whenever something push-worthy happens (an incoming direct call, a
//      new chat message), the sender calls sendPush() (src/lib/serverApi.js)
//      which hits POST /api/send-push — a server function that looks up the
//      target's device token(s) and asks Firebase Cloud Messaging to deliver
//      a real Android notification. FCM delivers "notification"-shaped
//      payloads straight to the system tray via Android's own background
//      service, so this works even if the app process isn't running at
//      all — which is what actually gets it onto the lock screen.
//   3. unregisterForPush() — best-effort, called on sign-out — removes this
//      device's token so a signed-out phone stops receiving someone else's
//      notifications.
//
// No-ops entirely on web/desktop — this only ever runs inside the Capacitor
// Android shell.
import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

let currentToken = null;
let listenersAttached = false;

async function loadPushPlugin() {
  try {
    return await import("@capacitor/push-notifications");
  } catch {
    return null; // plugin not present in this build — nothing to do
  }
}

export async function registerForPush(identity) {
  if (!Capacitor.isNativePlatform() || !identity?.type || !identity?.id) return;

  const mod = await loadPushPlugin();
  if (!mod) return;
  const { PushNotifications } = mod;

  if (!listenersAttached) {
    listenersAttached = true;

    PushNotifications.addListener("registration", async (token) => {
      currentToken = token.value;
      try {
        await supabase.from("push_tokens").upsert(
          {
            owner_type: identity.type,
            owner_id: identity.id,
            token: token.value,
            platform: "android",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "token" }
        );
      } catch {
        // Best-effort — a failed token save just means this device won't
        // get pushes until the next successful registration (e.g. next
        // app open), not a reason to interrupt sign-in.
      }
    });

    PushNotifications.addListener("registrationError", () => {
      // Nothing actionable to show the person — foreground in-app
      // notifications (notify.js) still work regardless.
    });

    // Tapping a system notification (app was backgrounded/closed) — just
    // let the app open normally; App.jsx's own listeners (realtime chat/
    // call subscriptions) pick the right screen back up once signed in.
    PushNotifications.addListener("pushNotificationActionPerformed", () => {});
  }

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
    await PushNotifications.register();
  } catch {
    // Permission denied or unsupported device — silently skip.
  }
}

export async function unregisterForPush() {
  if (!Capacitor.isNativePlatform() || !currentToken) return;
  try {
    await supabase.from("push_tokens").delete().eq("token", currentToken);
  } catch {
    // Best-effort.
  }
  currentToken = null;
}

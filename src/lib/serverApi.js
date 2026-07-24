// src/lib/serverApi.js
// Talks to the login-creation endpoints — deployed as Vercel Serverless
// Functions under /api (see /api/admin/create-dealer-login.js and
// /api/create-dealer-staff-login.js at the project root), which run
// alongside the frontend on the same Vercel deployment. Defaulting to ""
// means it hits the same origin the app is served from — no separate
// server, no env var, no CORS to configure. VITE_SERVER_API_BASE is still
// supported as an override if you ever want to point this at a different
// backend instead.
import { supabase } from "./supabase";

export const SERVER_API_BASE = import.meta.env.VITE_SERVER_API_BASE || "";

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function post(path, body) {
  const res = await fetch(`${SERVER_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Staff-only: creates a dealer's primary login and links it to their record.
export async function createDealerLogin({ dealerId, email, password }) {
  return post("/api/admin/create-dealer-login", { accessToken: await accessToken(), dealerId, email, password });
}

// Staff, or the dealer themself for their own dealerId: creates a sub-staff
// login under that dealer.
export async function createDealerStaffLogin({ dealerId, fullName, email, password }) {
  return post("/api/create-dealer-staff-login", { accessToken: await accessToken(), dealerId, fullName, email, password });
}

// Fire-and-forget: asks the server to push a real (lock-screen-capable)
// notification to a target identity's registered device(s) — see
// api/send-push.js. Never throws — a failed push shouldn't break whatever
// in-app action triggered it (sending a message, ringing someone).
export async function sendPush({ targetType, targetId, title, body, data }) {
  try {
    await post("/api/send-push", { accessToken: await accessToken(), targetType, targetId, title, body, data });
  } catch {
    // Best-effort — the in-app realtime notification (notify.js) still
    // covers the case where the recipient's app is actually open.
  }
}

// Anyone signed in (staff, dealer, or dealer sub-staff) can request a token
// to join an Agora call on the given channel (= the chat_thread id).
export async function fetchAgoraToken({ channel }) {
  return post("/api/agora-token", { accessToken: await accessToken(), channel });
}

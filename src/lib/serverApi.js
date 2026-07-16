// src/lib/serverApi.js
// Talks to the small Express server in /server (same one that proxies the
// PCC portal) for anything that needs the Supabase service role key —
// i.e. creating a login with a password, which the browser can never do
// safely with just the anon key.
import { supabase } from "./supabase";

export const SERVER_API_BASE =
  import.meta.env.VITE_SERVER_API_BASE || import.meta.env.VITE_PCC_STATUS_API_BASE || "http://localhost:5000";

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

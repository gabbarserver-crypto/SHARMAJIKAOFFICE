// api/_lib/adminAuth.js
// Shared by the two login-creation serverless functions. Not itself a
// route — files/folders starting with "_" are ignored by Vercel's
// file-based routing.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// This needs the Supabase SERVICE ROLE key to call auth.admin.createUser(),
// which is the only way to set a password for someone else server-side —
// the browser only ever gets the anon key. NEVER put the service role key
// in the React app; it only ever lives here, as a Vercel env var, on the
// server side of this function.
export const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

// Verifies the caller's access token (sent from the already-logged-in React
// app) and returns { kind: 'staff', id, name } or
// { kind: 'dealer' | 'dealer_staff', id, dealerId, name } — or null if the
// token doesn't resolve to either (including if it's missing, expired, or
// malformed — this NEVER throws, on purpose: every api/*.js handler calls
// this unguarded before its own try/catch even starts, so a throw here
// used to crash the whole function with an opaque Vercel
// "FUNCTION_INVOCATION_FAILED" instead of a normal 403).
// id/name are additive — callers that only read .kind/.dealerId (most of
// the existing api/*.js files) are unaffected.
export async function resolveCaller(accessToken) {
  if (!accessToken || !supabaseAdmin) return null;
  try {
    const { data: userData, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !userData?.user) return null;
    const authUserId = userData.user.id;

    const { data: staffRow } = await supabaseAdmin.from("staff").select("id, full_name").eq("auth_user_id", authUserId).maybeSingle();
    if (staffRow) return { kind: "staff", id: staffRow.id, name: staffRow.full_name || "Staff" };

    const { data: dealerRow } = await supabaseAdmin.from("dealers").select("id, name, short_name").eq("auth_user_id", authUserId).maybeSingle();
    if (dealerRow) return { kind: "dealer", id: dealerRow.id, dealerId: dealerRow.id, name: dealerRow.short_name || dealerRow.name || "Dealer" };

    const { data: dealerStaffRow } = await supabaseAdmin.from("dealer_staff").select("id, dealer_id, full_name").eq("auth_user_id", authUserId).maybeSingle();
    if (dealerStaffRow) return { kind: "dealer_staff", id: dealerStaffRow.id, dealerId: dealerStaffRow.dealer_id, name: dealerStaffRow.full_name || "Dealer Staff" };

    return null;
  } catch (e) {
    console.error("resolveCaller failed:", e.message);
    return null;
  }
}

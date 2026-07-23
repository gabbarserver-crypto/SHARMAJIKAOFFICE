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
// app) and returns { kind: 'staff' } or { kind: 'dealer', dealerId } —
// or null if the token doesn't resolve to either.
export async function resolveCaller(accessToken) {
  if (!accessToken || !supabaseAdmin) return null;
  const { data: userData, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !userData?.user) return null;
  const authUserId = userData.user.id;

  const { data: staffRow } = await supabaseAdmin.from("staff").select("id").eq("auth_user_id", authUserId).maybeSingle();
  if (staffRow) return { kind: "staff" };

  const { data: dealerRow } = await supabaseAdmin.from("dealers").select("id").eq("auth_user_id", authUserId).maybeSingle();
  if (dealerRow) return { kind: "dealer", dealerId: dealerRow.id };

  const { data: dealerStaffRow } = await supabaseAdmin.from("dealer_staff").select("id, dealer_id").eq("auth_user_id", authUserId).maybeSingle();
  if (dealerStaffRow) return { kind: "dealer_staff", dealerId: dealerStaffRow.dealer_id };

  return null;
}

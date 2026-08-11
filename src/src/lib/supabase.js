// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

// TODO: move to environment variables (.env + Vite's import.meta.env) before deploying.
const SUPABASE_URL = "https://kxusesmymrlbjsbppikm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_T8sMx32GuOd8V5tvtb3gPg_RQHhrQ1h";

// `experimental.passkey` opts in to Supabase's fingerprint/Face ID/security-key
// login (WebAuthn passkeys) — point 17. Marked experimental/beta by Supabase
// itself; the API may change. Also requires enabling Passkeys + setting the
// Relying Party (your domain) in Supabase Dashboard → Authentication →
// Passkeys — that part can't be done from code, only there.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { experimental: { passkey: true } },
});

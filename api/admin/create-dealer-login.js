// api/admin/create-dealer-login.js
//
// Vercel Serverless Function — runs server-side on Vercel's infrastructure
// (never in the browser), so it's safe to use the Supabase service role
// key here. Deployed automatically alongside the frontend; no separate
// hosting needed.
//
// Create a login (email + password, pre-confirmed) for a dealer's PRIMARY
// account. Staff-only.
//
// Body: { accessToken, dealerId, email, password }
//
// Required Vercel env vars (Project Settings → Environment Variables):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (Supabase Dashboard → Settings → API → service_role — keep secret)
import { supabaseAdmin, resolveCaller } from "../_lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Server isn't configured with SUPABASE_SERVICE_ROLE_KEY" });

  const { accessToken, dealerId, email, password } = req.body || {};
  if (!dealerId || !email || !password) return res.status(400).json({ error: "dealerId, email and password are required" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const caller = await resolveCaller(accessToken);
  if (caller?.kind !== "staff") return res.status(403).json({ error: "Only staff can create a dealer login" });

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createError) return res.status(400).json({ error: createError.message });

  const { error: linkError } = await supabaseAdmin.from("dealers").update({ auth_user_id: created.user.id }).eq("id", dealerId);
  if (linkError) return res.status(400).json({ error: "User created but linking failed: " + linkError.message });

  res.json({ ok: true });
}

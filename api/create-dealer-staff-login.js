// api/create-dealer-staff-login.js
//
// Vercel Serverless Function — see the note in create-dealer-login.js about
// why this is safe to do server-side but never in the browser.
//
// Create a login for one of a dealer's sub-staff. Callable by EITHER staff
// (any dealer) or the dealer themself (only for their own dealerId).
//
// Body: { accessToken, dealerId, fullName, email, password }
import { supabaseAdmin, resolveCaller } from "./_lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Server isn't configured with SUPABASE_SERVICE_ROLE_KEY" });

  const { accessToken, dealerId, fullName, email, password } = req.body || {};
  if (!dealerId || !fullName || !email || !password) {
    return res.status(400).json({ error: "dealerId, fullName, email and password are required" });
  }
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const caller = await resolveCaller(accessToken);
  const allowed = caller?.kind === "staff" || (caller?.kind === "dealer" && caller.dealerId === dealerId);
  if (!allowed) return res.status(403).json({ error: "Not allowed to add staff for this dealer" });

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createError) return res.status(400).json({ error: createError.message });

  const { error: insertError } = await supabaseAdmin
    .from("dealer_staff")
    .insert({ dealer_id: dealerId, full_name: fullName, email, auth_user_id: created.user.id, active: true });
  if (insertError) return res.status(400).json({ error: "User created but linking failed: " + insertError.message });

  res.json({ ok: true });
}

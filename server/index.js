// server/index.js
//
// Proxies calls to the Delhi Police PCC portal so the React app (running in the
// browser) never has to call pcccvr.delhipolice.gov.in directly — that request
// would be blocked by the portal's CORS policy if it came straight from the browser.
//
// Run:
//   cd server
//   npm install
//   npm start           (defaults to http://localhost:5000)

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const DELHI_PCC_BASE_URL =
  process.env.DELHI_PCC_BASE_URL || "https://pcccvr.delhipolice.gov.in/api/PccForm";

const delhiClient = axios.create({
  baseURL: DELHI_PCC_BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

// ============================================================
// Account creation (dealer logins + dealer sub-staff logins)
//
// This needs the Supabase SERVICE ROLE key to call auth.admin.createUser(),
// which is the only way to set a password for someone else server-side —
// the browser only ever gets the anon key. NEVER put the service role key
// in the React app; it only ever lives here, as an env var on this server.
//
//   SUPABASE_URL=https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=eyJ...   (Settings > API > service_role, keep secret)
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

// Verifies the caller's access token (sent from the already-logged-in React
// app) and returns { kind: 'staff' } or { kind: 'dealer', dealerId } —
// or null if the token doesn't resolve to either. Used to decide who's
// allowed to create which kind of login below.
async function resolveCaller(accessToken) {
  if (!accessToken || !supabaseAdmin) return null;
  const { data: userData, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !userData?.user) return null;
  const authUserId = userData.user.id;

  const { data: staffRow } = await supabaseAdmin.from("staff").select("id").eq("auth_user_id", authUserId).maybeSingle();
  if (staffRow) return { kind: "staff" };

  const { data: dealerRow } = await supabaseAdmin.from("dealers").select("id").eq("auth_user_id", authUserId).maybeSingle();
  if (dealerRow) return { kind: "dealer", dealerId: dealerRow.id };

  return null;
}

/**
 * Create a login (email + password, pre-confirmed) for a dealer's PRIMARY
 * account. Staff-only. Links it to the dealer row the same way the old
 * "Link" flow did, but without requiring the dealer to self-register first.
 *
 * Body: { accessToken, dealerId, email, password }
 */
app.post("/api/admin/create-dealer-login", async (req, res) => {
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
});

/**
 * Create a login for one of a dealer's sub-staff. Callable by EITHER staff
 * (any dealer) or the dealer themself (only for their own dealerId) —
 * item 14: "add by both admin and dealer".
 *
 * Body: { accessToken, dealerId, fullName, email, password }
 */
app.post("/api/create-dealer-staff-login", async (req, res) => {
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
});

/**
 * STEP 1 — Search for the application to get its applicationID.
 *
 * Body: { applicationNumber, applicantName, guardianName }
 * Forwards as-is to Delhi Police's search-pcc-application endpoint and
 * returns their response unchanged.
 */
app.post("/api/pcc-status/search", async (req, res) => {
  const { applicationNumber, applicantName, guardianName } = req.body || {};
  if (!applicationNumber || !applicantName) {
    return res.status(400).json({ success: false, error: "applicationNumber and applicantName are required" });
  }

  try {
    const result = await delhiClient.post("/search-pcc-application", {
      applicationNumber,
      applicantName,
      guardianName,
    });
    res.json(result.data);
  } catch (err) {
    console.error("PCC search failed:", err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      details: err.response?.data,
    });
  }
});

/**
 * "Fetch details" endpoint used by the click-to-fetch button in the
 * Applications table.
 *
 * Mirrors exactly what the Delhi Police portal's own public "Track
 * Application" page calls, confirmed from its Network tab:
 *   1. POST /search-pcc-application   { applicationNumber, applicantName, guardianName }
 *   2. POST /get-pcc-applicant-details { applicationID }   <- capital ID
 *   3. POST /get-pcc-application-status { applicationId }  <- lowercase d
 *
 * All three are the same public lookup the portal exposes to anyone tracking
 * their own application — nothing admin-only.
 *
 * Body: { applicationNumber, applicantName, guardianName }
 */
app.post("/api/pcc-status/check", async (req, res) => {
  const { applicationNumber, applicantName, guardianName } = req.body || {};
  if (!applicationNumber || !applicantName) {
    return res.status(400).json({ success: false, error: "applicationNumber and applicantName are required" });
  }

  try {
    const searchResult = await delhiClient.post("/search-pcc-application", {
      applicationNumber,
      applicantName,
      guardianName,
    });

    const application = searchResult.data?.data?.[0] || null;
    if (!application?.applicationID) {
      return res.json({ success: false, stage: "search", raw: searchResult.data });
    }

    const id = String(application.applicationID);

    const [detailsResult, statusResult] = await Promise.allSettled([
      delhiClient.post("/get-pcc-applicant-details", { applicationID: id }),
      delhiClient.post("/get-pcc-application-status", { applicationId: id }),
    ]);

    return res.json({
      success: true,
      application,
      details: detailsResult.status === "fulfilled" ? detailsResult.value.data?.data || null : null,
      status: statusResult.status === "fulfilled" ? statusResult.value.data?.data || null : null,
      statusError: statusResult.status === "rejected"
        ? { message: statusResult.reason.message, body: statusResult.reason.response?.data || null }
        : null,
    });
  } catch (err) {
    console.error("PCC check failed:", err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      details: err.response?.data,
    });
  }
});

app.listen(PORT, () => {
  console.log(`PCC status proxy server running on http://localhost:${PORT}`);
});

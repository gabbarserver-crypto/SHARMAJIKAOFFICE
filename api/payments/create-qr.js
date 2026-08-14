// api/payments/create-qr.js
//
// Vercel Serverless Function. A dealer (or their active sub-staff) hits
// "Pay by QR" in DealerPaymentsPanel, OR "Top Up" in the Wallet Balance
// card -- either way this creates a Cashfree order with a fixed expiry,
// asks Cashfree to render it as a UPI QR, and records a
// `payment_qr_requests` row so the frontend has something to poll/subscribe
// to. Nothing lands in `payments` or `dealers.wallet_balance` yet -- that
// only happens in webhook.js, once Cashfree actually confirms money moved.
//
// `purpose` is what tells webhook.js which of those two it should do:
//   "application_payment" (default) -- inserts a verified `payments` row,
//       same as today, optionally tied to `applicationId`.
//   "wallet_topup" -- credits `dealers.wallet_balance` directly instead;
//       never tied to an application, so applicationId is ignored/forced
//       null for this purpose.
//
// Body: { accessToken, dealerId, applicationId?, amount, minutesValid?, purpose? }
//
// Required Vercel env vars, in addition to the ones create-dealer-login.js
// already needs (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
//   CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, CASHFREE_ENV   (see _lib/cashfree.js)
//   PUBLIC_APP_URL   your deployed app's base URL, e.g. https://sjo-admin.vercel.app
//                     -- used to build the webhook URL we hand Cashfree.
//
// NOTE: requires the `purpose` column on `payment_qr_requests` and the
// `increment_dealer_wallet` function -- see the migration shared alongside
// this change (not part of this repo's tracked SQL, run it in the Supabase
// SQL editor before deploying).
import { supabaseAdmin, resolveCaller } from "../_lib/adminAuth.js";
import { createOrder, generateUpiQr, cashfreeConfigured } from "./_lib/cashfree.js";

// Cashfree requires order_expiry_time to be more than 15 minutes out (and
// less than 30 days), so this fallback -- and anything the client sends --
// must stay above 15.
const DEFAULT_MINUTES_VALID = 20;
const MIN_MINUTES_VALID = 16;

const ALLOWED_PURPOSES = ["application_payment", "wallet_topup"];

// CORS: same reasoning/pattern as api/agora-token.js -- the Android app
// (Capacitor) and any local dev server hit this as a genuine cross-origin
// request (different origin than this API), so without these headers plus
// answering the OPTIONS preflight, the browser fetch() fails with an opaque
// "Failed to fetch"/405 before the response body is ever readable, even
// though the function itself would have run fine. "*" is fine here -- this
// endpoint requires a valid Supabase accessToken in the body to do
// anything, so an open CORS policy doesn't itself expose anything; auth is
// enforced by resolveCaller() below, not by origin-checking.
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Preflight -- the browser sends this automatically before the real POST
  // on a cross-origin request; it just needs a 2xx response with the CORS
  // headers above, no body required.
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Server isn't configured with SUPABASE_SERVICE_ROLE_KEY" });
  if (!cashfreeConfigured()) return res.status(500).json({ error: "Server isn't configured with Cashfree credentials" });
  if (!process.env.PUBLIC_APP_URL) return res.status(500).json({ error: "Server isn't configured with PUBLIC_APP_URL" });

  try {
    const { accessToken, dealerId, applicationId, amount, minutesValid, purpose } = req.body || {};
    const amountNum = Number(amount);
    if (!dealerId || !amountNum || amountNum <= 0) {
      return res.status(400).json({ error: "dealerId and a positive amount are required" });
    }
    const requestedPurpose = purpose || "application_payment";
    if (!ALLOWED_PURPOSES.includes(requestedPurpose)) {
      return res.status(400).json({ error: `purpose must be one of: ${ALLOWED_PURPOSES.join(", ")}` });
    }
    // A wallet top-up is never tied to one application -- ignore anything
    // the client sent for applicationId rather than trusting it.
    const effectiveApplicationId = requestedPurpose === "wallet_topup" ? null : (applicationId || null);

    // Only that dealer themself (or their active sub-staff), or staff
    // acting on a dealer's behalf, can request a QR for that dealer_id --
    // otherwise anyone signed in could generate a QR that credits a
    // stranger's account once paid.
    const caller = await resolveCaller(accessToken);
    const allowed =
      caller?.kind === "staff" ||
      ((caller?.kind === "dealer" || caller?.kind === "dealer_staff") && caller.dealerId === dealerId);
    if (!allowed) return res.status(403).json({ error: "Not allowed to request a QR for this dealer" });

    const { data: dealer, error: dealerErr } = await supabaseAdmin
      .from("dealers")
      .select("id, name, mobile, email")
      .eq("id", dealerId)
      .maybeSingle();
    if (dealerErr || !dealer) return res.status(404).json({ error: "Dealer not found" });

    const requestedMinutes = Number(minutesValid) > 0 ? Number(minutesValid) : DEFAULT_MINUTES_VALID;
    if (requestedMinutes < MIN_MINUTES_VALID) {
      return res.status(400).json({ error: `QR must be valid for at least ${MIN_MINUTES_VALID} minutes (Cashfree requires more than 15 minutes)` });
    }
    const minutes = requestedMinutes;
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    const cfOrderId = `SJO-${dealerId.slice(0, 8)}-${Date.now()}`;

    const webhookUrl = `${process.env.PUBLIC_APP_URL}/api/payments/webhook`;

    const order = await createOrder({
      orderId: cfOrderId,
      amount: amountNum,
      dealer,
      expiresAtIso: expiresAt.toISOString(),
      webhookUrl,
    });

    const qr = await generateUpiQr({ paymentSessionId: order.payment_session_id });

    const { data: qrRequest, error: insertErr } = await supabaseAdmin
      .from("payment_qr_requests")
      .insert({
        dealer_id: dealerId,
        application_id: effectiveApplicationId,
        amount: amountNum,
        cf_order_id: cfOrderId,
        qr_expires_at: expiresAt.toISOString(),
        status: "pending",
        purpose: requestedPurpose,
      })
      .select()
      .single();
    if (insertErr) return res.status(500).json({ error: "Order created at Cashfree but failed to save locally: " + insertErr.message });

    res.json({
      qrRequestId: qrRequest.id,
      qrImageUrl: qr.qrImageUrl,
      qrRawString: qr.qrRawString,
      expiresAt: expiresAt.toISOString(),
      cfOrderId,
    });
  } catch (e) {
    console.error("create-qr failed:", e);
    res.status(500).json({ error: e.message || "Unexpected server error" });
  }
}

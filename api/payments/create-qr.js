// api/payments/create-qr.js
//
// Vercel Serverless Function. A dealer (or their active sub-staff) hits
// "Pay by QR" in DealerPaymentsPanel -- this creates a Cashfree order with
// a fixed expiry, asks Cashfree to render it as a UPI QR, and records a
// `payment_qr_requests` row so the frontend has something to poll/subscribe
// to. Nothing lands in `payments` yet -- that only happens in webhook.js,
// once Cashfree actually confirms money moved.
//
// Body: { accessToken, dealerId, applicationId?, amount, minutesValid? }
//
// Required Vercel env vars, in addition to the ones create-dealer-login.js
// already needs (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
//   CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, CASHFREE_ENV   (see _lib/cashfree.js)
//   PUBLIC_APP_URL   your deployed app's base URL, e.g. https://sjo-admin.vercel.app
//                     -- used to build the webhook URL we hand Cashfree.
import { supabaseAdmin, resolveCaller } from "../_lib/adminAuth.js";
import { createOrder, generateUpiQr, cashfreeConfigured } from "./_lib/cashfree.js";

const DEFAULT_MINUTES_VALID = 10;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Server isn't configured with SUPABASE_SERVICE_ROLE_KEY" });
  if (!cashfreeConfigured()) return res.status(500).json({ error: "Server isn't configured with Cashfree credentials" });

  try {
    const { accessToken, dealerId, applicationId, amount, minutesValid } = req.body || {};
    const amountNum = Number(amount);
    if (!dealerId || !amountNum || amountNum <= 0) {
      return res.status(400).json({ error: "dealerId and a positive amount are required" });
    }

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

    const minutes = Number(minutesValid) > 0 ? Number(minutesValid) : DEFAULT_MINUTES_VALID;
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
        application_id: applicationId || null,
        amount: amountNum,
        cf_order_id: cfOrderId,
        qr_expires_at: expiresAt.toISOString(),
        status: "pending",
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

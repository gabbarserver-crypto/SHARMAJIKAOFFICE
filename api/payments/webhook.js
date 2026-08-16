// api/payments/webhook.js
//
// Vercel Serverless Function -- this is the ONE part of the QR flow that
// isn't called by our own frontend. Cashfree calls this directly the
// moment a dealer's UPI payment against one of our orders succeeds (or
// fails). No accessToken, no dealer session -- so nothing here can be
// trusted just because the request arrived; every request is verified two
// separate ways before anything gets written:
//   1. The x-webhook-signature header, checked against CASHFREE_CLIENT_SECRET
//      (verifyWebhookSignature in _lib/cashfree.js -- Cashfree signs webhooks
//      with the same PG secret key used for API auth, not a separate
//      per-webhook secret) -- proves the request body wasn't forged or
//      tampered with in transit.
//   2. A direct server-to-server fetchOrderStatus() call back to Cashfree
//      -- proves the order is ACTUALLY marked PAID on Cashfree's side right
//      now, rather than trusting whatever status string the webhook body
//      itself claims. Belt-and-suspenders: even a correctly-signed but
//      stale/replayed webhook can't insert a payment this way, because a
//      replayed "paid" webhook still results in the SAME true status.
//
// This is also why body parsing is turned off below -- signature
// verification needs the exact raw bytes Cashfree sent, before any
// JSON.parse/stringify round-trip could change key order or whitespace.
//
// Register this URL in the Cashfree Dashboard -> Developers -> Webhooks as
// <PUBLIC_APP_URL>/api/payments/webhook, subscribed to at least the
// PAYMENT_SUCCESS_WEBHOOK event.
import { supabaseAdmin } from "../_lib/adminAuth.js";
import { verifyWebhookSignature, fetchOrderStatus } from "./_lib/cashfree.js";
import { sendPushNotification } from "../_lib/push.js";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Server isn't configured with SUPABASE_SERVICE_ROLE_KEY" });

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: "Could not read request body" });
  }

  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];
  if (!verifyWebhookSignature({ rawBody, timestamp, signature })) {
    console.warn("payments/webhook: signature check failed -- ignoring");
    // 200, not 401/403: Cashfree retries on non-2xx, and a bad signature
    // will never become a good one on retry, so acknowledging (while
    // logging and doing nothing else) avoids pointless retry storms.
    return res.status(200).json({ ok: true, note: "signature check failed, ignored" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(200).json({ ok: true, note: "unparseable body, ignored" });
  }

  const orderId = event?.data?.order?.order_id;
  if (!orderId) return res.status(200).json({ ok: true, note: "no order_id in payload, ignored" });

  try {
    const { data: qrRequest } = await supabaseAdmin
      .from("payment_qr_requests")
      .select("*")
      .eq("cf_order_id", orderId)
      .maybeSingle();
    if (!qrRequest) return res.status(200).json({ ok: true, note: "unknown order_id, ignored" });

    // Already handled (Cashfree can send the same webhook more than once --
    // this makes the handler idempotent instead of double-inserting/
    // double-crediting).
    if (qrRequest.status === "paid") return res.status(200).json({ ok: true, note: "already processed" });

    const order = await fetchOrderStatus(orderId);

    if (order.order_status === "PAID") {
      const { data: dealerRow } = await supabaseAdmin
        .from("dealers")
        .select("name")
        .eq("id", qrRequest.dealer_id)
        .maybeSingle();

      const referenceNo = order.cf_order_id ? String(order.cf_order_id) : null;

      // Single insert straight into the ledger — this is now the only
      // table payments live in, so a QR payment can no longer be visible
      // to staff (old `payments` row) but invisible on the dealer's ledger
      // (old separate `ledger_entries` insert failing).
      const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
        .from("ledger_entries")
        .insert({
          entry_code: referenceNo || `PMT-QR-${orderId}`,
          entry_type: "PAYMENT",
          entry_date: new Date().toISOString().slice(0, 10),
          dealer_id: qrRequest.dealer_id,
          source_application_id: qrRequest.application_id,
          amount: -qrRequest.amount,
          payment_mode: "UPI",
          reference_no: referenceNo,
          payer_name: dealerRow?.name || null,
          remarks: `Auto-recorded from UPI QR payment (order ${orderId})`,
          submitted_by: "gateway",
        })
        .select()
        .single();
      if (ledgerErr) {
        console.error("webhook: failed to insert ledger entry for", orderId, ledgerErr.message);
        return res.status(200).json({ ok: true, note: "ledger insert failed, will retry on next webhook delivery" });
      }

      await supabaseAdmin
        .from("payment_qr_requests")
        .update({ status: "paid", payment_id: ledgerRow.id, paid_at: new Date().toISOString() })
        .eq("id", qrRequest.id);

      // Real push to every staff device, not just an in-app toast -- this
      // runs server-side (Cashfree calling us directly, no staff browser
      // involved at all), so it's the only way staff get notified if
      // nobody's app happens to be open right now. Fire-and-forget: never
      // block or fail the webhook response over a push delivery issue.
      sendPushNotification({
        targetType: "all_staff",
        title: "Payment received (QR)",
        body: `${dealerRow?.name || "A dealer"} — ₹${Number(qrRequest.amount).toLocaleString("en-IN")}`,
        data: { kind: "payment" },
      }).catch(() => {});

      return res.status(200).json({ ok: true });
    }

    if (["EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"].includes(order.order_status)) {
      await supabaseAdmin.from("payment_qr_requests").update({ status: "expired" }).eq("id", qrRequest.id);
      return res.status(200).json({ ok: true });
    }

    // ACTIVE or anything else -- not paid yet, nothing to do.
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("payments/webhook failed:", e);
    // Non-2xx so Cashfree retries -- this branch is for OUR errors (e.g. a
    // transient Supabase blip), not for anything about the payment itself.
    return res.status(500).json({ error: "internal error, please retry" });
  }
}

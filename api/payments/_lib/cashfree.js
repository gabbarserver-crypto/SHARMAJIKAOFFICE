// api/payments/_lib/cashfree.js
// Shared by create-qr.js and webhook.js — not itself a route (folders
// starting with "_" are ignored by Vercel's file-based routing, same
// convention as api/_lib/adminAuth.js).
//
// Required Vercel env vars (Project Settings -> Environment Variables):
//   CASHFREE_CLIENT_ID       (Cashfree Dashboard -> Developers -> API Keys)
//   CASHFREE_CLIENT_SECRET   (same page -- keep secret, server-side only)
//   CASHFREE_ENV              "SANDBOX" while testing, "PRODUCTION" once live
//   CASHFREE_WEBHOOK_SECRET  (Dashboard -> Developers -> Webhooks -> your
//                             webhook's secret -- NOT the same as the API
//                             client secret. Used only to verify that a
//                             webhook call really came from Cashfree.)
//
// NOTE ON API VERSION: Cashfree versions their PG API by date via the
// x-api-version header, and response field names have shifted across
// versions before (this is exactly the kind of detail that goes stale).
// Before going live, open Cashfree's current "Create Order" and "Order Pay
// (UPI QR)" reference pages, confirm CASHFREE_API_VERSION below still
// matches what they return, and adjust extractQrPayload() if the response
// shape has changed since this was written.

import { createHmac, timingSafeEqual } from "crypto";

const CASHFREE_API_VERSION = "2023-08-01";

const BASE_URL = () =>
  process.env.CASHFREE_ENV === "PRODUCTION"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "x-api-version": CASHFREE_API_VERSION,
    "x-client-id": process.env.CASHFREE_CLIENT_ID,
    "x-client-secret": process.env.CASHFREE_CLIENT_SECRET,
  };
}

export function cashfreeConfigured() {
  return !!(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET && process.env.CASHFREE_WEBHOOK_SECRET);
}

// Creates a Cashfree order for this exact amount, expiring at expiresAtIso.
// This expiry is what actually enforces "the QR only lives for N minutes" --
// Cashfree itself will reject a payment attempt against an expired order,
// this app doesn't have to police it, only reflect it in the UI countdown.
export async function createOrder({ orderId, amount, dealer, expiresAtIso, webhookUrl }) {
  const res = await fetch(`${BASE_URL()}/orders`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      order_id: orderId,
      order_amount: amount,
      order_currency: "INR",
      order_expiry_time: expiresAtIso,
      customer_details: {
        customer_id: dealer.id,
        customer_name: dealer.name,
        customer_phone: dealer.mobile || "9999999999",
        customer_email: dealer.email || undefined,
      },
      order_meta: {
        notify_url: webhookUrl,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Cashfree create-order failed (${res.status})`);
  return data; // { order_id, cf_order_id, payment_session_id, ... }
}

// Asks Cashfree to render that order specifically as a UPI QR (as opposed
// to the hosted checkout page) -- this is the "Order Pay" call, made right
// after Create Order with the payment_session_id it returned.
export async function generateUpiQr({ paymentSessionId }) {
  const res = await fetch(`${BASE_URL()}/orders/sessions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      payment_session_id: paymentSessionId,
      payment_method: { upi: { channel: "qrcode" } },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Cashfree QR generation failed (${res.status})`);
  return extractQrPayload(data);
}

// Cashfree's response nests the actual QR image/string a couple of levels
// down under `data.payload`. Pulled into its own function so that if a
// future API version renames/reshapes this, there's exactly one place to
// fix it rather than hunting through create-qr.js.
function extractQrPayload(cashfreeResponse) {
  const payload = cashfreeResponse?.data?.payload || {};
  return {
    qrImageUrl: payload.qrcode || payload.qrCodeUrl || null, // data:image/... or https URL, depending on version
    qrRawString: payload.upi_link || payload.upiLink || null, // raw upi://pay?... string, if returned, for a client-side QR fallback
  };
}

// Confirms a payment against Cashfree directly (belt-and-suspenders check
// used inside the webhook handler before trusting its own signature check
// alone) -- fetches the order and looks at its actual status server-to-
// server, rather than trusting anything the webhook body itself claims.
export async function fetchOrderStatus(orderId) {
  const res = await fetch(`${BASE_URL()}/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Cashfree fetch-order failed (${res.status})`);
  return data; // { order_status: 'PAID' | 'ACTIVE' | 'EXPIRED' | ..., ... }
}

// Cashfree signs each webhook as base64(HMAC-SHA256(timestamp + rawBody,
// webhook_secret)) and sends the signature + timestamp as headers. This
// must run against the RAW request body (before any JSON.parse), which is
// why webhook.js disables Vercel's automatic body parsing -- parsing and
// re-stringifying the body can reorder keys or change whitespace, which
// would make a genuine Cashfree webhook fail signature verification.
export function verifyWebhookSignature({ rawBody, timestamp, signature }) {
  const secret = process.env.CASHFREE_WEBHOOK_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const expected = createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false; // length mismatch etc. -- definitely not a match
  }
}

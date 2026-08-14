// scripts/backfill-qr-ledger.js
//
// One-off fix for payments that were auto-recorded via the "Pay by QR" /
// Cashfree webhook BEFORE the fix in api/payments/webhook.js -- those rows
// exist in `payments` (submitted_by = 'gateway') but never got a matching
// `ledger_entries` row, so they never reached the dealer's Running Balance
// / Ledger tab / Payments tab, even though staff could see them fine in
// "All Receipts & Payments" and the bank feed.
//
// This script finds exactly those payments (gateway-submitted, no
// ledger_entries row pointing at them via source_payment_id) and inserts
// the missing ledger entry for each one, using the SAME field mapping the
// webhook now uses -- so the end result is identical to what would have
// been written at the time.
//
// Safe to re-run: it re-checks source_payment_id before every insert, so
// already-backfilled (or already-correct) payments are skipped, never
// duplicated.
//
// USAGE:
//   1. First do a dry run (no writes) to see what it WOULD do:
//        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-qr-ledger.js --dry-run
//   2. Review the printed list, then actually apply it:
//        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-qr-ledger.js
//
// Needs the SAME two env vars the webhook itself uses (Vercel dashboard ->
// Settings -> Environment Variables, or your local .env). The service role
// key is required because this bypasses RLS the same way the webhook does
// -- never run this with the anon key, and never commit real values.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(DRY_RUN ? "Running in DRY-RUN mode -- no writes will happen.\n" : "Running for real -- missing ledger entries WILL be inserted.\n");

  // 1. All gateway-recorded payments (i.e. auto-recorded from a Pay-by-QR
  // success), oldest first so ledger entries land in the order they
  // actually happened.
  const { data: gatewayPayments, error: paymentsErr } = await supabaseAdmin
    .from("payments")
    .select("id, dealer_id, amount, payment_mode, reference_no, created_at")
    .eq("submitted_by", "gateway")
    .order("created_at", { ascending: true });

  if (paymentsErr) {
    console.error("Failed to load gateway payments:", paymentsErr.message);
    process.exit(1);
  }
  if (!gatewayPayments?.length) {
    console.log("No gateway-recorded payments found. Nothing to do.");
    return;
  }
  console.log(`Found ${gatewayPayments.length} gateway-recorded payment(s) total.`);

  // 2. Which of those already have a ledger_entries row pointing at them.
  const paymentIds = gatewayPayments.map((p) => p.id);
  const { data: existingEntries, error: ledgerErr } = await supabaseAdmin
    .from("ledger_entries")
    .select("source_payment_id")
    .in("source_payment_id", paymentIds);

  if (ledgerErr) {
    console.error("Failed to check existing ledger entries:", ledgerErr.message);
    process.exit(1);
  }
  const alreadyCovered = new Set((existingEntries || []).map((e) => e.source_payment_id));

  const missing = gatewayPayments.filter((p) => !alreadyCovered.has(p.id));
  if (!missing.length) {
    console.log("Every gateway payment already has a ledger entry. Nothing to backfill.");
    return;
  }
  console.log(`${missing.length} payment(s) are missing their ledger entry:\n`);

  // 3. Look up dealer names in one batch (for payer_name, same as the
  // webhook does per-payment).
  const dealerIds = [...new Set(missing.map((p) => p.dealer_id).filter(Boolean))];
  const { data: dealerRows } = dealerIds.length
    ? await supabaseAdmin.from("dealers").select("id, name").in("id", dealerIds)
    : { data: [] };
  const dealerNameById = new Map((dealerRows || []).map((d) => [d.id, d.name]));

  let inserted = 0;
  let failed = 0;

  for (const p of missing) {
    const entry = {
      entry_code: `PMT-${p.id}`,
      entry_type: "PAYMENT",
      entry_date: (p.created_at || new Date().toISOString()).slice(0, 10),
      dealer_id: p.dealer_id,
      amount: -p.amount,
      payment_mode: p.payment_mode,
      reference_no: p.reference_no || null,
      payer_name: dealerNameById.get(p.dealer_id) || null,
      source_payment_id: p.id,
    };

    console.log(
      `  payment #${p.id} — ₹${Number(p.amount).toLocaleString("en-IN")} — dealer ${entry.payer_name || p.dealer_id} — ${entry.entry_date}`
    );

    if (DRY_RUN) continue;

    const { error: insertErr } = await supabaseAdmin.from("ledger_entries").insert(entry);
    if (insertErr) {
      console.error(`    -> FAILED: ${insertErr.message}`);
      failed++;
    } else {
      inserted++;
    }
  }

  console.log("");
  if (DRY_RUN) {
    console.log(`Dry run complete. ${missing.length} entry(ies) would be inserted. Re-run without --dry-run to apply.`);
  } else {
    console.log(`Done. Inserted ${inserted} ledger entry(ies).${failed ? ` ${failed} failed -- see errors above.` : ""}`);
    console.log("Dealer Running Balances recompute automatically from ledger_entries, so no separate step is needed.");
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});

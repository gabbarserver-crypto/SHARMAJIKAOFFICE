# Agency Fee → Agency Ledger sync

## What changed
`src/pages/Applications.jsx` only — two spots:

1. **New `syncAgencyLedger()` helper**, called from `updateRowField()`
   whenever you edit the **Agency Fee** or **Agency** cell on an
   application row (the ones circled in your screenshot). It posts a
   `debit` line to `agency_ledger_transactions` for the chosen agency,
   equal to the Agency Fee — same "we owe them" convention already used
   by the Payments page. It's keyed by the application's own `draft_code`
   as `voucher_no`, so re-editing the fee or switching the agency updates
   that same line instead of creating duplicates.
   - Clear the fee (or unset the agency) → the ledger line is removed.
   - Change the agency → the old line is removed, a fresh one is posted
     under the new agency.
   - This reflects live, on every edit — unlike the *dealer's* fee, which
     only posts once on Accept (that behavior is unchanged).

2. **`deleteApplication()`** now also deletes that application's
   agency-ledger line (if any), same as it already does for the dealer
   ledger, so deleting an application doesn't leave a dangling "owed"
   line behind.

## Not covered (by design, flag if you want it too)
- **CSV import** (bulk-importing existing records with an Agency Fee +
  Agency already filled in) does not currently post to the agency ledger.
  Only edits made through the table UI do. Say the word if you'd like
  imported rows to post too.
- No new tables/migrations needed — this only writes to
  `agency_ledger_transactions`, which already exists and is what the
  Agency ledger view (Ledger.jsx) reads from.

## Test it
1. Open an application row, set an Agency and an Agency Fee (e.g. ₹1,900,
   like your screenshot).
2. Go to Ledger → Agency → that agency → you should see a new debit line
   for that amount, with the applicant's name / app no. in the
   description.
3. Edit the fee to a different amount → same ledger line updates instead
   of a second line appearing.
4. Clear the fee, or clear the Agency dropdown → the ledger line disappears.

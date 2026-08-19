-- Fix: ledger_entries has Row Level Security enabled but had NO policies
-- at all. With RLS on and zero matching policies, Postgres denies ALL
-- direct-table/view access by default — so dealer_ledger, agency_ledger,
-- dealer_ledger_balances, agency_ledger_balances (all read ledger_entries)
-- silently returned an empty array to every authenticated user, even
-- though the exact same query worked in the SQL Editor (service role,
-- bypasses RLS). PAYMENT rows still "worked" elsewhere because they're
-- written via the SECURITY DEFINER RPC record_payment_with_ledger, which
-- also bypasses RLS — but a direct SELECT never did.
--
-- Scoping follows the same pattern already used for chat_threads /
-- call_logs (see 002_chat_and_dealer_staff.sql, 003_call_logs.sql):
--   * staff (admin/back-office): can read every ledger_entries row.
--   * a dealer's own login (dealers.auth_user_id = auth.uid()): can read
--     only rows for their own dealer_id.
--   * agencies don't have their own login yet, so only staff can read
--     agency-side (agency_id) rows for now. When agency login ships,
--     add an "agencies.auth_user_id = auth.uid()" branch the same way
--     dealers has it below.
--
-- Run this once in the Supabase SQL editor.

create policy "Staff can read all ledger_entries"
  on ledger_entries
  for select
  to authenticated
  using (
    exists (select 1 from staff where staff.auth_user_id = auth.uid())
  );

create policy "Dealers can read their own ledger_entries"
  on ledger_entries
  for select
  to authenticated
  using (
    dealer_id is not null
    and exists (
      select 1 from dealers
      where dealers.id = ledger_entries.dealer_id
        and dealers.auth_user_id = auth.uid()
    )
  );

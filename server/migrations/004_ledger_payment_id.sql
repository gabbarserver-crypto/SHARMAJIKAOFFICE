-- 004_ledger_payment_id.sql
-- Deleting/editing a payment previously matched its ledger_transactions /
-- agency_ledger_transactions row by voucher_no (the payment's reference_no,
-- or a PMT-<id> fallback). That's fragile: if reference_no was edited, or
-- didn't match for any other reason, the ledger delete silently affected
-- zero rows (Postgres/PostgREST does not error on a delete that matches
-- nothing) while the payment itself still got deleted — leaving a ledger
-- entry with no payment behind it, which is exactly the bug reported.
--
-- payment_id is a direct, unambiguous link — used going forward as the
-- primary match, with voucher_no kept as a fallback for rows created
-- before this migration.
alter table ledger_transactions add column if not exists payment_id uuid references payments(id) on delete set null;
alter table agency_ledger_transactions add column if not exists payment_id uuid references payments(id) on delete set null;

create index if not exists idx_ledger_transactions_payment_id on ledger_transactions(payment_id);
create index if not exists idx_agency_ledger_transactions_payment_id on agency_ledger_transactions(payment_id);

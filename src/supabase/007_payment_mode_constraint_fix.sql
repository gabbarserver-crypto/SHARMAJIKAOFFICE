-- Run this in the Supabase SQL editor. Safe to re-run any number of times.
--
-- Why: the UI's payment-mode options were relabeled "Bank Transfer" -> "Bank"
-- (and "Card" was dropped) so the dropdown only shows Cash / Bank / UPI /
-- Cheque. Nobody checked the database side though, so the existing
-- check constraint on payments.payment_mode still only allows the *old*
-- exact strings ('Cash','UPI','Bank Transfer','Cheque','Card'). Every row
-- with the new "Bank" value (typed by hand, imported, or edited) gets
-- rejected by Postgres with:
--   new row for relation "payments" violates check constraint "payments_payment_mode_check"
-- — which is what stopped the CSV import at "ELECTRICITA".
--
-- This widens the constraint to accept both the old and new spellings
-- (non-destructive — existing rows keep whatever value they already have),
-- so both old data and new imports/entries work going forward.

begin;

alter table payments drop constraint if exists payments_payment_mode_check;

alter table payments
  add constraint payments_payment_mode_check
  check (payment_mode in ('Cash', 'UPI', 'Bank', 'Bank Transfer', 'Cheque', 'Card'));

commit;

-- Verify:
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'payments'::regclass and conname = 'payments_payment_mode_check';

-- 008_payments_reference_no_unique.sql
--
-- Rejects a second payment with the same reference_no at the database
-- level — the real backstop behind the app-side duplicate checks added in
-- Payments.jsx (manual entry + CSV import both now check for an existing
-- reference_no before inserting; this catches anything that slips past
-- that, e.g. two people saving at the same moment).
--
-- Only applies to non-empty reference_no — payments with no reference at
-- all (cash with nothing to cite) are never compared against each other,
-- so this can't block two different blank-reference cash payments.
create unique index if not exists payments_reference_no_unique
  on payments (reference_no)
  where reference_no is not null and reference_no <> '';

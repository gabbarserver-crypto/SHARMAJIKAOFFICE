-- 005_payment_verification.sql
-- Run this in the Supabase SQL editor.
--
-- Lets a dealer (or their sub-staff) submit a payment themselves from the
-- Dealer Portal, without it silently landing on the ledger as fact — it
-- sits as 'pending' until a staff member verifies it. Every payment staff
-- record directly (the existing "Record New Payment" form on the
-- Receipts page) keeps working exactly as before: it defaults to already
-- 'verified', so nothing about the existing flow changes.

alter table payments add column if not exists status text not null default 'verified' check (status in ('pending', 'verified', 'rejected'));
alter table payments add column if not exists submitted_by text not null default 'staff' check (submitted_by in ('staff', 'dealer'));
alter table payments add column if not exists verified_by uuid references staff(id);
alter table payments add column if not exists verified_at timestamptz;

create index if not exists payments_status_idx on payments(status);

alter table payments enable row level security;

-- Our staff can do everything, same as every other table in this app.
drop policy if exists "staff full access payments" on payments;
create policy "staff full access payments" on payments
  for all
  using (exists (select 1 from staff where staff.auth_user_id = auth.uid()))
  with check (exists (select 1 from staff where staff.auth_user_id = auth.uid()));

-- A dealer (or their active sub-staff) can see their OWN dealer's payments
-- — both staff-recorded ones and their own submissions, at any status, so
-- they can watch a submission move from Pending to Verified.
drop policy if exists "dealer read own payments" on payments;
create policy "dealer read own payments" on payments
  for select
  using (
    exists (select 1 from dealers where dealers.id = payments.dealer_id and dealers.auth_user_id = auth.uid())
    or exists (select 1 from dealer_staff ds where ds.dealer_id = payments.dealer_id and ds.auth_user_id = auth.uid() and ds.active)
  );

-- A dealer (or their active sub-staff) can submit a NEW payment for their
-- own dealer_id — but only ever as 'pending' / 'dealer', never able to
-- insert a row that's already 'verified' or attributed to 'staff'. This is
-- the one thing that actually keeps "self-reported" from becoming
-- "self-verified": ledger entries only ever get posted by the staff-side
-- verify action (see Payments.jsx), which requires the "staff full access"
-- policy above to touch the row at all.
drop policy if exists "dealer submit own payments" on payments;
create policy "dealer submit own payments" on payments
  for insert
  with check (
    status = 'pending'
    and submitted_by = 'dealer'
    and (
      exists (select 1 from dealers where dealers.id = payments.dealer_id and dealers.auth_user_id = auth.uid())
      or exists (select 1 from dealer_staff ds where ds.dealer_id = payments.dealer_id and ds.auth_user_id = auth.uid() and ds.active)
    )
  );

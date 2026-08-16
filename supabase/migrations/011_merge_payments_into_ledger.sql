-- Merges `payments` into `ledger_entries` so there's exactly ONE table for
-- receipts/payments going forward (no more double-entry, no more chance of
-- a receipt existing without its ledger row or vice versa).
--
-- After this runs:
--   * ledger_entries is the only table the app writes payments/receipts to.
--   * `payments` is renamed to `payments_archived_backup_<date>` (NOT
--     dropped) so your existing data is safe. Once you've spot-checked the
--     Ledger/Receipts pages and everything looks right, you can drop it
--     yourself with: drop table payments_archived_backup_<date>;
--   * The dealer-self-report-a-bank-transfer flow (status
--     pending/verified/rejected) is being removed per your instruction —
--     dealers now only pay by QR. Any payments rows that were left
--     'pending' or 'rejected' were never posted to the ledger and are NOT
--     migrated in (they're financially unverified data — sitting in the
--     archived table if you ever need to look them up, but intentionally
--     excluded from the ledger so nothing unverified silently starts
--     counting against a dealer's balance).

-- 1. Columns ledger_entries needs to fully replace `payments`.
alter table ledger_entries add column if not exists remarks text;
alter table ledger_entries add column if not exists received_by uuid;
alter table ledger_entries add column if not exists submitted_by text; -- 'staff' | 'gateway'
alter table ledger_entries add column if not exists source_application_id uuid;
alter table ledger_entries add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'ledger_entries_source_application_id_fkey'
  ) then
    alter table ledger_entries
      add constraint ledger_entries_source_application_id_fkey
      foreign key (source_application_id) references applications(id) on delete set null;
  end if;
end $$;

-- 2. Backfill remarks/received_by/submitted_by/application link/created_at
--    onto ledger rows that already exist for a payment (posted by the old
--    two-table flow or the 010 RPC).
update ledger_entries le
set
  remarks = p.remarks,
  received_by = p.received_by,
  submitted_by = coalesce(p.submitted_by, 'staff'),
  source_application_id = p.application_id,
  created_at = p.created_at
from payments p
where le.source_payment_id = p.id;

-- 3. Bring in any payment that never made it into the ledger (an orphan
--    from the old bug) — verified/staff/gateway ones only, per above.
insert into ledger_entries (
  entry_code, entry_type, entry_date, dealer_id, agency_id, amount,
  agency_paid_amount, payment_mode, reference_no, payer_name,
  remarks, received_by, submitted_by, source_application_id, source_payment_id, created_at
)
select
  coalesce(nullif(trim(p.reference_no), ''), 'PMT-' || p.id),
  'PAYMENT',
  coalesce(p.created_at::date, current_date),
  p.dealer_id,
  p.paid_at_agency_id,
  case when p.dealer_id is not null then -p.amount else 0 end,
  case when p.paid_at_agency_id is not null then p.amount else 0 end,
  p.payment_mode,
  p.reference_no,
  coalesce(d.name, a.name),
  p.remarks,
  p.received_by,
  coalesce(p.submitted_by, 'staff'),
  p.application_id,
  p.id,
  p.created_at
from payments p
left join dealers d on d.id = p.dealer_id
left join agencies a on a.id = p.paid_at_agency_id
where not exists (select 1 from ledger_entries le where le.source_payment_id = p.id)
  and (p.status is null or p.status = 'verified');

-- 4. The old atomic RPC (migration 010) is no longer needed — the app now
--    inserts into ledger_entries directly since it's a single table.
drop function if exists record_payment_with_ledger(
  payments.dealer_id%type, payments.application_id%type, payments.amount%type,
  payments.payment_mode%type, payments.reference_no%type, payments.remarks%type,
  payments.paid_at_agency_id%type, payments.received_by%type, timestamptz, date
);

-- 5. payment_qr_requests.payment_id currently points at payments(id) — the
--    webhook is about to start writing straight to ledger_entries instead,
--    so this FK needs to point there too (otherwise every future QR
--    payment would fail this constraint, since nothing will be inserting
--    into `payments` anymore).
do $$
declare
  fk record;
begin
  for fk in
    select tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.table_name = 'payment_qr_requests'
      and kcu.column_name = 'payment_id'
      and tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_name = 'payments'
  loop
    execute format('alter table payment_qr_requests drop constraint %I', fk.constraint_name);
  end loop;
end $$;

do $$
begin
  begin
    alter table payment_qr_requests
      add constraint payment_qr_requests_payment_id_fkey
      foreign key (payment_id) references ledger_entries(id) on delete set null;
  exception when duplicate_object then null;
  end;
end $$;

-- 6. Archive, don't drop — rename so the app (which no longer references
--    "payments" anywhere) can't accidentally write to it, while keeping the
--    data around as a safety net.
alter table if exists payments rename to payments_archived_backup;

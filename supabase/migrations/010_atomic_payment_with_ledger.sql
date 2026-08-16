-- Fix: a new receipt could be saved into `payments` even when its matching
-- `ledger_entries` row failed to insert (network hiccup, a stray RLS rule,
-- duplicate reference_no, etc). Payments.jsx did the two inserts as two
-- separate client-side calls, so there was no way to guarantee both landed
-- together — the payment would go through, the app would show
-- "Payment recorded" (or a toast that's easy to miss saying ledger sync
-- failed), and the entry would show up in "All Receipts & Payments" but
-- never in that dealer/agency's Ledger.
--
-- This function does BOTH inserts inside a single Postgres transaction.
-- If the ledger_entries insert fails for any reason, the whole function
-- raises and the payments insert is rolled back too — so a receipt and its
-- ledger entry can never exist independently of each other again. The
-- frontend (Payments.jsx) now calls this RPC instead of doing the two
-- inserts itself.
--
-- Run this once in the Supabase SQL editor (or via `supabase db push` if
-- you use the CLI) against your project.

create or replace function record_payment_with_ledger(
  p_dealer_id payments.dealer_id%type,
  p_application_id payments.application_id%type,
  p_amount payments.amount%type,
  p_payment_mode payments.payment_mode%type,
  p_reference_no payments.reference_no%type,
  p_remarks payments.remarks%type,
  p_paid_at_agency_id payments.paid_at_agency_id%type,
  p_received_by payments.received_by%type,
  p_created_at timestamptz default null,
  p_entry_date date default null
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_dealer_name text;
  v_agency_name text;
  v_entry_code text;
  v_is_agency_only boolean;
begin
  v_is_agency_only := p_dealer_id is null;

  insert into payments (
    dealer_id, application_id, amount, payment_mode, reference_no,
    remarks, paid_at_agency_id, received_by, created_at
  )
  values (
    p_dealer_id, p_application_id, p_amount, p_payment_mode, p_reference_no,
    p_remarks, p_paid_at_agency_id, p_received_by, coalesce(p_created_at, now())
  )
  returning * into v_payment;

  if p_dealer_id is not null then
    select name into v_dealer_name from dealers where id = p_dealer_id;
  end if;
  if p_paid_at_agency_id is not null then
    select name into v_agency_name from agencies where id = p_paid_at_agency_id;
  end if;

  v_entry_code := coalesce(nullif(trim(p_reference_no), ''), 'PMT-' || v_payment.id);

  -- If this insert fails, the exception propagates out of the function and
  -- Postgres automatically rolls back the payments insert above too.
  insert into ledger_entries (
    entry_code, entry_type, entry_date, dealer_id, agency_id, amount,
    agency_paid_amount, payment_mode, reference_no, payer_name, source_payment_id
  )
  values (
    v_entry_code,
    'PAYMENT',
    coalesce(p_entry_date, current_date),
    p_dealer_id,
    p_paid_at_agency_id,
    case when v_is_agency_only then 0 else -p_amount end,
    case when p_paid_at_agency_id is not null then p_amount else 0 end,
    p_payment_mode,
    p_reference_no,
    case when v_is_agency_only then v_agency_name else v_dealer_name end,
    v_payment.id
  );

  return v_payment;
end;
$$;

-- Same access as the existing "insert into payments" / "insert into
-- ledger_entries" RLS policies already grant to authenticated users —
-- security definer means this function itself carries the rights to write
-- both tables, so callers only need EXECUTE on the function.
grant execute on function record_payment_with_ledger(
  payments.dealer_id%type, payments.application_id%type, payments.amount%type,
  payments.payment_mode%type, payments.reference_no%type, payments.remarks%type,
  payments.paid_at_agency_id%type, payments.received_by%type, timestamptz, date
) to authenticated;

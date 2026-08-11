-- 013_atomic_ledger_amount_update.sql
-- Run this in the Supabase SQL editor.
--
-- Fixes: editing the "Amount" field in the Ledger page's application-detail
-- modal used to run TWO separate updates from the browser (one on
-- ledger_transactions / agency_ledger_transactions, one on applications).
-- If the connection dropped or one call failed after the other succeeded,
-- the ledger and the application's own amount could go out of sync.
--
-- These two functions do both updates inside a single Postgres transaction
-- (a function body is always atomic) — either both writes land, or neither
-- does. The frontend now calls one of these via supabase.rpc(...) instead
-- of two separate .update() calls.

create or replace function update_dealer_ledger_amount(
  p_txn_id uuid,
  p_application_id uuid,
  p_new_amount numeric
)
returns void
language plpgsql
security invoker
as $$
begin
  update ledger_transactions
    set amount = p_new_amount
    where id = p_txn_id;

  if not found then
    raise exception 'Ledger transaction % not found', p_txn_id;
  end if;

  update applications
    set amount = p_new_amount
    where id = p_application_id;

  if not found then
    raise exception 'Application % not found', p_application_id;
  end if;
end;
$$;

create or replace function update_agency_ledger_amount(
  p_txn_id uuid,
  p_application_id uuid,
  p_new_amount numeric
)
returns void
language plpgsql
security invoker
as $$
begin
  update agency_ledger_transactions
    set amount = p_new_amount
    where id = p_txn_id;

  if not found then
    raise exception 'Agency ledger transaction % not found', p_txn_id;
  end if;

  update applications
    set amount = p_new_amount
    where id = p_application_id;

  if not found then
    raise exception 'Application % not found', p_application_id;
  end if;
end;
$$;

-- security invoker (default in recent Postgres, explicit here for clarity)
-- means these run with the CALLING user's permissions/RLS — same access
-- rules as the two separate updates had before, just atomic now.

grant execute on function update_dealer_ledger_amount(uuid, uuid, numeric) to authenticated;
grant execute on function update_agency_ledger_amount(uuid, uuid, numeric) to authenticated;

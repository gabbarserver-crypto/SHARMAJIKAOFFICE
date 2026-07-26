-- Run this in the Supabase SQL editor. Safe to re-run any number of times.
--
-- Adds the new "paymentsReport" module — the read-only Payments page
-- (Fee vs PCC Fee per application) that sits alongside the renamed
-- "payments" module (now labelled "Receipts" in the UI, unchanged here —
-- module names in the `permissions` table are internal keys, not the
-- on-screen label). Every role gets the same can_view it already has for
-- "payments", since this is just a reporting view over the same data
-- (nothing here is editable, so can_add/can_edit/can_delete/can_approve
-- always stay false regardless of role).

begin;

insert into permissions (role_id, module, can_view, can_add, can_edit, can_delete, can_approve, can_print, can_export)
select
  p.role_id,
  'paymentsReport',
  p.can_view,
  false,
  false,
  false,
  false,
  p.can_print,
  p.can_export
from permissions p
where p.module = 'payments'
  and not exists (
    select 1 from permissions existing
    where existing.role_id = p.role_id and existing.module = 'paymentsReport'
  );

commit;

-- Verify:
select r.role_name, pr.can_view
from permissions pr
join roles r on r.id = pr.role_id
where pr.module = 'paymentsReport'
order by r.role_name;

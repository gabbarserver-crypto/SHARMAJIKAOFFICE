-- Run this once in the Supabase SQL editor.
-- Consolidates `roles` down to exactly 4: Admin, Staff, Dealer, Dealer Staff,
-- and seeds `permissions` rows for each of them across every module the app
-- now gates by role (see MODULE_BY_NAV_KEY in src/App.jsx).
--
-- Safe to re-run: every step either upserts or only touches rows matching
-- the legacy role names, so running it twice is a no-op the second time.

begin;

-- 1. Make sure the 4 target roles exist.
insert into roles (role_name)
select v.role_name
from (values ('Admin'), ('Staff'), ('Dealer'), ('Dealer Staff')) as v(role_name)
where not exists (select 1 from roles r where r.role_name = v.role_name);

-- 2. Reassign any staff currently sitting on a role we're retiring, so the
--    delete below never orphans a staff row's role_id.
update staff
set role_id = (select id from roles where role_name = 'Admin')
where role_id in (select id from roles where role_name = 'Super Admin');

update staff
set role_id = (select id from roles where role_name = 'Staff')
where role_id in (select id from roles where role_name in ('Manager', 'Accounts'));

-- 3. Drop the legacy roles (and their now-orphaned permission rows).
delete from permissions
where role_id in (select id from roles where role_name in ('Super Admin', 'Manager', 'Accounts'));

delete from roles
where role_name in ('Super Admin', 'Manager', 'Accounts');

-- 4. Seed one permissions row per (role x module) that doesn't already have
--    one. Defaults below are a starting point — adjust per-checkbox in
--    Settings → Permissions afterwards:
--      Admin        — full access to everything.
--      Staff        — the day-to-day tabs (Dashboard, Staff View, Chats,
--                      Ledger); can edit/approve within those, no Masters
--                      or Settings.
--      Dealer /
--      Dealer Staff — included here for a complete permissions matrix, but
--                      note DealerPortal (their actual UI) doesn't read
--                      from this table yet — it already separates the two
--                      by hand (Dealer sees a "Staff" sub-tab to manage
--                      Dealer Staff logins; Dealer Staff doesn't).
insert into permissions (role_id, module, can_view, can_add, can_edit, can_delete, can_approve, can_print, can_export)
select
  r.id,
  m.module,
  case
    when r.role_name = 'Admin' then true
    when r.role_name = 'Staff' then m.module in ('dashboard', 'staffApplications', 'chats', 'ledger')
    else m.module in ('dashboard')
  end as can_view,
  (r.role_name = 'Admin') as can_add,
  case
    when r.role_name = 'Admin' then true
    when r.role_name = 'Staff' then m.module in ('staffApplications', 'chats')
    else false
  end as can_edit,
  (r.role_name = 'Admin') as can_delete,
  case
    when r.role_name = 'Admin' then true
    when r.role_name = 'Staff' then m.module = 'staffApplications'
    else false
  end as can_approve,
  (r.role_name = 'Admin') as can_print,
  (r.role_name = 'Admin') as can_export
from roles r
cross join (
  values
    ('dashboard'), ('applications'), ('staffApplications'), ('chats'),
    ('masters'), ('payments'), ('ledger'), ('reports'), ('settings')
) as m(module)
where r.role_name in ('Admin', 'Staff', 'Dealer', 'Dealer Staff')
  and not exists (
    select 1 from permissions p where p.role_id = r.id and p.module = m.module
  );

commit;

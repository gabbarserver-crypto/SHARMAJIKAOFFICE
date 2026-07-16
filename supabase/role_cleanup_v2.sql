-- Run this in the Supabase SQL editor. Safe to re-run any number of times.
--
-- Unlike role_cleanup.sql (which only inserted permission rows that didn't
-- already exist), this version:
--   1. Normalizes role_name (trims stray whitespace) so "Dealer" and
--      "Dealer " aren't treated as different roles.
--   2. Merges any duplicate role rows sharing the same (trimmed) name down
--      to one canonical row, re-pointing staff.role_id and permissions.role_id
--      before deleting the duplicates — so nothing gets orphaned.
--   3. Retires Super Admin / Manager / Accounts into Admin / Staff.
--   4. Wipes and rebuilds the permissions grid for Admin / Staff / Dealer /
--      Dealer Staff from scratch, so there's no ambiguity about which role_id
--      the rows are attached to.

begin;

-- 1. Trim stray whitespace in role names.
update roles set role_name = trim(role_name) where role_name <> trim(role_name);

-- 2. Merge duplicates: for every role_name with more than one row, keep the
--    lowest id and move staff/permissions off the rest before deleting them.
with dupes as (
  select role_name, min(id) as keep_id
  from roles
  group by role_name
  having count(*) > 1
)
update staff s
set role_id = d.keep_id
from roles r
join dupes d on d.role_name = r.role_name
where s.role_id = r.id and r.id <> d.keep_id;

with dupes as (
  select role_name, min(id) as keep_id
  from roles
  group by role_name
  having count(*) > 1
)
delete from permissions p
using roles r
join dupes d on d.role_name = r.role_name
where p.role_id = r.id and r.id <> d.keep_id;

with dupes as (
  select role_name, min(id) as keep_id
  from roles
  group by role_name
  having count(*) > 1
)
delete from roles r
using dupes d
where r.role_name = d.role_name and r.id <> d.keep_id;

-- 3. Make sure the 4 target roles exist.
insert into roles (role_name)
select v.role_name
from (values ('Admin'), ('Staff'), ('Dealer'), ('Dealer Staff')) as v(role_name)
where not exists (select 1 from roles r where r.role_name = v.role_name);

update staff
set role_id = (select id from roles where role_name = 'Admin')
where role_id in (select id from roles where role_name = 'Super Admin');

update staff
set role_id = (select id from roles where role_name = 'Staff')
where role_id in (select id from roles where role_name in ('Manager', 'Accounts'));

delete from permissions
where role_id in (select id from roles where role_name in ('Super Admin', 'Manager', 'Accounts'));

delete from roles
where role_name in ('Super Admin', 'Manager', 'Accounts');

-- 4. Wipe and rebuild permissions for the 4 target roles — removes any doubt
--    about stale/duplicate rows left over from earlier attempts.
delete from permissions
where role_id in (select id from roles where role_name in ('Admin', 'Staff', 'Dealer', 'Dealer Staff'));

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
where r.role_name in ('Admin', 'Staff', 'Dealer', 'Dealer Staff');

commit;

-- Verify:
select r.role_name, count(p.id) as permission_row_count
from roles r
left join permissions p on p.role_id = r.id
group by r.role_name
order by r.role_name;

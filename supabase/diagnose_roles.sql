-- Run this in the Supabase SQL editor and share the output.
-- Shows every role row (including any hidden duplicates) and how many
-- permission rows each one actually has.

select
  r.id,
  r.role_name,
  length(r.role_name) as name_length,   -- catches invisible trailing spaces
  count(p.id) as permission_row_count
from roles r
left join permissions p on p.role_id = r.id
group by r.id, r.role_name
order by r.role_name, r.id;

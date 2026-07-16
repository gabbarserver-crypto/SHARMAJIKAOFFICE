-- Run this in the Supabase SQL editor and share the output — it shows the
-- actual SQL body of the two functions gating access to `permissions`.

select proname as function_name, pg_get_functiondef(oid) as definition
from pg_proc
where proname in ('is_office_staff', 'has_permission')
  and pronamespace = 'public'::regnamespace;

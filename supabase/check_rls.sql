-- Run this in the Supabase SQL editor and share the output.

-- 1. Is RLS even turned on for these tables?
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('roles', 'permissions')
  and relnamespace = 'public'::regnamespace;

-- 2. What policies (if any) exist on them?
select tablename, policyname, cmd, roles, qual
from pg_policies
where tablename in ('roles', 'permissions');

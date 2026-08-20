-- 003_call_logs.sql
-- Run this in the Supabase SQL editor.
--
-- Adds call_logs — a persisted history of voice/video call *attempts*,
-- covering both kinds of calling this app already does:
--   - "thread" calls   — lib/call.js, rung inside one chat thread
--   - "direct" calls   — lib/directCall.js, person-to-person, rung on
--                        someone's personal channel regardless of thread
--
-- Exactly one row is written per call attempt, always by the caller's
-- side (see logCallStart/logCallOutcome in src/lib/callLog.js) so a call
-- between two logged-in tabs only ever produces one row, not two.
--
-- outcome is filled in once the call ends: 'answered' (both sides
-- connected — duration_seconds is set), 'missed' (rang out / cancelled
-- before anyone answered), or 'declined' (recipient explicitly declined).
-- It's null for the brief window while a call is still ringing/active.

create table if not exists call_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('thread', 'direct')),
  thread_id uuid references chat_threads(id) on delete cascade,
  call_type text not null check (call_type in ('audio', 'video')),
  caller_type text not null check (caller_type in ('staff', 'dealer', 'dealer_staff')),
  caller_id uuid not null,
  caller_name text,
  callee_type text check (callee_type in ('staff', 'dealer', 'dealer_staff')),
  callee_id uuid,
  callee_name text,
  outcome text check (outcome in ('answered', 'missed', 'declined')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer
);

-- Defensive, same pattern as the other migrations in this folder.
alter table call_logs add column if not exists source text;
alter table call_logs add column if not exists thread_id uuid references chat_threads(id) on delete cascade;
alter table call_logs add column if not exists call_type text;
alter table call_logs add column if not exists caller_type text;
alter table call_logs add column if not exists caller_id uuid;
alter table call_logs add column if not exists caller_name text;
alter table call_logs add column if not exists callee_type text;
alter table call_logs add column if not exists callee_id uuid;
alter table call_logs add column if not exists callee_name text;
alter table call_logs add column if not exists outcome text;
alter table call_logs add column if not exists started_at timestamptz not null default now();
alter table call_logs add column if not exists ended_at timestamptz;
alter table call_logs add column if not exists duration_seconds integer;

create index if not exists call_logs_thread_id_idx on call_logs(thread_id);
create index if not exists call_logs_caller_idx on call_logs(caller_type, caller_id);
create index if not exists call_logs_callee_idx on call_logs(callee_type, callee_id);
create index if not exists call_logs_started_at_idx on call_logs(started_at desc);

alter table call_logs enable row level security;

-- Our staff can see and write every call log row.
drop policy if exists "staff full access call_logs" on call_logs;
create policy "staff full access call_logs" on call_logs
  for all
  using (exists (select 1 from staff where staff.auth_user_id = auth.uid()))
  with check (exists (select 1 from staff where staff.auth_user_id = auth.uid()));

-- A dealer (or their sub-staff) can see/write call log rows that belong to
-- them — either a thread call on one of their own chat_threads, or a direct
-- call where they were the caller or callee.
drop policy if exists "dealer access own call_logs" on call_logs;
create policy "dealer access own call_logs" on call_logs
  for all
  using (
    exists (
      select 1 from chat_threads t
      join dealers d on d.id = t.dealer_id
      where t.id = call_logs.thread_id and d.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from chat_threads t
      join dealer_staff ds on ds.dealer_id = t.dealer_id
      where t.id = call_logs.thread_id and ds.auth_user_id = auth.uid() and ds.active
    )
    or exists (select 1 from dealers d where d.id = call_logs.caller_id and d.auth_user_id = auth.uid())
    or exists (select 1 from dealers d where d.id = call_logs.callee_id and d.auth_user_id = auth.uid())
    or exists (select 1 from dealer_staff ds where ds.id = call_logs.caller_id and ds.auth_user_id = auth.uid() and ds.active)
    or exists (select 1 from dealer_staff ds where ds.id = call_logs.callee_id and ds.auth_user_id = auth.uid() and ds.active)
  )
  with check (
    exists (
      select 1 from chat_threads t
      join dealers d on d.id = t.dealer_id
      where t.id = call_logs.thread_id and d.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from chat_threads t
      join dealer_staff ds on ds.dealer_id = t.dealer_id
      where t.id = call_logs.thread_id and ds.auth_user_id = auth.uid() and ds.active
    )
    or exists (select 1 from dealers d where d.id = call_logs.caller_id and d.auth_user_id = auth.uid())
    or exists (select 1 from dealer_staff ds where ds.id = call_logs.caller_id and ds.auth_user_id = auth.uid() and ds.active)
  );

-- Realtime, so the call log panel on the Chats page can update live
-- without a manual refresh (same pattern as chat_messages).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'call_logs'
  ) then
    alter publication supabase_realtime add table call_logs;
  end if;
end $$;

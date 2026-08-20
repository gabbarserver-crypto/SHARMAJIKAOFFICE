-- 002_chat_and_dealer_staff.sql
-- Run this in the Supabase SQL editor.
--
-- Adds:
--   1. dealer_staff        — sub-logins under a dealer (didn't exist before;
--                             today a dealer has exactly one auth login).
--   2. chat_threads        — one row per conversation. application_id is
--                             NULL for a dealer's general/overall thread,
--                             or set for a thread scoped to one application.
--   3. chat_messages       — messages inside a thread.
--   4. RLS so dealers and their sub-staff can only ever see their own
--      dealer's threads/messages, while any of our staff can see everything.

-- ============================================================
-- 1. Dealer sub-staff
-- ============================================================
create table if not exists dealer_staff (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references dealers(id) on delete cascade,
  full_name text not null,
  email text,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Defensive: if this table already existed from a partial earlier run,
-- make sure every column this migration depends on is actually there.
alter table dealer_staff add column if not exists dealer_id uuid references dealers(id) on delete cascade;
alter table dealer_staff add column if not exists full_name text;
alter table dealer_staff add column if not exists email text;
alter table dealer_staff add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table dealer_staff add column if not exists active boolean not null default true;
alter table dealer_staff add column if not exists created_at timestamptz not null default now();

create index if not exists dealer_staff_dealer_id_idx on dealer_staff(dealer_id);

alter table dealer_staff enable row level security;

-- Our staff can manage all dealer_staff rows.
drop policy if exists "staff manage dealer_staff" on dealer_staff;
create policy "staff manage dealer_staff" on dealer_staff
  for all
  using (exists (select 1 from staff where staff.auth_user_id = auth.uid()))
  with check (exists (select 1 from staff where staff.auth_user_id = auth.uid()));

-- A dealer (primary login) can see/manage their own sub-staff.
drop policy if exists "dealer manage own dealer_staff" on dealer_staff;
create policy "dealer manage own dealer_staff" on dealer_staff
  for all
  using (exists (select 1 from dealers where dealers.id = dealer_staff.dealer_id and dealers.auth_user_id = auth.uid()))
  with check (exists (select 1 from dealers where dealers.id = dealer_staff.dealer_id and dealers.auth_user_id = auth.uid()));

-- A sub-staff member can read their own row (to resolve their dealer_id on login).
drop policy if exists "dealer_staff read self" on dealer_staff;
create policy "dealer_staff read self" on dealer_staff
  for select
  using (auth_user_id = auth.uid());


-- ============================================================
-- 2. Chat threads
-- ============================================================
create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references dealers(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
alter table chat_threads add column if not exists dealer_id uuid references dealers(id) on delete cascade;
alter table chat_threads add column if not exists application_id uuid references applications(id) on delete cascade;
alter table chat_threads add column if not exists created_at timestamptz not null default now();
alter table chat_threads add column if not exists last_message_at timestamptz not null default now();

-- One general thread per dealer (application_id null), one thread per
-- (dealer, application) pair.
create unique index if not exists chat_threads_general_uidx
  on chat_threads(dealer_id) where application_id is null;
create unique index if not exists chat_threads_application_uidx
  on chat_threads(dealer_id, application_id) where application_id is not null;

alter table chat_threads enable row level security;

drop policy if exists "staff full access chat_threads" on chat_threads;
create policy "staff full access chat_threads" on chat_threads
  for all
  using (exists (select 1 from staff where staff.auth_user_id = auth.uid()))
  with check (exists (select 1 from staff where staff.auth_user_id = auth.uid()));

drop policy if exists "dealer access own chat_threads" on chat_threads;
create policy "dealer access own chat_threads" on chat_threads
  for all
  using (
    exists (select 1 from dealers where dealers.id = chat_threads.dealer_id and dealers.auth_user_id = auth.uid())
    or exists (select 1 from dealer_staff ds where ds.dealer_id = chat_threads.dealer_id and ds.auth_user_id = auth.uid() and ds.active)
  )
  with check (
    exists (select 1 from dealers where dealers.id = chat_threads.dealer_id and dealers.auth_user_id = auth.uid())
    or exists (select 1 from dealer_staff ds where ds.dealer_id = chat_threads.dealer_id and ds.auth_user_id = auth.uid() and ds.active)
  );


-- ============================================================
-- 3. Chat messages
-- ============================================================
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_type text not null check (sender_type in ('staff', 'dealer', 'dealer_staff')),
  sender_id uuid not null,          -- staff.id, dealers.id, or dealer_staff.id
  sender_name text not null,
  body text,                        -- nullable: a message can be attachment-only
  attachment_url text,
  created_at timestamptz not null default now()
);
alter table chat_messages add column if not exists thread_id uuid references chat_threads(id) on delete cascade;
alter table chat_messages add column if not exists sender_type text;
alter table chat_messages add column if not exists sender_id uuid;
alter table chat_messages add column if not exists sender_name text;
alter table chat_messages add column if not exists body text;
alter table chat_messages add column if not exists attachment_url text;
alter table chat_messages add column if not exists created_at timestamptz not null default now();
-- Relax body in case it was created NOT NULL by an earlier version of this migration.
alter table chat_messages alter column body drop not null;

-- Defensive: if a chat_messages table already existed in this project from
-- an earlier/different schema (e.g. with its own NOT NULL dealer_id column
-- instead of going through chat_threads), relax it so our inserts — which
-- only ever set thread_id/sender_*/body — don't fail. Dealer is derived via
-- thread_id -> chat_threads.dealer_id in this design.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'dealer_id'
  ) then
    execute 'alter table chat_messages alter column dealer_id drop not null';
  end if;
end $$;

create index if not exists chat_messages_thread_id_idx on chat_messages(thread_id, created_at);

alter table chat_messages enable row level security;

drop policy if exists "staff full access chat_messages" on chat_messages;
create policy "staff full access chat_messages" on chat_messages
  for all
  using (exists (select 1 from staff where staff.auth_user_id = auth.uid()))
  with check (exists (select 1 from staff where staff.auth_user_id = auth.uid()));

drop policy if exists "dealer access own chat_messages" on chat_messages;
create policy "dealer access own chat_messages" on chat_messages
  for all
  using (
    exists (
      select 1 from chat_threads t
      where t.id = chat_messages.thread_id
      and (
        exists (select 1 from dealers where dealers.id = t.dealer_id and dealers.auth_user_id = auth.uid())
        or exists (select 1 from dealer_staff ds where ds.dealer_id = t.dealer_id and ds.auth_user_id = auth.uid() and ds.active)
      )
    )
  )
  with check (
    exists (
      select 1 from chat_threads t
      where t.id = chat_messages.thread_id
      and (
        exists (select 1 from dealers where dealers.id = t.dealer_id and dealers.auth_user_id = auth.uid())
        or exists (select 1 from dealer_staff ds where ds.dealer_id = t.dealer_id and ds.auth_user_id = auth.uid() and ds.active)
      )
    )
  );

-- Keep last_message_at fresh so thread lists can sort by recent activity.
create or replace function bump_chat_thread_last_message()
returns trigger as $$
begin
  update chat_threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_bump_chat_thread on chat_messages;
create trigger trg_bump_chat_thread
  after insert on chat_messages
  for each row execute function bump_chat_thread_last_message();

-- Enable realtime for live updates in the chat widget. Guarded so re-running
-- this migration doesn't error if it's already been added.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table chat_messages;
  end if;
end $$;

-- ============================================================
-- 4. Learner's Licence -> Driving Licence appointment booking
--
-- Lets a dealer take a service that's been Completed for 30+ days (e.g. a
-- Learner's Licence) and, in one click, create a new draft application for
-- whatever service is configured as its follow-up (e.g. Driving Licence),
-- pre-filled with the same applicant and a chosen appointment date.
-- ============================================================

-- Which service this one converts into once completed (set in Masters >
-- Service > "Next Service"). Nullable — most services have no follow-up.
alter table services add column if not exists next_service_id uuid references services(id);

-- When an application actually became Completed — written once, when status
-- transitions to Completed. Used for the 30-day eligibility check instead of
-- re-deriving it from application_status_history on every row every time.
alter table applications add column if not exists completed_at timestamptz;

-- Set on a new draft that was created via this flow, pointing back at the
-- Completed application it was booked from. Lets the UI hide the "Book
-- Appointment" action once a follow-up has already been created, and lets
-- staff trace "this DL came from that LL".
alter table applications add column if not exists source_application_id uuid references applications(id);

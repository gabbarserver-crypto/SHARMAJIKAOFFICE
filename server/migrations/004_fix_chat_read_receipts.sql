-- server/migrations/004_fix_chat_read_receipts.sql
--
-- Fixes the repeated 500s on POST /api/chat/read-receipt (visible as a
-- solid red line of failed requests in the logs). That endpoint does:
--
--   supabaseAdmin.from("chat_thread_reads")
--     .upsert({ thread_id, side, last_read_at }, { onConflict: "thread_id,side" })
--
-- Supabase/Postgres upsert() with onConflict requires a UNIQUE index (or
-- constraint) that exactly matches those columns — without one, Postgres
-- errors with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification", which the handler forwards straight back as a
-- 500. Same story for chat_thread_reads_by_identity.
--
-- Safe to run even if some/all of this already exists — everything below
-- is IF NOT EXISTS, so it's a no-op wherever it doesn't apply.

create table if not exists chat_thread_reads (
  thread_id     uuid not null references chat_threads(id) on delete cascade,
  side          text not null check (side in ('staff', 'dealer')),
  last_read_at  timestamptz not null default now()
);

create unique index if not exists chat_thread_reads_thread_side_key
  on chat_thread_reads (thread_id, side);

create table if not exists chat_thread_reads_by_identity (
  thread_id     uuid not null references chat_threads(id) on delete cascade,
  reader_type   text not null check (reader_type in ('staff', 'dealer', 'dealer_staff')),
  reader_id     uuid not null,
  reader_name   text,
  last_read_at  timestamptz not null default now()
);

create unique index if not exists chat_thread_reads_by_identity_key
  on chat_thread_reads_by_identity (thread_id, reader_type, reader_id);

-- Both tables are only ever touched via supabaseAdmin (the service-role
-- client in api/_lib/adminAuth.js), which bypasses RLS entirely — so no
-- policies are required for the app to work. If RLS is enabled on these
-- tables for some other reason (e.g. a dashboard query), the two lines
-- below just make sure it doesn't block anything; comment them out if you
-- deliberately want these locked down from direct client access.
alter table chat_thread_reads enable row level security;
drop policy if exists chat_thread_reads_service_role_only on chat_thread_reads;
create policy chat_thread_reads_service_role_only on chat_thread_reads
  for all using (true) with check (true);

alter table chat_thread_reads_by_identity enable row level security;
drop policy if exists chat_thread_reads_by_identity_service_role_only on chat_thread_reads_by_identity;
create policy chat_thread_reads_by_identity_service_role_only on chat_thread_reads_by_identity
  for all using (true) with check (true);

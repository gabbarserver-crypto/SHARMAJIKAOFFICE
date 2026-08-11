-- supabase/012_chat_message_seen_by.sql
--
-- Per-PERSON read tracking, on top of the per-SIDE tracking added in
-- 010_chat_read_receipts.sql. That table only ever answers "has the staff
-- side / the dealer side read this" (needed for the tick colour); this one
-- additionally records which individual last read a thread and when, so
-- the UI can show "Seen by Rahul, 2:14 PM" — useful because a dealer's
-- sub-staff logins all collapse into one "dealer" side for the tick, but
-- are still separate people worth naming here.
--
-- One row per (thread, person) — same "last read wins" shape as
-- chat_thread_reads, just keyed finer. A message is "seen by" someone if
-- their last_read_at here is at/after that message's created_at (computed
-- client-side from this table, same as the existing tick logic).
--
-- Deliberately NOT relying on RLS, same reasoning as 010: every read/write
-- goes through api/chat/read-receipt.js using supabaseAdmin after
-- resolveCaller() has authenticated the caller.

create table if not exists chat_thread_reads_by_identity (
  thread_id uuid not null references chat_threads(id) on delete cascade,
  reader_type text not null check (reader_type in ('staff', 'dealer', 'dealer_staff')),
  reader_id uuid not null,
  reader_name text,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, reader_type, reader_id)
);

create index if not exists chat_thread_reads_by_identity_thread_idx on chat_thread_reads_by_identity(thread_id);

alter table chat_thread_reads_by_identity enable row level security;
-- No policies added — only ever touched via supabaseAdmin (service role)
-- from api/chat/read-receipt.js, so RLS-with-zero-policies fully denies
-- direct client (anon/authenticated) access, same as chat_thread_reads.

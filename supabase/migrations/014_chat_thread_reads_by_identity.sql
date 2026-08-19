-- Ensures the per-individual chat read-tracking table exists.
--
-- Why this migration exists: this repo's migrations folder only has
-- 010/011/013 tracked — the earlier ones (002_chat_and_dealer_staff.sql
-- etc., referenced in 013's comments) that presumably created the base
-- chat tables aren't in this repo, meaning they were applied directly via
-- the Supabase SQL editor at some point and never committed. If
-- chat_thread_reads_by_identity specifically was one of those
-- SQL-editor-only additions and it was missed, every call to
-- api/chat/unread-summary.js fails (500, "relation does not exist"),
-- which api/App.jsx/DealerPortal.jsx's refreshPendingChatCount/
-- refreshUnreadChats swallow silently (best-effort try/catch) — so the
-- unread badge just freezes at its last successful value forever instead
-- of ever clearing on read. This is written with IF NOT EXISTS everywhere
-- so it's a safe no-op if the table already exists.
--
-- Run this once in the Supabase SQL editor.

create table if not exists chat_thread_reads_by_identity (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  reader_type text not null check (reader_type in ('staff', 'dealer', 'dealer_staff')),
  reader_id uuid not null,
  reader_name text,
  last_read_at timestamptz not null default now(),
  unique (thread_id, reader_type, reader_id)
);

create index if not exists chat_thread_reads_by_identity_thread_idx
  on chat_thread_reads_by_identity (thread_id);

-- Locked down to the service role only (api/*.js always calls this table
-- via supabaseAdmin, the service role client, which bypasses RLS
-- entirely) — RLS enabled with zero policies just means no
-- browser-session (anon/authenticated) request can touch it directly,
-- matching how the rest of the chat backend already works.
alter table chat_thread_reads_by_identity enable row level security;

-- Sanity check while you're in the SQL editor: also confirm the older
-- side-level table (staff vs dealer, used for the tick colours) exists.
-- Uncomment to create it too if it's somehow missing as well:
-- create table if not exists chat_thread_reads (
--   id uuid primary key default gen_random_uuid(),
--   thread_id uuid not null references chat_threads(id) on delete cascade,
--   side text not null check (side in ('staff', 'dealer')),
--   last_read_at timestamptz not null default now(),
--   unique (thread_id, side)
-- );
-- alter table chat_thread_reads enable row level security;

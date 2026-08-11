-- supabase/010_chat_read_receipts.sql
--
-- Backs the chat double-tick / blue-tick feature. One row per (thread,
-- side) — "side" collapses dealer + dealer_staff into a single 'dealer'
-- row, same convention already used elsewhere in this app (push targeting,
-- unread counts in chat.js) since any of a dealer's logins reading a
-- thread should count as "the dealer side has read it".
--
-- Deliberately NOT relying on RLS here — every read/write goes through
-- api/chat/read-receipt.js using supabaseAdmin (service role) after
-- resolveCaller() has already authenticated + figured out which side the
-- caller is on, same pattern as api/payments/create-qr.js and
-- api/agora-token.js. Simpler than re-deriving this app's existing
-- dealer/staff RLS model, which isn't in this migration set.

create table if not exists chat_thread_reads (
  thread_id uuid not null references chat_threads(id) on delete cascade,
  side text not null check (side in ('staff', 'dealer')),
  last_read_at timestamptz not null default now(),
  primary key (thread_id, side)
);

alter table chat_thread_reads enable row level security;
-- No policies added — this table is only ever touched via supabaseAdmin
-- (service role) from api/chat/read-receipt.js, which bypasses RLS. With
-- RLS enabled and zero policies, direct client access (anon/authenticated
-- role) is fully denied, which is what we want here.

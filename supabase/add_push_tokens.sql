-- Push notification device tokens — one row per device a person has ever
-- signed in on. `owner_type` + `owner_id` matches the same identity shape
-- used everywhere else (src/lib/chat.js identityFor / src/lib/directCall.js):
-- 'staff' | 'dealer' | 'dealer_staff'.
--
-- Registered client-side (src/lib/push.js) the moment someone signs in on
-- the native Android app. Read server-side only, by api/send-push.js, using
-- the service-role key — that's the only place an actual push gets sent,
-- since sending requires the Firebase service-account secret which never
-- touches the browser/app bundle.
create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('staff', 'dealer', 'dealer_staff')),
  owner_id uuid not null,
  token text not null unique,
  platform text not null default 'android',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_owner_idx on push_tokens (owner_type, owner_id);

alter table push_tokens enable row level security;

-- Same permissive posture as the rest of this app's tables (e.g. chat_messages,
-- the personal-call broadcast channels) — any signed-in user (staff, dealer,
-- or dealer_staff) can register/refresh a token. There's nothing sensitive in
-- this table (just an opaque device token + which identity owns it), and only
-- the server-side service-role key is ever used to read it for actually
-- sending a push.
drop policy if exists "push_tokens_insert" on push_tokens;
create policy "push_tokens_insert" on push_tokens for insert to authenticated with check (true);

drop policy if exists "push_tokens_update" on push_tokens;
create policy "push_tokens_update" on push_tokens for update to authenticated using (true);

drop policy if exists "push_tokens_delete" on push_tokens;
create policy "push_tokens_delete" on push_tokens for delete to authenticated using (true);

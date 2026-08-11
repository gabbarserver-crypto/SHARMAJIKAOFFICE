-- supabase/011_chat_message_replies.sql
--
-- Lets a chat message reference another message in the same thread as the
-- one it's replying to (WhatsApp-style "swipe/tap to reply" quoting).
-- Nullable — most messages aren't replies. On delete of the original,
-- we keep the reply itself (set null) rather than cascading, since the
-- reply's own text/attachment is still meaningful on its own.

alter table chat_messages
  add column if not exists reply_to_id uuid references chat_messages(id) on delete set null;

create index if not exists chat_messages_reply_to_id_idx on chat_messages(reply_to_id);

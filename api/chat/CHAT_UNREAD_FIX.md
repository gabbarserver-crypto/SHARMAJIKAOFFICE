# Chat unread badge fix

## What was actually wrong

Two separate bugs, stacked:

1. **The "3" badge was never based on "read" status.** `countOpenThreads()`
   / `countDealerUnread()` in `lib/chat.js` count threads by "who sent the
   last message" (an *awaiting-reply* heuristic), not by whether anyone
   opened and read them. Opening a chat could never clear it — only
   sending a reply could.

2. **`/api/chat/read-receipt` was 500ing on every call** (see your Logs
   screenshot — a solid red line of failed `POST /api/chat/read-receipt`).
   That endpoint is the one actual per-person "last read" tracker
   (`chat_thread_reads` / `chat_thread_reads_by_identity`), and it was
   failing on every call, most likely because the table(s) it
   `upsert(..., { onConflict: ... })`s into don't have a matching unique
   index — Postgres requires one for `ON CONFLICT` to work at all.

## What changed

- **`server/migrations/004_fix_chat_read_receipts.sql`** — idempotent
  (`IF NOT EXISTS` throughout) migration that creates the read-receipt
  tables and their required unique indexes if missing. **Run this in
  Supabase's SQL editor.** If `/api/chat/read-receipt` still 500s
  afterward, open the failing request's Network tab **Response** body
  (not just the status) and share the actual `{"error": "..."}` message —
  the guess above is my best read of the evidence I had, not a
  confirmed diagnosis.

- **`api/chat/unread-summary.js`** (new) — returns each thread's real
  unread count for the calling individual, computed from
  `chat_thread_reads_by_identity` vs. actual message timestamps.

- **`lib/serverApi.js`** — added `chatUnreadSummary()`.

- **`lib/threadReadBus.js`** (new) — tiny pub/sub so `ChatPanel` can tell
  every badge on screen "a thread was just marked read" the moment it
  happens, instead of everything waiting on its own poll interval.

- **`ChatPanel.jsx`** — calls `notifyThreadRead()` right after the first
  successful read-receipt call for a newly opened thread.

- **`App.jsx`** (staff sidebar badge) and **`DealerPortal.jsx`** (dealer
  sidebar badge) — now call `chatUnreadSummary()` instead of
  `countOpenThreads()`/`countDealerUnread()`, and refetch instantly on
  `threadReadBus` events (plus the existing 30s poll / new-message
  realtime trigger as fallbacks).

- **`CommsWindow.jsx`'s `ThreadsTab`**, **`Chats.jsx`**, and
  **`DealerPortal.jsx`'s `DealerChats`** — per-thread badges now come
  from `chatUnreadSummary()` too, with an optimistic instant-clear on
  click (so the badge disappears the moment you tap, not after a round
  trip). Replaced the old `lib/threadSeen.js` (browser-localStorage-only,
  so it never synced across devices and didn't touch the real unread
  count) — that file is now deleted.

- **`lib/chat.js`** — `countOpenThreads()`/`countDealerUnread()` are kept
  (in case they're still useful for an "awaiting reply" report/metric)
  but their comments now say plainly not to wire them into anything
  meant to be a personal unread badge again.

## To deploy

1. Run `server/migrations/004_fix_chat_read_receipts.sql` in Supabase.
2. Deploy the changed files (the new `api/chat/unread-summary.js` needs
   to land as a Vercel function alongside the existing `api/chat/`
   endpoints).
3. Open a chat as staff and as a dealer and confirm both sidebar badges
   and per-thread numbers clear on open, immediately, and stay cleared
   after a refresh.

# Unified Chats/Calls window — setup

## What's in this zip
- `src/components/CommsWindow.jsx` — NEW. The single floating chat icon +
  window with a bottom nav (Chats / Calls / New Call), used by every login
  type.
- `src/lib/chat.js` — modified, adds `listRecentThreadsForStaff` and
  `listRecentThreadsForDealer` (powers the Chats tab).
- `src/lib/callLog.js` — modified, adds `fetchAllCallLogs` for staff and
  joins in thread/dealer info so a call row can show who it was and jump
  back to that conversation.
- `src/App.jsx` — modified. Replaces `<StaffChatWidget ...>` with
  `<CommsWindow variant="staff" ...>`.
  **This version already includes the FCM push-notification wiring from
  the previous zip (`push-notifications-fcm.zip`) merged in** — use THIS
  App.jsx, not that one, if you're applying both.
- `src/pages/DealerPortal.jsx` — modified. Replaces `<ChatWidget ...>`
  with `<CommsWindow variant="dealer" ...>`.

You can now delete `src/components/ChatWidget.jsx` and
`src/components/StaffChatWidget.jsx` — nothing references them anymore.

## How the permission rule works
"New Call" tab:
- **Staff** see every dealer + every active dealer_staff, and can call or
  video-call any of them.
- **Dealer / dealer_staff** logins see ONLY admin staff. This isn't a
  filter applied to one shared list — it's a completely separate Supabase
  query (`select from staff`) that never touches the `dealers` or
  `dealer_staff` tables at all, so there's no code path that could ever
  show a dealer another dealer, or another dealer's sub-staff.

## Nothing new to install
No new dependencies, no new migrations — this only reuses tables and
Supabase queries that already exist in your project.

## Test it
1. Sign in as staff → chat bubble bottom-right → should show Chats / Calls
   / New Call tabs. New Call should list dealers and dealer staff.
2. Sign in as a dealer → same bubble → New Call should list ONLY admin
   staff (try searching — a dealer's own name/company should never appear).
3. Start a call from New Call, hang up, check it shows up in the Calls tab
   with a "call back" button.
4. Send a message from Chats tab, confirm it appears in the other side's
   Recent list.

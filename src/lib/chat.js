// src/lib/chat.js
//
// Thin data layer over the chat_threads / chat_messages tables
// (see server/migrations/002_chat_and_dealer_staff.sql).
//
// A "thread" is either:
//   - general:      { dealer_id, application_id: null }  — one running
//                    conversation per dealer, covers everything.
//   - per-application: { dealer_id, application_id }      — scoped to one
//                    case, opened from that application's row/detail.
//
// Who can read/write a thread is enforced by Postgres RLS (dealer + their
// own sub-staff + our staff — see the migration), this file just calls the
// API; it doesn't itself decide who's allowed to see what.

import { supabase } from "./supabase";

// Get (or lazily create) a thread for a dealer, optionally scoped to one
// application. Safe to call repeatedly — unique indexes on chat_threads
// mean concurrent calls converge on the same row.
export async function getOrCreateThread({ dealerId, applicationId = null }) {
  let query = supabase.from("chat_threads").select("*").eq("dealer_id", dealerId);
  query = applicationId ? query.eq("application_id", applicationId) : query.is("application_id", null);
  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from("chat_threads")
    .insert({ dealer_id: dealerId, application_id: applicationId })
    .select()
    .single();
  // Race: someone else created it a moment ago — just fetch it.
  if (createError) {
    const { data: refetched, error: refetchError } = await query.maybeSingle();
    if (refetched) return refetched;
    throw createError || refetchError;
  }
  return created;
}

export async function listMessages(threadId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendMessage({ threadId, sender }) {
  const { error } = await supabase.from("chat_messages").insert({
    thread_id: threadId,
    sender_type: sender.type,   // 'staff' | 'dealer' | 'dealer_staff'
    sender_id: sender.id,
    sender_name: sender.name,
    body: sender.body || null,
    attachment_url: sender.attachmentUrl || null,
  });
  if (error) throw error;
}

// Uploads an image to the same "application-documents" bucket already used
// for document uploads, under a chat/ prefix, and returns its public URL.
export async function uploadChatAttachment(threadId, file) {
  const path = `chat/${threadId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from("application-documents").upload(path, file);
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from("application-documents").getPublicUrl(path);
  return data.publicUrl;
}

// Live updates for a single thread. Returns an unsubscribe function.
// Uses a unique channel name per call (not just the thread id) so two
// overlapping subscriptions to the same thread — e.g. React 18 dev-mode
// briefly mounting an effect twice — never collide on the same channel
// object and hit "cannot add postgres_changes callbacks after subscribe()".
export function subscribeToThread(threadId, onMessage) {
  const channelName = `chat_messages:${threadId}:${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
      (payload) => onMessage(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// Counts application threads whose latest message is from a dealer/dealer_staff
// (i.e. staff hasn't replied yet). Used for the sidebar "Chats" badge — same
// "awaiting reply" definition used everywhere else in the app, not a literal
// per-staff read/unseen count (there's no read-tracking table for that).
export async function countOpenThreads() {
  const { data: threads, error: threadsError } = await supabase
    .from("chat_threads")
    .select("id")
    .not("application_id", "is", null);
  if (threadsError) throw threadsError;
  const threadIds = (threads || []).map((t) => t.id);
  if (threadIds.length === 0) return 0;

  const { data: messages, error: messagesError } = await supabase
    .from("chat_messages")
    .select("thread_id, sender_type, created_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });
  if (messagesError) throw messagesError;

  const latestByThread = {};
  for (const m of messages || []) {
    if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
  }
  return Object.values(latestByThread).filter((m) => m.sender_type !== "staff").length;
}

// Dealer-side counterpart to countOpenThreads: counts this dealer's threads
// (general + per-application) whose latest message came from staff, i.e.
// it's the dealer's turn to reply. Used for the dealer portal's "Chats" tab
// badge — same "hasn't been replied to" proxy used everywhere else, not a
// literal per-user read/unseen flag.
export async function countDealerUnread(dealerId) {
  const { data: threads, error: threadsError } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("dealer_id", dealerId);
  if (threadsError) throw threadsError;
  const threadIds = (threads || []).map((t) => t.id);
  if (threadIds.length === 0) return 0;

  const { data: messages, error: messagesError } = await supabase
    .from("chat_messages")
    .select("thread_id, sender_type, created_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });
  if (messagesError) throw messagesError;

  const latestByThread = {};
  for (const m of messages || []) {
    if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
  }
  return Object.values(latestByThread).filter((m) => m.sender_type === "staff").length;
}

// Recent conversations across EVERY dealer, most-recently-active first —
// powers the "Recent" tab of CommsWindow for staff. Unlike countOpenThreads/
// the old StaffChatWidget list, this isn't filtered to "awaiting reply
// only" — it's meant to read like WhatsApp's chat list, not a to-do list.
export async function listRecentThreadsForStaff(limit = 30) {
  const { data: threadRows, error: threadsError } = await supabase
    .from("chat_threads")
    .select("id, application_id, dealer_id, applications(draft_code, application_no, applicant_name), dealers(name, short_name, code)")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (threadsError) throw threadsError;

  const threadIds = (threadRows || []).map((t) => t.id);
  let latestByThread = {};
  if (threadIds.length) {
    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select("thread_id, sender_type, body, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false });
    if (messagesError) throw messagesError;
    for (const m of messages || []) {
      if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
    }
  }

  return (threadRows || []).map((t) => {
    const latest = latestByThread[t.id];
    return {
      threadId: t.id,
      applicationId: t.application_id,
      dealerId: t.dealer_id,
      label: t.application_id
        ? `${t.applications?.application_no || t.applications?.draft_code || "—"} — ${t.applications?.applicant_name || "—"}`
        : "General",
      dealerLabel: t.dealers?.short_name || t.dealers?.name || t.dealers?.code || "—",
      lastMessage: latest?.body || (latest?.attachment_url ? "📎 Attachment" : null),
      lastAt: latest?.created_at || null,
      awaitingReply: latest ? latest.sender_type !== "staff" : false,
    };
  });
}

// Recent conversations for ONE dealer (their general thread + every
// per-application thread), most-recently-active first — powers the
// "Recent" tab of CommsWindow for a dealer/dealer_staff login.
export async function listRecentThreadsForDealer(dealerId, limit = 30) {
  const { data: threadRows, error: threadsError } = await supabase
    .from("chat_threads")
    .select("id, application_id, applications(draft_code, application_no, applicant_name)")
    .eq("dealer_id", dealerId)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (threadsError) throw threadsError;

  const threadIds = (threadRows || []).map((t) => t.id);
  let latestByThread = {};
  if (threadIds.length) {
    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select("thread_id, sender_type, body, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false });
    if (messagesError) throw messagesError;
    for (const m of messages || []) {
      if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
    }
  }

  return (threadRows || [])
    .map((t) => {
      const latest = latestByThread[t.id];
      return {
        threadId: t.id,
        applicationId: t.application_id,
        label: t.application_id
          ? `${t.applications?.application_no || t.applications?.draft_code || "—"} — ${t.applications?.applicant_name || "—"}`
          : "General",
        lastMessage: latest?.body || (latest?.attachment_url ? "📎 Attachment" : null),
        lastAt: latest?.created_at || null,
        awaitingReply: latest ? latest.sender_type === "staff" : false,
      };
    })
    .sort((a, b) => {
      // General thread first, then most recently active.
      if (!a.applicationId !== !b.applicationId) return a.applicationId ? 1 : -1;
      return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
    });
}

// Resolves who's currently logged in, in the shape sendMessage() expects.
// `staff` and `dealer`/`dealerStaff` are whatever App.jsx already has in
// state — this just normalizes them into one sender object.
export function identityFor({ staff, dealer, dealerStaff }) {
  if (staff) return { type: "staff", id: staff.id, name: staff.full_name || "Staff" };
  if (dealerStaff) return { type: "dealer_staff", id: dealerStaff.id, name: dealerStaff.full_name || "Dealer Staff" };
  if (dealer) return { type: "dealer", id: dealer.id, name: dealer.short_name || dealer.name || "Dealer" };
  return null;
}

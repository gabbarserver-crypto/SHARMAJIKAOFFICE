// src/lib/callLog.js
//
// Persisted call *history* — separate on purpose from the live signaling
// in call.js / directCall.js, which never touches a table (see the comment
// at the top of call.js). This is what backs the missed-call log on the
// Chats page.
//
// Exactly one row is written per call attempt, always from the caller's
// side — logCallStart() is only ever called by whoever pressed "call", and
// logCallOutcome() fills in how it ended once it's over. That way a call
// between two logged-in tabs produces one row, not two.
import { supabase } from "./supabase";

// source: 'thread' | 'direct'
// threadId: chat thread id for a thread call, null for a direct call
// caller/callee: { type, id, name } identities (callee is null for a
//   thread call — the row is looked up by thread_id instead; see fetchCallLogs)
// callType: 'audio' | 'video'
export async function logCallStart({ source, threadId = null, caller, callee = null, callType }) {
  const { data, error } = await supabase
    .from("call_logs")
    .insert({
      source,
      thread_id: threadId,
      call_type: callType,
      caller_type: caller?.type || null,
      caller_id: caller?.id || null,
      caller_name: caller?.name || null,
      callee_type: callee?.type || null,
      callee_id: callee?.id || null,
      callee_name: callee?.name || null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("call log insert failed:", error.message);
    return null;
  }
  return data.id;
}

// outcome: 'answered' | 'missed' | 'declined'
// answeredAt: Date the call actually connected, if it did — used to compute
// duration_seconds; omit/null for a call that never connected.
export async function logCallOutcome(id, { outcome, answeredAt = null }) {
  if (!id) return;
  const endedAt = new Date();
  const durationSeconds = answeredAt ? Math.max(0, Math.round((endedAt - answeredAt) / 1000)) : null;
  const { error } = await supabase
    .from("call_logs")
    .update({ outcome, ended_at: endedAt.toISOString(), duration_seconds: durationSeconds })
    .eq("id", id);
  if (error) console.error("call log update failed:", error.message);
}

// Recent call history for one dealer thread — every "thread" call made
// from that thread's ChatPanel, plus any "direct" call between the two
// people on that thread (dealer/dealer_staff on one side, whichever admin
// staff they called or were called by on the other). Powers the call log
// panel embedded in the Chats page.
export async function fetchCallLogs({ threadId, dealerId, limit = 30 }) {
  const clauses = [];
  if (threadId) clauses.push(`thread_id.eq.${threadId}`);
  if (dealerId) {
    clauses.push(`and(caller_type.eq.dealer,caller_id.eq.${dealerId})`);
    clauses.push(`and(callee_type.eq.dealer,callee_id.eq.${dealerId})`);
  }
  if (!clauses.length) return { rows: [], error: null };

  const { data, error } = await supabase
    .from("call_logs")
    .select("*")
    .or(clauses.join(","))
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error };
  return { rows: data || [], error: null };
}

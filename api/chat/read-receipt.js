// api/chat/read-receipt.js
//
// Vercel Serverless Function. Powers the double-tick / blue-tick UI in
// ChatPanel.jsx: called (a) whenever a chat panel is opened/visible, to
// mark that side as having read the thread up to now, and (b) polled
// periodically while a chat is open, so the OTHER side's tick color
// updates live-ish without needing a Realtime subscription on a new table.
//
// Body: { accessToken, threadId, markRead? }
//   markRead (default true) — pass false for a read-only status check
//   without bumping this caller's own last_read_at (not currently used by
//   the client, but kept as an option rather than always writing).
//
// Response: { staff: isoString|null, dealer: isoString|null, readers: [...] }
//   "dealer" covers both `dealer` and `dealer_staff` callers — same
//   side-collapsing convention chat.js already uses for push targeting and
//   unread counts (a dealer's own sub-staff logins all count as one side).
//   readers is the finer-grained, per-person list this side-level pair
//   collapses: [{ type, id, name, lastReadAt }, ...], one row per
//   individual who has ever opened this thread — lets the UI show exactly
//   who ("Seen by Rahul, 2:14 PM") rather than just which side.
import { supabaseAdmin, resolveCaller } from "../_lib/adminAuth.js";
import { applyCors } from "../_lib/cors.js";

function sideFor(caller) {
  if (caller?.kind === "staff") return "staff";
  if (caller?.kind === "dealer" || caller?.kind === "dealer_staff") return "dealer";
  return null;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight handled

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Server isn't configured with SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const { accessToken, threadId, markRead = true } = req.body || {};
    if (!threadId) return res.status(400).json({ error: "threadId is required" });

    const caller = await resolveCaller(accessToken);
    if (!caller) return res.status(403).json({ error: "Not signed in" });
    const side = sideFor(caller);
    if (!side) return res.status(403).json({ error: "Not allowed to read this thread" });

    // Only a participant of this specific thread can mark/see its read
    // status — a dealer/dealer_staff caller must own the thread; staff can
    // touch any thread (same trust level they have everywhere else, e.g.
    // create-qr.js).
    if (side === "dealer") {
      const { data: thread, error: threadErr } = await supabaseAdmin
        .from("chat_threads")
        .select("id, dealer_id")
        .eq("id", threadId)
        .maybeSingle();
      if (threadErr || !thread) return res.status(404).json({ error: "Thread not found" });
      if (thread.dealer_id !== caller.dealerId) return res.status(403).json({ error: "Not allowed to read this thread" });
    }

    if (markRead) {
      const nowIso = new Date().toISOString();
      const { error: upsertErr } = await supabaseAdmin
        .from("chat_thread_reads")
        .upsert({ thread_id: threadId, side, last_read_at: nowIso }, { onConflict: "thread_id,side" });
      if (upsertErr) return res.status(500).json({ error: upsertErr.message });

      // Per-individual row too — same last_read_at, keyed finer so "Seen by
      // <name>" can name the actual person, not just their side. Non-fatal:
      // a failure here shouldn't break the (already-working) tick feature.
      const { error: identityUpsertErr } = await supabaseAdmin.from("chat_thread_reads_by_identity").upsert(
        { thread_id: threadId, reader_type: caller.kind, reader_id: caller.id, reader_name: caller.name, last_read_at: nowIso },
        { onConflict: "thread_id,reader_type,reader_id" }
      );
      if (identityUpsertErr) console.error("chat_thread_reads_by_identity upsert failed:", identityUpsertErr.message);
    }

    const { data: rows, error: selectErr } = await supabaseAdmin
      .from("chat_thread_reads")
      .select("side, last_read_at")
      .eq("thread_id", threadId);
    if (selectErr) return res.status(500).json({ error: selectErr.message });

    const { data: identityRows, error: identitySelectErr } = await supabaseAdmin
      .from("chat_thread_reads_by_identity")
      .select("reader_type, reader_id, reader_name, last_read_at")
      .eq("thread_id", threadId);
    if (identitySelectErr) console.error("chat_thread_reads_by_identity select failed:", identitySelectErr.message);

    const result = { staff: null, dealer: null };
    for (const row of rows || []) result[row.side] = row.last_read_at;
    result.readers = (identityRows || []).map((r) => ({
      type: r.reader_type,
      id: r.reader_id,
      name: r.reader_name || "Unknown",
      lastReadAt: r.last_read_at,
    }));
    res.json(result);
  } catch (e) {
    console.error("chat read-receipt failed:", e);
    res.status(500).json({ error: e.message || "Unexpected server error" });
  }
}

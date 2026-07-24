// src/components/CommsWindow.jsx
//
// Unified "chat icon" entry point — one floating button that opens a
// WhatsApp-style window with its own bottom nav: Chats (recent
// conversations), Calls (call history), and New Call (a directory to ring
// someone you haven't talked to yet). Replaces the two separate widgets
// that used to do this (ChatWidget for the dealer side, StaffChatWidget
// for staff) with one shared component, scoped by `variant`.
//
// IMPORTANT permission rule, enforced right here in the "New Call" tab:
// a dealer (or their own sub-staff) can ONLY ever see and call admin
// staff — never another dealer, and never another dealer's sub-staff.
// The dealer-variant contact list below is built from a completely
// separate query (`staff` table only) than the staff-variant one, so
// there's no shared code path that could ever leak another dealer into
// it. Admin staff, on the other hand, can call/chat with any dealer or
// dealer_staff — that's the whole point of the support desk.
import React, { useCallback, useEffect, useState } from "react";
import { MessageCircle, MessageSquare, History, UserPlus, Phone, Video, PhoneMissed, PhoneOff, Search, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import ChatPanel from "./ChatPanel";
import Avatar from "./Avatar";
import { listRecentThreadsForStaff, listRecentThreadsForDealer } from "../lib/chat";
import { fetchAllCallLogs, fetchCallLogs } from "../lib/callLog";

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// row.outcome is null while a call is still ringing/in progress — treat
// that (and anything unrecognized) as "missed" for icon purposes.
function callRowMeta(row) {
  if (row.outcome === "answered") {
    return { Icon: row.call_type === "video" ? Video : Phone, color: "text-emerald-600 dark:text-emerald-400", label: "Answered" };
  }
  if (row.outcome === "declined") {
    return { Icon: PhoneOff, color: "text-amber-600 dark:text-amber-400", label: "Declined" };
  }
  return { Icon: PhoneMissed, color: "text-rose-600 dark:text-rose-400", label: "Missed" };
}

function threadLabelFromRow(row) {
  const t = row.chat_threads;
  if (!t) return null;
  const dealerName = t.dealers?.short_name || t.dealers?.name || null;
  const appLabel = t.application_id
    ? `${t.applications?.application_no || t.applications?.draft_code || "—"} — ${t.applications?.applicant_name || "—"}`
    : "General";
  return { dealerId: t.dealer_id, applicationId: t.application_id, dealerName, appLabel };
}

const TABS = [
  { key: "recent", label: "Chats", Icon: MessageSquare },
  { key: "calls", label: "Calls", Icon: History },
  { key: "new", label: "New Call", Icon: UserPlus },
];

export default function CommsWindow({ variant, identity, call, dealerId, dealerName, staff, pendingCount = 0, onExpand }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("recent");
  const [selectedThread, setSelectedThread] = useState(null); // { dealerId, applicationId, label } | null

  const openWindow = () => setOpen(true);
  const closeWindow = () => { setOpen(false); setSelectedThread(null); };

  if (variant === "staff" && !staff) return null;
  if (variant === "dealer" && !dealerId) return null;

  const headerTitle = selectedThread
    ? selectedThread.label
    : tab === "recent" ? "Chats" : tab === "calls" ? "Call history" : "New Call";
  const headerSubtitle = selectedThread ? (variant === "staff" ? selectedThread.dealerName : null) : null;

  return (
    <div
      className="no-print fixed z-50 flex flex-col items-end gap-3"
      style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))", right: "calc(1.25rem + env(safe-area-inset-right))" }}
    >
      {open && (
        <div className="w-80 sm:w-96 h-[540px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-slate-900 text-white px-4 py-3 flex items-center gap-2.5 shrink-0">
            {selectedThread ? (
              <button onClick={() => setSelectedThread(null)} className="text-xs font-semibold text-blue-300 hover:text-blue-200 shrink-0 mr-1">
                ← Back
              </button>
            ) : (
              <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <MessageCircle size={18} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight truncate">{headerTitle}</p>
              {headerSubtitle && <p className="text-xs text-slate-300 leading-tight truncate">{headerSubtitle}</p>}
            </div>
            {onExpand && !selectedThread && (
              <button onClick={onExpand} title="Open full Chats inbox" className="text-xs font-semibold text-blue-300 hover:text-blue-200 shrink-0 mr-1">
                Expand
              </button>
            )}
            <button onClick={closeWindow} title="Close" className="w-7 h-7 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 flex flex-col">
            {selectedThread ? (
              <ChatPanel
                dealerId={selectedThread.dealerId}
                applicationId={selectedThread.applicationId}
                identity={identity}
                emptyLabel="No messages here yet."
              />
            ) : tab === "recent" ? (
              <RecentTab variant={variant} dealerId={dealerId} onOpenThread={setSelectedThread} />
            ) : tab === "calls" ? (
              <CallsTab variant={variant} dealerId={dealerId} identity={identity} call={call} onOpenThread={setSelectedThread} />
            ) : (
              <NewCallTab variant={variant} identity={identity} call={call} />
            )}
          </div>

          {/* Bottom nav — hidden while a thread is open, same as a phone's
              tab bar disappearing inside a conversation. */}
          {!selectedThread && (
            <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 flex">
              {TABS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[11px] font-medium ${
                    tab === key ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => (open ? closeWindow() : openWindow())}
        aria-label={open ? "Close chat" : "Open chat"}
        className="relative w-14 h-14 rounded-full bg-slate-900 text-white shadow-lg flex items-center justify-center hover:bg-slate-800 transition-colors"
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {!open && pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center">
            {pendingCount}
          </span>
        )}
      </button>
    </div>
  );
}

// ============================================================
// Recent tab — every conversation, most-recently-active first.
// ============================================================
function RecentTab({ variant, dealerId, onOpenThread }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = variant === "staff" ? await listRecentThreadsForStaff(30) : await listRecentThreadsForDealer(dealerId, 30);
      setThreads(rows);
    } catch (e) {
      setError(e.message || "Couldn't load chats");
    } finally {
      setLoading(false);
    }
  }, [variant, dealerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">Loading…</p>;
  if (error) return <p className="text-sm text-rose-500 text-center py-8 px-4">{error}</p>;
  if (threads.length === 0) return <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 px-4">No conversations yet.</p>;

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
      {threads.map((t) => (
        <button
          key={t.threadId}
          onClick={() => onOpenThread({ dealerId: variant === "staff" ? t.dealerId : dealerId, applicationId: t.applicationId, label: t.label, dealerName: t.dealerLabel })}
          className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center gap-2.5"
        >
          <Avatar name={variant === "staff" ? t.dealerLabel : t.label} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">
                {variant === "staff" ? t.dealerLabel : t.label}
              </span>
              {t.lastAt && <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 ml-2">{timeAgo(t.lastAt)}</span>}
            </div>
            {variant === "staff" && <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{t.label}</p>}
            <div className="flex items-center gap-1.5">
              {t.awaitingReply && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />}
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{t.lastMessage || "No messages yet"}</p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Calls tab — call history, most recent first. Tapping a direct call's
// icon calls that same person back; tapping a thread call jumps into that
// conversation instead (there's no single "person" to call back for one
// of those — see lib/call.js).
// ============================================================
function CallsTab({ variant, dealerId, identity, call, onOpenThread }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { rows: fetched } = variant === "staff" ? await fetchAllCallLogs({ limit: 30 }) : await fetchCallLogs({ dealerId, limit: 30 });
    setRows(fetched);
    setLoading(false);
  }, [variant, dealerId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`comms-calls:${variant}:${dealerId || "staff"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_logs" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, variant, dealerId]);

  if (loading) return <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 px-4">No calls yet.</p>;

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((r) => {
        const { Icon, color, label } = callRowMeta(r);
        const iAmCaller = identity && r.caller_type === identity.type && r.caller_id === identity.id;
        const counterpart = r.source === "direct"
          ? (iAmCaller ? { type: r.callee_type, id: r.callee_id, name: r.callee_name } : { type: r.caller_type, id: r.caller_id, name: r.caller_name })
          : null;
        const who = r.caller_name || r.callee_name || "Unknown";
        const threadInfo = r.source === "thread" ? threadLabelFromRow(r) : null;

        return (
          <div key={r.id} className="w-full px-4 py-3 flex items-center gap-2.5">
            <Avatar name={who} size={34} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">{who}</p>
              <div className="flex items-center gap-1.5">
                <Icon size={13} className={color} />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {label}{r.duration_seconds ? ` · ${formatDuration(r.duration_seconds)}` : ""}
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">· {timeAgo(r.started_at)}</span>
              </div>
            </div>
            {counterpart?.id ? (
              <button
                onClick={() => call?.startCall(counterpart, "audio")}
                disabled={!call || call.status !== "idle"}
                title={`Call ${who} back`}
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-30"
              >
                <Phone size={14} />
              </button>
            ) : threadInfo ? (
              <button
                onClick={() => onOpenThread({ dealerId: variant === "staff" ? threadInfo.dealerId : dealerId, applicationId: threadInfo.applicationId, label: threadInfo.appLabel, dealerName: threadInfo.dealerName })}
                title="Open this chat"
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              >
                <MessageSquare size={14} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// New Call tab — a directory to ring someone directly (lib/directCall.js),
// not tied to any existing chat thread. Two totally separate branches by
// design (see the file-level comment): a dealer/dealer_staff can ONLY ever
// list and call admin staff here.
// ============================================================
function NewCallTab({ variant, identity, call }) {
  return variant === "staff" ? <StaffNewCallList call={call} /> : <DealerNewCallList call={call} />;
}

// Staff can call any dealer, or any of that dealer's active sub-staff.
function StaffNewCallList({ call }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: dealers }, { data: dealerStaff }] = await Promise.all([
        supabase.from("dealers").select("id, name, short_name").order("name"),
        supabase.from("dealer_staff").select("id, full_name, dealer_id, active, dealers(short_name, name)").eq("active", true).order("full_name"),
      ]);
      const combined = [
        ...(dealers || []).map((d) => ({ type: "dealer", id: d.id, name: d.short_name || d.name, sub: "Dealer" })),
        ...(dealerStaff || []).map((s) => ({ type: "dealer_staff", id: s.id, name: s.full_name, sub: s.dealers?.short_name || s.dealers?.name || "Dealer staff" })),
      ].sort((a, b) => a.name.localeCompare(b.name));
      setContacts(combined);
      setLoading(false);
    })();
  }, []);

  const filtered = contacts.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.sub.toLowerCase().includes(query.toLowerCase()));

  return <ContactList contacts={filtered} loading={loading} query={query} setQuery={setQuery} call={call} />;
}

// A dealer (or their sub-staff) can ONLY see and call admin staff — this
// query never touches the dealers/dealer_staff tables at all, so there is
// no way for a dealer to end up looking at, or ringing, another dealer.
function DealerNewCallList({ call }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("staff").select("id, full_name, role").order("full_name");
      setContacts((data || []).map((s) => ({ type: "staff", id: s.id, name: s.full_name, sub: s.role || "Our team" })));
      setLoading(false);
    })();
  }, []);

  const filtered = contacts.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return <ContactList contacts={filtered} loading={loading} query={query} setQuery={setQuery} call={call} emptyLabel="No team members found." />;
}

function ContactList({ contacts, loading, query, setQuery, call, emptyLabel = "No contacts found." }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-2.5 py-1.5">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="bg-transparent text-sm outline-none flex-1 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">Loading…</p>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 px-4">{emptyLabel}</p>
        ) : (
          contacts.map((c) => (
            <div key={`${c.type}-${c.id}`} className="px-4 py-2.5 flex items-center gap-2.5">
              <Avatar name={c.name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{c.name}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{c.sub}</p>
              </div>
              <button
                onClick={() => call?.startCall(c, "audio")}
                disabled={!call || call.status !== "idle"}
                title={`Call ${c.name}`}
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-30"
              >
                <Phone size={14} />
              </button>
              <button
                onClick={() => call?.startCall(c, "video")}
                disabled={!call || call.status !== "idle"}
                title={`Video call ${c.name}`}
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-30"
              >
                <Video size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Send, Image as ImageIcon, Smile, ThumbsUp } from "lucide-react";
import { getOrCreateThread, listMessages, sendMessage, subscribeToThread, uploadChatAttachment } from "../lib/chat";

const SENDER_BUBBLE = {
  staff: "bg-slate-800 text-white",
  dealer: "bg-blue-600 text-white",
  dealer_staff: "bg-blue-600 text-white",
};

const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "🙏", "✅"];

// Renders the message list + composer for one thread (general dealer thread,
// or one scoped to a single application). Owns thread resolution, initial
// load, and the realtime subscription; the caller just tells it who's
// talking to whom.
export default function ChatPanel({ dealerId, applicationId = null, identity, emptyLabel, onMessage }) {
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    (async () => {
      if (!dealerId) return;
      setLoading(true);
      setError("");
      try {
        const thread = await getOrCreateThread({ dealerId, applicationId });
        if (cancelled) return;
        setThreadId(thread.id);
        const existing = await listMessages(thread.id);
        if (cancelled) return;
        setMessages(existing);
        unsubscribe = subscribeToThread(thread.id, (msg) => {
          setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]));
          onMessage?.(msg);
        });
        if (cancelled) unsubscribe(); // effect was torn down mid-flight — don't leak the subscription
      } catch (e) {
        if (!cancelled) setError(e.message || "Couldn't load chat");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [dealerId, applicationId]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  const send = async (body) => {
    const text = (body ?? draft).trim();
    if (!text || !threadId || !identity) return;
    setDraft("");
    setShowEmoji(false);
    try {
      await sendMessage({ threadId, sender: { ...identity, body: text } });
      // No optimistic push needed — the realtime subscription (including our
      // own insert) will bring it back in, keeping a single source of truth.
    } catch (e) {
      setError(e.message || "Couldn't send message");
    }
  };

  const sendImage = async (file) => {
    if (!file || !threadId || !identity) return;
    setUploading(true);
    setError("");
    try {
      const url = await uploadChatAttachment(threadId, file);
      await sendMessage({ threadId, sender: { ...identity, attachmentUrl: url } });
    } catch (e) {
      setError(e.message || "Couldn't send image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">{emptyLabel || "No messages yet — say hello."}</p>
        ) : (
          messages.map((m) => {
            const mine = identity && m.sender_type === identity.type && m.sender_id === identity.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    mine ? SENDER_BUBBLE[m.sender_type] + " rounded-br-sm" : "bg-white text-slate-700 border border-slate-200 rounded-bl-sm"
                  }`}
                >
                  {!mine && <p className="text-[11px] font-semibold opacity-60 mb-0.5">{m.sender_name}</p>}
                  {m.attachment_url && (
                    <a href={m.attachment_url} target="_blank" rel="noreferrer" className="block mb-1">
                      <img src={m.attachment_url} alt="attachment" className="rounded-lg max-w-full max-h-48 object-cover" />
                    </a>
                  )}
                  {m.body && <p>{m.body}</p>}
                </div>
              </div>
            );
          })
        )}
        {uploading && <p className="text-xs text-slate-400 text-right pr-1">Sending image…</p>}
      </div>

      {error && <p className="text-rose-500 text-xs px-3 py-1">{error}</p>}

      {showEmoji && (
        <div className="flex gap-1.5 px-3 pb-1">
          {QUICK_EMOJI.map((e) => (
            <button key={e} onClick={() => send(e)} className="text-lg hover:scale-110 transition-transform">
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-slate-200 p-2 flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => setShowEmoji((s) => !s)}
          disabled={!identity}
          title="Quick reactions"
          className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-blue-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <Smile size={19} />
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => sendImage(e.target.files?.[0])} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!identity || uploading}
          title="Send an image"
          className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-blue-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <ImageIcon size={19} />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type your message…"
          disabled={!identity}
          className="flex-1 text-sm rounded-full border border-slate-300 px-3.5 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-100"
        />
        <button
          onClick={() => (draft.trim() ? send() : send("👍"))}
          disabled={!identity}
          className="w-9 h-9 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-50"
          aria-label={draft.trim() ? "Send" : "Send thumbs up"}
        >
          {draft.trim() ? <Send size={15} /> : <ThumbsUp size={16} />}
        </button>
      </div>
    </div>
  );
}

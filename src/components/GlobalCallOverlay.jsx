// src/components/GlobalCallOverlay.jsx
//
// Renders the incoming-call banner and in-call screen for a useDirectCall()
// instance, fixed to the viewport so it shows up no matter which tab/page
// is open — mounted once, near the top of App.jsx, alongside the
// useDirectCall() hook itself. Visually mirrors the per-thread call UI in
// ChatPanel.jsx, just promoted to `position: fixed` instead of living inside
// one panel.
import React from "react";
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from "lucide-react";

export default function GlobalCallOverlay({ call }) {
  if (!call) return null;

  return (
    <>
      {call.status === "ringing-incoming" && (
        <div className="fixed inset-x-0 top-0 z-[999] bg-slate-900 text-white px-4 py-3 flex items-center justify-between shadow-lg">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{call.remoteName}</p>
            <p className="text-xs text-slate-300">Incoming {call.callType} call…</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={call.declineCall} className="w-9 h-9 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center">
              <PhoneOff size={16} />
            </button>
            <button onClick={call.acceptCall} className="w-9 h-9 rounded-full bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center">
              <Phone size={16} />
            </button>
          </div>
        </div>
      )}

      {(call.status === "ringing-outgoing" || call.status === "connecting" || call.status === "in-call") && (
        <div className="fixed inset-0 z-[999] bg-slate-900 text-white flex flex-col">
          <div className="flex-1 relative flex items-center justify-center">
            {call.callType === "video" ? (
              <>
                <div ref={call.remoteVideoElRef} className="absolute inset-0 bg-slate-800" />
                {!call.hasRemoteVideo && (
                  <p className="text-sm text-slate-300 z-10">
                    {call.status === "in-call" ? "Waiting for their video…" : `Calling ${call.remoteName}…`}
                  </p>
                )}
                <div ref={call.localVideoElRef} className="absolute bottom-3 right-3 w-28 h-36 rounded-lg overflow-hidden bg-slate-700 border border-slate-600" />
              </>
            ) : (
              <div className="text-center">
                <div className="w-20 h-20 mx-auto rounded-full bg-white/10 flex items-center justify-center mb-4 text-2xl font-semibold">
                  {(call.remoteName || "?").split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                </div>
                <p className="text-base font-semibold mb-1">{call.remoteName}</p>
                <p className="text-sm text-slate-300">
                  {call.status === "ringing-outgoing" ? "Calling…" : call.status === "connecting" ? "Connecting…" : "On call"}
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-3 pb-8 pt-2 shrink-0">
            {call.status === "in-call" && (
              <button
                onClick={call.toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center ${call.muted ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`}
              >
                {call.muted ? <MicOff size={19} /> : <Mic size={19} />}
              </button>
            )}
            {call.status === "in-call" && call.callType === "video" && (
              <button
                onClick={call.toggleCamera}
                className={`w-12 h-12 rounded-full flex items-center justify-center ${call.cameraOff ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`}
              >
                {call.cameraOff ? <VideoOff size={19} /> : <Video size={19} />}
              </button>
            )}
            <button onClick={call.endCall} className="w-12 h-12 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center">
              <PhoneOff size={19} />
            </button>
          </div>
        </div>
      )}

      {call.callError && call.status === "idle" && (
        <div className="fixed inset-x-0 top-0 z-[999] bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2 flex items-center justify-between shadow">
          <span>{call.callError}</span>
          <button onClick={call.dismissError} className="font-semibold px-2">✕</button>
        </div>
      )}
    </>
  );
}

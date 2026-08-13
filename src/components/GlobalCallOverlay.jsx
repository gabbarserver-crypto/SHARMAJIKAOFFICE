// src/components/GlobalCallOverlay.jsx
//
// Renders the incoming-call banner and in-call screen for a useDirectCall()
// instance, fixed to the viewport so it shows up no matter which tab/page
// is open — mounted once, near the top of App.jsx, alongside the
// useDirectCall() hook itself. Visually mirrors the per-thread call UI in
// ChatPanel.jsx, just promoted to `position: fixed` instead of living inside
// one panel.
import React from "react";
import { Capacitor } from "@capacitor/core";
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, Volume1 } from "lucide-react";
import CallTimer from "./CallTimer";

// Full-screen ringing UI — used on the native Android app, where there's no
// "corner" of a desktop window to pop a small card into and the phone's own
// full-screen incoming-call feel is what people expect.
function IncomingCallFullScreen({ call }) {
  return (
    <div className="fixed inset-0 z-[999] bg-slate-900 text-white flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-28 h-28 rounded-full bg-white/10 flex items-center justify-center mb-6 text-4xl font-semibold">
          {(call.remoteName || "?").split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
        </div>
        <p className="text-2xl font-semibold mb-2 text-center">{call.remoteName}</p>
        <p className="text-base text-slate-300">Incoming {call.callType} call…</p>
      </div>
      {/* Buttons sized to WhatsApp/Android's own call-UI scale (~80px
          circles, well past the 48dp minimum touch target) — the
          previous top-banner version used 36px buttons crammed into a
          thin strip, which was genuinely hard to hit reliably. */}
      <div className="flex items-center justify-around px-10 pb-12 pt-4 shrink-0">
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={call.declineCall}
            className="w-20 h-20 rounded-full bg-rose-600 active:bg-rose-700 flex items-center justify-center shadow-lg"
          >
            <PhoneOff size={32} />
          </button>
          <span className="text-sm text-slate-300">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={call.acceptCall}
            className="w-20 h-20 rounded-full bg-emerald-600 active:bg-emerald-700 flex items-center justify-center shadow-lg animate-pulse"
          >
            <Phone size={32} />
          </button>
          <span className="text-sm text-slate-300">Accept</span>
        </div>
      </div>
    </div>
  );
}

// Small bottom-right card — used on web, so an incoming call no longer takes
// over the whole browser window (you were still meant to be able to see/use
// the app underneath, the way WhatsApp Web's incoming-call toast works).
function IncomingCallCorner({ call }) {
  return (
    <div
      className="fixed z-[999] w-80 max-w-[calc(100vw-2rem)] bg-slate-900 text-white rounded-xl shadow-2xl border border-white/10 overflow-hidden animate-in slide-in-from-bottom-4 fade-in"
      style={{ right: "1rem", bottom: "1rem" }}
    >
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="w-12 h-12 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-lg font-semibold">
          {(call.remoteName || "?").split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate">{call.remoteName}</p>
          <p className="text-xs text-slate-300">Incoming {call.callType} call…</p>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 pb-4">
        <button
          onClick={call.declineCall}
          className="flex-1 h-10 rounded-lg bg-rose-600 hover:bg-rose-700 flex items-center justify-center gap-1.5 text-sm font-medium"
        >
          <PhoneOff size={16} /> Decline
        </button>
        <button
          onClick={call.acceptCall}
          className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center gap-1.5 text-sm font-medium animate-pulse"
        >
          <Phone size={16} /> Accept
        </button>
      </div>
    </div>
  );
}

export default function GlobalCallOverlay({ call }) {
  if (!call) return null;
  const isNative = Capacitor.isNativePlatform();

  return (
    <>
      {call.status === "ringing-incoming" &&
        (isNative ? <IncomingCallFullScreen call={call} /> : <IncomingCallCorner call={call} />)}

      {(call.status === "ringing-outgoing" || call.status === "connecting" || call.status === "in-call") && (
        <div className="fixed inset-0 z-[999] bg-slate-900 text-white flex flex-col">
          <div className="flex-1 relative flex items-center justify-center">
            {call.callType === "video" ? (
              <>
                <div ref={call.remoteVideoElRef} className="absolute inset-0 bg-slate-800" />
                {call.endedReason ? (
                  <p className="flex items-center gap-1.5 text-sm font-medium text-rose-400 z-10">
                    <PhoneOff size={14} /> {call.endedReason}
                  </p>
                ) : !call.hasRemoteVideo && (
                  <p className="text-sm text-slate-300 z-10">
                    {call.status === "in-call" ? "Waiting for their video…" : `Calling ${call.remoteName}…`}
                  </p>
                )}
                {call.status === "in-call" && (
                  <CallTimer answeredAt={call.answeredAt} className="absolute top-3 left-3 z-10 text-xs font-semibold bg-black/40 text-white px-2 py-1 rounded-full" />
                )}
                <div ref={call.localVideoElRef} className="absolute bottom-3 right-3 w-28 h-36 rounded-lg overflow-hidden bg-slate-700 border border-slate-600" />
              </>
            ) : (
              <div className="text-center">
                <div className="w-20 h-20 mx-auto rounded-full bg-white/10 flex items-center justify-center mb-4 text-2xl font-semibold">
                  {(call.remoteName || "?").split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                </div>
                <p className="text-base font-semibold mb-1">{call.remoteName}</p>
                {call.endedReason ? (
                  <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-rose-400">
                    <PhoneOff size={14} /> {call.endedReason}
                  </p>
                ) : (
                  <p className="text-sm text-slate-300">
                    {call.status === "ringing-outgoing" ? "Calling…" : call.status === "connecting" ? "Connecting…" : "On call"}
                    {call.status === "in-call" && <CallTimer answeredAt={call.answeredAt} className="ml-1.5" />}
                  </p>
                )}
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
            {call.status === "in-call" && (
              <button
                onClick={call.toggleSpeaker}
                title="Handsfree / Speaker"
                className={`w-12 h-12 rounded-full flex items-center justify-center ${call.speakerOn ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`}
              >
                {call.speakerOn ? <Volume2 size={19} /> : <Volume1 size={19} />}
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
        <div
          className="fixed inset-x-0 top-0 z-[999] bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2 flex items-center justify-between shadow"
          style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
        >
          <span>
            {call.callError.friendly}
            {call.callError.raw && <span className="block text-[10px] text-amber-600/70 mt-0.5">Details: {call.callError.raw}</span>}
          </span>
          <button onClick={call.dismissError} className="font-semibold px-2 shrink-0">✕</button>
        </div>
      )}
    </>
  );
}

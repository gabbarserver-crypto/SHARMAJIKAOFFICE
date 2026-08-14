// src/components/NotificationSettings.jsx
//
// The "Notifications" tab on the Settings page. Controls are backed by
// lib/notificationSound.js (persisted in localStorage per device/browser)
// and read directly by lib/notify.js's playPing()/startRingtone() — so
// changes here take effect immediately for new chats, drafts, and
// incoming calls, no save button needed.
import React from "react";
import { Card } from "./UI";
import { useNotificationSound, NOTIFICATION_TONES } from "../lib/notificationSound";
import { previewTone } from "../lib/notify";

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </label>
  );
}

export default function NotificationSettings() {
  const { enabled, tone, setEnabled, setTone } = useNotificationSound();

  return (
    <div className="max-w-xl">
      <p className="text-sm text-slate-400 dark:text-slate-500 mb-5">
        Choose whether new chats, drafts, and incoming calls play a sound, and which ring tone is used.
      </p>

      <Card className="mb-5">
        <Toggle checked={enabled} onChange={setEnabled} label="Notification sound" />
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
          {enabled ? "Sounds will play for new activity and incoming calls." : "Muted — you'll still see in-app and on-screen alerts, just without sound."}
        </p>
      </Card>

      <Card title="Notification ring">
        <div className="space-y-2">
          {Object.entries(NOTIFICATION_TONES).map(([key, def]) => (
            <div
              key={key}
              onClick={() => setTone(key)}
              className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                tone === key
                  ? "border-blue-600 bg-blue-50 dark:bg-blue-950/30"
                  : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-4 h-4 rounded-full border-2 shrink-0 ${
                    tone === key ? "border-blue-600 bg-blue-600" : "border-slate-300 dark:border-slate-600"
                  }`}
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{def.label}</span>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); previewTone(def); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-colors"
              >
                ▶ Preview
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

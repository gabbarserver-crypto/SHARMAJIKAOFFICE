SJO ERP — Handsfree (Speaker) toggle for calls
================================================

Where each file goes:

  src/lib/speakerMode.js              → src/lib/speakerMode.js  (new file)
  src/lib/call.js                     → src/lib/call.js
  src/lib/directCall.js               → src/lib/directCall.js
  src/components/GlobalCallOverlay.jsx → src/components/GlobalCallOverlay.jsx
  src/components/ChatPanel.jsx        → src/components/ChatPanel.jsx
  android_native/SpeakerModePlugin.java → android/app/src/main/java/com/sharmajikaoffice/erp/SpeakerModePlugin.java (new file)
  android_native/MainActivity.java    → android/app/src/main/java/com/sharmajikaoffice/erp/MainActivity.java

Why a native plugin was needed:
Calls run on Agora's Web SDK inside the Android WebView. That SDK has no
"speakerphone" concept — routing audio to the loudspeaker vs. the earpiece
is an Android AudioManager setting, not something a web page can control.
SpeakerModePlugin.java is a small bridge for just that one setting.

What you get:
- A new Handsfree/Speaker button next to Mute, once a call connects
  (both the full-screen call UI and the in-chat-panel call UI).
- Defaults: video calls start on speaker (phone usually propped up/held
  away from the ear), audio calls start on earpiece (held to the ear like
  a normal call) — tap the button any time to switch.
- Audio routing resets back to normal once the call ends.

After copying files:
  npm install     (no new npm packages needed — this is a local native plugin)
  npx cap sync android
Then in Android Studio: Clean Project → Rebuild → reinstall the APK.

Note: MainActivity.java here already includes your existing mic/camera
permission fix — just adds the one registerPlugin(SpeakerModePlugin.class)
line before super.onCreate(). If your actual MainActivity.java has since
changed further, just add that one line + the import yourself instead of
overwriting the whole file.

# Fix: calls fail with "Cannot read properties of undefined (reading 'replace')" even though Microphone permission is allowed

## Root cause
This is an Android **WebView** quirk, not a bug in the call code itself
(`lib/directCall.js` / `lib/call.js` / `callErrors.js` were already doing
the right thing — that friendly message is the app correctly catching an
error, not causing one).

The app runs inside a Capacitor WebView. Android Settings →
Apps → SJO ERP → Permissions → Microphone: **Allowed** only means the
app's *process* is allowed to touch the mic. The WebView still separately
asks the app "should this specific web page be allowed to use the
mic/camera right now?" via `WebChromeClient.onPermissionRequest()` — and a
stock, unmodified Capacitor `MainActivity` never answers that question, so
the WebView silently refuses `getUserMedia()`. The Agora SDK then fails
deep inside itself trying to build the local track from nothing, and that
surfaces as the raw `TypeError: Cannot read properties of undefined
(reading 'replace')` instead of a clean permission error.

So: the Android Settings toggle and the in-app "permission allowed"
message are both true and both irrelevant — the missing piece is a few
lines of native code that were never added, because this project doesn't
have an `android/` folder checked in yet (per `ANDROID_SETUP.md`, you
generate it locally with `npm run android:add`).

## The fix — 2 steps, after you run `npm run android:add`

**1. Drop in the patched `MainActivity.java`**

Copy `MainActivity.java` from this folder to:
```
android/app/src/main/java/com/sharmajikaoffice/erp/MainActivity.java
```
(overwriting the default Capacitor-generated one). It:
- Requests the real Android `RECORD_AUDIO` / `CAMERA` runtime permissions on launch.
- Answers the WebView's own `onPermissionRequest()` for `getUserMedia()`, granting only the mic/camera resources the app actually holds the matching Android permission for.

**2. Add the permissions to `AndroidManifest.xml`**

Open `android/app/src/main/AndroidManifest.xml` and, inside the
`<manifest>` tag (as a sibling of the existing `<uses-permission>` /
`<application>` tags), add:
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

<!-- required="false" so the app still installs on devices without a
     camera — voice calls should still work there. -->
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.microphone" android:required="false" />
```

**3. Rebuild**
```
npm run android:build
npm run android:open
```
Then Build → Generate Signed Bundle / APK as usual.

## After this
On first launch after installing the new build, Android will show the
normal system permission dialogs for Microphone/Camera (this is the
`ActivityCompat.requestPermissions` call in step 1) — accept those once.
If it was previously denied and "Don't ask again" was ticked, you'll need
to grant it manually once via Settings → Apps → SJO ERP → Permissions
(same as before), and the WebView-level grant in step 1 will then start
working on top of that.

If the person is on an OLD build (before this fix) and denies the system
dialog, or already has it denied with "don't ask again", they'll keep
seeing the same "Couldn't connect the call…" message until they update to
a build that includes this fix and grant the permission on first launch.

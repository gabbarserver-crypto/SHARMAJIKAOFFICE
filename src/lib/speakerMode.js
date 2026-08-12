// src/lib/speakerMode.js
//
// Thin wrapper around the custom native "SpeakerMode" plugin (see
// android/.../SpeakerModePlugin.java) that toggles loudspeaker vs. earpiece
// during a call. No-ops on web/desktop, where there's no such distinction —
// calls there just play out of whatever output device the browser/OS picked.
import { Capacitor, registerPlugin } from "@capacitor/core";

const SpeakerMode = Capacitor.isNativePlatform() ? registerPlugin("SpeakerMode") : null;

export async function setSpeakerphone(enabled) {
  if (!SpeakerMode) return;
  try {
    await SpeakerMode.setEnabled({ enabled });
  } catch {
    // Non-fatal — worst case the call just stays on whatever routing
    // Android already picked.
  }
}

export async function resetSpeakerphone() {
  if (!SpeakerMode) return;
  try {
    await SpeakerMode.reset();
  } catch {
    // ignore
  }
}

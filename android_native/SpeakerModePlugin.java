package com.sharmajikaoffice.erp;

import android.content.Context;
import android.media.AudioManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Lets JS toggle loudspeaker vs earpiece during a call. Agora's Web SDK
// (running inside the WebView, not the native Agora SDK) has no concept of
// this — routing audio to the earpiece vs. the loudspeaker is an Android
// AudioManager setting, not something WebRTC/getUserMedia exposes to a
// page. This plugin is the bridge for that one setting.
@CapacitorPlugin(name = "SpeakerMode")
public class SpeakerModePlugin extends Plugin {

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) {
            call.reject("AudioManager unavailable");
            return;
        }
        // MODE_IN_COMMUNICATION is what actually makes setSpeakerphoneOn
        // take effect during a VoIP-style call (rather than a plain media
        // playback stream) — without this, toggling speakerphone on/off
        // often has no audible effect.
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        am.setSpeakerphoneOn(enabled);

        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSObject ret = new JSObject();
        ret.put("enabled", am != null && am.isSpeakerphoneOn());
        call.resolve(ret);
    }

    // Called once the call fully ends, to hand audio routing back to
    // Android's normal (non-call) behavior instead of leaving the device
    // stuck in communication mode.
    @PluginMethod
    public void reset(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            am.setSpeakerphoneOn(false);
            am.setMode(AudioManager.MODE_NORMAL);
        }
        call.resolve();
    }
}

package com.oneinfinity.erp;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

  private static final int MIC_CAMERA_REQUEST_CODE = 1001;

  // Set on the launch Intent by CallMessagingService's full-screen intent
  // so we know to draw over the lock screen. Never set for a normal app
  // launch, so normal opens are unaffected.
  public static final String EXTRA_INCOMING_CALL = "incoming_call";

  // Held onto so we can finish resolving the WebView's PermissionRequest
  // once the (async) native permission dialog actually returns a result —
  // see onRequestPermissionsResult below.
  private PermissionRequest pendingWebPermissionRequest;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(SpeakerModePlugin.class);
    super.onCreate(savedInstanceState);
    maybeShowOverLockscreen(getIntent());

    // Capacitor only turns on WebView debugging (chrome://inspect) when
    // BuildConfig.DEBUG is true, i.e. only for debug builds — a release
    // APK's WebView is otherwise completely uninspectable, with no error
    // or indication why, just an empty device tab list. Forcing this on
    // unconditionally means chrome://inspect always works for diagnosing
    // field issues, on any build type. Harmless in production: it only
    // allows inspection from a device already trusted via USB debugging
    // authorization, same as any other Android app.
    WebView.setWebContentsDebuggingEnabled(true);

    // Only prompt if not already granted — otherwise this pops the OS
    // permission dialog on every single app launch, even for a user who
    // already tapped "Allow" last time.
    String[] perms = { Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA };
    boolean needsRequest = false;
    for (String p : perms) {
      if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
        needsRequest = true;
        break;
      }
    }
    if (needsRequest) {
      ActivityCompat.requestPermissions(this, perms, MIC_CAMERA_REQUEST_CODE);
    }

    this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(() -> resolveWebPermissionRequest(request));
      }
    });
  }

  // Grants the WebView's getUserMedia request ONLY for resources whose
  // underlying native Android permission is actually held right now.
  // Blindly granting everything the WebView asks for (the previous
  // behavior) tells the page "you have mic/camera access" even when the OS
  // permission is still pending or was denied — the WebView then fails to
  // actually open the device, and because it never reported that failure
  // as a normal getUserMedia error, the Agora SDK gets back an unusable
  // (undefined) device object and throws an opaque internal TypeError
  // ("Cannot read properties of undefined (reading 'replace')") instead of
  // a real permission error.
  private void resolveWebPermissionRequest(PermissionRequest request) {
    List<String> grantable = new ArrayList<>();
    boolean micRequested = false;
    boolean micGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    boolean camGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;

    for (String resource : request.getResources()) {
      if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
        micRequested = true;
        if (micGranted) grantable.add(resource);
      } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
        if (camGranted) grantable.add(resource);
      }
    }

    if (!grantable.isEmpty()) {
      request.grant(grantable.toArray(new String[0]));
    }
    // Nothing grantable yet (native permission still pending/denied): if
    // mic access is what's missing, kick off (or re-trigger) the native
    // permission dialog and hold onto the request so we can resolve it
    // for real once onRequestPermissionsResult fires below, instead of
    // just calling request.deny() and leaving the user stuck.
    if (grantable.isEmpty() && micRequested && !micGranted) {
      pendingWebPermissionRequest = request;
      ActivityCompat.requestPermissions(
          this,
          new String[]{ Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA },
          MIC_CAMERA_REQUEST_CODE
      );
    } else if (grantable.isEmpty()) {
      request.deny();
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != MIC_CAMERA_REQUEST_CODE || pendingWebPermissionRequest == null) return;

    // Now that we have a real answer from the user, resolve the WebView
    // request we deferred above against the actual outcome.
    PermissionRequest request = pendingWebPermissionRequest;
    pendingWebPermissionRequest = null;
    resolveWebPermissionRequest(request);
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    // MainActivity is launchMode="singleTask", so a tap on the full-screen
    // call notification while the app is already running arrives here
    // instead of onCreate.
    maybeShowOverLockscreen(intent);
  }

  // Draws the activity over the lock screen and turns the screen on, but
  // ONLY when launched from CallMessagingService's incoming-call
  // full-screen intent — never for a normal app open.
  private void maybeShowOverLockscreen(Intent intent) {
    if (intent == null || !intent.getBooleanExtra(EXTRA_INCOMING_CALL, false)) return;

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    } else {
      getWindow().addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
              | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
              | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
    if (km != null) {
      km.requestDismissKeyguard(this, null);
    }
  }
}

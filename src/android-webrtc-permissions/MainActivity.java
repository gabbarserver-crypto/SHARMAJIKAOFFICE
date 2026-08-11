package com.sharmajikaoffice.erp;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

// Why this file exists
// ---------------------
// The in-app calling feature (lib/directCall.js / lib/call.js, via
// agora-rtc-sdk-ng) calls the browser's getUserMedia() API to grab the mic
// (and camera, for video calls). That works fine on a normal desktop/mobile
// browser tab. Inside a Capacitor app it runs inside an Android WebView
// instead, and a *plain* WebView never grants getUserMedia — no matter what
// you've allowed in Android Settings → Apps → SJO ERP → Permissions. That
// system-level "Microphone: Allowed" toggle only means the app's PROCESS is
// allowed to touch the mic; the WebView still separately asks the app
// "is this specific web permission request OK?" via
// WebChromeClient.onPermissionRequest(), and if nothing answers that
// (which is the stock Capacitor default), the WebView silently refuses.
// Deep inside the Agora SDK that refusal doesn't come back as a clean
// "permission denied" — it surfaces as the raw internal TypeError you saw
// ("Cannot read properties of undefined (reading 'replace')"), which
// lib/callErrors.js then displays as "Couldn't connect the call...".
//
// This file makes MainActivity answer that WebView-level permission
// request (granting it once the real Android runtime permission is held),
// AND requests the real Android runtime permission on launch so there's
// something to grant. Both parts are needed — either alone isn't enough.
public class MainActivity extends BridgeActivity {
  private static final int MEDIA_PERMISSION_REQUEST_CODE = 6001;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // 1) Ask for the real Android runtime permissions up front, same as
    // any native app would. Needed so there's something for step 2 to
    // grant — a WebView can't get mic/camera access the app process
    // itself was never given.
    ActivityCompat.requestPermissions(
      this,
      new String[] { Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA },
      MEDIA_PERMISSION_REQUEST_CODE
    );

    // 2) Answer the WebView's OWN permission prompt for getUserMedia().
    // Subclassing BridgeWebChromeClient (rather than a plain
    // WebChromeClient) keeps every other Capacitor WebView behavior
    // (file uploads via <input type=file>, JS alerts/confirms, etc.)
    // working exactly as before — this only adds the one missing
    // callback.
    getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(() -> {
          boolean hasMic = ActivityCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
          boolean hasCamera = ActivityCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED;

          if (hasMic || hasCamera) {
            // Grant only the resources we actually hold the matching
            // Android runtime permission for — never blanket-grant
            // everything the page asked for.
            java.util.List<String> toGrant = new java.util.ArrayList<>();
            for (String resource : request.getResources()) {
              if (resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && hasMic) toGrant.add(resource);
              if (resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && hasCamera) toGrant.add(resource);
            }
            if (!toGrant.isEmpty()) {
              request.grant(toGrant.toArray(new String[0]));
              return;
            }
          }
          request.deny();
        });
      }
    });
  }
}

package com.sharmajikaoffice.erp;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

// Why this file exists
// ---------------------
// The in-app calling feature (lib/directCall.js / lib/call.js, via
// agora-rtc-sdk-ng) calls the browser's getUserMedia() API to grab the mic
// (and camera, for video calls). A plain Android WebView never grants
// getUserMedia on its own — no matter what's allowed in Android Settings
// → Apps → SJO ERP → Permissions — because the WebView separately asks the
// hosting Activity "is this specific web permission request OK?" via
// WebChromeClient.onPermissionRequest(), and a stock Capacitor
// MainActivity never answers that. Without an answer, the WebView
// silently refuses, and the Agora SDK's failure surfaces as a raw
// "Cannot read properties of undefined (reading 'replace')" instead of a
// clean permission error.
//
// IMPORTANT: this wiring happens in onStart(), not onCreate(). Right after
// super.onCreate() the Bridge/WebView aren't guaranteed to be fully
// attached yet on every device/Capacitor version — calling
// getBridge().getWebView() at that point caused a NullPointerException on
// launch for some users. onStart() runs after onCreate() has fully
// completed, and everything is also null-checked as a second layer of
// safety: if the bridge or WebView somehow isn't ready, this code just
// skips wiring up the permission handler instead of crashing — the app
// still opens normally, it would just fall back to the old "Couldn't
// connect the call" behavior for that one session.
public class MainActivity extends BridgeActivity {
  private static final int MEDIA_PERMISSION_REQUEST_CODE = 6001;
  private boolean webChromeClientWired = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Ask for the real Android runtime permissions up front, same as any
    // native app would. Needed so there's something for the WebView-level
    // grant (below) to actually grant — a WebView can't get mic/camera
    // access the app process itself was never given.
    ActivityCompat.requestPermissions(
      this,
      new String[] { Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA },
      MEDIA_PERMISSION_REQUEST_CODE
    );
  }

  @Override
  public void onStart() {
    super.onStart();
    if (webChromeClientWired) return; // only need to set this up once

    try {
      Bridge bridge = getBridge();
      if (bridge == null) return;
      WebView webView = bridge.getWebView();
      if (webView == null) return;

      webView.setWebChromeClient(new BridgeWebChromeClient(bridge) {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
          if (request == null) return;
          runOnUiThread(() -> {
            try {
              boolean hasMic = ActivityCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
              boolean hasCamera = ActivityCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;

              java.util.List<String> toGrant = new java.util.ArrayList<>();
              String[] resources = request.getResources();
              if (resources != null) {
                for (String resource : resources) {
                  if (resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && hasMic) toGrant.add(resource);
                  if (resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && hasCamera) toGrant.add(resource);
                }
              }
              if (!toGrant.isEmpty()) {
                request.grant(toGrant.toArray(new String[0]));
              } else {
                request.deny();
              }
            } catch (Exception e) {
              // Never let a permission-prompt hiccup crash the app —
              // worst case the call just fails with the old friendly
              // error message instead of connecting.
              request.deny();
            }
          });
        }
      });

      webChromeClientWired = true;
    } catch (Exception e) {
      // Swallow — see class-level comment. The call feature simply won't
      // get mic/camera access this session; nothing else should break.
    }
  }
}

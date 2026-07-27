package com.sharmajikaoffice.erp;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

// Two things were missing that block Agora calls (mic/camera) from
// working inside the Android app, even though the exact same code works
// fine in a desktop browser:
//
//  1. The Android WebView does NOT grant getUserMedia() access to
//     JavaScript by default, no matter what's in AndroidManifest.xml — the
//     host app has to explicitly grant it via WebChromeClient's
//     onPermissionRequest(), which the default BridgeActivity doesn't do.
//     Without this, Agora's SDK gets a broken/empty media stream and
//     throws an opaque internal error instead of a clear permission error
//     (see src/lib/callErrors.js on the JS side for the friendlier message
//     that now shows if this ever happens again for another reason).
//
//  2. Runtime permission (Android 6+) still needs to be requested
//     separately from the WebView grant above — see onCreate() below.
public class MainActivity extends BridgeActivity {
  private static final int PERMISSION_REQUEST_CODE = 1001;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Ask for mic/camera up front so a call never fails on first attempt
    // just because the OS-level permission dialog hadn't been shown yet.
    String[] needed = { Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA };
    boolean allGranted = true;
    for (String p : needed) {
      if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
        allGranted = false;
        break;
      }
    }
    if (!allGranted) {
      ActivityCompat.requestPermissions(this, needed, PERMISSION_REQUEST_CODE);
    }

    // Grant the WebView's own getUserMedia() permission requests coming
    // from Agora's JS SDK — this is the actual fix for the crash.
    this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(() -> request.grant(request.getResources()));
      }
    });
  }
}

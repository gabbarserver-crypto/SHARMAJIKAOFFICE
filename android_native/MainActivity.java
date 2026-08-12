package com.sharmajikaoffice.erp;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Capacitor requires custom plugins to be registered BEFORE
    // super.onCreate() runs.
    registerPlugin(SpeakerModePlugin.class);

    super.onCreate(savedInstanceState);

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
      ActivityCompat.requestPermissions(this, perms, 1001);
    }

    this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(() -> request.grant(request.getResources()));
      }
    });
  }
}

package com.sharmajikaoffice.erp;

import android.Manifest;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    ActivityCompat.requestPermissions(this,
        new String[]{ Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA }, 1001);

    this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(() -> request.grant(request.getResources()));
      }
    });
  }
}
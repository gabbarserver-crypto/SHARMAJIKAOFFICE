package com.oneinfinity.erp;

import android.app.KeyguardManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Replaces the default @capacitor/push-notifications MessagingService
 * (removed in AndroidManifest.xml via tools:node="remove") so that we can
 * intercept the data-only "call" push sent from api/send-push.js and turn
 * the screen on / show a full-screen incoming-call UI even when the app is
 * killed or the device is locked — mirrors WhatsApp/Signal behavior.
 *
 * Every other push (chat, draft, etc.) still uses a "notification" block,
 * which Google Play Services delivers straight to the system tray on its
 * own whenever the app isn't in the foreground — that path does NOT go
 * through this service at all, so it's untouched by this change.
 */
public class CallMessagingService extends FirebaseMessagingService {

  private static final String CHANNEL_ID = "incoming_calls";
  private static final int CALL_NOTIFICATION_ID = 9001;
  private static final int CALL_REQUEST_CODE = 9001;

  @Override
  public void onMessageReceived(RemoteMessage remoteMessage) {
    super.onMessageReceived(remoteMessage);

    Map<String, String> data = remoteMessage.getData();
    if (data == null || !"call".equals(data.get("kind"))) {
      // Not a call push. Nothing to do here — chat/draft notifications are
      // notification-block payloads and never reach onMessageReceived
      // unless the app is in the foreground, where Supabase Realtime +
      // notify.js already handle them directly.
      return;
    }

    showIncomingCallNotification(data);
    briefWakeLock();
  }

  private void showIncomingCallNotification(Map<String, String> data) {
    String title = data.get("title");
    if (title == null || title.isEmpty()) title = "Incoming call";
    String body = data.get("body");
    if (body == null) body = "";

    createChannelIfNeeded();

    Intent fullScreenIntent = new Intent(this, MainActivity.class);
    fullScreenIntent.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    fullScreenIntent.putExtra(MainActivity.EXTRA_INCOMING_CALL, true);

    int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      piFlags |= PendingIntent.FLAG_IMMUTABLE;
    }
    PendingIntent fullScreenPendingIntent =
        PendingIntent.getActivity(this, CALL_REQUEST_CODE, fullScreenIntent, piFlags);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(body)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .setOngoing(false)
        .setFullScreenIntent(fullScreenPendingIntent, true)
        .setContentIntent(fullScreenPendingIntent);

    // Pre-Android 8 (no channel importance): set sound/vibration directly.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
      builder.setSound(ringtone);
      builder.setVibrate(new long[]{0, 500, 500, 500});
    }

    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm != null) {
      nm.notify(CALL_NOTIFICATION_ID, builder.build());
    }
  }

  private void createChannelIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;

    NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("Ringing screen for incoming SJO calls");
    channel.enableVibration(true);
    channel.setVibrationPattern(new long[]{0, 500, 500, 500});
    channel.enableLights(true);
    channel.setBypassDnd(true);
    channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);

    Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    AudioAttributes attrs = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build();
    channel.setSound(ringtone, attrs);

    nm.createNotificationChannel(channel);
  }

  // Safety net for aggressive OEM battery managers (Xiaomi/Vivo/Oppo etc.)
  // that sometimes ignore setFullScreenIntent alone. Held only briefly —
  // the full-screen intent notification is what actually keeps the UI up.
  private void briefWakeLock() {
    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
    if (pm == null) return;
    @SuppressWarnings("deprecation")
    PowerManager.WakeLock wakeLock = pm.newWakeLock(
        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
            | PowerManager.ACQUIRE_CAUSES_WAKEUP
            | PowerManager.ON_AFTER_RELEASE,
        "sjo:incoming_call");
    wakeLock.acquire(10000);
  }
}

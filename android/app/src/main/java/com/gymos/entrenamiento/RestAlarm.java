package com.gymos.entrenamiento;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

public final class RestAlarm extends BroadcastReceiver {
    private static final String CHANNEL = "gymos-rest";
    private static final String AT = "at";
    private static final String NEXT_EXERCISE = "nextExercise";
    private static final int ID = 101;

    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences(CHANNEL, Context.MODE_PRIVATE);
    }

    private static PendingIntent alarm(Context context, int flags) {
        return PendingIntent.getBroadcast(context, ID, new Intent(context, RestAlarm.class),
            flags | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean schedule(Context context, long at, boolean nextExercise) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(
            CHANNEL, "Fin del descanso", NotificationManager.IMPORTANCE_HIGH));
        if (!notifications.areNotificationsEnabled()
                || notifications.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE) {
            return false;
        }
        notifications.cancel(ID);
        store(context).edit().putLong(AT, at).putBoolean(NEXT_EXERCISE, nextExercise).apply();
        if (at <= System.currentTimeMillis()) {
            finish(context, at);
        } else {
            PendingIntent pending = alarm(context, PendingIntent.FLAG_UPDATE_CURRENT);
            AlarmManager alarms = context.getSystemService(AlarmManager.class);
            if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) {
                try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                    return true;
                } catch (SecurityException ignored) {
                    // Exact-alarm access can change while the app is open.
                }
            }
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }
        return true;
    }

    static void cancel(Context context) {
        store(context).edit().clear().apply();
        PendingIntent pending = alarm(context, PendingIntent.FLAG_NO_CREATE);
        if (pending != null) {
            context.getSystemService(AlarmManager.class).cancel(pending);
            pending.cancel();
        }
    }

    static void finish(Context context, long at) {
        SharedPreferences prefs = store(context);
        if (at <= 0 || prefs.getLong(AT, 0) != at || at > System.currentTimeMillis()) return;
        boolean nextExercise = prefs.getBoolean(NEXT_EXERCISE, false);
        cancel(context);
        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, ID, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_workout_notification)
            .setContentTitle("Descanso terminado")
            .setContentText(nextExercise ? "Es hora del siguiente ejercicio." : "Es hora de la siguiente serie.")
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build();
        context.getSystemService(NotificationManager.class).notify(ID, notification);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        finish(context, store(context).getLong(AT, 0));
    }
}

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

public final class WorkoutAlarm extends BroadcastReceiver {
    static final String AT = "workoutReminderAt";
    private static final String EXERCISE = "exercise";
    private static final String CHANNEL = "workout-reminders";
    private static final String ALARM = "com.gymos.entrenamiento.WORKOUT_REMINDER";
    private static final int NOTIFICATION = 100;

    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences(CHANNEL, Context.MODE_PRIVATE);
    }

    private static PendingIntent pendingAlarm(Context context, int flags) {
        Intent intent = new Intent(context, WorkoutAlarm.class).setAction(ALARM);
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean schedule(Context context, long at, String exercise) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
            CHANNEL, "Siguiente ejercicio", NotificationManager.IMPORTANCE_DEFAULT));
        if (!manager.areNotificationsEnabled()
                || manager.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE) {
            return false;
        }
        manager.cancel(NOTIFICATION);
        store(context).edit().putLong(AT, at).putString(EXERCISE, exercise).commit();
        arm(context, at);
        return true;
    }

    private static void arm(Context context, long at) {
        context.getSystemService(AlarmManager.class).setAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP, at, pendingAlarm(context, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    static void cancel(Context context) {
        PendingIntent pending = pendingAlarm(context, PendingIntent.FLAG_NO_CREATE);
        if (pending != null) {
            context.getSystemService(AlarmManager.class).cancel(pending);
            pending.cancel();
        }
        context.getSystemService(NotificationManager.class).cancel(NOTIFICATION);
        store(context).edit().clear().commit();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = store(context);
        long at = prefs.getLong(AT, 0);
        if (at <= 0) return;
        if (!ALARM.equals(intent.getAction()) || at > System.currentTimeMillis()) {
            arm(context, Math.max(at, System.currentTimeMillis()));
            return;
        }

        Intent open = new Intent(context, MainActivity.class).putExtra(AT, at)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String exercise = prefs.getString(EXERCISE, "");
        Notification notification = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_workout_notification)
            .setContentTitle("Continúa tu rutina")
            .setContentText(exercise.trim().isEmpty() ? "Toca para ver el siguiente ejercicio." : "Siguiente ejercicio: " + exercise)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build();
        prefs.edit().clear().commit();
        context.getSystemService(NotificationManager.class).notify(NOTIFICATION, notification);
    }
}

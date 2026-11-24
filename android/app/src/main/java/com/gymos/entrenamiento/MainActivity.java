package com.gymos.entrenamiento;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.provider.Settings;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String WEB_CLIENT =
        "1025418774866-89ojv98s4dun12sqa5mrkhqsg6s03unh.apps.googleusercontent.com";
    private static final int POST_NOTIFICATIONS = 1;
    private WebView web;
    private CredentialManager credentials;
    private long launchAt;
    private Runnable permissionGranted;
    private Runnable permissionDenied;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        launchAt = getIntent().getLongExtra(WorkoutAlarm.AT, 0);
        credentials = CredentialManager.create(this);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme()) && "appassets.androidplatform.net".equals(url.getHost())) {
                    return false;
                }
                if (request.isForMainFrame() && ("http".equals(url.getScheme()) || "https".equals(url.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                    catch (android.content.ActivityNotFoundException ignored) {}
                }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "GymOSAndroid", Collections.singleton(ORIGIN),
                (view, message, origin, mainFrame, reply) -> {
                    if (mainFrame && message.getData() != null) handleMessage(message.getData(), reply);
                });
        }
        setContentView(web);
        web.loadUrl(ORIGIN + "/assets/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        launchAt = intent.getLongExtra(WorkoutAlarm.AT, 0);
        if (launchAt > 0) {
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('gymos:workout-notification',{detail:"
                + launchAt + "}))", null);
        }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
            "document.getElementById('workout-mode')?.classList.contains('is-hidden') ? false : (document.getElementById('btnExitWorkout')?.click(), true)",
            handled -> {
                if ("true".equals(handled)) return;
                if (web.canGoBack()) web.goBack();
                else finish();
            });
    }

    private long restRequest;

    private void handleMessage(String message, JavaScriptReplyProxy reply) {
        String id = "";
        try {
            JSONObject data = new JSONObject(message);
            id = data.getString("id");
            switch (data.getString("command")) {
                case "signIn": signIn(reply, id); break;
                case "signOut": signOut(reply, id); break;
                case "schedule": schedule(data, reply, id, false); break;
                case "scheduleRest": schedule(data, reply, id, true); break;
                case "restSettings": respond(reply, id, restSettings(), null); break;
                case "enableRestNotifications": enableRestNotifications(reply, id); break;
                case "openRestChannel":
                    RestAlarm.channel(this);
                    openSettings(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                        .putExtra(Settings.EXTRA_CHANNEL_ID, RestAlarm.CHANNEL));
                    respond(reply, id, true, null);
                    break;
                case "openExactAlarms":
                    if (Build.VERSION.SDK_INT >= 31) openSettings(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri()));
                    respond(reply, id, true, null);
                    break;
                case "testRestNotification":
                    if (RestAlarm.test(this)) respond(reply, id, true, null);
                    else respond(reply, id, null, "Activa las notificaciones de descanso primero.");
                    break;
                case "cancelRest":
                    restRequest++;
                    RestAlarm.cancel(this);
                    respond(reply, id, true, null);
                    break;
                case "finishRest":
                    RestAlarm.finish(this, data.getLong("at"));
                    respond(reply, id, true, null);
                    break;
                case "cancel":
                    if (permissionDenied != null) permissionDenied.run();
                    permissionGranted = null;
                    permissionDenied = null;
                    WorkoutAlarm.cancel(this);
                    respond(reply, id, true, null);
                    break;
                case "launch":
                    respond(reply, id, launchAt, null);
                    launchAt = 0;
                    break;
                default: respond(reply, id, null, "Acción desconocida.");
            }
        } catch (JSONException error) {
            respond(reply, id, null, "Solicitud inválida.");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('gymos:settings-return'))", null);
    }

    private Uri packageUri() {
        return Uri.parse("package:" + getPackageName());
    }

    private void openSettings(Intent action) {
        try {
            startActivity(action);
        } catch (android.content.ActivityNotFoundException error) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri()));
        }
    }

    private JSONObject restSettings() throws JSONException {
        NotificationManager manager = getSystemService(NotificationManager.class);
        var channel = RestAlarm.channel(this);
        return new JSONObject()
            .put("enabled", manager.areNotificationsEnabled())
            .put("channel", channel.getImportance() != NotificationManager.IMPORTANCE_NONE)
            .put("sound", channel.getImportance() >= NotificationManager.IMPORTANCE_DEFAULT && channel.getSound() != null)
            .put("exact", Build.VERSION.SDK_INT < 31 || getSystemService(AlarmManager.class).canScheduleExactAlarms());
    }

    private void enableRestNotifications(JavaScriptReplyProxy reply, String id) {
        boolean needsPermission = Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
        if (needsPermission && !getPreferences(MODE_PRIVATE).getBoolean("restPermissionAsked", false) && permissionGranted == null) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("restPermissionAsked", true).apply();
            permissionGranted = () -> respond(reply, id, true, null);
            permissionDenied = () -> respond(reply, id, false, null);
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, POST_NOTIFICATIONS);
            return;
        }
        openSettings(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        respond(reply, id, true, null);
    }

    private void signIn(JavaScriptReplyProxy reply, String id) {
        var option = new GetSignInWithGoogleOption.Builder(WEB_CLIENT).build();
        var request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        credentials.getCredentialAsync(this, request, new CancellationSignal(), this::runOnUiThread,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    try {
                        String token = GoogleIdTokenCredential.createFrom(result.getCredential().getData()).getIdToken();
                        respond(reply, id, token, null);
                    } catch (Exception error) {
                        respond(reply, id, null, "No se pudo leer la credencial de Google.");
                    }
                }
                @Override
                public void onError(GetCredentialException exception) {
                    respond(reply, id, null, "No se completó el inicio con Google. Revisa tu conexión y tu cuenta.");
                }
            });
    }

    private void signOut(JavaScriptReplyProxy reply, String id) {
        credentials.clearCredentialStateAsync(new ClearCredentialStateRequest(), null, this::runOnUiThread,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void value) { respond(reply, id, true, null); }
                @Override
                public void onError(ClearCredentialException error) { respond(reply, id, false, null); }
            });
    }

    private void schedule(JSONObject data, JavaScriptReplyProxy reply, String id, boolean rest) throws JSONException {
        long at = data.getLong("at");
        String exercise = data.optString("exercise");
        if (at <= System.currentTimeMillis() || at > System.currentTimeMillis() + 24 * 60 * 60_000L) {
            respond(reply, id, null, "La hora del recordatorio no es válida.");
            return;
        }
        long restToken = rest ? ++restRequest : 0;
        boolean nextExercise = data.optBoolean("nextExercise");
        Runnable schedule = () -> {
            if (rest && restToken != restRequest) {
                respond(reply, id, false, null);
                return;
            }
            boolean scheduled = rest ? RestAlarm.schedule(this, at, nextExercise) : WorkoutAlarm.schedule(this, at, exercise);
            if (scheduled) respond(reply, id, true, null);
            else respond(reply, id, null, "Activa los avisos de GymOS en los ajustes de Android.");
        };
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (permissionGranted != null) {
                respond(reply, id, null, "Responde primero a la solicitud de permiso de Android.");
                return;
            }
            getPreferences(MODE_PRIVATE).edit().putBoolean("restPermissionAsked", true).apply();
            permissionGranted = schedule;
            permissionDenied = () -> respond(reply, id, null, "Activa las notificaciones de GymOS para recibir avisos.");
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, POST_NOTIFICATIONS);
        } else schedule.run();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code != POST_NOTIFICATIONS) return;
        Runnable callback = grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED
            ? permissionGranted : permissionDenied;
        permissionGranted = null;
        permissionDenied = null;
        if (callback != null) callback.run();
    }

    private void respond(JavaScriptReplyProxy reply, String id, Object value, String error) {
        try {
            reply.postMessage(new JSONObject().put("id", id).put("value", value == null ? JSONObject.NULL : value)
                .put("error", error == null ? JSONObject.NULL : error).toString());
        } catch (JSONException | IllegalStateException ignored) {}
    }
}

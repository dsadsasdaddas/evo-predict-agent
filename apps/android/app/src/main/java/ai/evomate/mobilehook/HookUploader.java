package ai.evomate.mobilehook;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class HookUploader {
    interface Callback {
        void onResult(boolean ok, int status, String message);
    }

    private final Context appContext;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    HookUploader(Context context) {
        this.appContext = context.getApplicationContext();
    }

    void post(JSONObject event, HookConfig config, Callback callback) {
        executor.execute(() -> {
            int status = 0;
            String message = "";
            boolean ok = false;
            try {
                JSONArray events = new JSONArray().put(event);
                JSONObject payload = new JSONObject()
                        .put("protocolVersion", HookConfig.PROTOCOL_VERSION)
                        .put("events", events);
                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                HttpURLConnection connection = (HttpURLConnection) new URL(config.apiUrl).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(1500);
                connection.setReadTimeout(2500);
                connection.setDoOutput(true);
                connection.setRequestProperty("content-type", "application/json");
                connection.setRequestProperty("accept", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
                status = connection.getResponseCode();
                ok = status >= 200 && status < 300;
                message = readResponse(connection, ok);
            } catch (Exception error) {
                message = String.valueOf(error.getMessage() == null ? error : error.getMessage());
            }
            remember(event, ok, status, message);
            if (callback != null) callback.onResult(ok, status, message);
        });
    }

    private String readResponse(HttpURLConnection connection, boolean ok) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                ok ? connection.getInputStream() : connection.getErrorStream(),
                StandardCharsets.UTF_8
        ))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
            return builder.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private void remember(JSONObject event, boolean ok, int status, String message) {
        SharedPreferences prefs = HookConfig.prefs(appContext);
        prefs.edit()
                .putBoolean("lastOk", ok)
                .putInt("lastStatus", status)
                .putLong("lastAt", System.currentTimeMillis())
                .putString("lastMessage", message)
                .putString("lastEventPreview", event.optString("content"))
                .apply();
    }
}

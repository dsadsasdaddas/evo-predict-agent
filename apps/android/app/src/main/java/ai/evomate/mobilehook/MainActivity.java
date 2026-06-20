package ai.evomate.mobilehook;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private CheckBox enabled;
    private CheckBox captureUser;
    private CheckBox captureAssistant;
    private CheckBox captureUnknown;
    private CheckBox clientRedaction;
    private EditText apiUrl;
    private EditText minChars;
    private EditText maxChars;
    private EditText targetPackages;
    private TextView status;
    private HookUploader uploader;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        uploader = new HookUploader(this);
        setContentView(buildView());
        loadIntoFields();
        refreshStatus();
    }

    private ScrollView buildView() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(28));
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("EvoMate Android Hook", 22, true);
        root.addView(title);
        root.addView(text("监听豆包、ChatGPT、Claude、Gemini 等安卓聊天界面，并按 evomate.hook.v1 / mobile-chat 上传到现有 evomap hook endpoint。", 14, false));

        enabled = check("启用监听");
        captureUser = check("捕获用户输入");
        captureAssistant = check("捕获模型回复");
        captureUnknown = check("捕获未知角色文本");
        clientRedaction = check("手机端脱敏后上传");
        root.addView(enabled);
        root.addView(captureUser);
        root.addView(captureAssistant);
        root.addView(captureUnknown);
        root.addView(clientRedaction);

        apiUrl = edit("API URL", false);
        minChars = edit("最少字符数", true);
        maxChars = edit("最大字符数", true);
        targetPackages = edit("目标 App 包名，一行一个", false);
        targetPackages.setMinLines(8);
        targetPackages.setGravity(android.view.Gravity.TOP);
        root.addView(label("上传地址"));
        root.addView(apiUrl);
        root.addView(label("过滤"));
        root.addView(minChars);
        root.addView(maxChars);
        root.addView(label("目标 App 包名"));
        root.addView(targetPackages);

        Button save = button("保存配置");
        save.setOnClickListener(view -> {
            saveFields();
            refreshStatus();
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
        });
        root.addView(save);

        Button accessibility = button("打开安卓无障碍设置");
        accessibility.setOnClickListener(view -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        root.addView(accessibility);

        Button test = button("发送测试 hook");
        test.setOnClickListener(view -> {
            saveFields();
            sendTestHook();
        });
        root.addView(test);

        status = text("", 13, false);
        status.setTextColor(Color.rgb(65, 80, 90));
        status.setPadding(0, dp(14), 0, 0);
        root.addView(status);
        return scroll;
    }

    private void loadIntoFields() {
        SharedPreferences prefs = HookConfig.prefs(this);
        HookConfig config = HookConfig.load(this);
        enabled.setChecked(config.enabled);
        captureUser.setChecked(config.captureUser);
        captureAssistant.setChecked(config.captureAssistant);
        captureUnknown.setChecked(config.captureUnknown);
        clientRedaction.setChecked(config.clientRedaction);
        apiUrl.setText(config.apiUrl);
        minChars.setText(String.valueOf(config.minChars));
        maxChars.setText(String.valueOf(config.maxChars));
        targetPackages.setText(prefs.getString("targetPackages", HookConfig.DEFAULT_TARGET_PACKAGES));
    }

    private void saveFields() {
        HookConfig.save(
                this,
                enabled.isChecked(),
                apiUrl.getText().toString(),
                captureUser.isChecked(),
                captureAssistant.isChecked(),
                captureUnknown.isChecked(),
                clientRedaction.isChecked(),
                parseInt(minChars.getText().toString(), 12),
                parseInt(maxChars.getText().toString(), 6000),
                targetPackages.getText().toString()
        );
    }

    private void sendTestHook() {
        HookConfig config = HookConfig.load(this);
        try {
            JSONObject event = new JSONObject()
                    .put("protocolVersion", HookConfig.PROTOCOL_VERSION)
                    .put("source", "mobile-chat:android-test")
                    .put("channel", "mobile-chat")
                    .put("event", "mobile_chat_user")
                    .put("eventKind", "user_message")
                    .put("direction", "inbound")
                    .put("content", "EvoMate Android hook test")
                    .put("sessionId", "android_test_" + System.currentTimeMillis())
                    .put("device", "android")
                    .put("app", "ai.evomate.mobilehook")
                    .put("occurredAt", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).format(new Date()))
                    .put("metadata", new JSONObject()
                            .put("provider", "android-test")
                            .put("captureMode", "manual_test")
                            .put("textHash", TextTools.hash("EvoMate Android hook test")))
                    .put("privacy", new JSONObject()
                            .put("consent", true)
                            .put("redaction", "client")
                            .put("pii", "none")
                            .put("retention", "short"))
                    .put("signals", new JSONArray()
                            .put("mobile_chat")
                            .put("android_accessibility")
                            .put("manual_test"));
            uploader.post(event, config, (ok, statusCode, message) -> runOnUiThread(() -> {
                refreshStatus();
                Toast.makeText(this, ok ? "Hook sent" : "Hook failed: " + statusCode, Toast.LENGTH_LONG).show();
            }));
        } catch (Exception error) {
            Toast.makeText(this, String.valueOf(error.getMessage()), Toast.LENGTH_LONG).show();
        }
    }

    private void refreshStatus() {
        SharedPreferences prefs = HookConfig.prefs(this);
        long lastAt = prefs.getLong("lastAt", 0L);
        String time = lastAt > 0 ? new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).format(new Date(lastAt)) : "never";
        status.setText(
                "Last upload: " + time +
                        "\nOK: " + prefs.getBoolean("lastOk", false) +
                        "\nHTTP: " + prefs.getInt("lastStatus", 0) +
                        "\nPreview: " + prefs.getString("lastEventPreview", "") +
                        "\nEndpoint: " + HookConfig.load(this).apiUrl
        );
    }

    private TextView label(String value) {
        TextView label = text(value, 13, true);
        label.setPadding(0, dp(12), 0, dp(4));
        return label;
    }

    private TextView text(String value, int sizeSp, boolean bold) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(sizeSp);
        text.setTextColor(Color.rgb(20, 28, 35));
        text.setPadding(0, dp(3), 0, dp(5));
        if (bold) text.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return text;
    }

    private CheckBox check(String label) {
        CheckBox box = new CheckBox(this);
        box.setText(label);
        box.setTextSize(15);
        return box;
    }

    private EditText edit(String hint, boolean number) {
        EditText edit = new EditText(this);
        edit.setHint(hint);
        edit.setSingleLine(false);
        edit.setInputType(number ? InputType.TYPE_CLASS_NUMBER : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        return edit;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setPadding(0, dp(8), 0, dp(8));
        return button;
    }

    private int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(value.trim());
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

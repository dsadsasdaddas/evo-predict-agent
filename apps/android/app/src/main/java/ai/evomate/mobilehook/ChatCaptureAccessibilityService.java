package ai.evomate.mobilehook;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;

public class ChatCaptureAccessibilityService extends AccessibilityService {
    private static final int MAX_RECENT_HASHES = 320;
    private static final int MAX_EVENTS_PER_SCAN = 5;
    private static final long WINDOW_SCAN_DEBOUNCE_MS = 900;

    private final ArrayDeque<String> recentOrder = new ArrayDeque<>();
    private final Set<String> recentHashes = new HashSet<>();
    private HookUploader uploader;
    private long lastWindowScanAt = 0L;
    private String lastInputText = "";
    private long lastInputAt = 0L;
    private String installId;

    @Override
    protected void onServiceConnected() {
        uploader = new HookUploader(this);
        installId = HookConfig.prefs(this).getString("installId", "");
        if (installId == null || installId.isEmpty()) {
            installId = UUID.randomUUID().toString();
            HookConfig.prefs(this).edit().putString("installId", installId).apply();
        }
        Toast.makeText(this, "EvoMate Hook listening", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        HookConfig config = HookConfig.load(this);
        if (!config.enabled) return;
        String packageName = String.valueOf(event.getPackageName() == null ? "" : event.getPackageName());
        if (!config.shouldCapturePackage(packageName)) return;

        int type = event.getEventType();
        if (type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            captureInputChange(event, packageName, config);
            return;
        }
        if (type == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            captureFeedbackClick(event, packageName, config);
            return;
        }
        if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED || type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            long now = System.currentTimeMillis();
            if (now - lastWindowScanAt < WINDOW_SCAN_DEBOUNCE_MS) return;
            lastWindowScanAt = now;
            scanVisibleMessages(event, packageName, config);
        }
    }

    @Override
    public void onInterrupt() {
    }

    private void captureInputChange(AccessibilityEvent event, String packageName, HookConfig config) {
        String text = eventText(event);
        if (!isCapturable(text, "user", config)) return;
        lastInputText = text;
        lastInputAt = System.currentTimeMillis();
    }

    private void captureFeedbackClick(AccessibilityEvent event, String packageName, HookConfig config) {
        String text = eventText(event).toLowerCase(Locale.ROOT);
        if (text.contains("copy") || text.contains("复制")) {
            sendEvent("copy", "feedback", "accepted", freshInputText(), packageName, "accessibility_click", "feedback", config, 0.78);
        } else if (text.contains("regenerate") || text.contains("重新生成")) {
            sendEvent("regenerate", "feedback", "corrected", text, packageName, "accessibility_click", "feedback", config, 0.25);
        } else if (text.contains("stop") || text.contains("停止")) {
            sendEvent("stop", "feedback", "interrupted", text, packageName, "accessibility_click", "feedback", config, 0.15);
        } else if (looksLikeSend(text)) {
            String input = freshInputText();
            if (isCapturable(input, "user", config)) {
                sendEvent("user_message", "inbound", null, input, packageName, "accessibility_send_click", "user", config, null);
            }
        }
    }

    private void scanVisibleMessages(AccessibilityEvent event, String packageName, HookConfig config) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        List<NodeText> texts = new ArrayList<>();
        collectLeafTexts(root, texts, 0);
        int sent = 0;
        for (NodeText item : texts) {
            String role = item.editable ? "user" : "assistant";
            if (!shouldCaptureRole(role, config)) continue;
            if (!isCapturable(item.text, role, config)) continue;
            if (role.equals("user") && item.text.equals(freshInputText())) continue;
            sendEvent(
                    role.equals("user") ? "user_message" : "assistant_message",
                    role.equals("user") ? "inbound" : "outbound",
                    null,
                    item.text,
                    packageName,
                    "accessibility_tree",
                    role,
                    config,
                    null
            );
            sent += 1;
            if (sent >= MAX_EVENTS_PER_SCAN) break;
        }
        root.recycle();
    }

    private void collectLeafTexts(AccessibilityNodeInfo node, List<NodeText> out, int depth) {
        if (node == null || depth > 24) return;
        CharSequence text = node.getText();
        CharSequence description = node.getContentDescription();
        String value = TextTools.clean(text != null ? text.toString() : description == null ? "" : description.toString());
        boolean hasChildren = node.getChildCount() > 0;
        if (!value.isEmpty() && (!hasChildren || value.length() >= 24)) {
            out.add(new NodeText(value, node.isEditable(), String.valueOf(node.getClassName())));
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            collectLeafTexts(child, out, depth + 1);
            if (child != null) child.recycle();
        }
    }

    private void sendEvent(
            String eventKind,
            String direction,
            String outcome,
            String rawContent,
            String packageName,
            String captureMode,
            String role,
            HookConfig config,
            Double score
    ) {
        String content = config.clientRedaction ? TextTools.redact(rawContent) : TextTools.clean(rawContent);
        content = TextTools.trimToLimit(content, config.maxChars);
        if (!isCapturable(content, role, config)) return;
        String provider = ProviderDetector.detect(packageName);
        String hash = TextTools.hash(provider + "\n" + role + "\n" + TextTools.normalizeForHash(content));
        if (remembered(hash)) return;

        try {
            JSONObject event = new JSONObject()
                    .put("protocolVersion", HookConfig.PROTOCOL_VERSION)
                    .put("source", "mobile-chat:" + provider)
                    .put("channel", "mobile-chat")
                    .put("event", "mobile_chat_" + role)
                    .put("eventKind", eventKind)
                    .put("direction", direction)
                    .put("content", content)
                    .put("sessionId", sessionId(provider, packageName))
                    .put("device", "android")
                    .put("app", packageName)
                    .put("occurredAt", isoNow())
                    .put("metadata", new JSONObject()
                            .put("provider", provider)
                            .put("packageName", packageName)
                            .put("captureMode", captureMode)
                            .put("role", role)
                            .put("textHash", hash))
                    .put("privacy", new JSONObject()
                            .put("consent", true)
                            .put("redaction", config.clientRedaction ? "client" : "none")
                            .put("pii", "possible")
                            .put("retention", "short"))
                    .put("signals", new JSONArray()
                            .put("mobile_chat")
                            .put("android_accessibility")
                            .put("provider_" + provider)
                            .put("role_" + role));
            if (outcome != null) event.put("outcome", outcome);
            if (score != null) event.put("score", score);
            uploader.post(event, config, null);
        } catch (Exception ignored) {
        }
    }

    private boolean shouldCaptureRole(String role, HookConfig config) {
        if ("user".equals(role)) return config.captureUser;
        if ("assistant".equals(role)) return config.captureAssistant;
        return config.captureUnknown;
    }

    private boolean isCapturable(String text, String role, HookConfig config) {
        String clean = TextTools.clean(text);
        int min = "user".equals(role) ? Math.min(config.minChars, 1) : config.minChars;
        return clean.length() >= min && !TextTools.isNoise(clean);
    }

    private boolean remembered(String hash) {
        if (recentHashes.contains(hash)) return true;
        recentHashes.add(hash);
        recentOrder.addLast(hash);
        while (recentOrder.size() > MAX_RECENT_HASHES) {
            String old = recentOrder.removeFirst();
            recentHashes.remove(old);
        }
        return false;
    }

    private String eventText(AccessibilityEvent event) {
        StringBuilder builder = new StringBuilder();
        for (CharSequence item : event.getText()) {
            if (item != null) builder.append(item).append('\n');
        }
        if (builder.length() == 0 && event.getContentDescription() != null) {
            builder.append(event.getContentDescription());
        }
        return TextTools.clean(builder.toString());
    }

    private String freshInputText() {
        return System.currentTimeMillis() - lastInputAt < 20000 ? lastInputText : "";
    }

    private boolean looksLikeSend(String text) {
        String value = String.valueOf(text == null ? "" : text).toLowerCase(Locale.ROOT);
        return value.contains("send") || value.contains("submit") || value.contains("发送") || value.contains("提交");
    }

    private String sessionId(String provider, String packageName) {
        String day = new SimpleDateFormat("yyyyMMdd", Locale.ROOT).format(new Date());
        return "android_" + provider + "_" + day + "_" + TextTools.hash(installId + packageName).substring(0, 8);
    }

    private String isoNow() {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date());
    }

    private static final class NodeText {
        final String text;
        final boolean editable;
        final String className;

        NodeText(String text, boolean editable, String className) {
            this.text = text;
            this.editable = editable;
            this.className = className;
        }
    }
}

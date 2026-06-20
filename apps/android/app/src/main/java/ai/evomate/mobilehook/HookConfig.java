package ai.evomate.mobilehook;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

final class HookConfig {
    static final String PROTOCOL_VERSION = "evomate.hook.v1";
    static final String DEFAULT_API_URL = "https://evomate-api-3mkana4zma-df.a.run.app/api/hook-events";
    static final String DEFAULT_TARGET_PACKAGES =
            "com.larus.nova\n" +
            "com.openai.chatgpt\n" +
            "com.anthropic.claude\n" +
            "com.google.android.apps.bard\n" +
            "ai.perplexity.app.android\n" +
            "com.quora.poe\n" +
            "com.deepseek.chat\n" +
            "com.moonshot.kimichat\n" +
            "com.alibaba.tongyi";

    private static final String PREFS = "evomate_mobile_hook";

    final boolean enabled;
    final String apiUrl;
    final boolean captureUser;
    final boolean captureAssistant;
    final boolean captureUnknown;
    final boolean clientRedaction;
    final int minChars;
    final int maxChars;
    final Set<String> targetPackages;

    private HookConfig(
            boolean enabled,
            String apiUrl,
            boolean captureUser,
            boolean captureAssistant,
            boolean captureUnknown,
            boolean clientRedaction,
            int minChars,
            int maxChars,
            Set<String> targetPackages
    ) {
        this.enabled = enabled;
        this.apiUrl = normalizeApiUrl(apiUrl);
        this.captureUser = captureUser;
        this.captureAssistant = captureAssistant;
        this.captureUnknown = captureUnknown;
        this.clientRedaction = clientRedaction;
        this.minChars = Math.max(1, minChars);
        this.maxChars = Math.max(120, maxChars);
        this.targetPackages = targetPackages;
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static HookConfig load(Context context) {
        SharedPreferences prefs = prefs(context);
        String packages = prefs.getString("targetPackages", DEFAULT_TARGET_PACKAGES);
        return new HookConfig(
                prefs.getBoolean("enabled", true),
                prefs.getString("apiUrl", DEFAULT_API_URL),
                prefs.getBoolean("captureUser", true),
                prefs.getBoolean("captureAssistant", true),
                prefs.getBoolean("captureUnknown", false),
                prefs.getBoolean("clientRedaction", true),
                prefs.getInt("minChars", 12),
                prefs.getInt("maxChars", 6000),
                parsePackageList(packages)
        );
    }

    static void save(
            Context context,
            boolean enabled,
            String apiUrl,
            boolean captureUser,
            boolean captureAssistant,
            boolean captureUnknown,
            boolean clientRedaction,
            int minChars,
            int maxChars,
            String targetPackages
    ) {
        prefs(context).edit()
                .putBoolean("enabled", enabled)
                .putString("apiUrl", normalizeApiUrl(apiUrl))
                .putBoolean("captureUser", captureUser)
                .putBoolean("captureAssistant", captureAssistant)
                .putBoolean("captureUnknown", captureUnknown)
                .putBoolean("clientRedaction", clientRedaction)
                .putInt("minChars", Math.max(1, minChars))
                .putInt("maxChars", Math.max(120, maxChars))
                .putString("targetPackages", targetPackages == null ? DEFAULT_TARGET_PACKAGES : targetPackages.trim())
                .apply();
    }

    static String normalizeApiUrl(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) return DEFAULT_API_URL;
        if (trimmed.endsWith("/api/hook-events")) return trimmed;
        return trimmed.replaceAll("/+$", "") + "/api/hook-events";
    }

    boolean shouldCapturePackage(String packageName) {
        String normalized = packageName == null ? "" : packageName.toLowerCase(Locale.ROOT);
        if (normalized.isEmpty()) return false;
        if (targetPackages.contains(normalized)) return true;
        return normalized.contains("doubao")
                || normalized.contains("chatgpt")
                || normalized.contains("openai")
                || normalized.contains("claude")
                || normalized.contains("gemini")
                || normalized.contains("bard")
                || normalized.contains("perplexity")
                || normalized.contains("poe")
                || normalized.contains("deepseek")
                || normalized.contains("kimi")
                || normalized.contains("tongyi")
                || normalized.contains("hunyuan")
                || normalized.contains("yuanbao")
                || normalized.contains("zhipu")
                || normalized.contains("wenxin");
    }

    private static Set<String> parsePackageList(String value) {
        Set<String> result = new HashSet<>();
        Arrays.stream(String.valueOf(value).split("[,\\n\\r\\t ]+"))
                .map(item -> item.trim().toLowerCase(Locale.ROOT))
                .filter(item -> !item.isEmpty())
                .forEach(result::add);
        return result;
    }
}

package ai.evomate.mobilehook;

import java.util.Locale;
import java.util.regex.Pattern;

final class TextTools {
    private static final Pattern EMAIL = Pattern.compile("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", Pattern.CASE_INSENSITIVE);
    private static final Pattern PHONE = Pattern.compile("\\b(?:\\+?\\d[\\d\\s().-]{7,}\\d)\\b");
    private static final Pattern API_KEY = Pattern.compile("sk-(?:evomap-)?[A-Za-z0-9_-]{16,}");
    private static final Pattern BEARER = Pattern.compile("Bearer\\s+[A-Za-z0-9._=-]{12,}", Pattern.CASE_INSENSITIVE);

    private TextTools() {}

    static String clean(String text) {
        return String.valueOf(text == null ? "" : text)
                .replace('\u00a0', ' ')
                .replaceAll("[ \\t]+", " ")
                .replaceAll("\\n{3,}", "\n\n")
                .trim();
    }

    static String redact(String text) {
        String value = clean(text);
        value = BEARER.matcher(value).replaceAll("Bearer [redacted]");
        value = API_KEY.matcher(value).replaceAll("sk-[redacted]");
        value = EMAIL.matcher(value).replaceAll("[email-redacted]");
        value = PHONE.matcher(value).replaceAll("[phone-redacted]");
        return value;
    }

    static String trimToLimit(String text, int limit) {
        String value = clean(text);
        if (value.length() <= limit) return value;
        return value.substring(0, Math.max(0, limit)) + "...";
    }

    static boolean isNoise(String text) {
        String normalized = normalizeForHash(text);
        if (normalized.isEmpty()) return true;
        if (normalized.matches("(?i)^(new chat|sign in|log in|upgrade|share|copy|regenerate|send|stop generating|发送|停止生成|复制|重新生成|新对话|登录)$")) {
            return true;
        }
        return normalized.length() < 3;
    }

    static String hash(String text) {
        long hash = 2166136261L;
        String value = String.valueOf(text == null ? "" : text);
        for (int i = 0; i < value.length(); i++) {
            hash ^= value.charAt(i);
            hash = (hash * 16777619L) & 0xffffffffL;
        }
        return String.format(Locale.ROOT, "%08x", hash);
    }

    static String normalizeForHash(String text) {
        String normalized = clean(text).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
        return normalized.substring(0, Math.min(normalized.length(), 3000));
    }
}

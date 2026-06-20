package ai.evomate.mobilehook;

import java.util.Locale;

final class ProviderDetector {
    private ProviderDetector() {}

    static String detect(String packageName) {
        String pkg = packageName == null ? "" : packageName.toLowerCase(Locale.ROOT);
        if (pkg.contains("larus") || pkg.contains("doubao")) return "doubao";
        if (pkg.contains("openai") || pkg.contains("chatgpt")) return "chatgpt";
        if (pkg.contains("anthropic") || pkg.contains("claude")) return "claude";
        if (pkg.contains("gemini") || pkg.contains("bard") || pkg.contains("google")) return "gemini";
        if (pkg.contains("perplexity")) return "perplexity";
        if (pkg.contains("poe")) return "poe";
        if (pkg.contains("deepseek")) return "deepseek";
        if (pkg.contains("moonshot") || pkg.contains("kimi")) return "kimi";
        if (pkg.contains("tongyi") || pkg.contains("alibaba")) return "tongyi";
        if (pkg.contains("hunyuan") || pkg.contains("yuanbao") || pkg.contains("tencent")) return "yuanbao";
        if (pkg.contains("zhipu")) return "zhipu";
        if (pkg.contains("wenxin") || pkg.contains("baidu")) return "wenxin";
        return "generic_mobile_ai";
    }
}

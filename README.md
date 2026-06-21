# EvoMate — EvoMap 自进化超级助理

EvoMate 是一个基于 **EvoMap / GEP / MCP** 的自进化 Agent sidecar。它不做另一个聊天框，而是观察 Codex、Claude Code、浏览器 AI、移动端分享等交互，把用户反馈转成可复用的行为进化资产。

核心主张：**进化不只是 prompt injection，而是 Memory Engineering + 工程层 MoE Router + GEP 资产固化。**


## 公网演示

稳定入口：

```text
https://evomate.yueanlab.com/mobile
https://evomate.yueanlab.com/graph
https://evomate.yueanlab.com/api/hook-events
```

这个域名走香港 GCE Nginx + HTTPS，后面反代 Cloud Run 的 `evomate-web` / `evomate-api`，比直接记 `.run.app` 更适合路演和手机快捷指令。

## 30 秒验收

先启动 API：

```bash
set -a; [ -f ./.env.local ] && . ./.env.local; set +a
EVOMATE_API_PORT=8787 npm run evomate:api
```

另开终端启动前端：

```bash
EVOMATE_WEB_PORT=3333 NEXT_PUBLIC_EVOMATE_API_URL=http://127.0.0.1:8787 npm run evomate:web
```

打开：

```text
http://127.0.0.1:3333/mobile
http://127.0.0.1:3333/graph
```

跑核心闭环 smoke：

```bash
npm run evomate:smoke
```

看到 `EVOMATE_SMOKE_OK` 代表：

```text
hook event
  -> advisor prepare
  -> Memory MoE route
  -> advisorPrompt 注入 MEM/GEP
  -> feedback 写 GEP Mutation/EvolutionEvent
  -> memory route 读回 GEP proof
```

## 路演评分点对应

### 1. EvoMap 融合度

- 使用 `@evomap/gep-sdk` 生成/校验 GEP asset id。
- feedback/outcome 写入 `Mutation`、`EvolutionEvent`，达到阈值后可 solidify `Capsule`。
- `npm run mcp:local` 可启动本地 GEP MCP server。
- `/api/memory/route` 会读取 GEP genes/capsules/events 作为 `gepProof`。

### 2. 技术创新性

EvoMate 的执行链路：

```text
Omni Hook Protocol
  -> Semantic Signal
  -> Memory Engineering MoE Router
  -> Behavior Gene / Policy Bandit
  -> Advisor Prompt Injection
  -> Outcome / Feedback
  -> GEP Asset Solidification
```

Memory Experts：

- `episodic`：最近会话、hook、工具上下文
- `procedural`：GEP capsule / workflow recipe
- `validation`：测试、命令结果、失败样本
- `repo`：Git、Terminal、本地项目文件
- `preference`：用户纠正、禁忌、yes/no 偏好
- `policy`：行为基因、reward、yesness 策略

### 3. 商业/应用潜力

EvoMate 适合作为 Codex / Claude Code / 浏览器 AI 的个人进化层：

- 不替换原 AI 工具，只做 sidecar hook。
- 低摩擦收集真实反馈。
- 把“这次太啰嗦 / 太冒进 / 没跑检查”等反馈变成下次可复用的工程记忆。
- 可扩展到团队共享 GEP 资产。

### 4. 完成度与表现力

- `/mobile`：手机演示入口，展示 Hook、Memory MoE、Yesness、Training、Feedback Dock。
- `/graph`：进化树视图，展示事件如何进入进化节点。
- `npm run evomate:smoke`：一键证明核心闭环活着。
- Browser Extension / Sidecar / Local Agent：多入口 hook。

## 常用命令

```bash
npm install
npm run evomate:api
npm run evomate:web
npm run evomate:smoke
npm run evomate:status -- --json
npm run evomate:check
NEXT_PUBLIC_EVOMATE_API_URL=http://127.0.0.1:8787 npm run build -w apps/web
```

可选 smoke 场景：

```bash
npm run evomate:smoke -- --scenario preference
npm run evomate:smoke -- --scenario validation --no-write
npm run evomate:smoke -- --scenario procedural --no-write
npm run evomate:smoke -- --scenario repo --no-write
```

默认 smoke 使用 fast advisor，避免现场被外部 LLM 网络延迟卡住。要验证真实 EvoMap LLM：

```bash
npm run evomate:smoke -- --llm
```

## 关键目录

```text
apps/api/                         # EvoMate API: hooks, advisor, feedback, Memory MoE, GEP writes
apps/web/                         # Next.js mobile dashboard + graph
apps/browser-extension/           # ChatGPT / Claude / Gemini / Doubao web hook
apps/local-agent/                 # 本地 Git/Terminal/桌面活动 hook
packages/evomate-sidecar/         # Codex / Claude Code hook CLI
packages/evomate-hooks/           # 统一 hook protocol
packages/evomate-core/            # behavior genes, policy/reward, semantic parser
assets/                           # GEP genes/capsules/events store (events ignored by git)
docs/EVOMATE_MEMORY_MOE.md        # Memory MoE 设计和验收说明
```

## 与旧实验代码的关系

仓库早期包含 `evo_predict_agent/` 的 capability benchmark 实验，用来验证 baseline vs evolved 的能力提升。当前路演主线已经切到 EvoMate：面向真实 Codex/Claude/browser/mobile 工作流的 runtime evolution sidecar。旧实验仍保留为辅助资产，不再是主叙事。

## 安全边界

- `.env.local` 被 gitignore，真实 EvoMap key 不提交。
- `memory/`、`assets/events.jsonl` 默认忽略，避免提交本地会话和反馈流水。
- Hook sidecar 会 redaction 常见 token / secret 字段。

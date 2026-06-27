<p align="center">
  <h1 align="center">Tokboard</h1>
  <p align="center">一个本地优先的 Obsidian AI Token 用量看板</p>
</p>

<p align="center">
  <a href="https://github.com/2488652el/Tokboard/releases/tag/0.1.0"><img alt="Release" src="https://img.shields.io/github/v/release/2488652el/Tokboard?style=flat-square"></a>
  <a href="https://github.com/2488652el/Tokboard/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/2488652el/Tokboard?style=flat-square"></a>
  <img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.5%2B-7C3AED?style=flat-square">
  <img alt="Desktop only" src="https://img.shields.io/badge/Desktop-only-64748B?style=flat-square">
</p>

<p align="center">
  在 Obsidian 里集中查看 AI API 余额、Token Plan、Coding Plan、模型级 Token 用量、热力图和趋势图。
</p>

---

## 为什么做 Tokboard

如果你同时使用 DeepSeek、OpenAI、Codex、Gemini、Kimi、MiniMax、GLM、火山方舟等多个模型或 Coding Plan，最麻烦的事情往往不是调用 API，而是到处打开控制台查：

- 今天用了多少 Token？
- 哪个模型用得最多？
- Coding Plan 的 5 小时 / 周额度还剩多少？
- 哪个供应商余额快没了？
- 本地 Codex 会话到底消耗了多少？

**Tokboard 把这些信息收进 Obsidian，一个面板里看完。**

---

## 功能概览

| 能力 | 说明 |
|---|---|
| 统一看板 | 在 Obsidian 里查看 AI API 用量、余额、Token Plan 和 Coding Plan |
| 模型级统计 | 总用量、最常用模型、7/30 天趋势、模型占比和小时热力图 |
| 简洁详情卡 | 优先显示 Token 消耗、余额、剩余额度百分比等关键指标 |
| Coding Plan | 支持 Kimi、智谱 GLM、MiniMax、火山方舟等套餐窗口查询思路 |
| Codex 本地用量 | 解析本机 Codex JSONL 会话日志，不需要 OpenAI Admin Key |
| OpenAI Admin | 查询 OpenAI Organization Usage API 的模型级用量 |
| Gemini best-effort | 支持连接测试和 `countTokens`，不伪造历史总用量 |
| 主题自适应 | 跟随 Obsidian 背景、边框、文字和强调色变量 |
| 加密归档 | 可选把用量快照加密保存到 vault，交给同步工具异地保存 |

---

## 界面结构

Tokboard 是一个紧凑的监控面板。

```text
顶部统计卡
  总 Token / 已添加模型 / 采样次数 / 活跃天数 / 最常用模型

活跃热力图
  最近 7 天小时级调用密度，悬停显示模型与 Token 数

趋势与占比
  每日 Token 趋势图 + 模型用量圆环图

模型与 Coding Plan 详情
  每个供应商独立卡片，显示主指标、额度窗口、重置时间、错误信息
```

设计原则：

- 少展示废话字段，例如“是否可用”会被状态点取代。
- Coding Plan 已有“5 小时剩余”时，不再重复显示“5 小时已用”。
- 主指标优先显示真正有判断价值的数字。
- 图表颜色尽量使用 Obsidian 主题变量，适配亮色和暗色主题。

---

## 支持范围

Tokboard 不会把猜测写成事实。能通过公开接口查询的就展示真实数据；普通 API Key 无法查询历史用量的，会明确标记为受限或 best-effort。

| 供应商 | 状态 | 查询内容 |
|---|---:|---|
| DeepSeek | 支持 | `/user/balance` 账户余额 |
| StepFun | 支持 | `/accounts` 账户余额 |
| SiliconFlow | 支持 | `/user/info` 账户余额 |
| OpenRouter | 支持 | `/credits` credits 与 usage |
| Novita AI | 支持 | `/user/balance` 账户余额 |
| Kimi For Coding | 支持 | 5 小时、周 Token Plan 窗口 |
| 智谱 GLM Coding | 支持 | Token Plan quota limit 窗口 |
| MiniMax Coding | 支持 | Coding Plan 剩余百分比 |
| 火山方舟 Coding / Agent Plan | 支持 | 控制台 cURL 解析 + OpenAPI 备选 |
| Codex 本地会话 | 支持 | `~/.codex` JSONL token_count 事件 |
| OpenAI Admin / GPT-5 用量 | 支持 | Organization Usage completions API |
| Google Gemini | best-effort | API 连接测试与 `countTokens`；历史用量需要 Google Cloud Monitoring |
| Moonshot / Kimi | best-effort | 可用时查询余额端点 |
| OpenAI-compatible | best-effort | 可用时查询兼容余额 / credit 端点 |
| Anthropic / DashScope | 受限 | 普通模型 API Key 通常不能直接查询账号用量 |

更详细的说明见 [docs/provider-matrix.md](docs/provider-matrix.md)。

---

## 安全边界

Tokboard 默认本地优先，不上传你的密钥。

| 项目 | 处理方式 |
|---|---|
| API Key | 默认只保存在 Obsidian 插件数据 `data.json` |
| 环境变量 | 可以不填 Key，只填环境变量名，让插件从本机读取 |
| 笔记正文 | 不写入 API Key |
| 日志 | 不记录 API Key |
| 加密归档 | 只保存用量快照和历史，不保存密钥 |
| 单供应商失败 | 不影响其他供应商刷新 |

请不要提交这些内容：

- vault 里的插件 `data.json`
- `.env` 文件
- 真实 API Key
- 控制台复制出来的带 Cookie / CSRF 的 cURL
- `*.enc` 加密归档文件

项目已提供 `.gitignore` 来避免误传常见本地数据。

---

## 手动安装

在 Tokboard 正式进入 Obsidian 第三方插件商店之前，可以手动安装。

1. 打开 [Releases](https://github.com/2488652el/Tokboard/releases)。
2. 下载最新版本中的三个文件：

   ```text
   manifest.json
   main.js
   styles.css
   ```

3. 在你的 vault 中创建目录：

   ```text
   .obsidian/plugins/tokboard/
   ```

4. 把三个文件放进去。
5. 重启 Obsidian，或重新加载第三方插件。
6. 在 `设置 -> 第三方插件` 中启用 **Tokboard**。

---

## 开发

```bash
npm install
npm run build
```

复制到当前开发 vault：

```bash
npm run copy-to-vault
```

该命令会复制：

```text
main.js
manifest.json
styles.css
```

到：

```text
.obsidian/plugins/tokboard/
```

发布前建议运行：

```bash
npm run lint
npm run build
```

---

## 进入 Obsidian 第三方插件商店

要让 Tokboard 能在 Obsidian 第三方插件商店被搜索到，需要走官方社区插件流程：

1. GitHub 仓库保持公开。
2. 创建 GitHub Release，并上传：

   ```text
   manifest.json
   main.js
   styles.css
   ```

3. 确认插件 ID 稳定为 `tokboard`。
4. Fork `obsidianmd/obsidian-releases`。
5. 在 `community-plugins.json` 中添加：

   ```json
   {
     "id": "tokboard",
     "name": "Tokboard",
     "author": "LLM-WIKI",
     "description": "Local-first token usage board for AI API keys, coding plans, quota windows, and model-level history.",
     "repo": "2488652el/Tokboard"
   }
   ```

6. 向 `obsidianmd/obsidian-releases` 提交 PR。
7. 等待 Obsidian 审核。通过后，Tokboard 会出现在 Obsidian 第三方插件商店搜索结果中。

官方仓库：

<https://github.com/obsidianmd/obsidian-releases>

---

## 致谢

Tokboard 的供应商查询分类和本地会话用量解析思路参考了 CC Switch。

- CC Switch 用量查询文档：<https://ccswitch.io/zh/docs?section=providers&item=usage-query>
- CC Switch 仓库：<https://github.com/farion1231/cc-switch>

---

## License

MIT

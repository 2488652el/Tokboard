# Provider 能力矩阵

| Provider | 默认 Base URL | 额度查询状态 | 端点 | 说明 |
|---|---|---|---|---|
| Mock Provider | `https://example.invalid` | supported | none | UI 和设置流程测试，不发起真实请求。 |
| DeepSeek | `https://api.deepseek.com` | supported | `/user/balance` | 返回账户余额和可用状态。 |
| StepFun | `https://api.stepfun.com/v1` | supported | `/accounts` | 参考 CC Switch 官方余额模板，返回账户余额。 |
| SiliconFlow | `https://api.siliconflow.cn/v1` | supported | `/user/info` | 参考 CC Switch 官方余额模板，支持 CN/EN 域名币种差异。 |
| Moonshot / Kimi | `https://api.moonshot.cn/v1` | best-effort | `/users/me/balance` | 返回余额字段；不是模型级 Token Plan。 |
| OpenRouter | `https://openrouter.ai/api/v1` | supported | `/credits` | 参考 CC Switch 官方余额模板，返回 total_credits 和 total_usage。 |
| Novita AI | `https://api.novita.ai/v3` | supported | `/user/balance` | 参考 CC Switch 官方余额模板，availableBalance 除以 10000 转 USD。 |
| Kimi For Coding | `https://api.kimi.com/coding` | supported | `/v1/usages` | 参考 CC Switch Token Plan 模板，展示 5 小时和周额度。 |
| Zhipu GLM Coding | `https://open.bigmodel.cn/api/paas/v4` | supported | `/api/monitor/usage/quota/limit` | 参考 CC Switch Token Plan 模板，Authorization 不加 Bearer。 |
| MiniMax Coding | `https://api.minimaxi.com` | supported | `/v1/api/openplatform/coding_plan/remains` | 参考 CC Switch Token Plan 模板，剩余百分比转换为已用百分比。 |
| OpenAI / Compatible | `https://api.openai.com` | best-effort | `/dashboard/billing/credit_grants` | 兼容供应商可能支持；官方 OpenAI 普通 key 可能不可用。 |
| Codex 本地会话用量 | `~/.codex` | supported | `sessions/**/*.jsonl` + `archived_sessions/*.jsonl` | 参考 CC Switch v3.13+，解析本机 Codex JSONL session logs 的 `token_count` 事件，不需要 Admin Key。 |
| OpenAI Admin / GPT-5 用量 | `https://api.openai.com` | supported | `/v1/organization/usage/completions` | 需要 OpenAI Admin API Key；按天、按模型查询 GPT-5/GPT-5-Codex 等 API token 和请求量，并写入 Dashboard 历史图表。 |
| Anthropic | `https://api.anthropic.com` | unsupported | none | 普通模型 API Key + Base URL 通常不能直接查询 Token Plan。 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | best-effort | `/models/gemini-2.5-flash:countTokens` | API Key 可做连接测试和单次 token 计数；历史总用量需要 Google Cloud Monitoring，账单额度需要 Cloud Billing 权限。 |
| Alibaba DashScope | `https://dashscope.aliyuncs.com` | unsupported | none | 套餐和余额通常依赖阿里云控制台。 |
| Volcengine Coding / Agent Plan | `https://ark.cn-beijing.volces.com/api/coding` | supported | Console `GetCodingPlanUsage` cURL + OpenAPI fallback | Coding Plan 推荐复制火山控制台 Network 的 `GetCodingPlanUsage` cURL；AK/SK 签名作为备选。普通推理 API Key + Base URL 不足以查询套餐。 |

## 适配规则

- 能通过 API Key + Base URL 查询的供应商显示真实字段。
- 只能通过控制台或 Admin API 查询的供应商显示受限状态。
- 不把推断写成额度事实。
- 每个供应商请求独立执行，失败不会影响其他供应商。

## CC Switch 对齐点

- 自动订阅额度和普通供应商查询分离。
- 普通供应商需要显式启用查询。
- Token Plan 与余额查询分开建模，避免同一供应商既能查套餐又能查余额时自动猜错。
- 参考来源：<https://ccswitch.io/zh/docs?section=providers&item=usage-query>、<https://github.com/farion1231/cc-switch>。

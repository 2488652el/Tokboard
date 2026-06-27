import { createHash, createHmac } from "crypto";
import { readdir, readFile, stat } from "fs/promises";
import { homedir } from "os";
import { join as joinPath } from "path";
import { ProviderAdapter, ProviderContext, UsageHistorySample } from "../types";
import { enabledKeyMissing, formatCurrency, formatNumber, formatPercent, formatResetTime, joinUrl, result } from "./utils";

interface BalanceInfo {
  currency?: string;
  total_balance?: string;
  granted_balance?: string;
  topped_up_balance?: string;
}

interface QuotaTier {
  name: string;
  modelName?: string;
  utilization: number;
  remainingPercent: number;
  remainingTokens?: number;
  tokenLimit?: number;
  resetsAt?: string;
  usedValueUsd?: number;
  maxValueUsd?: number;
}

interface OpenAIUsageBucket {
  start_time?: number;
  end_time?: number;
  results?: Array<{
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    input_cached_tokens?: number;
    num_model_requests?: number;
  }>;
}

interface OpenAIUsageResponse {
  data?: OpenAIUsageBucket[];
}

export const PROVIDERS: ProviderAdapter[] = [
  {
    id: "mock",
    displayName: "Mock Provider",
    defaultBaseUrl: "https://example.invalid",
    homepage: "https://example.invalid",
    directQuotaSupport: "supported",
    requiredCredential: "任意测试字符串",
    description: "本地 UI 验证用，不发起真实网络请求。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      return result(this.id, this.displayName, "ready", [
        { label: "Token 套餐", value: "演示套餐" },
        { label: "剩余 Token", value: "1,000,000" },
        { label: "请求次数", value: "42" },
        { label: "Base URL", value: context.baseUrl }
      ], "Mock 数据用于确认 Dashboard、设置持久化和刷新流程。");
    }
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    homepage: "https://platform.deepseek.com",
    directQuotaSupport: "supported",
    requiredCredential: "DeepSeek API Key",
    description: "通过 /user/balance 查询账户余额。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ is_available?: boolean; balance_infos?: BalanceInfo[] }>({
        url: joinUrl(context.baseUrl, "/user/balance"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`
        }
      });
      const balances = data.balance_infos ?? [];
      const primary = balances[0] ?? {};

      return result(this.id, this.displayName, "ready", [
        { label: "是否可用", value: data.is_available === false ? "否" : "是" },
        { label: "币种", value: primary.currency ?? "无数据" },
        { label: "总余额", value: formatCurrency(primary.total_balance, primary.currency ?? "CNY") },
        { label: "赠送余额", value: formatCurrency(primary.granted_balance, primary.currency ?? "CNY") },
        { label: "充值余额", value: formatCurrency(primary.topped_up_balance, primary.currency ?? "CNY") }
      ], balances.length > 1 ? `返回 ${balances.length} 个币种/账户余额。` : "余额来自供应商账户接口。");
    }
  },
  {
    id: "stepfun",
    displayName: "StepFun",
    defaultBaseUrl: "https://api.stepfun.com/v1",
    homepage: "https://platform.stepfun.com",
    directQuotaSupport: "supported",
    requiredCredential: "StepFun API Key",
    description: "参考 CC Switch 官方余额模板，通过 /accounts 查询账户余额。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ balance?: number | string; total_cash_balance?: number | string; total_voucher_balance?: number | string; type?: string }>({
        url: joinUrl(context.baseUrl, "/accounts"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          Accept: "application/json"
        }
      });

      return result(this.id, this.displayName, "ready", [
        { label: "套餐", value: data.type ?? "StepFun" },
        { label: "余额", value: formatCurrency(data.balance, "CNY") },
        { label: "现金余额", value: formatCurrency(data.total_cash_balance, "CNY") },
        { label: "代金券余额", value: formatCurrency(data.total_voucher_balance, "CNY") },
        { label: "单位", value: "CNY" }
      ], "余额查询方式参考 CC Switch: GET /v1/accounts。");
    }
  },
  {
    id: "siliconflow",
    displayName: "SiliconFlow",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    homepage: "https://cloud.siliconflow.cn",
    directQuotaSupport: "supported",
    requiredCredential: "SiliconFlow API Key",
    description: "参考 CC Switch 官方余额模板，通过 /user/info 查询账户余额。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ data?: { balance?: number | string; chargeBalance?: number | string; totalBalance?: number | string; status?: string } }>({
        url: joinUrl(context.baseUrl, "/user/info"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          Accept: "application/json"
        }
      });
      const balance = data.data ?? {};
      const unit = context.baseUrl.toLowerCase().includes("siliconflow.com") ? "USD" : "CNY";

      return result(this.id, this.displayName, "ready", [
        { label: "状态", value: balance.status ?? "无数据" },
        { label: "余额", value: formatCurrency(balance.balance, unit) },
        { label: "充值余额", value: formatCurrency(balance.chargeBalance, unit) },
        { label: "总额", value: formatCurrency(balance.totalBalance, unit) },
        { label: "单位", value: unit }
      ], "支持 api.siliconflow.cn 与 api.siliconflow.com。");
    }
  },
  {
    id: "moonshot",
    displayName: "Moonshot / Kimi",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    homepage: "https://platform.moonshot.cn",
    directQuotaSupport: "best-effort",
    requiredCredential: "Moonshot API Key",
    description: "尝试通过 /users/me/balance 查询余额。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ data?: { available_balance?: number | string; voucher_balance?: number | string; cash_balance?: number | string; currency?: string } }>({
        url: joinUrl(context.baseUrl, "/users/me/balance"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`
        }
      });
      const balance = data.data ?? {};

      return result(this.id, this.displayName, "ready", [
        { label: "币种", value: balance.currency ?? "CNY" },
        { label: "可用余额", value: formatCurrency(balance.available_balance, balance.currency ?? "CNY") },
        { label: "代金券余额", value: formatCurrency(balance.voucher_balance, balance.currency ?? "CNY") },
        { label: "现金余额", value: formatCurrency(balance.cash_balance, balance.currency ?? "CNY") }
      ], "Moonshot 返回的是账户余额，不是模型级 Token Plan。");
    }
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    homepage: "https://openrouter.ai",
    directQuotaSupport: "supported",
    requiredCredential: "OpenRouter API Key",
    description: "参考 CC Switch 官方余额模板，通过 /credits 查询 credits 和 usage。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ data?: { total_credits?: number | string; total_usage?: number | string } }>({
        url: joinUrl(context.baseUrl, "/credits"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          Accept: "application/json"
        }
      });
      const credits = data.data ?? {};
      const totalCredits = Number(credits.total_credits ?? 0);
      const totalUsage = Number(credits.total_usage ?? 0);
      const remaining = totalCredits - totalUsage;

      return result(this.id, this.displayName, "ready", [
        { label: "剩余额度", value: formatCurrency(remaining) },
        { label: "总额度", value: formatCurrency(totalCredits) },
        { label: "已用额度", value: formatCurrency(totalUsage) },
        { label: "是否可用", value: remaining > 0 ? "是" : "否" }
      ], "OpenRouter credits 查询方式参考 CC Switch: GET /api/v1/credits。");
    }
  },
  {
    id: "novita",
    displayName: "Novita AI",
    defaultBaseUrl: "https://api.novita.ai/v3",
    homepage: "https://novita.ai",
    directQuotaSupport: "supported",
    requiredCredential: "Novita AI API Key",
    description: "参考 CC Switch 官方余额模板，通过 /user/balance 查询余额。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ availableBalance?: number | string; cashBalance?: number | string; creditLimit?: number | string; outstandingInvoices?: number | string }>({
        url: joinUrl(context.baseUrl, "/user/balance"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          Accept: "application/json"
        }
      });
      const available = Number(data.availableBalance ?? 0) / 10000;

      return result(this.id, this.displayName, "ready", [
        { label: "可用余额", value: formatCurrency(available) },
        { label: "现金余额原始值", value: formatNumber(data.cashBalance) },
        { label: "授信额度原始值", value: formatNumber(data.creditLimit) },
        { label: "未结发票原始值", value: formatNumber(data.outstandingInvoices) }
      ], "Novita 金额单位参考 CC Switch，availableBalance 除以 10000 转为 USD。");
    }
  },
  {
    id: "kimi-coding",
    displayName: "Kimi For Coding",
    defaultBaseUrl: "https://api.kimi.com/coding",
    homepage: "https://platform.moonshot.cn",
    directQuotaSupport: "supported",
    requiredCredential: "Kimi Coding API Key",
    description: "参考 CC Switch Token Plan 模板，通过 /v1/usages 查询 5 小时和周额度。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ limits?: Array<{ detail?: { limit?: number | string; remaining?: number | string; resetTime?: string | number } }>; usage?: { limit?: number | string; remaining?: number | string; resetTime?: string | number } }>({
        url: joinUrl(context.baseUrl, "/v1/usages"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          Accept: "application/json"
        }
      });
      const tiers: QuotaTier[] = [];
      for (const item of data.limits ?? []) {
        const detail = item.detail;
        if (!detail) {
          continue;
        }
        tiers.push(limitRemainingTier("5 小时", detail.limit, detail.remaining, detail.resetTime));
      }
      if (data.usage) {
        tiers.push(limitRemainingTier("周", data.usage.limit, data.usage.remaining, data.usage.resetTime));
      }

      return quotaTierResult(this.id, this.displayName, tiers, "Kimi Token Plan 查询方式参考 CC Switch: GET /coding/v1/usages。");
    }
  },
  {
    id: "zhipu-coding",
    displayName: "Zhipu GLM Coding",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    homepage: "https://open.bigmodel.cn",
    directQuotaSupport: "supported",
    requiredCredential: "Zhipu API Key",
    description: "参考 CC Switch Token Plan 模板，通过 /api/monitor/usage/quota/limit 查询套餐额度。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const quotaBase = context.baseUrl.toLowerCase().includes("bigmodel.cn") ? "https://open.bigmodel.cn" : "https://api.z.ai";
      const data = await context.requestJson<{ data?: { packageType?: string; limits?: Array<{ type?: string; percentage?: number; nextResetTime?: number | string; unit?: number }> } }>({
        url: joinUrl(quotaBase, "/api/monitor/usage/quota/limit"),
        method: "GET",
        headers: {
          Authorization: context.apiKey,
          "Content-Type": "application/json",
          "Accept-Language": "en-US,en"
        }
      });
      const tiers = parseZhipuTiers(data.data);

      return quotaTierResult(this.id, this.displayName, tiers, `套餐：${data.data?.packageType ?? "N/A"}。智谱鉴权参考 CC Switch，不加 Bearer 前缀。`);
    }
  },
  {
    id: "minimax-coding",
    displayName: "MiniMax Coding",
    defaultBaseUrl: "https://api.minimaxi.com",
    homepage: "https://www.minimaxi.com",
    directQuotaSupport: "supported",
    requiredCredential: "MiniMax API Key",
    description: "参考 CC Switch Token Plan 模板，通过 /v1/api/openplatform/coding_plan/remains 查询套餐额度。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const domain = context.baseUrl.toLowerCase().includes("minimax.io") ? "https://api.minimax.io" : "https://api.minimaxi.com";
      const data = await context.requestJson<MiniMaxCodingPlanResponse>({
        url: joinUrl(domain, "/v1/api/openplatform/coding_plan/remains"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          "Content-Type": "application/json"
        }
      });
      const tiers = parseMiniMaxTiers(data);

      return quotaTierResult(this.id, this.displayName, tiers, "MiniMax Token Plan 使用剩余百分比展示额度；兼容 model_name/current_interval_remaining_percent 与旧字段。");
    }
  },
  {
    id: "openai-compatible",
    displayName: "OpenAI / Compatible",
    defaultBaseUrl: "https://api.openai.com",
    homepage: "https://platform.openai.com",
    directQuotaSupport: "best-effort",
    requiredCredential: "OpenAI 或 OpenAI-compatible API Key",
    description: "尝试常见 credit grants 端点；官方 OpenAI 可能需要组织/Admin 权限或不再支持普通 key 查询。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ total_granted?: number; total_used?: number; total_available?: number; object?: string }>({
        url: joinUrl(context.baseUrl, "/dashboard/billing/credit_grants"),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`
        }
      });

      return result(this.id, this.displayName, "ready", [
        { label: "总授信", value: formatCurrency(data.total_granted) },
        { label: "已用额度", value: formatCurrency(data.total_used) },
        { label: "可用余额", value: formatCurrency(data.total_available) },
        { label: "响应类型", value: data.object ?? "credit_grants" }
      ], "这是 best-effort 兼容接口；如果供应商关闭该端点，请在卡片错误中查看 HTTP 状态。");
    }
  },
  {
    id: "codex-local-usage",
    displayName: "Codex 本地会话用量",
    defaultBaseUrl: "~/.codex",
    homepage: "https://developers.openai.com/codex",
    directQuotaSupport: "supported",
    requiredCredential: "本机 Codex 会话目录",
    description: "参考 CC Switch v3.13+，解析 ~/.codex/sessions 与 archived_sessions 里的 JSONL token_count 事件。",
    async fetchQuota(context) {
      const codexDir = expandHome(context.baseUrl || "~/.codex");
      const summary = await parseCodexLocalUsage(codexDir);
      const top = summary.modelTotals[0];

      return {
        ...result(this.id, this.displayName, summary.totalTokens > 0 ? "ready" : "limited", [
          { label: "总 Token", value: formatNumber(summary.totalTokens) },
          { label: "输入 Token", value: formatNumber(summary.inputTokens) },
          { label: "缓存输入 Token", value: formatNumber(summary.cachedInputTokens) },
          { label: "输出 Token", value: formatNumber(summary.outputTokens) },
          { label: "会话事件", value: formatNumber(summary.events) },
          { label: "扫描文件", value: formatNumber(summary.filesScanned) },
          { label: "最常用模型", value: top ? `${top.providerName} (${formatPercent((top.value / Math.max(summary.totalTokens, 1)) * 100)})` : "无数据" }
        ], `读取 ${codexDir}。参考 CC Switch：从 Codex JSONL session logs 解析 token_count，而不是调用 OpenAI Admin API。`),
        historySamples: summary.historySamples
      };
    }
  },
  {
    id: "openai-admin-usage",
    displayName: "OpenAI Admin / GPT-5 用量",
    defaultBaseUrl: "https://api.openai.com",
    homepage: "https://platform.openai.com/usage",
    directQuotaSupport: "supported",
    requiredCredential: "OpenAI Admin API Key",
    description: "使用 OpenAI Organization Usage API 查询 GPT-5、GPT-5-Codex 等模型的每日 token 和请求量。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<OpenAIUsageResponse>({
        url: openAIAdminUsageUrl(context.baseUrl),
        method: "GET",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          Accept: "application/json"
        }
      });
      const summary = summarizeOpenAIUsage(data.data ?? [], this.id);
      const top = summary.modelTotals[0];

      return {
        ...result(this.id, this.displayName, summary.totalTokens > 0 ? "ready" : "limited", [
          { label: "总 Token", value: formatNumber(summary.totalTokens) },
          { label: "输入 Token", value: formatNumber(summary.inputTokens) },
          { label: "输出 Token", value: formatNumber(summary.outputTokens) },
          { label: "缓存输入 Token", value: formatNumber(summary.cachedInputTokens) },
          { label: "请求次数", value: formatNumber(summary.requests) },
          { label: "最常用模型", value: top ? `${top.providerName} (${formatPercent((top.value / Math.max(summary.totalTokens, 1)) * 100)})` : "无数据" }
        ], "OpenAI Admin Usage API：按天、按模型查询最近 30 天 completions 用量。需要组织级 Admin API Key；ChatGPT/Codex 产品订阅用量仍需在 Codex Usage Dashboard 查看。"),
        historySamples: summary.historySamples
      };
    }
  },
  unsupportedProvider(
    "anthropic",
    "Anthropic",
    "https://api.anthropic.com",
    "https://console.anthropic.com",
    "Anthropic 的 usage/cost 更偏 Admin API；普通模型 API Key + Base URL 通常不能直接查询 Token Plan。"
  ),
  {
    id: "gemini",
    displayName: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    homepage: "https://aistudio.google.com",
    directQuotaSupport: "best-effort",
    requiredCredential: "Gemini API Key",
    description: "Gemini API Key 可用于 countTokens 连通性测试；历史总用量和账单需要 Google Cloud Monitoring/Billing 权限。",
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(this.id, this.displayName);
      }

      const data = await context.requestJson<{ totalTokens?: number; totalBillableCharacters?: number }>({
        url: joinUrl(geminiApiBase(context.baseUrl), "/models/gemini-2.5-flash:countTokens"),
        method: "POST",
        headers: {
          "x-goog-api-key": context.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: "API usage dashboard connectivity check." }]
          }]
        })
      });

      return result(this.id, this.displayName, "limited", [
        { label: "连接状态", value: "API Key 可用" },
        { label: "本次测试 Token", value: formatNumber(data.totalTokens) },
        { label: "历史用量", value: "需要 Cloud Monitoring" },
        { label: "账单额度", value: "需要 Cloud Billing" }
      ], "Gemini 模型 API Key 不能直接查询账号历史总 token 或剩余额度；插件已用 countTokens 验证连接。若要自动汇总历史用量，需要后续新增 Google Cloud OAuth/Service Account 模式。");
    }
  },
  unsupportedProvider(
    "dashscope",
    "Alibaba DashScope",
    "https://dashscope.aliyuncs.com",
    "https://dashscope.console.aliyun.com",
    "DashScope 的账户余额/套餐通常走阿里云控制台，不保证存在可公开调用的 Token Plan API。"
  ),
  {
    id: "volcengine-coding",
    displayName: "Volcengine Coding / Agent Plan",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    homepage: "https://console.volcengine.com/ark",
    directQuotaSupport: "supported",
    requiredCredential: "Console GetCodingPlanUsage cURL 或 Volcengine AK/SK",
    description: "Coding Plan 推荐导入火山控制台 GetCodingPlanUsage cURL；AK/SK OpenAPI 作为备选，不是推理 API Key。",
    async fetchQuota(context) {
      const curl = context.config.usageCurl.trim();
      const accessKeyId = context.config.accessKeyId.trim();
      const secretAccessKey = context.config.secretAccessKey.trim();

      if (curl) {
        try {
          const consoleResponse = await volcengineConsoleCurlCall(context, curl);
          const consoleTiers = parseVolcengineCodingTiers((consoleResponse.Result ?? consoleResponse) as Record<string, unknown>);
          if (consoleTiers.length) {
            return quotaTierResult(this.id, this.displayName, consoleTiers, "Volcengine Coding Plan。来源：火山控制台 GetCodingPlanUsage cURL。");
          }
        } catch (error) {
          if (!accessKeyId || !secretAccessKey) {
            throw error;
          }
        }
      }

      if (!accessKeyId || !secretAccessKey) {
        return result(this.id, this.displayName, "unconfigured", [], "火山 Coding Plan 推荐粘贴控制台 GetCodingPlanUsage cURL；备选才需要火山账号 AccessKey ID 和 Secret AccessKey。");
      }

      const region = volcengineRegion(context.baseUrl);
      const afp = await volcengineOpenApiCall(context, region, accessKeyId, secretAccessKey, "GetAFPUsage");
      const afpTiers = parseVolcengineAfpTiers((afp.Result ?? afp) as Record<string, unknown>);
      if (afpTiers.length) {
        return quotaTierResult(this.id, this.displayName, afpTiers, `Agent Plan ${String(((afp.Result as Record<string, unknown> | undefined)?.PlanType ?? "")).trim() || ""}`.trim());
      }

      const coding = await volcengineOpenApiCall(context, region, accessKeyId, secretAccessKey, "GetCodingPlanUsage");
      const codingTiers = parseVolcengineCodingTiers((coding.Result ?? coding) as Record<string, unknown>);
      if (codingTiers.length) {
        return quotaTierResult(this.id, this.displayName, codingTiers, "Volcengine Coding Plan。");
      }

      return result(this.id, this.displayName, "limited", [
        { label: "套餐", value: "没有可用的 Agent/Coding Plan" },
        { label: "区域", value: region }
      ], "AK/SK 签名成功，但没有解析到已订阅的 Agent Plan 或 Coding Plan。");
    }
  }
];

interface MiniMaxCodingPlanItem {
  model_name?: string;
  model_type?: string;
  current_interval_remaining_percent?: number | string;
  current_session_remaining_percent?: number | string;
  current_weekly_remaining_percent?: number | string;
  current_weekly_status?: number;
  end_time?: number | string;
  session_reset_time?: number | string;
  weekly_end_time?: number | string;
  weekly_reset_time?: number | string;
}

interface MiniMaxCodingPlanResponse {
  model_remains?: MiniMaxCodingPlanItem[];
}

const VOLCENGINE_OPENAPI_HOST = "open.volcengineapi.com";
const VOLCENGINE_API_VERSION = "2024-01-01";
const VOLCENGINE_SERVICE = "ark";
const VOLCENGINE_CONTENT_TYPE = "application/json";
const VOLCENGINE_SIGNED_HEADERS = "content-type;host;x-content-sha256;x-date";

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function limitRemainingTier(name: string, limitValue: unknown, remainingValue: unknown, resetValue: unknown, modelName?: string): QuotaTier {
  const limit = numberValue(limitValue, 1);
  const remaining = numberValue(remainingValue, 0);
  const used = Math.max(limit - remaining, 0);
  const utilization = limit > 0 ? (used / limit) * 100 : 0;
  const remainingPercent = limit > 0 ? (remaining / limit) * 100 : 0;

  return {
    name,
    modelName,
    utilization,
    remainingPercent,
    remainingTokens: remaining,
    tokenLimit: limit,
    resetsAt: formatResetTime(resetValue)
  };
}

function quotaTierResult(providerId: string, providerName: string, tiers: QuotaTier[], note: string) {
  if (!tiers.length) {
    return result(providerId, providerName, "limited", [
      { label: "套餐", value: "没有可用套餐" }
    ], `${note} 未从响应中解析到套餐窗口。`);
  }

  const modelNames = [...new Set(tiers.map((tier) => normalizedModelName(tier.modelName)).filter((name): name is string => Boolean(name)))];
  const metrics = tiers.flatMap((tier) => {
    const tierMetrics = [
      { label: `${tier.name}剩余`, value: formatPercent(tier.remainingPercent) },
      { label: `${tier.name}已用`, value: formatPercent(tier.utilization) }
    ];

    if (tier.remainingTokens !== undefined) {
      tierMetrics.push({ label: `${tier.name}剩余 Token`, value: formatNumber(tier.remainingTokens) });
    }

    tierMetrics.push({ label: `${tier.name}重置`, value: tier.resetsAt ?? "无数据" });
    return tierMetrics;
  });

  metrics.unshift({ label: "调用模型", value: modelNames.length ? modelNames.join(" / ") : "接口未返回具体模型" });

  return result(providerId, providerName, "ready", metrics, note);
}

function normalizedModelName(modelName?: string): string | null {
  const value = modelName?.trim();
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (
    normalized === "general"
    || normalized.includes(" coding")
    || normalized.endsWith("coding")
    || normalized.includes("agent plan")
    || normalized.includes("token plan")
  ) {
    return null;
  }

  return value;
}

function parseZhipuTiers(data?: { limits?: Array<{ type?: string; percentage?: number; nextResetTime?: number | string; unit?: number }> }): QuotaTier[] {
  const limits = (data?.limits ?? []).filter((item) => (item.type ?? "").toLowerCase() === "tokens_limit");
  const fiveHour = limits.find((item) => item.unit === 3) ?? limits[0];
  const weekly = limits.find((item) => item.unit === 6) ?? limits.find((item) => item !== fiveHour);
  const tiers: QuotaTier[] = [];

  if (fiveHour) {
    tiers.push({
      name: "5 小时",
      utilization: numberValue(fiveHour.percentage),
      remainingPercent: 100 - numberValue(fiveHour.percentage),
      resetsAt: formatResetTime(fiveHour.nextResetTime)
    });
  }

  if (weekly) {
    tiers.push({
      name: "周",
      utilization: numberValue(weekly.percentage),
      remainingPercent: 100 - numberValue(weekly.percentage),
      resetsAt: formatResetTime(weekly.nextResetTime)
    });
  }

  return tiers;
}

function parseMiniMaxTiers(data: MiniMaxCodingPlanResponse): QuotaTier[] {
  const modelRemains = data.model_remains ?? [];
  const general = modelRemains.find((item) => ((item.model_name ?? item.model_type ?? "").toLowerCase() === "general"))
    ?? modelRemains.find((item) => !["video", "image"].includes((item.model_name ?? item.model_type ?? "").toLowerCase()));
  if (!general) {
    return [];
  }

  const tiers: QuotaTier[] = [];
  const modelName = general.model_name ?? general.model_type ?? "MiniMax Coding";
  const intervalRemainingPercent = general.current_interval_remaining_percent ?? general.current_session_remaining_percent;
  if (intervalRemainingPercent !== undefined) {
    const remainingPercent = numberValue(intervalRemainingPercent);
    tiers.push({
      name: "5 小时",
      modelName,
      utilization: 100 - remainingPercent,
      remainingPercent,
      resetsAt: formatResetTime(general.end_time ?? general.session_reset_time)
    });
  }
  if (general.current_weekly_status === 1 && general.current_weekly_remaining_percent !== undefined) {
    const remainingPercent = numberValue(general.current_weekly_remaining_percent);
    tiers.push({
      name: "周",
      modelName,
      utilization: 100 - remainingPercent,
      remainingPercent,
      resetsAt: formatResetTime(general.weekly_end_time ?? general.weekly_reset_time)
    });
  }

  return tiers;
}

function openAIAdminUsageUrl(baseUrl: string): string {
  const startTime = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const params = new URLSearchParams({
    start_time: String(startTime),
    bucket_width: "1d",
    group_by: "model",
    limit: "31"
  });
  return `${joinUrl(baseUrl, "/v1/organization/usage/completions")}?${params.toString()}`;
}

function summarizeOpenAIUsage(buckets: OpenAIUsageBucket[], providerId: string) {
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let requests = 0;
  const modelTotals = new Map<string, { providerId: string; providerName: string; value: number }>();
  const historySamples: UsageHistorySample[] = [];

  for (const bucket of buckets) {
    const timestamp = new Date((bucket.start_time ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

    for (const item of bucket.results ?? []) {
      const model = item.model?.trim() || "unknown-model";
      const modelProviderId = `${providerId}:${model}`;
      const modelInput = numberValue(item.input_tokens);
      const modelOutput = numberValue(item.output_tokens);
      const modelCached = numberValue(item.input_cached_tokens);
      const modelRequests = numberValue(item.num_model_requests);
      const modelTotal = modelInput + modelOutput;
      if (modelTotal <= 0 && modelRequests <= 0) {
        continue;
      }

      inputTokens += modelInput;
      outputTokens += modelOutput;
      cachedInputTokens += modelCached;
      requests += modelRequests;
      totalTokens += modelTotal;

      const current = modelTotals.get(modelProviderId) ?? {
        providerId: modelProviderId,
        providerName: model,
        value: 0
      };
      current.value += modelTotal;
      modelTotals.set(modelProviderId, current);

      historySamples.push({
        providerId: modelProviderId,
        providerName: model,
        timestamp,
        label: "每日 Token",
        value: modelTotal,
        kind: "tokens"
      });
    }
  }

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    requests,
    modelTotals: [...modelTotals.values()].sort((a, b) => b.value - a.value),
    historySamples
  };
}

interface CodexCumulativeTokens {
  input: number;
  cachedInput: number;
  output: number;
  total: number;
}

async function parseCodexLocalUsage(codexDir: string) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const files = await collectCodexJsonlFiles(codexDir, cutoff);
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let events = 0;
  const modelTotals = new Map<string, { providerId: string; providerName: string; value: number }>();
  const historySamples: UsageHistorySample[] = [];

  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => "");
    if (!content) {
      continue;
    }
    let currentModel = "codex-unknown";
    let previous: CodexCumulativeTokens | null = null;

    for (const line of content.split(/\r?\n/)) {
      if (!line.includes("turn_context") && !line.includes("event_msg")) {
        continue;
      }

      let value: Record<string, unknown>;
      try {
        value = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const eventType = String(value.type ?? "");
      const payload = value.payload as Record<string, unknown> | undefined;
      if (eventType === "turn_context" && payload) {
        const info = payload.info as Record<string, unknown> | undefined;
        const model = String(payload.model ?? info?.model ?? "").trim();
        if (model) {
          currentModel = normalizeCodexModel(model);
        }
        continue;
      }

      if (eventType !== "event_msg" || !payload || payload.type !== "token_count") {
        continue;
      }

      const info = payload.info as Record<string, unknown> | undefined;
      if (!info) {
        continue;
      }
      const model = String(info.model ?? info.model_name ?? payload.model ?? "").trim();
      if (model) {
        currentModel = normalizeCodexModel(model);
      }

      const totalUsage = info.total_token_usage as Record<string, unknown> | undefined;
      const lastUsage = info.last_token_usage as Record<string, unknown> | undefined;
      const cumulative = parseCodexTokenObject(totalUsage ?? lastUsage);
      if (!cumulative) {
        continue;
      }

      const delta = totalUsage ? codexDelta(previous, cumulative) : cumulative;
      previous = totalUsage ? cumulative : previous;
      const eventTotal = delta.total || delta.input + delta.output;
      if (eventTotal <= 0) {
        continue;
      }

      const timestamp = String(value.timestamp ?? new Date().toISOString());
      const modelProviderId = `codex-local-usage:${currentModel}`;
      inputTokens += delta.input;
      cachedInputTokens += delta.cachedInput;
      outputTokens += delta.output;
      totalTokens += eventTotal;
      events += 1;

      const current = modelTotals.get(modelProviderId) ?? {
        providerId: modelProviderId,
        providerName: currentModel,
        value: 0
      };
      current.value += eventTotal;
      modelTotals.set(modelProviderId, current);
      historySamples.push({
        providerId: modelProviderId,
        providerName: currentModel,
        timestamp,
        label: "Codex 会话 Token",
        value: eventTotal,
        kind: "tokens"
      });
    }
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    events,
    filesScanned: files.length,
    modelTotals: [...modelTotals.values()].sort((a, b) => b.value - a.value),
    historySamples
  };
}

async function collectCodexJsonlFiles(codexDir: string, cutoff: number): Promise<string[]> {
  const roots = [joinPath(codexDir, "sessions"), joinPath(codexDir, "archived_sessions")];
  const files: string[] = [];
  for (const root of roots) {
    await collectJsonlRecursive(root, files, cutoff, 0, 4);
  }
  return files;
}

async function collectJsonlRecursive(dir: string, files: string[], cutoff: number, depth: number, maxDepth: number): Promise<void> {
  if (depth > maxDepth) {
    return;
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = joinPath(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsonlRecursive(path, files, cutoff, depth + 1, maxDepth);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const metadata = await stat(path).catch(() => null);
    if (!metadata || metadata.mtimeMs < cutoff) {
      continue;
    }
    files.push(path);
  }
}

function parseCodexTokenObject(value?: Record<string, unknown>): CodexCumulativeTokens | null {
  if (!value) {
    return null;
  }
  const input = numberValue(value.input_tokens);
  const cachedInput = numberValue(value.cached_input_tokens ?? value.cache_read_input_tokens);
  const output = numberValue(value.output_tokens);
  const total = numberValue(value.total_tokens) || input + output;
  return { input, cachedInput: Math.min(cachedInput, input || cachedInput), output, total };
}

function codexDelta(previous: CodexCumulativeTokens | null, current: CodexCumulativeTokens): CodexCumulativeTokens {
  if (!previous) {
    return current;
  }
  return {
    input: Math.max(current.input - previous.input, 0),
    cachedInput: Math.max(current.cachedInput - previous.cachedInput, 0),
    output: Math.max(current.output - previous.output, 0),
    total: Math.max(current.total - previous.total, 0)
  };
}

function normalizeCodexModel(model: string): string {
  let name = model.toLowerCase();
  const slash = name.lastIndexOf("/");
  if (slash >= 0) {
    name = name.slice(slash + 1);
  }
  name = name.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  name = name.replace(/-\d{8}$/, "");
  return name;
}

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return joinPath(homedir(), path.slice(2));
  }
  return path;
}

function geminiApiBase(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return /\/v\d+(beta)?$/i.test(normalized) ? normalized : `${normalized}/v1beta`;
}

function volcengineRegion(baseUrl: string): string {
  const host = baseUrl.split("://").pop()?.split("/")[0] ?? "";
  return host.split(".").find((part) => part.startsWith("cn-") || part.startsWith("ap-")) ?? "cn-beijing";
}

function volcengineCanonicalQuery(action: string): string {
  return [
    ["Action", action],
    ["Version", VOLCENGINE_API_VERSION]
  ]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function volcengineSign(accessKeyId: string, secretAccessKey: string, region: string, canonicalQuery: string, body: string) {
  const now = new Date();
  const shortDate = now.toISOString().slice(0, 10).replace(/-/g, "");
  const xDate = `${shortDate}T${now.toISOString().slice(11, 19).replace(/:/g, "")}Z`;
  const xContentSha256 = sha256Hex(body);
  const canonicalHeaders = `content-type:${VOLCENGINE_CONTENT_TYPE}\nhost:${VOLCENGINE_OPENAPI_HOST}\nx-content-sha256:${xContentSha256}\nx-date:${xDate}\n`;
  const canonicalRequest = `POST\n/\n${canonicalQuery}\n${canonicalHeaders}\n${VOLCENGINE_SIGNED_HEADERS}\n${xContentSha256}`;
  const credentialScope = `${shortDate}/${region}/${VOLCENGINE_SERVICE}/request`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const kDate = hmacSha256(secretAccessKey, shortDate);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, VOLCENGINE_SERVICE);
  const kSigning = hmacSha256(kService, "request");
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  return {
    authorization: `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${VOLCENGINE_SIGNED_HEADERS}, Signature=${signature}`,
    xDate,
    xContentSha256
  };
}

async function volcengineOpenApiCall(context: ProviderContext, region: string, accessKeyId: string, secretAccessKey: string, action: string): Promise<Record<string, unknown>> {
  const canonicalQuery = volcengineCanonicalQuery(action);
  const body = "{}";
  const signature = volcengineSign(accessKeyId, secretAccessKey, region, canonicalQuery, body);
  const response = await context.requestRaw({
    url: `https://${VOLCENGINE_OPENAPI_HOST}/?${canonicalQuery}`,
    method: "POST",
    headers: {
      "X-Date": signature.xDate,
      "X-Content-Sha256": signature.xContentSha256,
      "Content-Type": VOLCENGINE_CONTENT_TYPE,
      Authorization: signature.authorization
    },
    body
  });
  const json = response.json as Record<string, unknown>;
  const error = volcengineResponseError(json);
  if (error) {
    throw new Error(`${action}: ${error}`);
  }
  return json;
}

async function volcengineConsoleCurlCall(context: ProviderContext, curl: string): Promise<Record<string, unknown>> {
  const parsed = parseVolcengineConsoleCurl(curl);
  const response = await context.requestRaw({
    url: parsed.url,
    method: "POST",
    headers: parsed.headers,
    body: "{}"
  });
  const json = response.json as Record<string, unknown>;
  const error = volcengineResponseError(json);
  if (error) {
    throw new Error(`GetCodingPlanUsage: ${error}`);
  }
  return json;
}

function parseVolcengineConsoleCurl(curl: string): { url: string; headers: Record<string, string> } {
  const normalized = curl.replace(/\\\r?\n/g, " ").replace(/\r?\n/g, " ");
  const url = firstCurlArgument(normalized)
    ?? "https://console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/GetCodingPlanUsage";
  if (!url.includes("console.volcengine.com") || !url.includes("GetCodingPlanUsage")) {
    throw new Error("火山控制台 cURL 需要来自 GetCodingPlanUsage 请求。");
  }

  const headers = extractCurlHeaders(normalized);
  const cookie = extractCurlFlagValue(normalized, ["-b", "--cookie"]) ?? headers.Cookie ?? headers.cookie;
  if (!cookie) {
    throw new Error("火山控制台 cURL 缺少 Cookie。请在浏览器 Network 里对 GetCodingPlanUsage 复制完整 cURL。");
  }

  const csrfToken = headerValue(headers, "x-csrf-token") ?? cookieValue(cookie, "csrfToken");
  if (!cookieValue(cookie, "connect.sid") || !cookieValue(cookie, "digest")) {
    throw new Error("火山控制台 cURL 的 Cookie 缺少 connect.sid 或 digest，可能复制的不是登录态请求。");
  }
  if (!csrfToken) {
    throw new Error("火山控制台 cURL 缺少 csrfToken / x-csrf-token。");
  }

  return {
    url,
    headers: {
      "Content-Type": headerValue(headers, "content-type") ?? VOLCENGINE_CONTENT_TYPE,
      Origin: headerValue(headers, "origin") ?? "https://console.volcengine.com",
      Referer: headerValue(headers, "referer") ?? "https://console.volcengine.com/ark",
      "X-CSRF-Token": csrfToken,
      Cookie: cookie,
      "User-Agent": headerValue(headers, "user-agent") ?? "Mozilla/5.0"
    }
  };
}

function firstCurlArgument(text: string): string | null {
  const match = text.match(/curl(?:\.exe)?\s+(?:--location\s+|-L\s+)?(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function extractCurlHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const regex = /(?:^|\s)(?:-H|--header)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const separator = raw.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const name = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    if (name && value) {
      headers[name] = value;
    }
  }
  return headers;
}

function extractCurlFlagValue(text: string, flags: string[]): string | null {
  for (const flag of flags) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`(?:^|\\s)${escaped}\\s+"([^"]+)"`, "i"),
      new RegExp(`(?:^|\\s)${escaped}\\s+'([^']+)'`, "i"),
      new RegExp(`(?:^|\\s)${escaped}=([^\\s]+)`, "i"),
      new RegExp(`(?:^|\\s)${escaped}\\s+([^\\s]+)`, "i")
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
  }
  return null;
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const pair = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return pair?.[1] ?? null;
}

function cookieValue(cookie: string, name: string): string | null {
  const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1) ?? null;
}

function volcengineResponseError(body: Record<string, unknown>): string | null {
  const metadata = body.ResponseMetadata as Record<string, unknown> | undefined;
  const error = (metadata?.Error ?? body.Error) as Record<string, unknown> | undefined;
  if (!error) {
    return null;
  }
  const code = String(error.Code ?? "");
  const message = String(error.Message ?? "");
  return [code, message].filter(Boolean).join(": ") || null;
}

function parseVolcengineAfpTiers(resultBody: Record<string, unknown>): QuotaTier[] {
  const windows: Array<[string, string]> = [
    ["AFPFiveHour", "5 小时"],
    ["AFPWeekly", "周"],
    ["AFPMonthly", "月"]
  ];

  return windows.flatMap(([key, name]) => {
    const window = resultBody[key] as Record<string, unknown> | undefined;
    const quota = numberValue(window?.Quota);
    if (!window || quota <= 0) {
      return [];
    }
    const used = numberValue(window.Used);
    const utilization = quota > 0 ? (used / quota) * 100 : 0;
    return [{
      name,
      modelName: String(resultBody.Model ?? resultBody.ModelName ?? resultBody.Product ?? "Agent Plan"),
      utilization,
      remainingPercent: 100 - utilization,
      remainingTokens: Math.max(quota - used, 0),
      tokenLimit: quota,
      resetsAt: formatResetTime(window.ResetTime)
    }];
  });
}

function parseVolcengineCodingTiers(resultBody: Record<string, unknown>): QuotaTier[] {
  const quotaUsage = (resultBody.QuotaUsage ?? resultBody.Usages ?? resultBody.Details) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(quotaUsage)) {
    return [];
  }

  return quotaUsage.flatMap((item) => {
    const label = String(item.Level ?? item.Type ?? item.Period ?? item.Label ?? item.Window ?? "").toLowerCase();
    const name = volcengineWindowName(label);
    if (!name) {
      return [];
    }
    const utilization = numberValue(item.Percent ?? item.UsedPercent ?? item.UsagePercent);
    return [{
      name,
      modelName: String(item.Model ?? item.ModelName ?? item.Name ?? item.Product ?? "Volcengine Coding"),
      utilization,
      remainingPercent: 100 - utilization,
      resetsAt: formatResetTime(item.ResetTime ?? item.ResetTimestamp)
    }];
  });
}

function volcengineWindowName(label: string): string | null {
  if (["session", "5h", "fivehour", "five_hour", "rolling_5h"].includes(label)) {
    return "5 小时";
  }
  if (["weekly", "week", "7d"].includes(label)) {
    return "周";
  }
  if (["monthly", "month"].includes(label)) {
    return "月";
  }
  return null;
}

function unsupportedProvider(id: string, displayName: string, defaultBaseUrl: string, homepage: string, note: string): ProviderAdapter {
  return {
    id,
    displayName,
    defaultBaseUrl,
    homepage,
    directQuotaSupport: "unsupported",
    requiredCredential: "API Key",
    description: note,
    async fetchQuota(context) {
      if (!context.apiKey) {
        return enabledKeyMissing(id, displayName);
      }

      return result(id, displayName, "limited", [
        { label: "Base URL", value: context.baseUrl },
        { label: "Direct Query", value: "Unsupported" },
        { label: "Credential", value: "Configured" }
      ], note);
    }
  };
}

export function getProvider(id: string): ProviderAdapter | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

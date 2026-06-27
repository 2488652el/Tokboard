import { ProviderQuotaResult, ProviderStatus } from "../types";

export function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

export function result(
  providerId: string,
  providerName: string,
  status: ProviderStatus,
  metrics: { label: string; value: string }[],
  note?: string,
  error?: string
): ProviderQuotaResult {
  return {
    providerId,
    providerName,
    status,
    metrics,
    note,
    error,
    refreshedAt: new Date().toISOString()
  };
}

export function formatNumber(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat().format(value);
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return "无数据";
}

export function formatCurrency(value: unknown, currency = "USD"): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return formatNumber(value);
  }

  const normalizedCurrency = currency.toUpperCase() === "RMB" ? "CNY" : currency.toUpperCase();

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalizedCurrency
    }).format(numeric);
  } catch {
    return `${normalizedCurrency} ${new Intl.NumberFormat().format(numeric)}`;
  }
}

export function formatPercent(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return formatNumber(value);
  }

  return `${numeric.toFixed(1)}%`;
}

export function formatResetTime(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "无数据";
  }

  const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  return new Date(milliseconds).toLocaleString();
}

export function enabledKeyMissing(providerId: string, providerName: string): ProviderQuotaResult {
  return result(providerId, providerName, "unconfigured", [], "已启用，但未填写 API Key，也没有从环境变量解析到密钥。");
}

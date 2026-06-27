import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

export type ProviderStatus = "ready" | "limited" | "unconfigured" | "error";

export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  apiKeyEnvVar: string;
  accessKeyId: string;
  secretAccessKey: string;
  usageCurl: string;
  baseUrl: string;
}

export interface ApiUsageDashboardSettings {
  currency: string;
  refreshIntervalMinutes: number;
  displayOptions: DisplayOptions;
  archive: ArchiveSettings;
  providers: Record<string, ProviderConfig>;
  usageHistory: Record<string, UsageHistorySample[]>;
}

export interface ArchiveSettings {
  enabled: boolean;
  path: string;
  passphrase: string;
}

export interface DisplayOptions {
  showBalance: boolean;
  showUsage: boolean;
  showResetTime: boolean;
  showStatus: boolean;
  showNotes: boolean;
  showErrors: boolean;
  showHeatmap: boolean;
}

export interface ProviderMetric {
  label: string;
  value: string;
}

export interface ProviderQuotaResult {
  providerId: string;
  providerName: string;
  status: ProviderStatus;
  metrics: ProviderMetric[];
  historySamples?: UsageHistorySample[];
  note?: string;
  error?: string;
  refreshedAt: string;
}

export interface UsageHistorySample {
  providerId: string;
  providerName: string;
  timestamp: string;
  label: string;
  value: number;
  kind: "tokens" | "percent" | "currency" | "count";
}

export interface ProviderContext {
  apiKey: string;
  baseUrl: string;
  config: ProviderConfig;
  requestJson<T>(request: RequestUrlParam): Promise<T>;
  requestRaw(request: RequestUrlParam): Promise<RequestUrlResponse>;
}

export interface ProviderAdapter {
  id: string;
  displayName: string;
  defaultBaseUrl: string;
  homepage: string;
  directQuotaSupport: "supported" | "best-effort" | "unsupported";
  requiredCredential: string;
  description: string;
  fetchQuota(context: ProviderContext): Promise<ProviderQuotaResult>;
}

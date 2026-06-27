import { ProviderConfig, ApiUsageDashboardSettings, DisplayOptions } from "./types";

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  enabled: false,
  apiKey: "",
  apiKeyEnvVar: "",
  accessKeyId: "",
  secretAccessKey: "",
  usageCurl: "",
  baseUrl: ""
};

export const DEFAULT_SETTINGS: ApiUsageDashboardSettings = {
  currency: "CNY",
  refreshIntervalMinutes: 30,
  displayOptions: {
    showBalance: true,
    showUsage: true,
    showResetTime: true,
    showStatus: true,
    showNotes: true,
    showErrors: true,
    showHeatmap: true
  },
  archive: {
    enabled: false,
    path: "30-输出/40-自动化方案/Tokboard/tokboard-usage-archive.enc",
    passphrase: ""
  },
  providers: {},
  usageHistory: {}
};

export function mergeDisplayOptions(options?: Partial<DisplayOptions>): DisplayOptions {
  return {
    ...DEFAULT_SETTINGS.displayOptions,
    ...options
  };
}

export function mergeProviderConfig(defaultBaseUrl: string, config?: Partial<ProviderConfig>): ProviderConfig {
  return {
    ...DEFAULT_PROVIDER_CONFIG,
    baseUrl: defaultBaseUrl,
    ...config
  };
}

export function getEnvValue(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }

  return globalThis.process?.env?.[trimmed] ?? "";
}

export function resolveApiKey(config: ProviderConfig): string {
  return config.apiKey.trim() || getEnvValue(config.apiKeyEnvVar).trim();
}

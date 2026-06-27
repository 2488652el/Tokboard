import { App, Notice, Plugin, PluginSettingTab, requestUrl, Setting, WorkspaceLeaf } from "obsidian";
import { PROVIDERS } from "./providers/registry";
import { DEFAULT_SETTINGS, mergeDisplayOptions, mergeProviderConfig, resolveApiKey } from "./settings";
import { ApiUsageDashboardSettings, ProviderAdapter, ProviderConfig, ProviderQuotaResult, UsageHistorySample } from "./types";
import { API_USAGE_VIEW_TYPE, ApiUsageDashboardView } from "./view";

export default class ApiUsageDashboardPlugin extends Plugin {
  settings: ApiUsageDashboardSettings = DEFAULT_SETTINGS;
  private samplingPromise: Promise<ProviderQuotaResult[]> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(API_USAGE_VIEW_TYPE, (leaf) => new ApiUsageDashboardView(leaf, this));

    this.addRibbonIcon("gauge", "API Token 套餐额度", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-api-usage-dashboard",
      name: "打开 API Token 套餐额度面板",
      callback: () => {
        void this.activateView();
      }
    });

    this.addSettingTab(new ApiUsageDashboardSettingTab(this.app, this));

    this.registerAutoSampling();
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(API_USAGE_VIEW_TYPE);
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(API_USAGE_VIEW_TYPE);
    let leaf: WorkspaceLeaf;

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: API_USAGE_VIEW_TYPE,
        active: true
      });
    }

    this.app.workspace.revealLeaf(leaf);
  }

  getProviderConfig(provider: ProviderAdapter): ProviderConfig {
    return mergeProviderConfig(provider.defaultBaseUrl, this.settings.providers[provider.id]);
  }

  async updateProviderConfig(provider: ProviderAdapter, updates: Partial<ProviderConfig>): Promise<void> {
    this.settings.providers[provider.id] = {
      ...this.getProviderConfig(provider),
      ...updates
    };
    await this.saveSettings();
  }

  async deleteProviderConfig(provider: ProviderAdapter): Promise<void> {
    this.settings.providers[provider.id] = mergeProviderConfig(provider.defaultBaseUrl, {
      enabled: false,
      apiKey: "",
      apiKeyEnvVar: "",
      accessKeyId: "",
      secretAccessKey: "",
      usageCurl: "",
      baseUrl: provider.defaultBaseUrl
    });
    await this.saveSettings();
  }

  async fetchProviderQuota(provider: ProviderAdapter): Promise<ProviderQuotaResult> {
    const config = this.getProviderConfig(provider);
    const apiKey = resolveApiKey(config);
    const baseUrl = config.baseUrl.trim() || provider.defaultBaseUrl;

    try {
      return await provider.fetchQuota({
        apiKey,
        baseUrl,
        config,
        requestJson: async (request) => {
          const response = await requestUrl(request);
          return response.json;
        },
        requestRaw: requestUrl
      });
    } catch (error) {
      return {
        providerId: provider.id,
        providerName: provider.displayName,
        status: "error",
        metrics: [
          { label: "Base URL", value: baseUrl },
          { label: "直连查询", value: provider.directQuotaSupport }
        ],
        error: error instanceof Error ? error.message : String(error),
        refreshedAt: new Date().toISOString()
      };
    }
  }

  async sampleEnabledProviders(): Promise<ProviderQuotaResult[]> {
    if (this.samplingPromise) {
      return this.samplingPromise;
    }

    this.samplingPromise = this.runSampleEnabledProviders().finally(() => {
      this.samplingPromise = null;
    });
    return this.samplingPromise;
  }

  private async runSampleEnabledProviders(): Promise<ProviderQuotaResult[]> {
    const enabledProviders = PROVIDERS.filter((provider) => this.getProviderConfig(provider).enabled);
    if (!enabledProviders.length) {
      return [];
    }

    const results: ProviderQuotaResult[] = [];
    for (const provider of enabledProviders) {
      results.push(await this.fetchProviderQuota(provider));
    }
    await this.recordUsageHistory(results);
    return results;
  }

  private registerAutoSampling(): void {
    const intervalMinutes = this.settings.refreshIntervalMinutes;
    if (intervalMinutes <= 0) {
      return;
    }
    this.registerInterval(window.setInterval(() => {
      void this.sampleEnabledProviders();
    }, intervalMinutes * 60 * 1000));
  }

  async recordUsageHistory(results: ProviderQuotaResult[]): Promise<void> {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    for (const result of results) {
      const samples = result.historySamples?.length ? result.historySamples : [this.createUsageHistorySample(result)].filter((sample): sample is UsageHistorySample => Boolean(sample));

      for (const sample of samples) {
        const history = [...(this.settings.usageHistory[sample.providerId] ?? []), sample];
        const deduped = new Map<string, UsageHistorySample>();
        for (const item of history) {
          deduped.set(`${item.providerId}|${item.timestamp}|${item.label}`, item);
        }
        this.settings.usageHistory[sample.providerId] = [...deduped.values()]
          .filter((item) => new Date(item.timestamp).getTime() >= cutoff)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          .slice(-720);
      }
    }

    await this.saveSettings();
    await this.exportEncryptedArchive(results);
  }

  getUsageHistory(providerId: string): UsageHistorySample[] {
    return this.settings.usageHistory[providerId] ?? [];
  }

  private createUsageHistorySample(result: ProviderQuotaResult): UsageHistorySample | null {
    const metric = this.historyMetric(result.metrics);
    if (!metric) {
      return null;
    }

    const value = this.numericMetricValue(metric.value);
    if (value === null) {
      return null;
    }

    return {
      providerId: result.providerId,
      providerName: this.historyDisplayName(result) ?? result.providerName,
      timestamp: result.refreshedAt,
      label: metric.label,
      value,
      kind: this.historyMetricKind(metric.label, metric.value)
    };
  }

  private historyDisplayName(result: ProviderQuotaResult): string | null {
    const metric = result.metrics.find((item) => /最常用模型|调用模型/i.test(item.label));
    if (!metric) {
      return null;
    }

    return this.cleanModelName(metric.value);
  }

  private cleanModelName(value: string): string | null {
    const first = value.split("/")[0]?.replace(/\(.+\)$/, "").trim();
    if (!first) {
      return null;
    }

    const normalized = first.toLowerCase();
    if (
      normalized.includes("无数据")
      || normalized.includes("未返回")
      || normalized.includes("待验证")
      || normalized === "n/a"
      || normalized.includes(" coding")
      || normalized.endsWith("coding")
      || normalized.includes("agent plan")
      || normalized.includes("token plan")
    ) {
      return null;
    }

    return first;
  }

  private historyMetric(metrics: ProviderQuotaResult["metrics"]): ProviderQuotaResult["metrics"][number] | null {
    const priority = [
      /已用\s*token/i,
      /本次测试\s*token/i,
      /used\s*tokens?/i,
      /total\s*tokens?/i,
      /请求次数|requests?/i,
      /已用额度|used quota|usage/i,
      /剩余\s*token/i,
      /剩余额度|remaining quota/i
    ];

    for (const pattern of priority) {
      const metric = metrics.find((item) => pattern.test(item.label));
      if (metric) {
        return metric;
      }
    }

    return metrics.find((item) => this.numericMetricValue(item.value) !== null) ?? null;
  }

  private historyMetricKind(label: string, value: string): UsageHistorySample["kind"] {
    const normalized = `${label} ${value}`.toLowerCase();
    if (normalized.includes("%")) {
      return "percent";
    }
    if (normalized.includes("token")) {
      return "tokens";
    }
    if (normalized.includes("¥") || normalized.includes("$") || normalized.includes("余额") || normalized.includes("额度")) {
      return "currency";
    }
    return "count";
  }

  private numericMetricValue(value: string): number | null {
    const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!match) {
      return null;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async exportEncryptedArchive(results: ProviderQuotaResult[]): Promise<void> {
    const archive = this.settings.archive;
    if (!archive.enabled) {
      return;
    }

    const passphrase = archive.passphrase.trim();
    if (!passphrase) {
      new Notice("Tokboard：已启用归档，但未填写加密口令。");
      return;
    }

    const archivePath = this.normalizeArchivePath(archive.path);
    const payload = {
      schema: "tokboard.archive.v1",
      exportedAt: new Date().toISOString(),
      vault: this.app.vault.getName(),
      providers: Object.fromEntries(Object.entries(this.settings.providers).map(([providerId, config]) => [providerId, {
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        hasApiKey: Boolean(config.apiKey || config.apiKeyEnvVar),
        hasAccessKey: Boolean(config.accessKeyId && config.secretAccessKey),
        hasUsageCurl: Boolean(config.usageCurl)
      }])),
      latestResults: results.map((result) => ({
        providerId: result.providerId,
        providerName: result.providerName,
        status: result.status,
        metrics: result.metrics,
        note: result.note,
        error: result.error,
        refreshedAt: result.refreshedAt
      })),
      usageHistory: this.settings.usageHistory
    };

    const encrypted = await this.encryptArchive(JSON.stringify(payload), passphrase);
    await this.ensureFolder(archivePath);
    await this.app.vault.adapter.write(archivePath, JSON.stringify(encrypted, null, 2));
  }

  private normalizeArchivePath(path: string): string {
    const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    return normalized || DEFAULT_SETTINGS.archive.path;
  }

  private async ensureFolder(filePath: string): Promise<void> {
    const folder = filePath.split("/").slice(0, -1).join("/");
    if (!folder || await this.app.vault.adapter.exists(folder)) {
      return;
    }

    const parts = folder.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async encryptArchive(plainText: string, passphrase: string) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 250000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(plainText)
    );

    return {
      schema: "tokboard.encrypted-archive.v1",
      algorithm: "AES-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: 250000,
      createdAt: new Date().toISOString(),
      salt: this.bytesToBase64(salt),
      iv: this.bytesToBase64(iv),
      ciphertext: this.bytesToBase64(new Uint8Array(cipherBuffer))
    };
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      displayOptions: mergeDisplayOptions(saved?.displayOptions),
      archive: {
        ...DEFAULT_SETTINGS.archive,
        ...(saved?.archive ?? {})
      },
      providers: {
        ...DEFAULT_SETTINGS.providers,
        ...(saved?.providers ?? {})
      },
      usageHistory: saved?.usageHistory ?? {}
    };
    let shouldSaveSettings = false;
    if (!this.settings.autoSamplingMigratedFromDefault && this.settings.refreshIntervalMinutes === 30) {
      this.settings.refreshIntervalMinutes = 0;
      shouldSaveSettings = true;
    } else {
      this.settings.refreshIntervalMinutes = this.settings.refreshIntervalMinutes > 0 ? this.settings.refreshIntervalMinutes : 0;
    }
    if (!this.settings.autoSamplingMigratedFromDefault) {
      this.settings.autoSamplingMigratedFromDefault = true;
      shouldSaveSettings = true;
    }

    for (const provider of PROVIDERS) {
      this.settings.providers[provider.id] = this.getProviderConfig(provider);
    }

    if (shouldSaveSettings) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class ApiUsageDashboardSettingTab extends PluginSettingTab {
  plugin: ApiUsageDashboardPlugin;
  private selectedProviderId = "deepseek";

  constructor(app: App, plugin: ApiUsageDashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "API 用量面板" });
    containerEl.createEl("p", {
      cls: "api-usage-muted",
      text: "API Key 默认保存在本插件的 data.json。也可以只填写环境变量名，让插件从本机环境变量读取。"
    });

    this.renderTemplatePicker(containerEl);
    this.renderConfiguredProviders(containerEl);
    this.renderSelectedProvider(containerEl);

    const globalSettings = containerEl.createEl("details", { cls: "api-usage-settings-advanced" });
    globalSettings.createEl("summary", { text: "全局高级设置" });

    new Setting(globalSettings)
      .setName("展示币种")
      .setDesc("用于格式化部分供应商返回的金额字段。")
      .addText((text) => {
        text
          .setPlaceholder("CNY")
          .setValue(this.plugin.settings.currency)
          .onChange((value) => {
            this.plugin.settings.currency = value.trim().toUpperCase() || "CNY";
            void this.plugin.saveSettings();
          });
      });

    globalSettings.createEl("h4", { text: "Dashboard 显示内容" });

    this.renderDisplayToggle(globalSettings, "showBalance", "货币余额");
    this.renderDisplayToggle(globalSettings, "showUsage", "Token 套餐 / 用量进度");
    this.renderDisplayToggle(globalSettings, "showResetTime", "重置时间");
    this.renderDisplayToggle(globalSettings, "showStatus", "状态字段");
    this.renderDisplayToggle(globalSettings, "showNotes", "说明文字");
    this.renderDisplayToggle(globalSettings, "showErrors", "错误信息");
    this.renderDisplayToggle(globalSettings, "showHeatmap", "用量热力图");

    globalSettings.createEl("h4", { text: "Fast Note Sync 加密归档" });

    new Setting(globalSettings)
      .setName("启用加密归档")
      .setDesc("开启后，每次刷新会把用量快照和本地历史写入一个加密文件；Fast Note Sync 会按普通文件变更同步它。不会写入 API Key、AK/SK 或控制台 cURL。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.archive.enabled)
          .onChange((value) => {
            this.plugin.settings.archive.enabled = value;
            void this.plugin.saveSettings();
          });
      });

    new Setting(globalSettings)
      .setName("归档文件路径")
      .setDesc("建议放在 vault 内会被 Fast Note Sync 同步的位置。文件内容为加密 JSON。")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.archive.path)
          .setValue(this.plugin.settings.archive.path)
          .onChange((value) => {
            this.plugin.settings.archive.path = value.trim() || DEFAULT_SETTINGS.archive.path;
            void this.plugin.saveSettings();
          });
      });

    new Setting(globalSettings)
      .setName("加密口令")
      .setDesc("用于 AES-GCM 加密归档。请自行保存；忘记后无法解密已同步归档。")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("输入一个仅本地保存的归档口令")
          .setValue(this.plugin.settings.archive.passphrase)
          .onChange((value) => {
            this.plugin.settings.archive.passphrase = value;
            void this.plugin.saveSettings();
          });
      });

    new Setting(globalSettings)
      .setName("立即写入归档")
      .setDesc("使用当前面板最近一次刷新结果写入加密文件；如果还没有刷新结果，则会只写入已有历史。")
      .addButton((button) => {
        button
          .setButtonText("写入归档")
          .onClick(async () => {
            await this.plugin.recordUsageHistory([]);
            new Notice("Tokboard：已尝试写入加密归档。");
          });
      });

    new Setting(globalSettings)
      .setName("自动刷新间隔")
      .setDesc("单位：分钟。填 0 表示关闭后台采样，建议保持 0 并手动刷新，可减少打开 Obsidian 时的卡顿。")
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.refreshIntervalMinutes))
          .onChange((value) => {
            const parsed = Number(value);
            this.plugin.settings.refreshIntervalMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            void this.plugin.saveSettings();
          });
      });
  }

  private renderTemplatePicker(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: "api-usage-template-picker" });
    section.createEl("h3", { text: "1. 选择模型或 Token 套餐模板" });

    new Setting(section)
      .setName("模板")
      .setDesc("选择后，下方只显示该模板的二级配置。Base URL 会自动套用官网默认值。")
      .addDropdown((dropdown) => {
        for (const provider of PROVIDERS) {
          dropdown.addOption(provider.id, `${this.providerGroupLabel(provider)} / ${provider.displayName}`);
        }
        dropdown
          .setValue(this.selectedProviderId)
          .onChange((value) => {
            this.selectedProviderId = value;
            this.display();
          });
      });
  }

  private renderConfiguredProviders(containerEl: HTMLElement): void {
    const enabledProviders = PROVIDERS.filter((provider) => this.plugin.getProviderConfig(provider).enabled);
    const section = containerEl.createDiv({ cls: "api-usage-configured" });
    section.createEl("h3", { text: "已添加" });

    if (!enabledProviders.length) {
      section.createDiv({ cls: "api-usage-muted", text: "还没有添加模型。先从上方选择模板，再填写 API Key 并启用。" });
      return;
    }

    const chips = section.createDiv({ cls: "api-usage-provider-chips" });
    for (const provider of enabledProviders) {
      const chip = chips.createDiv({
        cls: provider.id === this.selectedProviderId ? "api-usage-provider-chip is-active" : "api-usage-provider-chip"
      });
      const selectButton = chip.createEl("button", {
        cls: "api-usage-provider-chip-select",
        text: provider.displayName
      });
      selectButton.addEventListener("click", () => {
        this.selectedProviderId = provider.id;
        this.display();
      });
      const deleteButton = chip.createEl("button", {
        cls: "api-usage-provider-chip-delete",
        text: "删除"
      });
      deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.deleteProvider(provider);
      });
    }
  }

  private renderSelectedProvider(containerEl: HTMLElement): void {
    const provider = PROVIDERS.find((item) => item.id === this.selectedProviderId) ?? PROVIDERS[0];
    const config = this.plugin.getProviderConfig(provider);
    const wrapper = containerEl.createDiv({ cls: "api-usage-setting-provider" });
    wrapper.createEl("h3", { text: `2. 配置 ${provider.displayName}` });
    wrapper.createEl("p", {
      cls: "api-usage-muted",
      text: `${provider.description} 凭据：${provider.requiredCredential}。Base URL 已按官网模板预填。`
    });

    new Setting(wrapper)
      .setName("启用此模板")
      .setDesc("启用后会出现在 Dashboard 面板中。")
      .addToggle((toggle) => {
        toggle
          .setValue(config.enabled)
          .onChange(async (value) => {
            await this.plugin.updateProviderConfig(provider, { enabled: value });
            new Notice(`${provider.displayName} ${value ? "已启用" : "已禁用"}`);
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText("套用官网模板")
          .onClick(async () => {
            await this.plugin.updateProviderConfig(provider, {
              enabled: true,
              baseUrl: provider.defaultBaseUrl
            });
            new Notice(`已套用 ${provider.displayName} 官方模板`);
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText("打开官网")
          .onClick(() => {
            window.open(provider.homepage);
          });
      })
      .addButton((button) => {
        button
          .setButtonText("删除此查询")
          .setWarning()
          .onClick(async () => {
            await this.deleteProvider(provider);
          });
      });

    if (provider.id === "codex-local-usage") {
      new Setting(wrapper)
        .setName("Codex 配置目录")
        .setDesc("默认读取 ~/.codex/sessions 和 ~/.codex/archived_sessions。参考 CC Switch 的 JSONL session log 解析方案。")
        .addText((text) => {
          text
            .setPlaceholder("~/.codex")
            .setValue(config.baseUrl)
            .onChange((value) => {
              void this.plugin.updateProviderConfig(provider, { baseUrl: value.trim() || provider.defaultBaseUrl });
            });
        })
        .addButton((button) => this.attachTestButton(button, provider));
    } else if (provider.id === "volcengine-coding") {
      new Setting(wrapper)
        .setName("控制台 cURL")
        .setDesc("推荐方式：在火山方舟控制台打开 Coding Plan 页面，从浏览器 Network 复制 GetCodingPlanUsage 的 cURL。插件会解析 cookie/csrf 并查询真实套餐百分比。")
        .addTextArea((text) => {
          text.inputEl.rows = 6;
          text.inputEl.addClass("api-usage-curl-input");
          text
            .setPlaceholder("curl 'https://console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/GetCodingPlanUsage' ...")
            .setValue(config.usageCurl)
            .onChange((value) => {
              void this.plugin.updateProviderConfig(provider, { usageCurl: value.trim() });
            });
        })
        .addButton((button) => this.attachTestButton(button, provider));

      new Setting(wrapper)
        .setName("AccessKey ID")
        .setDesc("可选备选方式：火山控制面访问密钥 ID，不是推理 API Key。")
        .addText((text) => {
          text
            .setPlaceholder("AKLT...")
            .setValue(config.accessKeyId)
            .onChange((value) => {
              void this.plugin.updateProviderConfig(provider, { accessKeyId: value.trim() });
            });
        });

      new Setting(wrapper)
        .setName("Secret AccessKey")
        .setDesc("可选备选方式：火山控制面访问密钥 Secret。")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("Secret AccessKey")
            .setValue(config.secretAccessKey)
            .onChange((value) => {
              void this.plugin.updateProviderConfig(provider, { secretAccessKey: value.trim() });
            });
        })
        .addButton((button) => this.attachTestButton(button, provider));
    } else {
      new Setting(wrapper)
        .setName("API Key")
        .setDesc("留空时会尝试读取下面配置的环境变量。")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("sk-...")
            .setValue(config.apiKey)
            .onChange((value) => {
              void this.plugin.updateProviderConfig(provider, { apiKey: value.trim() });
            });
        })
        .addButton((button) => this.attachTestButton(button, provider));

      new Setting(wrapper)
        .setName("API Key 环境变量")
        .setDesc("例如 OPENAI_API_KEY。只有 API Key 留空时才会读取。")
        .addText((text) => {
          text
            .setPlaceholder(`${provider.id.toUpperCase().replace(/-/g, "_")}_API_KEY`)
            .setValue(config.apiKeyEnvVar)
            .onChange((value) => {
              void this.plugin.updateProviderConfig(provider, { apiKeyEnvVar: value.trim() });
            });
        });
    }

    const advanced = wrapper.createEl("details", { cls: "api-usage-settings-advanced" });
    advanced.createEl("summary", { text: "高级：Base URL 和查询能力" });

    new Setting(advanced)
      .setName("Base URL")
      .setDesc(`默认：${provider.defaultBaseUrl}`)
      .addText((text) => {
        text
          .setPlaceholder(provider.defaultBaseUrl)
          .setValue(config.baseUrl)
          .onChange((value) => {
            void this.plugin.updateProviderConfig(provider, { baseUrl: value.trim() || provider.defaultBaseUrl });
          });
      });

    const capability = advanced.createDiv({ cls: "api-usage-template-meta" });
    capability.createDiv({ text: `类型：${this.providerGroupLabel(provider)}` });
    capability.createDiv({ text: `查询能力：${provider.directQuotaSupport}` });
    capability.createDiv({ text: `默认地址：${provider.defaultBaseUrl}` });
  }

  private providerGroupLabel(provider: ProviderAdapter): string {
    if (provider.id.includes("coding")) {
      return "Coding Plan";
    }
    if (provider.id === "codex-local-usage") {
      return "本地日志";
    }
    if (["anthropic", "gemini", "dashscope"].includes(provider.id)) {
      return "模型";
    }
    if (["deepseek", "moonshot", "openai-compatible", "openai-admin-usage"].includes(provider.id)) {
      return "模型";
    }
    return "余额";
  }

  private renderDisplayToggle(containerEl: HTMLElement, key: keyof ApiUsageDashboardSettings["displayOptions"], name: string): void {
    new Setting(containerEl)
      .setName(name)
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.displayOptions[key])
          .onChange((value) => {
            this.plugin.settings.displayOptions[key] = value;
            void this.plugin.saveSettings();
          });
      });
  }

  private attachTestButton(button: import("obsidian").ButtonComponent, provider: ProviderAdapter): void {
    button
      .setButtonText("测试连接")
      .setCta()
      .onClick(async () => {
        await this.plugin.updateProviderConfig(provider, { enabled: true });
        new Notice(`正在测试 ${provider.displayName}...`);
        const result = await this.plugin.fetchProviderQuota(provider);
        if (result.status === "ready") {
          new Notice(`${provider.displayName} 连接成功`);
        } else {
          new Notice(`${provider.displayName} 测试结果：${result.error ?? result.note ?? "未返回可用额度"}`);
        }
        this.display();
      });
  }

  private async deleteProvider(provider: ProviderAdapter): Promise<void> {
    await this.plugin.deleteProviderConfig(provider);
    new Notice(`已删除 ${provider.displayName} 查询配置`);
    if (this.selectedProviderId === provider.id) {
      this.selectedProviderId = "deepseek";
    }
    this.display();
  }
}

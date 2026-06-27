import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import ApiUsageDashboardPlugin from "./main";
import { PROVIDERS } from "./providers/registry";
import { ProviderQuotaResult, UsageHistorySample } from "./types";

export const API_USAGE_VIEW_TYPE = "api-usage-dashboard-view";

export class ApiUsageDashboardView extends ItemView {
  private plugin: ApiUsageDashboardPlugin;
  private results: ProviderQuotaResult[] = [];
  private rangeDays = 7;

  constructor(leaf: WorkspaceLeaf, plugin: ApiUsageDashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return API_USAGE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "API 调用情况";
  }

  getIcon(): string {
    return "gauge";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("api-usage-dashboard");

    const toolbar = container.createDiv({ cls: "api-usage-toolbar" });
    const heading = toolbar.createDiv();
    heading.createDiv({ cls: "api-usage-title", text: "API Token 套餐额度" });
    heading.createDiv({
      cls: "api-usage-subtitle",
      text: "显示已添加模型和 Coding Plan 的 Token 套餐、余额与额度状态。"
    });

    const actions = toolbar.createDiv({ cls: "api-usage-actions" });
    const range = actions.createDiv({ cls: "api-usage-range-toggle" });
    this.renderRangeButton(range, 7);
    this.renderRangeButton(range, 30);
    const refreshButton = actions.createEl("button", { cls: "api-usage-icon-button" });
    const refreshIcon = refreshButton.createSpan();
    setIcon(refreshIcon, "refresh-cw");
    refreshButton.createSpan({ text: "刷新" });
    refreshButton.addEventListener("click", () => {
      void this.refresh();
    });

    const enabledCount = this.enabledProviders().length;
    const history = this.filteredHistory(this.rangeDays);
    this.renderUsageAnalytics(container, history, enabledCount);

    if (!this.results.length && !history.length) {
      container.createDiv({
        cls: "api-usage-muted",
        text: enabledCount ? "点击刷新开始查询已添加模型。" : "还没有添加模型。请先到插件设置中选择模型模板并填写 API Key。"
      });
      return;
    }

    if (this.results.length) {
      const detailHeader = container.createDiv({ cls: "api-usage-detail-header" });
      detailHeader.createDiv({ cls: "api-usage-section-title", text: "模型与 Coding Plan 详情" });
      detailHeader.createDiv({ cls: "api-usage-muted", text: "逐个查看连接状态、额度窗口、错误信息与本地采样热力图。" });
      const grid = container.createDiv({ cls: "api-usage-grid" });
      for (const result of this.results) {
        this.renderCard(grid, result);
      }
    }
  }

  async refresh(options: { silent?: boolean } = {}): Promise<void> {
    const enabledProviders = this.enabledProviders();

    if (!enabledProviders.length) {
      if (!options.silent) {
        new Notice("请先在设置中添加至少一个模型。");
      }
      return;
    }

    this.results = await this.plugin.sampleEnabledProviders();

    this.render();
  }

  private renderCard(parent: HTMLElement, result: ProviderQuotaResult): void {
    const card = parent.createDiv({ cls: "api-usage-card" });
    const header = card.createDiv({ cls: "api-usage-card-header" });
    const title = header.createDiv();
    const name = title.createDiv({ cls: "api-usage-provider-title" });
    name.createSpan({ cls: "api-usage-provider-name", text: result.providerName });
    title.createDiv({
      cls: "api-usage-muted",
      text: new Date(result.refreshedAt).toLocaleString()
    });
    const statusDot = header.createSpan({ cls: `api-usage-status-dot api-usage-status-dot-${result.status}` });
    statusDot.setAttr("title", this.statusLabel(result.status));

    const visibleMetrics = this.cardMetrics(result);

    if (visibleMetrics.length) {
      const primaryMetric = this.primaryMetric(visibleMetrics);
      const hero = card.createDiv({ cls: "api-usage-hero-metric" });
      this.renderMetricVisual(hero, primaryMetric, true);
      const heroText = hero.createDiv();
      heroText.createDiv({ cls: "api-usage-hero-value", text: primaryMetric.value });
      heroText.createDiv({ cls: "api-usage-hero-label", text: primaryMetric.label });

      const metrics = card.createDiv({ cls: "api-usage-metrics" });
      for (const metric of visibleMetrics.filter((item) => item !== primaryMetric)) {
        const item = metrics.createDiv({ cls: `api-usage-metric ${this.isModelMetric(metric.label) ? "api-usage-model-metric" : ""}` });
        const metricHeader = item.createDiv({ cls: "api-usage-metric-label" });
        this.renderMetricVisual(metricHeader, metric, false);
        metricHeader.createSpan({ text: metric.label });
        item.createDiv({ cls: "api-usage-metric-value", text: metric.value });
        this.renderMetricBar(item, metric);
      }
    }

    if (this.plugin.settings.displayOptions.showHeatmap) {
      this.renderHeatmap(card, result);
    }

    if (result.note && this.plugin.settings.displayOptions.showNotes) {
      card.createDiv({ cls: "api-usage-note", text: result.note });
    }

    if (result.error && this.plugin.settings.displayOptions.showErrors) {
      card.createDiv({ cls: "api-usage-error", text: result.error });
    }
  }

  private statusLabel(status: ProviderQuotaResult["status"]): string {
    switch (status) {
      case "ready":
        return "可查询";
      case "limited":
        return "受限";
      case "unconfigured":
        return "未配置";
      case "error":
        return "错误";
    }
  }

  private enabledProviders() {
    return PROVIDERS.filter((provider) => this.plugin.getProviderConfig(provider).enabled);
  }

  private renderRangeButton(parent: HTMLElement, days: 7 | 30): void {
    const button = parent.createEl("button", {
      cls: this.rangeDays === days ? "is-active" : "",
      text: `最近 ${days} 天`
    });
    button.addEventListener("click", () => {
      this.rangeDays = days;
      this.render();
    });
  }

  private renderUsageAnalytics(container: Element, history: UsageHistorySample[], enabledCount: number): void {
    const modelHistory = history.filter((sample) => !this.isGenericCodingPlanName(sample.providerName));
    const providerTotals = this.providerTotals(modelHistory);
    const total = providerTotals.reduce((sum, item) => sum + item.value, 0);
    const topProvider = providerTotals[0];
    const activeDays = new Set(modelHistory.filter((sample) => sample.value > 0).map((sample) => this.dayKey(new Date(sample.timestamp)))).size;
    const latestKind = modelHistory[modelHistory.length - 1]?.kind ?? history[history.length - 1]?.kind ?? "tokens";
    const unit = this.kindUnit(latestKind);

    const stats = container.createDiv({ cls: "api-usage-stat-grid" });
    this.renderStatCard(stats, "flame", `${unit} 用量`, this.compactNumber(total), modelHistory.length ? `最近 ${this.rangeDays} 天` : "等待模型级采样");
    this.renderStatCard(stats, "layers", "已添加模型", String(enabledCount), "已启用查询窗口");
    this.renderStatCard(stats, "message-square", "采样次数", String(modelHistory.length), "刷新会产生采样");
    this.renderStatCard(stats, "calendar-days", "活跃天数", String(activeDays), "有用量记录的天数");
    this.renderStatCard(stats, "activity", "最常用模型", topProvider?.providerName ?? "暂无", topProvider ? `占比 ${this.percentOf(topProvider.value, total)}` : "等待采样");

    if (this.plugin.settings.displayOptions.showHeatmap) {
      this.renderGlobalHeatmap(container, modelHistory.length ? modelHistory : history);
    }

    this.renderDailyTrend(container, modelHistory, providerTotals);
    this.renderProviderPie(container, providerTotals, total, unit);
  }

  private renderStatCard(parent: HTMLElement, iconName: string, label: string, value: string, subtext: string): void {
    const card = parent.createDiv({ cls: "api-usage-stat-card" });
    const labelEl = card.createDiv({ cls: "api-usage-stat-label" });
    const icon = labelEl.createSpan();
    setIcon(icon, iconName);
    labelEl.createSpan({ text: label });
    card.createDiv({ cls: "api-usage-stat-value", text: value });
    card.createDiv({ cls: "api-usage-stat-subtext", text: subtext });
  }

  private renderGlobalHeatmap(parent: Element, history: UsageHistorySample[]): void {
    const panel = parent.createDiv({ cls: "api-usage-chart-panel" });
    const header = panel.createDiv({ cls: "api-usage-chart-header" });
    header.createSpan({ text: "活跃热力图" });
    const legend = header.createSpan({ cls: "api-usage-legend-inline" });
    legend.createSpan({ text: "较少" });
    for (let level = 0; level <= 4; level += 1) {
      legend.createSpan({ cls: `api-usage-heatmap-cell level-${level}` });
    }
    legend.createSpan({ text: "较多" });

    const buckets = this.heatmapBuckets(history);
    const grid = panel.createDiv({ cls: "api-usage-global-heatmap-grid" });
    const max = Math.max(...buckets.map((bucket) => bucket.value), 0);
    const kind = history[history.length - 1]?.kind;
    for (const bucket of buckets) {
    const level = this.heatmapLevel(bucket.value, max);
      const cell = grid.createSpan({ cls: `api-usage-heatmap-cell level-${level}` });
      cell.setAttr("title", this.heatmapTooltip(bucket, kind));
    }
  }

  private renderDailyTrend(parent: Element, history: UsageHistorySample[], providerTotals: Array<{ providerId: string; providerName: string; value: number }>): void {
    const panel = parent.createDiv({ cls: "api-usage-chart-panel" });
    const unit = this.kindUnit(history[history.length - 1]?.kind ?? "tokens");
    panel.createDiv({ cls: "api-usage-chart-title", text: `按天 ${unit} 趋势` });
    const days = this.daysInRange(this.rangeDays);
    const dailyProviderValues = new Map<string, Map<string, number>>();

    for (const sample of history) {
      const day = this.dayKey(new Date(sample.timestamp));
      const values = dailyProviderValues.get(day) ?? new Map<string, number>();
      values.set(sample.providerId, (values.get(sample.providerId) ?? 0) + sample.value);
      dailyProviderValues.set(day, values);
    }

    const maxDaily = Math.max(...days.map((day) => {
      const values = dailyProviderValues.get(day.key);
      return values ? [...values.values()].reduce((sum, value) => sum + value, 0) : 0;
    }), 0);

    const chart = panel.createDiv({ cls: "api-usage-trend-chart" });
    for (const day of days) {
      const column = chart.createDiv({ cls: "api-usage-trend-column" });
      const stack = column.createDiv({ cls: "api-usage-trend-stack" });
      const values = dailyProviderValues.get(day.key) ?? new Map<string, number>();
      const dayTotal = [...values.values()].reduce((sum, value) => sum + value, 0);
      stack.style.height = maxDaily > 0 ? `${Math.max((dayTotal / maxDaily) * 100, dayTotal > 0 ? 4 : 0)}%` : "0";
      for (const provider of providerTotals.slice(0, 6)) {
        const value = values.get(provider.providerId) ?? 0;
        if (value <= 0 || dayTotal <= 0) {
          continue;
        }
        const segment = stack.createDiv({ cls: "api-usage-trend-segment" });
        segment.style.height = `${(value / dayTotal) * 100}%`;
        segment.style.background = this.providerColor(provider.providerId);
        segment.setAttr("title", this.chartTooltip(day.label, provider.providerName, value, dayTotal, unit));
        segment.setAttr("aria-label", this.chartTooltip(day.label, provider.providerName, value, dayTotal, unit));
      }
      column.createDiv({ cls: "api-usage-trend-label", text: day.label });
      column.setAttr("title", `${day.label}：总计 ${this.compactNumber(dayTotal)} ${unit}`);
    }

    this.renderProviderLegend(panel, providerTotals.slice(0, 6), unit);
  }

  private renderProviderPie(parent: Element, providerTotals: Array<{ providerId: string; providerName: string; value: number }>, total: number, unit: string): void {
    const panel = parent.createDiv({ cls: "api-usage-chart-panel" });
    panel.createDiv({ cls: "api-usage-chart-title", text: "模型用量" });
    const body = panel.createDiv({ cls: "api-usage-pie-layout" });
    const donut = body.createDiv({ cls: "api-usage-donut" });
    donut.style.background = this.donutGradient(providerTotals, total);
    donut.setAttr("title", this.pieSummary(providerTotals.slice(0, 8), total, unit));
    const center = donut.createDiv({ cls: "api-usage-donut-center" });
    center.createDiv({ text: this.compactNumber(total) });
    center.createDiv({ text: unit });

    const list = body.createDiv({ cls: "api-usage-pie-list" });
    for (const provider of providerTotals.slice(0, 8)) {
      const row = list.createDiv({ cls: "api-usage-pie-row" });
      const left = row.createDiv({ cls: "api-usage-pie-provider" });
      const dot = left.createSpan({ cls: "api-usage-color-dot" });
      dot.style.background = this.providerColor(provider.providerId);
      const name = left.createDiv();
      name.createDiv({ text: provider.providerName });
      name.createDiv({ cls: "api-usage-muted", text: `${this.compactNumber(provider.value)} ${unit}` });
      row.createSpan({ text: this.percentOf(provider.value, total) });
      row.setAttr("title", `${provider.providerName}：${this.compactNumber(provider.value)} ${unit}，占比 ${this.percentOf(provider.value, total)}`);
    }
  }

  private renderProviderLegend(parent: HTMLElement, providers: Array<{ providerId: string; providerName: string; value?: number }>, unit?: string): void {
    const legend = parent.createDiv({ cls: "api-usage-provider-legend" });
    for (const provider of providers) {
      const item = legend.createSpan();
      const dot = item.createSpan({ cls: "api-usage-color-dot" });
      dot.style.background = this.providerColor(provider.providerId);
      item.createSpan({ text: provider.providerName });
      if (provider.value !== undefined && unit) {
        item.setAttr("title", `${provider.providerName}：${this.compactNumber(provider.value)} ${unit}`);
      }
    }
  }

  private chartTooltip(label: string, providerName: string, value: number, total: number, unit: string): string {
    return `${label}｜${providerName}：${this.compactNumber(value)} ${unit}，占比 ${this.percentOf(value, total)}`;
  }

  private pieSummary(providerTotals: Array<{ providerName: string; value: number }>, total: number, unit: string): string {
    if (total <= 0) {
      return `暂无${unit}记录`;
    }
    return providerTotals
      .map((provider) => `${provider.providerName}：${this.compactNumber(provider.value)} ${unit}，${this.percentOf(provider.value, total)}`)
      .join("\n");
  }

  private shouldShowMetric(label: string): boolean {
    const category = this.metricCategory(label);
    const options = this.plugin.settings.displayOptions;

    switch (category) {
      case "quotaRemaining":
        return options.showUsage;
      case "balance":
        return options.showBalance;
      case "usage":
        return options.showUsage;
      case "token":
        return options.showUsage;
      case "reset":
        return options.showResetTime;
      case "status":
        return options.showStatus;
      case "other":
        return true;
    }
  }

  private cardMetrics(result: ProviderQuotaResult): ProviderQuotaResult["metrics"] {
    const filtered = result.metrics
      .filter((metric) => this.shouldShowMetric(metric.label))
      .filter((metric) => !this.isRedundantMetric(metric.label, result));
    return filtered.sort((a, b) => this.metricPriority(a.label) - this.metricPriority(b.label));
  }

  private isRedundantMetric(label: string, result: ProviderQuotaResult): boolean {
    const normalized = label.toLowerCase();
    if (normalized.includes("是否可用")) {
      return true;
    }
    if (normalized.includes("已用") && this.hasRemainingWindowMetric(result.metrics, label)) {
      return true;
    }
    if (normalized.includes("响应类型") || normalized.includes("直连查询")) {
      return true;
    }
    return false;
  }

  private hasRemainingWindowMetric(metrics: ProviderQuotaResult["metrics"], label: string): boolean {
    const windowName = label.replace(/已用.*/, "").trim();
    if (!windowName) {
      return false;
    }
    return metrics.some((metric) => metric.label.startsWith(windowName) && metric.label.includes("剩余"));
  }

  private primaryMetric(metrics: ProviderQuotaResult["metrics"]): ProviderQuotaResult["metrics"][number] {
    return [...metrics].sort((a, b) => this.metricPriority(a.label) - this.metricPriority(b.label))[0];
  }

  private metricPriority(label: string): number {
    const category = this.metricCategory(label);
    if (category === "token" && !label.includes("剩余")) {
      return 0;
    }
    if (category === "balance") {
      return 1;
    }
    if (category === "quotaRemaining") {
      return 2;
    }
    if (this.isModelMetric(label)) {
      return 3;
    }
    if (category === "usage") {
      return 4;
    }
    if (category === "reset") {
      return 5;
    }
    if (category === "status") {
      return 6;
    }
    return 7;
  }

  private renderSummary(container: Element, enabledCount: number): void {
    const readyCount = this.results.filter((result) => result.status === "ready").length;
    const issueCount = this.results.filter((result) => result.status !== "ready").length;
    const summary = container.createDiv({ cls: "api-usage-summary" });
    this.renderSummaryItem(summary, "layers", "已添加", String(enabledCount));
    this.renderSummaryItem(summary, "check-circle-2", "可用", String(readyCount));
    this.renderSummaryItem(summary, "alert-circle", "异常", String(issueCount));
  }

  private renderSummaryItem(parent: HTMLElement, iconName: string, label: string, value: string): void {
    const item = parent.createDiv({ cls: "api-usage-summary-item" });
    const icon = item.createSpan({ cls: "api-usage-summary-icon" });
    setIcon(icon, iconName);
    const content = item.createDiv();
    content.createDiv({ cls: "api-usage-summary-value", text: value });
    content.createDiv({ cls: "api-usage-summary-label", text: label });
  }

  private metricIcon(label: string): string {
    const normalized = label.toLowerCase();
    if (this.isModelMetric(label)) {
      return "brain-circuit";
    }
    if (normalized.includes("reset") || normalized.includes("重置")) {
      return "clock";
    }
    if (this.isTokenPlanMetric(normalized) && (normalized.includes("remaining") || normalized.includes("剩余"))) {
      return "gauge";
    }
    if (normalized.includes("token")) {
      return "cpu";
    }
    if (normalized.includes("used") || normalized.includes("usage") || normalized.includes("已用") || normalized.includes("用量")) {
      return "activity";
    }
    if (normalized.includes("balance") || normalized.includes("credit") || normalized.includes("cash") || normalized.includes("available") || normalized.includes("remaining") || normalized.includes("余额") || normalized.includes("可用") || normalized.includes("授信") || normalized.includes("剩余")) {
      return "coins";
    }
    if (normalized.includes("valid") || normalized.includes("status") || normalized.includes("available") || normalized.includes("状态") || normalized.includes("可用")) {
      return "badge-check";
    }
    if (normalized.includes("url")) {
      return "link";
    }
    return "bar-chart-3";
  }

  private isModelMetric(label: string): boolean {
    const normalized = label.toLowerCase();
    return normalized.includes("调用模型") || normalized.includes("model used") || normalized.includes("actual model");
  }

  private metricCategory(label: string): "quotaRemaining" | "balance" | "usage" | "token" | "reset" | "status" | "other" {
    const normalized = label.toLowerCase();
    if (normalized.includes("reset") || normalized.includes("重置")) {
      return "reset";
    }
    if (this.isTokenPlanMetric(normalized) && (normalized.includes("remaining") || normalized.includes("剩余"))) {
      return "quotaRemaining";
    }
    if (normalized.includes("used") || normalized.includes("usage") || normalized.includes("quota") || normalized.includes("已用") || normalized.includes("用量") || normalized.includes("额度")) {
      return "usage";
    }
    if (normalized.includes("token")) {
      return "token";
    }
    if (normalized.includes("balance") || normalized.includes("credit") || normalized.includes("cash") || normalized.includes("available") || normalized.includes("remaining") || normalized.includes("voucher") || normalized.includes("topped") || normalized.includes("余额") || normalized.includes("可用") || normalized.includes("授信") || normalized.includes("充值") || normalized.includes("现金")) {
      return "balance";
    }
    if (normalized.includes("valid") || normalized.includes("status") || normalized.includes("currency") || normalized.includes("unit") || normalized.includes("plan") || normalized.includes("状态") || normalized.includes("币种") || normalized.includes("单位") || normalized.includes("套餐")) {
      return "status";
    }
    return "other";
  }

  private isTokenPlanMetric(normalizedLabel: string): boolean {
    return normalizedLabel.includes("quota")
      || normalizedLabel.includes("额度")
      || normalizedLabel.includes("token")
      || normalizedLabel.includes("5 小时")
      || normalizedLabel.includes("五小时")
      || normalizedLabel.includes("five hour")
      || normalizedLabel.includes("weekly")
      || normalizedLabel.includes("周")
      || normalizedLabel.includes("monthly")
      || normalizedLabel.includes("月")
      || normalizedLabel.includes("session");
  }

  private renderMetricVisual(parent: HTMLElement, metric: ProviderQuotaResult["metrics"][number], isHero: boolean): void {
    const percent = this.percentValue(metric.value);
    if (percent === null) {
      const icon = parent.createSpan({ cls: isHero ? "api-usage-hero-icon" : "api-usage-metric-icon" });
      setIcon(icon, this.metricIcon(metric.label));
      return;
    }

    const ring = parent.createSpan({ cls: isHero ? "api-usage-percent-ring is-hero" : "api-usage-percent-ring" });
    const clamped = Math.max(0, Math.min(percent, 100));
    ring.style.setProperty("--api-usage-percent", `${clamped}%`);
    ring.createSpan({ text: `${Math.round(clamped)}` });
  }

  private renderMetricBar(parent: HTMLElement, metric: ProviderQuotaResult["metrics"][number]): void {
    const percent = this.percentValue(metric.value);
    if (percent === null) {
      return;
    }

    const bar = parent.createDiv({ cls: "api-usage-percent-bar" });
    const fill = bar.createDiv({ cls: "api-usage-percent-fill" });
    fill.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
  }

  private renderHeatmap(parent: HTMLElement, result: ProviderQuotaResult): void {
    const history = this.plugin.getUsageHistory(result.providerId);
    const buckets = this.heatmapBuckets(history);
    const panel = parent.createDiv({ cls: "api-usage-heatmap" });
    const header = panel.createDiv({ cls: "api-usage-heatmap-header" });
    header.createSpan({ text: "最近 7 天用量热力图" });
    header.createSpan({ text: this.heatmapLegend(history) });

    if (!history.length) {
      panel.createDiv({ cls: "api-usage-heatmap-empty", text: "刷新后开始记录本地用量历史。" });
      return;
    }

    const grid = panel.createDiv({ cls: "api-usage-heatmap-grid" });
    const max = Math.max(...buckets.map((bucket) => bucket.value), 0);
    for (const bucket of buckets) {
      const level = this.heatmapLevel(bucket.value, max);
      const cell = grid.createSpan({ cls: `api-usage-heatmap-cell level-${level}` });
      const tooltip = this.heatmapTooltip(bucket, history[history.length - 1]?.kind);
      cell.setAttr("aria-label", tooltip);
      cell.setAttr("title", tooltip);
    }
  }

  private heatmapBuckets(history: UsageHistorySample[]): Array<{ key: string; label: string; value: number; models: Map<string, number> }> {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const start = new Date(now.getTime() - (7 * 24 - 1) * 60 * 60 * 1000);
    const buckets = new Map<string, { key: string; label: string; value: number; models: Map<string, number> }>();

    for (let index = 0; index < 7 * 24; index += 1) {
      const date = new Date(start.getTime() + index * 60 * 60 * 1000);
      const key = this.hourKey(date);
      buckets.set(key, {
        key,
        label: date.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit" }),
        value: 0,
        models: new Map<string, number>()
      });
    }

    for (const sample of history) {
      const date = new Date(sample.timestamp);
      if (date < start || date > new Date(now.getTime() + 60 * 60 * 1000)) {
        continue;
      }
      date.setMinutes(0, 0, 0);
      const bucket = buckets.get(this.hourKey(date));
      if (bucket) {
        bucket.value = sample.kind === "percent" ? Math.max(bucket.value, sample.value) : bucket.value + sample.value;
        bucket.models.set(sample.providerName, (bucket.models.get(sample.providerName) ?? 0) + sample.value);
      }
    }

    return [...buckets.values()];
  }

  private heatmapLevel(value: number, max: number): number {
    if (value <= 0 || max <= 0) {
      return 0;
    }
    return Math.max(1, Math.min(4, Math.ceil(Math.sqrt(value / max) * 4)));
  }

  private heatmapTooltip(bucket: { label: string; value: number; models: Map<string, number> }, kind?: UsageHistorySample["kind"]): string {
    const unit = this.kindUnit(kind ?? "tokens");
    const lines = [`${bucket.label}：总计 ${this.formatHeatmapValue(bucket.value, kind)} ${unit}`];
    const modelLines = [...bucket.models.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => `${name}：${this.formatHeatmapValue(value, kind)} ${unit}`);
    return [...lines, ...modelLines].join("\n");
  }

  private heatmapLegend(history: UsageHistorySample[]): string {
    const latest = history[history.length - 1];
    if (!latest) {
      return "等待采样";
    }
    return latest.kind === "percent" ? "按百分比采样" : `按${latest.kind === "tokens" ? "Token" : latest.kind === "currency" ? "额度" : "次数"}采样`;
  }

  private formatHeatmapValue(value: number, kind?: UsageHistorySample["kind"]): string {
    if (kind === "percent") {
      return `${value.toFixed(1)}%`;
    }
    return new Intl.NumberFormat().format(Math.round(value));
  }

  private hourKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
  }

  private filteredHistory(days: number): UsageHistorySample[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return Object.values(this.plugin.settings.usageHistory)
      .flat()
      .filter((sample) => new Date(sample.timestamp).getTime() >= cutoff)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  private providerTotals(history: UsageHistorySample[]): Array<{ providerId: string; providerName: string; value: number }> {
    const totals = new Map<string, { providerId: string; providerName: string; value: number }>();
    for (const sample of history) {
      if (this.isGenericCodingPlanName(sample.providerName)) {
        continue;
      }
      const current = totals.get(sample.providerId) ?? {
        providerId: sample.providerId,
        providerName: sample.providerName,
        value: 0
      };
      current.value += sample.value;
      current.providerName = sample.providerName;
      totals.set(sample.providerId, current);
    }
    return [...totals.values()].sort((a, b) => b.value - a.value);
  }

  private isGenericCodingPlanName(name: string): boolean {
    const normalized = name.toLowerCase();
    return normalized.includes(" coding")
      || normalized.endsWith("coding")
      || normalized.includes("agent plan")
      || normalized.includes("token plan");
  }

  private daysInRange(days: number): Array<{ key: string; label: string }> {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(start.getTime() + index * 24 * 60 * 60 * 1000);
      return {
        key: this.dayKey(date),
        label: date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
      };
    });
  }

  private dayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  private kindUnit(kind: UsageHistorySample["kind"]): string {
    switch (kind) {
      case "tokens":
        return "tokens";
      case "percent":
        return "额度百分比";
      case "currency":
        return "额度";
      case "count":
        return "次";
    }
  }

  private compactNumber(value: number): string {
    if (!Number.isFinite(value)) {
      return "0";
    }
    if (Math.abs(value) >= 10000) {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 10000)}万`;
    }
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value);
  }

  private percentOf(value: number, total: number): string {
    if (total <= 0) {
      return "0%";
    }
    return `${Math.round((value / total) * 100)}%`;
  }

  private providerColor(providerId: string): string {
    const palette = [
      "var(--interactive-accent)",
      "var(--color-green, #22c55e)",
      "var(--color-purple, #8b5cf6)",
      "var(--color-red, #ef4444)",
      "var(--color-orange, #f59e0b)",
      "var(--color-cyan, #06b6d4)",
      "var(--color-pink, #ec4899)",
      "var(--text-muted)"
    ];
    let hash = 0;
    for (const char of providerId) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return palette[hash % palette.length];
  }

  private donutGradient(providerTotals: Array<{ providerId: string; value: number }>, total: number): string {
    if (total <= 0 || !providerTotals.length) {
      return "conic-gradient(color-mix(in srgb, var(--api-usage-border) 70%, transparent) 0 100%)";
    }

    let cursor = 0;
    const stops = providerTotals.map((provider) => {
      const start = cursor;
      cursor += (provider.value / total) * 100;
      return `${this.providerColor(provider.providerId)} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }

  private percentValue(value: string): number | null {
    const match = value.match(/-?\d+(\.\d+)?(?=%)/);
    if (!match) {
      return null;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

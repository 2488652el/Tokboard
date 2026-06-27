# 开发环境

## 本机环境

- Node.js: v24.11.0
- npm: 11.6.1
- Obsidian vault: `Y:\陈鑫杰\LLM-WIKI`
- 插件源码: `10-原始资料\收件箱\软件开发\obsidian plugin\tokboard`
- 插件安装目录: `.obsidian\plugins\tokboard`

## 初始化

```bash
npm install
```

## 构建

```bash
npm run build
```

## 复制到当前 vault

```bash
npm run copy-to-vault
```

复制文件：

- `main.js`
- `manifest.json`
- `styles.css`

## Obsidian 启用步骤

1. 打开 Obsidian 设置。
2. 关闭安全模式或进入第三方插件列表。
3. 找到 `Tokboard` 并启用。
4. 在插件设置里启用供应商，填写 API Key 和 Base URL。
5. 点击左侧 gauge 图标或命令面板中的「打开 Tokboard 面板」。

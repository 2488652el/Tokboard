# Tokboard

> A local-first token usage board for Obsidian.

Tokboard helps you track AI API usage from inside your Obsidian vault. It brings API balances, coding-plan quota windows, local Codex usage logs, model-level token history, heatmaps, trends, and provider details into one compact dashboard.

It is designed for people who use several model providers and do not want to jump between consoles just to answer: "How much did I use, which model used the most, and what quota window is getting tight?"

## Highlights

- **One Obsidian dashboard** for AI API usage, balances, token plans, and coding-plan quota windows.
- **Model-level history** with total usage, most-used model, 7/30 day trend charts, donut breakdowns, and hourly heatmaps.
- **Compact provider cards** that emphasize the useful number first: token usage, remaining quota, or balance.
- **Coding Plan support** for Kimi, Zhipu GLM, MiniMax, and Volcengine-style quota windows.
- **Codex local usage parser** that reads local Codex JSONL session logs without requiring an OpenAI Admin key.
- **OpenAI Admin usage support** for organization-level daily completions usage by model.
- **Gemini best-effort mode** for API connectivity and token-count testing, with clear limits for historical usage.
- **Theme-aware UI** that follows Obsidian background, border, text, and accent variables.
- **Local-first storage**: credentials stay in Obsidian plugin data unless you choose environment variables.
- **Optional encrypted archive** for syncing usage snapshots through tools such as Fast Note Sync.

## Screens

Tokboard is built as a monitoring-style panel:

- top summary cards for total usage, enabled models, active days, and the most-used model
- hourly heatmap with hover details for model and token counts
- daily stacked token trend chart
- model usage donut
- simplified provider and coding-plan detail cards

## Supported Providers

Support is intentionally explicit. Tokboard shows real provider data where a public or documented endpoint exists, and it marks limited providers clearly when a normal API key cannot query historical usage.

| Provider | Status | What Tokboard reads |
|---|---:|---|
| DeepSeek | Supported | Account balance from `/user/balance` |
| StepFun | Supported | Account balance from `/accounts` |
| SiliconFlow | Supported | Account balance from `/user/info` |
| OpenRouter | Supported | Credits and total usage from `/credits` |
| Novita AI | Supported | Account balance from `/user/balance` |
| Kimi For Coding | Supported | 5-hour and weekly Token Plan quota windows |
| Zhipu GLM Coding | Supported | Token Plan quota limit windows |
| MiniMax Coding | Supported | Coding-plan remaining percentage windows |
| Volcengine Coding / Agent Plan | Supported | Console cURL parser plus OpenAPI fallback |
| Codex local sessions | Supported | Local `~/.codex` JSONL token-count events |
| OpenAI Admin / GPT-5 usage | Supported | Organization usage completions API |
| Google Gemini | Best effort | API connectivity and `countTokens`; historical usage needs Google Cloud Monitoring |
| Moonshot / Kimi | Best effort | Account balance endpoint when available |
| OpenAI-compatible | Best effort | Legacy/compatible credit endpoint when available |
| Anthropic / DashScope | Limited | Normal model API keys usually cannot query account usage directly |

See [docs/provider-matrix.md](docs/provider-matrix.md) for details and caveats.

## Security Model

Tokboard is local-first.

- API keys are stored only in Obsidian plugin data (`data.json`) unless you leave them blank and use environment variable fallback.
- API keys are not written into notes.
- API keys are not included in the encrypted archive.
- API keys are not logged by Tokboard.
- Provider failures are isolated: one bad key or provider outage does not break the rest of the dashboard.
- The optional archive stores usage snapshots and history only, encrypted with AES-GCM using your passphrase.

Do not commit your vault plugin `data.json`, `.env` files, copied console cURL with cookies, or any real credentials.

## Install Manually

Until Tokboard is listed in Obsidian's community plugin directory:

1. Download the release files:
   - `manifest.json`
   - `main.js`
   - `styles.css`
2. Create this folder in your vault:

   ```text
   .obsidian/plugins/tokboard/
   ```

3. Put the three files into that folder.
4. Restart Obsidian or reload community plugins.
5. Enable **Tokboard** in `Settings -> Community plugins`.

## Development

```bash
npm install
npm run build
```

For the local development vault used by this project:

```bash
npm run copy-to-vault
```

That copies:

- `main.js`
- `manifest.json`
- `styles.css`

to `.obsidian/plugins/tokboard/`.

## Release Checklist

Before publishing a release:

```bash
npm run lint
npm run build
```

Then create a GitHub release containing:

- `manifest.json`
- `main.js`
- `styles.css`

The release tag should match `manifest.json` and `versions.json`, for example `0.1.0`.

## Obsidian Community Plugin Directory

To make Tokboard searchable in Obsidian's third-party plugin browser:

1. Publish this repository publicly on GitHub.
2. Create a GitHub release with `manifest.json`, `main.js`, and `styles.css`.
3. Make sure the plugin ID is stable: `tokboard`.
4. Fork `obsidianmd/obsidian-releases`.
5. Add Tokboard to the community plugin manifest list.
6. Open a pull request to `obsidianmd/obsidian-releases`.
7. Wait for Obsidian review. After approval, Tokboard becomes searchable in Obsidian's community plugin browser.

Official repository: <https://github.com/obsidianmd/obsidian-releases>

## Credits

Tokboard's provider thinking is inspired by CC Switch's usage-query categories and local session usage parsing ideas.

- CC Switch docs: <https://ccswitch.io/zh/docs?section=providers&item=usage-query>
- CC Switch repository: <https://github.com/farion1231/cc-switch>

## License

MIT

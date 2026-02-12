---
name: openpond-cli
description: Use the OpenPond CLI to create repos, watch deployments, and run tools without the web UI.
metadata:
  short-description: OpenPond CLI workflows
---

# OpenPond CLI

Use this skill when an agent needs to create or manage OpenPond apps via the CLI, without MCP.

## Quick setup

- Install: `npm i -g openpond-code` (or `npx --package openpond-code openpond <cmd>`)
- Auth: run `openpond login` or set `OPENPOND_API_KEY`
- Non-interactive login: `openpond login --api-key opk_...`

## Common workflows

- Create internal repo and attach remote:
  - `openpond repo create --name my-repo --path .`
- Non-interactive push (tokenized remote):
  - `openpond repo create --name my-repo --path . --token`
  - `git add . && git commit -m "init"`
  - `openpond repo push --path . --branch main`
  - `openpond repo push` reads `.git/config`, temporarily tokenizes `origin`, and restores it after push.
- Watch deployments:
  - `openpond deploy watch handle/repo --branch main`
- List and run tools:
  - `openpond tool list handle/repo`
  - `openpond tool run handle/repo myTool --body '{"foo":"bar"}'`
- Account-level APIs:
  - `openpond apps list [--handle <handle>] [--refresh]`
  - `openpond apps tools`
  - `openpond apps performance --app-id app_123`
  - `openpond apps agent create --prompt "Build a daily digest agent"`

## OpenTool passthrough

Use the CLI to run OpenTool commands via `npx`:

- `openpond opentool init --dir .`
- `openpond opentool validate --input tools`
- `openpond opentool build --input tools --output dist`

## Config and URLs

- Optional env vars: `OPENPOND_BASE_URL`, `OPENPOND_API_URL`, `OPENPOND_TOOL_URL`, `OPENPOND_API_KEY`
- Cache file: `~/.openpond/cache.json` (auto-refreshes on next use)
- Staging profile (recommended for template verification):
  - `OPENPOND_BASE_URL=https://staging.openpond.ai`
  - `OPENPOND_API_URL=https://api.staging-api.openpond.ai`
  - `OPENPOND_TOOL_URL=https://apps.staging.openpond.live`
  - `OPENPOND_GATEWAY_URL=https://gateway-staging.openpond.dev`

## Strategy testing (signal bot)

- Gateway pricing checks: `OPENPOND_GATEWAY_URL=https://gateway.openpond.dev bun run tests/gateway.ts`
- Shell variant: `bash tests/gateway.sh`
- Price bot smoke tests: `OPENPOND_GATEWAY_URL=https://gateway.openpond.dev OPENPOND_API_KEY=opk_... OPENPOND_BASE_URL=https://openpond.ai OPENPOND_API_URL=https://api.openpond.ai OPENPOND_TOOL_URL=https://apps.openpond.ai bun run tests/signal-bot-price-bots.ts`
- Shell variant: `bash tests/signal-bot-price-bots.sh`
- Config: `openpond-code/tests/gateway.config.json` + `openpond-code/tests/signal-bot-price-bots.config.json` + `OPENPOND_HYPERLIQUID_BASE_URL`/`OPENPOND_HL_WALLET_ADDRESS`

## Daily Snapshot verification
- Create/update Daily Snapshot in-app (Setup Notifications).
- Run template tools one-by-one:
  - `openpond tool run <handle>/<repo> <tool>`
- Run full testnet verification when needed:
  - `bun run tests/signal-bot-price-bots.ts`

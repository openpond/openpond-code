# OpenPond CLI Tests (Signal Bot, Testnet)

## Goal
Document the end-to-end flow for a Signal Bot on **Hyperliquid testnet**:
1) capture positions before,
2) run the tool,
3) capture positions after,
4) verify outputs.

## Prereqs
- Staging endpoints:
  - `OPENPOND_BASE_URL=https://staging.openpond.ai`
  - `OPENPOND_API_URL=https://api.staging-api.openpond.ai`
  - `OPENPOND_TOOL_URL=https://apps.staging.openpond.live`
- Gateway:
  - `OPENPOND_GATEWAY_URL=https://gateway-staging.openpond.dev`
- Hyperliquid testnet:
  - `OPENPOND_HYPERLIQUID_BASE_URL=<HYPERLIQUID_TESTNET_BASE_URL>`
- Wallet address:
  - `OPENPOND_HL_WALLET_ADDRESS=0x69cc68669d2c91FFc9FaB84C1F845d85E0D36F95`
- OpenPond API key is already in your local OpenPond config. (If not, set `OPENPOND_API_KEY`.)

## 1) Run the end-to-end test (pre/post positions + tool run)
This runs gateway checks, prints positions before/after, and executes the tool once.

```bash
OPENPOND_BASE_URL=https://staging.openpond.ai OPENPOND_API_URL=https://api.staging-api.openpond.ai OPENPOND_TOOL_URL=https://apps.staging.openpond.live OPENPOND_GATEWAY_URL=https://gateway-staging.openpond.dev OPENPOND_HYPERLIQUID_BASE_URL=https://api.hyperliquid-testnet.xyz OPENPOND_HL_WALLET_ADDRESS=0x69cc68669d2c91FFc9FaB84C1F845d85E0D36F95 SIGNAL_BOT_BOTS='[{"id":"signal-bot-rsi","handleRepo":"0xglu/signal-bot-rsi","toolName":"signal-bot","expectPositionChange":"none"}]' SIGNAL_BOT_INDICATOR_CHECKS='{"enabled":true,"symbol":"BTC","resolution":"60","countBack":240,"tolerance":1e-6}' bun run ./tests/signal-bot-price-bots.ts
```

## 2) Optional: run the tool directly (no position checks)
Useful for verifying tool output only.

```bash
OPENPOND_BASE_URL=https://staging.openpond.ai OPENPOND_API_URL=https://api.staging-api.openpond.ai OPENPOND_TOOL_URL=https://apps.staging.openpond.live bun run ./src/cli-package.ts tool run 0xglu/signal-bot-rsi signal-bot --method GET
```

## 3) Template update flow (openpondai -> 0xglu)
Use the API key stored in `~/.openpond/config.json` (do not export `OPENPOND_API_KEY` for this path).

```bash
# OPENPOND_API_KEY="<OPENPOND_API_KEY>"
OPENPOND_BASE_URL=https://staging.openpond.ai OPENPOND_API_URL=https://api.staging-api.openpond.ai OPENPOND_TOOL_URL=https://apps.staging.openpond.live bun run ./src/cli-package.ts template update 0xglu/init-hyperliquid-app
```

## Notes
- RSI config used for the app:
  - `asset: BTC`
  - `resolution: 60`
  - `countBack: 240`
  - `indicators: ["rsi"]`
- Schedule: derived from `resolution` (`60` => hourly) and enabled by default unless overridden in the app config.
- If you omit `OPENPOND_HYPERLIQUID_BASE_URL` + `OPENPOND_HL_WALLET_ADDRESS`, the positions check is skipped.
- Gateway checks come from `openpond-code/tests/gateway.config.json` unless you set `OPENPOND_GATEWAY_URL`.
- If positions change unexpectedly, the run fails and prints the diff.

## OpenClaw Dispatch (Staging)
- Use staging profile vars for every dispatch:
  - `OPENPOND_BASE_URL=https://staging.openpond.ai`
  - `OPENPOND_API_URL=https://api.staging-api.openpond.ai`
  - `OPENPOND_TOOL_URL=https://apps.staging.openpond.live`
  - `OPENPOND_GATEWAY_URL=https://gateway-staging.openpond.dev`
- Recommended dispatch commands:
  - `/pond-tool-list <handle/repo>` -> `openpond tool list <handle>/<repo>`
  - `/pond-tool-run <handle/repo> <tool>` -> `openpond tool run <handle>/<repo> <tool>`
  - `/pond-template-update <handle/repo>` -> `openpond template update <handle>/<repo>`
  - `/pond-deploy-watch <handle/repo> [branch]` -> `openpond deploy watch <handle>/<repo> --branch <branch>`
  - `/pond-agent-create <prompt>` -> `openpond apps agent create --prompt "<prompt>"`

## Daily Snapshot Loop
- Create/update Daily Snapshot via in-app setup (Setup Notifications).
- Run each template tool from CLI:
  - `openpond tool run <handle>/<repo> <tool>`
- For Hyperliquid template validation, run:
  - `bun run ./tests/signal-bot-price-bots.ts`

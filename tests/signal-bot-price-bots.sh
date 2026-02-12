#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
CONFIG_PATH=${SIGNAL_BOT_TEST_CONFIG:-"${SCRIPT_DIR}/signal-bot-price-bots.config.json"}
GATEWAY_CONFIG_PATH=${SIGNAL_BOT_GATEWAY_CONFIG:-"${SCRIPT_DIR}/gateway.config.json"}

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "missing config: ${CONFIG_PATH}"
  exit 1
fi
if [[ ! -f "${GATEWAY_CONFIG_PATH}" ]]; then
  echo "missing gateway config: ${GATEWAY_CONFIG_PATH}"
  exit 1
fi

config_value() {
  local file="$1"
  local key="$2"
  node -e "const fs=require('fs');const cfg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const value=cfg${key};if(value!==undefined&&value!==null)process.stdout.write(String(value));" "${file}"
}

CONFIG_BASE_URL=$(config_value "${CONFIG_PATH}" ".hyperliquid?.baseUrl")
CONFIG_WALLET=$(config_value "${CONFIG_PATH}" ".hyperliquid?.walletAddress")
CONFIG_DELAY=$(config_value "${CONFIG_PATH}" ".postRunDelayMs")
CONFIG_GATEWAY=$(config_value "${GATEWAY_CONFIG_PATH}" ".gateway?.baseUrl")
CONFIG_ENV=$(config_value "${GATEWAY_CONFIG_PATH}" ".environment")

HYPERLIQUID_BASE_URL=${OPENPOND_HYPERLIQUID_BASE_URL:-${HYPERLIQUID_BASE_URL:-${CONFIG_BASE_URL}}}
HL_WALLET_ADDRESS=${OPENPOND_HL_WALLET_ADDRESS:-${HL_WALLET_ADDRESS:-${CONFIG_WALLET}}}
POST_RUN_DELAY_MS=${SIGNAL_BOT_POST_RUN_DELAY_MS:-${CONFIG_DELAY:-5000}}
ENVIRONMENT=${OPENPOND_ENV:-${CONFIG_ENV}}
GATEWAY_URL=${OPENPOND_GATEWAY_URL:-}
if [[ -z "${GATEWAY_URL}" ]]; then
  if [[ "${ENVIRONMENT}" == "production" ]]; then
    GATEWAY_URL="https://gateway.openpond.dev"
  elif [[ "${ENVIRONMENT}" == "staging" ]]; then
    GATEWAY_URL="https://gateway-staging.openpond.dev"
  fi
fi
if [[ -z "${GATEWAY_URL}" ]]; then
  GATEWAY_URL=${CONFIG_GATEWAY}
fi

positions_enabled=true
if [[ -z "${HYPERLIQUID_BASE_URL}" || -z "${HL_WALLET_ADDRESS}" ]]; then
  positions_enabled=false
  echo "positions check disabled (set OPENPOND_HYPERLIQUID_BASE_URL/HYPERLIQUID_BASE_URL + OPENPOND_HL_WALLET_ADDRESS/HL_WALLET_ADDRESS or update config)"
fi

fetch_positions() {
  curl -fsS -X POST "${HYPERLIQUID_BASE_URL}/info" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"clearinghouseState\",\"user\":\"${HL_WALLET_ADDRESS}\"}"
}

normalize_positions() {
  node -e 'const fs=require("fs");const input=fs.readFileSync(0,"utf8").trim();if(!input){process.exit(1);}const payload=JSON.parse(input);const data=(payload&&payload.data)?payload.data:payload;const rows=Array.isArray(data&&data.assetPositions)?data.assetPositions:[];const summary=rows.map((row)=>{const pos=row&&row.position?row.position:{};return {coin:pos.coin||null,size:pos.szi??null};}).filter((p)=>p.coin);summary.sort((a,b)=>String(a.coin).localeCompare(String(b.coin)));process.stdout.write(JSON.stringify(summary));'
}

print_positions() {
  node -e 'const fs=require("fs");const input=fs.readFileSync(0,"utf8").trim();if(!input){process.exit(1);}const payload=JSON.parse(input);const data=(payload&&payload.data)?payload.data:payload;const rows=Array.isArray(data&&data.assetPositions)?data.assetPositions:[];const summary=rows.map((row)=>{const pos=row&&row.position?row.position:{};return {coin:pos.coin||null,size:pos.szi??null};}).filter((p)=>p.coin);summary.sort((a,b)=>String(a.coin).localeCompare(String(b.coin)));console.log(JSON.stringify({positions:summary},null,2));'
}

fetch_gateway_bars() {
  local symbol="$1"
  local resolution="$2"
  local count_back="$3"
  curl -fsS "${GATEWAY_URL}/v1/hyperliquid/bars?symbol=${symbol}&resolution=${resolution}&countBack=${count_back}"
}

check_gateway_bars() {
  local label="$1"
  local symbol="$2"
  local resolution="$3"
  local count_back="$4"
  local min_items="$5"

  local raw
  raw=$(fetch_gateway_bars "${symbol}" "${resolution}" "${count_back}")

  node -e 'const fs=require("fs");const label=process.argv[1];const min=Number(process.argv[2]);const payload=JSON.parse(fs.readFileSync(0,"utf8"));const bars=payload&&payload.bars;const count=Array.isArray(bars)?bars.length:0;if(count<min){console.error(`[fail] ${label} bars=${count} min=${min}`);process.exit(1);}console.log(`[ok] ${label} bars=${count}`);' "${label}" "${min_items}" <<<"${raw}"
}

run_cli() {
  (cd "${REPO_ROOT}" && bun ./src/cli-package.ts "$@")
}

mapfile -t GATEWAY_CHECKS < <(node -e 'const fs=require("fs");const cfg=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const checks=Array.isArray(cfg.gateway&&cfg.gateway.bars)?cfg.gateway.bars:[];for(const check of checks){const label=check.label||`${check.symbol}-${check.resolution}`;const symbol=check.symbol;const resolution=check.resolution;const countBack=check.countBack;const minItems=check.minItems; if(!symbol||!resolution||countBack==null||minItems==null) continue; console.log([label,symbol,resolution,countBack,minItems].join("|"));}' "${GATEWAY_CONFIG_PATH}")

mapfile -t BOTS < <(node -e 'const fs=require("fs");const cfg=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const bots=Array.isArray(cfg.bots)?cfg.bots:[];for(const bot of bots){const handleRepo=bot.handleRepo; if(!handleRepo) continue; const id=bot.id||handleRepo; const toolName=bot.toolName||"signal-bot"; const expect=bot.expectPositionChange||"none"; console.log([id,handleRepo,toolName,expect].join("|"));}' "${CONFIG_PATH}")

if [[ ${#BOTS[@]} -eq 0 ]]; then
  echo "no bots configured in ${CONFIG_PATH}"
  exit 1
fi

if [[ -z "${GATEWAY_URL}" ]]; then
  echo "missing OPENPOND_GATEWAY_URL (or gateway.baseUrl in config)"
  exit 1
fi
if [[ ${#GATEWAY_CHECKS[@]} -eq 0 ]]; then
  echo "no gateway checks configured in ${GATEWAY_CONFIG_PATH}"
  exit 1
fi
echo "==> gateway pricing checks"
for entry in "${GATEWAY_CHECKS[@]}"; do
  IFS="|" read -r label symbol resolution count_back min_items <<<"${entry}"
  check_gateway_bars "${label}" "${symbol}" "${resolution}" "${count_back}" "${min_items}"
done

failure=0
for entry in "${BOTS[@]}"; do
  IFS="|" read -r bot_id handle_repo tool_name expect_change <<<"${entry}"
  echo "==> ${bot_id} (${handle_repo})"

  before_snapshot=""
  if [[ "${positions_enabled}" == "true" ]]; then
    echo "[positions] before"
    fetch_positions | print_positions
    before_snapshot=$(fetch_positions | normalize_positions)
  fi

  echo "[tool] run ${tool_name}"
  run_cli tool run "${handle_repo}" "${tool_name}" --method GET

  if [[ "${positions_enabled}" == "true" ]]; then
    sleep "$(node -e "console.log(Math.max(${POST_RUN_DELAY_MS},0)/1000)")"
    echo "[positions] after"
    fetch_positions | print_positions
    after_snapshot=$(fetch_positions | normalize_positions)

    if [[ "${before_snapshot}" != "${after_snapshot}" ]]; then
      if [[ "${expect_change}" == "none" ]]; then
        echo "[fail] positions changed for ${bot_id}"
        failure=1
      else
        echo "[ok] positions changed for ${bot_id}"
      fi
    else
      if [[ "${expect_change}" == "any" ]]; then
        echo "[fail] positions did not change for ${bot_id}"
        failure=1
      else
        echo "[ok] positions unchanged for ${bot_id}"
      fi
    fi
  fi

done

exit ${failure}

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CONFIG_PATH=${SIGNAL_BOT_GATEWAY_CONFIG:-"${SCRIPT_DIR}/gateway.config.json"}

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "missing config: ${CONFIG_PATH}"
  exit 1
fi

config_value() {
  local key="$1"
  node -e "const fs=require('fs');const cfg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const value=cfg${key};if(value!==undefined&&value!==null)process.stdout.write(String(value));" "${CONFIG_PATH}"
}

CONFIG_ENV=$(config_value ".environment")
CONFIG_GATEWAY=$(config_value ".gateway?.baseUrl")
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
if [[ -z "${GATEWAY_URL}" ]]; then
  echo "missing OPENPOND_GATEWAY_URL (or gateway.baseUrl in config)"
  exit 1
fi

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

mapfile -t GATEWAY_CHECKS < <(node -e 'const fs=require("fs");const cfg=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const checks=Array.isArray(cfg.gateway&&cfg.gateway.bars)?cfg.gateway.bars:[];for(const check of checks){const label=check.label||`${check.symbol}-${check.resolution}`;const symbol=check.symbol;const resolution=check.resolution;const countBack=check.countBack;const minItems=check.minItems; if(!symbol||!resolution||countBack==null||minItems==null) continue; console.log([label,symbol,resolution,countBack,minItems].join("|"));}' "${CONFIG_PATH}")

if [[ ${#GATEWAY_CHECKS[@]} -eq 0 ]]; then
  echo "no gateway checks configured in ${CONFIG_PATH}"
  exit 1
fi

echo "==> gateway pricing checks"
for entry in "${GATEWAY_CHECKS[@]}"; do
  IFS="|" read -r label symbol resolution count_back min_items <<<"${entry}"
  check_gateway_bars "${label}" "${symbol}" "${resolution}" "${count_back}" "${min_items}"
done

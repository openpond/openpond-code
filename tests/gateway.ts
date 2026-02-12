import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type GatewayCheck = {
  label?: string;
  symbol: string;
  resolution: string;
  countBack: number;
  minItems: number;
};

type TestConfig = {
  environment?: string;
  gateway?: {
    baseUrl?: string;
    bars?: GatewayCheck[];
  };
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function readConfig(configPath: string): TestConfig {
  const raw = readFileSync(configPath, "utf8");
  return JSON.parse(raw) as TestConfig;
}

async function fetchGatewayBars(params: {
  baseUrl: string;
  symbol: string;
  resolution: string;
  countBack: number;
}): Promise<unknown> {
  const base = params.baseUrl.replace(/\/$/, "");
  const url = new URL(`${base}/v1/hyperliquid/bars`);
  url.searchParams.set("symbol", params.symbol);
  url.searchParams.set("resolution", params.resolution);
  url.searchParams.set("countBack", params.countBack.toString());
  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`gateway bars failed: ${response.status} ${text}`.trim());
  }
  return response.json();
}

async function main() {
  const configPath =
    process.env.SIGNAL_BOT_GATEWAY_CONFIG || path.join(scriptDir, "gateway.config.json");
  const config = readConfig(configPath);

  const environment = (process.env.OPENPOND_ENV || config.environment || "").toLowerCase();
  const inferredGateway =
    environment === "production"
      ? "https://gateway.openpond.dev"
      : environment === "staging"
        ? "https://gateway-staging.openpond.dev"
        : "";
  const gatewayUrl =
    process.env.OPENPOND_GATEWAY_URL ||
    inferredGateway ||
    config.gateway?.baseUrl ||
    "";

  if (!gatewayUrl) {
    throw new Error("missing OPENPOND_GATEWAY_URL (or gateway.baseUrl in config)");
  }

  const checks = Array.isArray(config.gateway?.bars) ? config.gateway?.bars : [];
  if (checks.length === 0) {
    throw new Error(`no gateway checks configured in ${configPath}`);
  }

  console.log("==> gateway pricing checks");
  for (const check of checks) {
    const label = check.label || `${check.symbol}-${check.resolution}`;
    const payload = await fetchGatewayBars({
      baseUrl: gatewayUrl,
      symbol: check.symbol,
      resolution: check.resolution,
      countBack: check.countBack,
    });
    const bars =
      payload && typeof payload === "object" && "bars" in payload
        ? (payload as { bars?: unknown }).bars
        : undefined;
    const count = Array.isArray(bars) ? bars.length : 0;
    if (count < check.minItems) {
      throw new Error(`[fail] ${label} bars=${count} min=${check.minItems}`);
    }
    console.log(`[ok] ${label} bars=${count}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

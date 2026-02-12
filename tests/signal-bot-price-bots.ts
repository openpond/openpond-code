import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeAtr,
  computeBollinger,
  computeEma,
  computeMacd,
  computeMaCross,
  computePriceChange,
  computeRsi,
  computeSma,
  type Bar,
} from "../src/indicators";

type BotConfig = {
  id?: string;
  handleRepo: string;
  toolName?: string;
  expectPositionChange?: "none" | "any";
  indicatorCheck?: IndicatorCheckConfig;
};

type GatewayCheck = {
  label?: string;
  symbol: string;
  resolution: string;
  countBack: number;
  minItems: number;
};

type GatewayConfig = {
  environment?: string;
  gateway?: {
    baseUrl?: string;
    bars?: GatewayCheck[];
  };
};

type TestConfig = {
  bots?: BotConfig[];
  indicatorChecks?: IndicatorCheckConfig;
};

type PositionSummary = {
  coin: string;
  size: string | number | null;
};

type IndicatorCheckConfig = {
  enabled?: boolean;
  symbol?: string;
  resolution?: string;
  countBack?: number;
  tolerance?: number;
};

type ToolOutput = {
  ok?: boolean;
  asset?: string;
  resolution?: string;
  price?: number;
  indicators?: Record<string, unknown>;
};

const DEFAULT_INDICATOR_COUNT_BACK = 240;
const DEFAULT_INDICATOR_TOLERANCE = 1e-6;

const barsCache = new Map<string, Bar[]>();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function readConfig<T>(configPath: string): T {
  const raw = readFileSync(configPath, "utf8");
  return JSON.parse(raw) as T;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBars(payload: unknown): Bar[] {
  const raw =
    payload && typeof payload === "object" && "bars" in payload
      ? (payload as { bars?: unknown }).bars
      : undefined;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const time = toNumber(record.time);
      const open = toNumber(record.open);
      const high = toNumber(record.high);
      const low = toNumber(record.low);
      const close = toNumber(record.close);
      const volume = toNumber(record.volume);
      if (time == null || open == null || high == null || low == null || close == null) {
        return null;
      }
      return {
        time,
        open,
        high,
        low,
        close,
        ...(volume != null ? { volume } : {}),
      };
    })
    .filter((bar): bar is Bar => Boolean(bar));
}

function buildBarsKey(symbol: string, resolution: string, countBack: number): string {
  return `${symbol.toUpperCase()}|${resolution}|${countBack}`;
}

function parseToolOutput(raw: string): ToolOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ToolOutput;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as ToolOutput;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function resolveIndicatorCheck(
  bot: BotConfig,
  defaults: IndicatorCheckConfig | undefined,
  toolOutput: ToolOutput | null
): Required<IndicatorCheckConfig> {
  const enabled = bot.indicatorCheck?.enabled ?? defaults?.enabled ?? true;
  const symbol =
    bot.indicatorCheck?.symbol ??
    defaults?.symbol ??
    toolOutput?.asset ??
    "";
  const resolution =
    bot.indicatorCheck?.resolution ??
    defaults?.resolution ??
    toolOutput?.resolution ??
    "";
  const countBackRaw =
    bot.indicatorCheck?.countBack ??
    defaults?.countBack ??
    DEFAULT_INDICATOR_COUNT_BACK;
  const toleranceRaw =
    bot.indicatorCheck?.tolerance ??
    defaults?.tolerance ??
    DEFAULT_INDICATOR_TOLERANCE;
  const countBack = Number.isFinite(countBackRaw) ? Number(countBackRaw) : DEFAULT_INDICATOR_COUNT_BACK;
  const tolerance = Number.isFinite(toleranceRaw)
    ? Number(toleranceRaw)
    : DEFAULT_INDICATOR_TOLERANCE;
  return {
    enabled,
    symbol,
    resolution,
    countBack,
    tolerance,
  };
}

function approxEqual(actual: number, expected: number, tolerance: number): boolean {
  const diff = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  return diff <= tolerance * scale;
}

function compareNumber(
  label: string,
  actual: number | null,
  expected: number | null,
  tolerance: number,
  errors: string[]
) {
  if (expected == null) {
    if (actual != null) {
      errors.push(`${label} expected null, received ${actual}`);
    }
    return;
  }
  if (actual == null) {
    errors.push(`${label} expected ${expected}, received null`);
    return;
  }
  if (!approxEqual(actual, expected, tolerance)) {
    errors.push(`${label} expected ${expected}, received ${actual}`);
  }
}

function readNumber(value: unknown): number | null {
  return toNumber(value);
}

function readInt(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric == null) return null;
  return Math.trunc(numeric);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function validateIndicators(
  toolOutput: ToolOutput,
  bars: Bar[],
  tolerance: number
): string[] {
  const errors: string[] = [];
  const indicators = toolOutput.indicators;
  if (!indicators || typeof indicators !== "object") {
    return ["missing indicators payload"];
  }
  const closes = bars.map((bar) => bar.close).filter((value) => Number.isFinite(value));
  if (closes.length === 0) {
    return ["no valid close values for indicator checks"];
  }
  const currentPrice =
    typeof toolOutput.price === "number" && Number.isFinite(toolOutput.price)
      ? toolOutput.price
      : closes[closes.length - 1];

  const record = indicators as Record<string, unknown>;

  if ("rsi" in record) {
    const rsi = record.rsi as Record<string, unknown> | null;
    if (!rsi) {
      errors.push("rsi payload missing");
    } else {
      const overbought = readNumber(rsi.overbought);
      const oversold = readNumber(rsi.oversold);
      const actualValue = readNumber(rsi.value);
      const actualSignal = readString(rsi.signal);
      const expectedValue = computeRsi(closes);
      compareNumber("rsi.value", actualValue, expectedValue, tolerance, errors);
      if (overbought == null || oversold == null) {
        errors.push("rsi thresholds missing");
      } else {
        const expectedSignal =
          expectedValue == null
            ? "unknown"
            : expectedValue >= overbought
              ? "overbought"
              : expectedValue <= oversold
                ? "oversold"
                : "neutral";
        if (actualSignal !== expectedSignal) {
          errors.push(`rsi.signal expected ${expectedSignal}, received ${actualSignal}`);
        }
      }
    }
  }

  if ("macd" in record) {
    const macd = record.macd as Record<string, unknown> | null;
    if (!macd) {
      errors.push("macd payload missing");
    } else {
      const actualMacd = readNumber(macd.macd);
      const actualSignalLine = readNumber(macd.signalLine);
      const actualHistogram = readNumber(macd.histogram);
      const actualSignal = readString(macd.signal);
      const expected = computeMacd(closes);
      compareNumber("macd.macd", actualMacd, expected?.macd ?? null, tolerance, errors);
      compareNumber(
        "macd.signalLine",
        actualSignalLine,
        expected?.signalLine ?? null,
        tolerance,
        errors
      );
      compareNumber(
        "macd.histogram",
        actualHistogram,
        expected?.histogram ?? null,
        tolerance,
        errors
      );
      const expectedSignal =
        expected == null
          ? "unknown"
          : expected.histogram > 0
            ? "bullish"
            : expected.histogram < 0
              ? "bearish"
              : "neutral";
      if (actualSignal !== expectedSignal) {
        errors.push(`macd.signal expected ${expectedSignal}, received ${actualSignal}`);
      }
    }
  }

  if ("sma" in record) {
    const sma = record.sma as Record<string, unknown> | null;
    if (!sma) {
      errors.push("sma payload missing");
    } else {
      const period = readInt(sma.period);
      const actualValue = readNumber(sma.value);
      const actualSignal = readString(sma.signal);
      if (period == null) {
        errors.push("sma.period missing");
      } else {
        const expectedValue = computeSma(closes, period);
        compareNumber("sma.value", actualValue, expectedValue, tolerance, errors);
        const expectedSignal =
          expectedValue == null
            ? "unknown"
            : currentPrice > expectedValue
              ? "above"
              : currentPrice < expectedValue
                ? "below"
                : "at";
        if (actualSignal !== expectedSignal) {
          errors.push(`sma.signal expected ${expectedSignal}, received ${actualSignal}`);
        }
      }
    }
  }

  if ("ema" in record) {
    const ema = record.ema as Record<string, unknown> | null;
    if (!ema) {
      errors.push("ema payload missing");
    } else {
      const period = readInt(ema.period);
      const actualValue = readNumber(ema.value);
      const actualSignal = readString(ema.signal);
      if (period == null) {
        errors.push("ema.period missing");
      } else {
        const expectedValue = computeEma(closes, period);
        compareNumber("ema.value", actualValue, expectedValue, tolerance, errors);
        const expectedSignal =
          expectedValue == null
            ? "unknown"
            : currentPrice > expectedValue
              ? "above"
              : currentPrice < expectedValue
                ? "below"
                : "at";
        if (actualSignal !== expectedSignal) {
          errors.push(`ema.signal expected ${expectedSignal}, received ${actualSignal}`);
        }
      }
    }
  }

  if ("maCross" in record) {
    const maCross = record.maCross as Record<string, unknown> | null;
    if (!maCross) {
      errors.push("maCross payload missing");
    } else {
      const type = readString(maCross.type) === "ema" ? "ema" : "sma";
      const fastPeriod = readInt(maCross.fastPeriod);
      const slowPeriod = readInt(maCross.slowPeriod);
      const actualFast = readNumber(maCross.fast);
      const actualSlow = readNumber(maCross.slow);
      const actualSignal = readString(maCross.signal);
      if (fastPeriod == null || slowPeriod == null) {
        errors.push("maCross periods missing");
      } else {
        const expected = computeMaCross(closes, type, fastPeriod, slowPeriod);
        compareNumber("maCross.fast", actualFast, expected?.fast ?? null, tolerance, errors);
        compareNumber("maCross.slow", actualSlow, expected?.slow ?? null, tolerance, errors);
        const expectedSignal = expected?.signal ?? "unknown";
        if (actualSignal !== expectedSignal) {
          errors.push(`maCross.signal expected ${expectedSignal}, received ${actualSignal}`);
        }
      }
    }
  }

  if ("bb" in record) {
    const bb = record.bb as Record<string, unknown> | null;
    if (!bb) {
      errors.push("bb payload missing");
    } else {
      const period = readInt(bb.period);
      const stdDev = readNumber(bb.stdDev);
      const actualUpper = readNumber(bb.upper);
      const actualMiddle = readNumber(bb.middle);
      const actualLower = readNumber(bb.lower);
      const actualSignal = readString(bb.signal);
      if (period == null || stdDev == null) {
        errors.push("bb period/stdDev missing");
      } else {
        const expected = computeBollinger(closes, period, stdDev);
        compareNumber("bb.upper", actualUpper, expected?.upper ?? null, tolerance, errors);
        compareNumber("bb.middle", actualMiddle, expected?.middle ?? null, tolerance, errors);
        compareNumber("bb.lower", actualLower, expected?.lower ?? null, tolerance, errors);
        const expectedSignal =
          expected == null
            ? "unknown"
            : currentPrice > expected.upper
              ? "overbought"
              : currentPrice < expected.lower
                ? "oversold"
                : "neutral";
        if (actualSignal !== expectedSignal) {
          errors.push(`bb.signal expected ${expectedSignal}, received ${actualSignal}`);
        }
      }
    }
  }

  if ("priceChange" in record) {
    const priceChange = record.priceChange as Record<string, unknown> | null;
    if (!priceChange) {
      errors.push("priceChange payload missing");
    } else {
      const lookback = readInt(priceChange.lookback);
      const actualPercent = readNumber(priceChange.percent);
      const actualPrevious = readNumber(priceChange.previous);
      const actualSignal = readString(priceChange.signal);
      if (lookback == null) {
        errors.push("priceChange.lookback missing");
      } else {
        const expected = computePriceChange(closes, lookback);
        compareNumber(
          "priceChange.percent",
          actualPercent,
          expected?.percent ?? null,
          tolerance,
          errors
        );
        if (expected != null) {
          compareNumber(
            "priceChange.previous",
            actualPrevious,
            expected.previous,
            tolerance,
            errors
          );
        }
        const expectedSignal =
          expected == null ? "unknown" : expected.percent >= 0 ? "up" : "down";
        if (actualSignal !== expectedSignal) {
          errors.push(
            `priceChange.signal expected ${expectedSignal}, received ${actualSignal}`
          );
        }
      }
    }
  }

  if ("atr" in record) {
    const atr = record.atr as Record<string, unknown> | null;
    if (!atr) {
      errors.push("atr payload missing");
    } else {
      const period = readInt(atr.period);
      const actualValue = readNumber(atr.value);
      if (period == null) {
        errors.push("atr.period missing");
      } else {
        const expectedValue = computeAtr(bars, period);
        compareNumber("atr.value", actualValue, expectedValue, tolerance, errors);
      }
    }
  }

  return errors;
}
function runCli(args: string[]): string {
  const result = spawnSync("bun", ["./src/cli-package.ts", ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "CLI command failed");
  }
  return result.stdout.trim();
}

async function fetchHyperliquidState(
  baseUrl: string,
  walletAddress: string
): Promise<unknown> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: walletAddress }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`hyperliquid info failed: ${response.status} ${text}`.trim());
  }
  return response.json();
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

async function getBarsForIndicator(params: {
  baseUrl: string;
  symbol: string;
  resolution: string;
  countBack: number;
}): Promise<Bar[]> {
  const key = buildBarsKey(params.symbol, params.resolution, params.countBack);
  const cached = barsCache.get(key);
  if (cached) return cached;
  const payload = await fetchGatewayBars(params);
  const bars = normalizeBars(payload);
  if (bars.length > 0) {
    barsCache.set(key, bars);
  }
  return bars;
}

function summarizePositions(payload: unknown): PositionSummary[] {
  const data =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data?: unknown }).data
      : payload;
  const assetPositions =
    data && typeof data === "object" && "assetPositions" in data
      ? (data as { assetPositions?: unknown }).assetPositions
      : undefined;
  const rows = Array.isArray(assetPositions) ? assetPositions : [];
  const summary = rows
    .map((row) => {
      const position =
        row && typeof row === "object" && "position" in row
          ? (row as { position?: Record<string, unknown> }).position
          : undefined;
      const coin =
        position && typeof position.coin === "string" ? position.coin : null;
      const size = position ? (position.szi as string | number | null) : null;
      return coin ? { coin, size } : null;
    })
    .filter((entry): entry is PositionSummary => Boolean(entry));
  summary.sort((a, b) => a.coin.localeCompare(b.coin));
  return summary;
}

function printPositions(label: string, summary: PositionSummary[]): void {
  console.log(label);
  console.log(JSON.stringify({ positions: summary }, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const botsRaw = process.env.SIGNAL_BOT_BOTS;
  if (!botsRaw) {
    throw new Error(
      "missing SIGNAL_BOT_BOTS (JSON array of bots with handleRepo/toolName)"
    );
  }
  let config: TestConfig = {};
  try {
    config = { bots: JSON.parse(botsRaw) as BotConfig[] };
  } catch {
    throw new Error("SIGNAL_BOT_BOTS must be valid JSON");
  }
  const indicatorChecksRaw = process.env.SIGNAL_BOT_INDICATOR_CHECKS;
  if (indicatorChecksRaw) {
    try {
      config.indicatorChecks = JSON.parse(indicatorChecksRaw) as IndicatorCheckConfig;
    } catch {
      throw new Error("SIGNAL_BOT_INDICATOR_CHECKS must be valid JSON");
    }
  }
  const gatewayConfigPath =
    process.env.SIGNAL_BOT_GATEWAY_CONFIG || path.join(scriptDir, "gateway.config.json");
  const gatewayConfig = readConfig<GatewayConfig>(gatewayConfigPath);

  const environment = (process.env.OPENPOND_ENV || gatewayConfig.environment || "").toLowerCase();
  const inferredGateway =
    environment === "production"
      ? "https://gateway.openpond.dev"
      : environment === "staging"
        ? "https://gateway-staging.openpond.dev"
        : "";
  const gatewayUrl =
    process.env.OPENPOND_GATEWAY_URL ||
    inferredGateway ||
    gatewayConfig.gateway?.baseUrl ||
    "";
  const gatewayChecks = Array.isArray(gatewayConfig.gateway?.bars)
    ? gatewayConfig.gateway?.bars
    : [];
  const baseUrl =
    process.env.OPENPOND_HYPERLIQUID_BASE_URL ||
    process.env.HYPERLIQUID_BASE_URL ||
    "";
  const walletAddress =
    process.env.OPENPOND_HL_WALLET_ADDRESS ||
    process.env.HL_WALLET_ADDRESS ||
    "";
  const postRunDelayMs =
    Number(process.env.SIGNAL_BOT_POST_RUN_DELAY_MS) || 5000;

  const bots = Array.isArray(config.bots) ? config.bots : [];
  if (bots.length === 0) {
    throw new Error("SIGNAL_BOT_BOTS must include at least one bot");
  }

  if (!gatewayUrl) {
    throw new Error("missing OPENPOND_GATEWAY_URL (or gateway.baseUrl in config)");
  }
  if (gatewayChecks.length === 0) {
    throw new Error(`no gateway checks configured in ${gatewayConfigPath}`);
  }
  console.log("==> gateway pricing checks");
  for (const check of gatewayChecks) {
    const label = check.label || `${check.symbol}-${check.resolution}`;
    const payload = await fetchGatewayBars({
      baseUrl: gatewayUrl,
      symbol: check.symbol,
      resolution: check.resolution,
      countBack: check.countBack,
    });
    const bars = normalizeBars(payload);
    const count = bars.length;
    if (count < check.minItems) {
      throw new Error(`[fail] ${label} bars=${count} min=${check.minItems}`);
    }
    const cacheKey = buildBarsKey(check.symbol, check.resolution, check.countBack);
    if (bars.length > 0 && !barsCache.has(cacheKey)) {
      barsCache.set(cacheKey, bars);
    }
    console.log(`[ok] ${label} bars=${count}`);
  }

  const positionsEnabled = Boolean(baseUrl && walletAddress);
  if (!positionsEnabled) {
    console.log(
      "positions check disabled (set OPENPOND_HYPERLIQUID_BASE_URL/HYPERLIQUID_BASE_URL + OPENPOND_HL_WALLET_ADDRESS/HL_WALLET_ADDRESS or update config)"
    );
  }

  let failed = false;

  for (const bot of bots) {
    const id = bot.id || bot.handleRepo;
    const toolName = bot.toolName || "signal-bot";
    const expectChange = bot.expectPositionChange || "none";

    console.log(`==> ${id} (${bot.handleRepo})`);

    let before: PositionSummary[] = [];
    if (positionsEnabled) {
      const payload = await fetchHyperliquidState(baseUrl, walletAddress);
      before = summarizePositions(payload);
      printPositions("[positions] before", before);
    }

    console.log(`[tool] run ${toolName}`);
    const output = runCli(["tool", "run", bot.handleRepo, toolName, "--method", "GET"]);
    if (output) console.log(output);

    const toolOutput = parseToolOutput(output);
    const indicatorCheck = resolveIndicatorCheck(bot, config.indicatorChecks, toolOutput);
    if (indicatorCheck.enabled) {
      if (!toolOutput || toolOutput.ok !== true) {
        console.log(`[fail] indicator check skipped (tool output missing or not ok)`);
        failed = true;
      } else if (!indicatorCheck.symbol || !indicatorCheck.resolution) {
        console.log(`[fail] indicator check missing symbol/resolution for ${id}`);
        failed = true;
      } else {
        const bars = await getBarsForIndicator({
          baseUrl: gatewayUrl,
          symbol: indicatorCheck.symbol,
          resolution: indicatorCheck.resolution,
          countBack: indicatorCheck.countBack,
        });
        if (bars.length === 0) {
          console.log(`[fail] indicator check missing bars for ${id}`);
          failed = true;
        } else {
          const errors = validateIndicators(toolOutput, bars, indicatorCheck.tolerance);
          if (errors.length > 0) {
            console.log(`[fail] indicator check mismatches for ${id}`);
            for (const error of errors) {
              console.log(`  - ${error}`);
            }
            failed = true;
          } else {
            console.log(`[ok] indicator checks match for ${id}`);
          }
        }
      }
    }

    if (positionsEnabled) {
      await sleep(Math.max(postRunDelayMs, 0));
      const payload = await fetchHyperliquidState(baseUrl, walletAddress);
      const after = summarizePositions(payload);
      printPositions("[positions] after", after);

      const changed = JSON.stringify(before) !== JSON.stringify(after);
      if (changed && expectChange === "none") {
        console.log(`[fail] positions changed for ${id}`);
        failed = true;
      } else if (!changed && expectChange === "any") {
        console.log(`[fail] positions did not change for ${id}`);
        failed = true;
      } else {
        console.log(
          changed
            ? `[ok] positions changed for ${id}`
            : `[ok] positions unchanged for ${id}`
        );
      }
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

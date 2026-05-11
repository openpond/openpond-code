import { randomUUID } from "node:crypto";
import {
  DEFAULT_OPENPOND_API_BASE_URL,
  DEFAULT_OPENPOND_CHAT_API_BASE_URL,
} from "./urls";

export type HostedChatRole = "system" | "user" | "assistant" | "tool";

export type HostedChatMessage = {
  role: HostedChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
};

export type HostedModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  [key: string]: unknown;
};

export type HostedModelsResponse = {
  object: "list" | string;
  data: HostedModel[];
};

export type HostedChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
};

export type HostedChatCompletion = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: HostedChatUsage;
  [key: string]: unknown;
};

export type HostedChatStreamDelta =
  | {
      type: "text_delta";
      text: string;
      raw: unknown;
    }
  | {
      type: "reasoning_delta";
      text: string;
      raw: unknown;
    }
  | {
      type: "usage";
      usage: HostedChatUsage;
      raw: unknown;
    }
  | {
      type: "finish";
      finishReason: string | null;
      raw: unknown;
    };

export type HostedChatRequestOptions = {
  apiBaseUrl: string;
  token: string;
  model: string;
  messages: HostedChatMessage[];
  requestId?: string;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
};

export type HostedModelsRequestOptions = {
  apiBaseUrl: string;
  token: string;
  signal?: AbortSignal;
};

export type HostedChatApiBaseUrlOptions = {
  apiBaseUrl?: string | null;
  chatApiBaseUrl?: string | null;
  env?: Record<string, string | undefined>;
};

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) throw new Error("apiBaseUrl is required");
  return trimmed;
}

function normalizeOptionalApiBaseUrl(value?: string | null): string | null {
  const trimmed = value?.trim().replace(/\/$/, "");
  return trimmed || null;
}

export function resolveHostedChatApiBaseUrl(
  options: HostedChatApiBaseUrlOptions = {}
): string {
  const runtimeEnv =
    options.env ??
    (typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined>)
      : {});
  const explicit =
    normalizeOptionalApiBaseUrl(options.chatApiBaseUrl) ??
    normalizeOptionalApiBaseUrl(runtimeEnv.OPENPOND_CHAT_API_URL) ??
    normalizeOptionalApiBaseUrl(runtimeEnv.OPENPOND_GATEWAY_URL);
  if (explicit) return explicit;

  const apiBase =
    normalizeOptionalApiBaseUrl(options.apiBaseUrl) ??
    normalizeOptionalApiBaseUrl(runtimeEnv.OPENPOND_API_URL) ??
    DEFAULT_OPENPOND_API_BASE_URL;

  return apiBase === DEFAULT_OPENPOND_API_BASE_URL
    ? DEFAULT_OPENPOND_CHAT_API_BASE_URL
    : apiBase;
}

function requireToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("OpenPond API key is required");
  return trimmed;
}

function hostedHeaders(token: string, accept: string, requestId?: string): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${requireToken(token)}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", accept);
  headers.set("x-openpond-client", "openpond-code");
  headers.set("x-openpond-request-id", requestId || randomUUID());
  return headers;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
    const error = typeof payload.error === "string" ? payload.error : null;
    const message = typeof payload.message === "string" ? payload.message : null;
    return [error, message].filter(Boolean).join(": ") || text;
  } catch {
    return text;
  }
}

function buildHostedChatBody(
  options: HostedChatRequestOptions,
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream,
  };
  if (typeof options.temperature === "number") {
    body.temperature = options.temperature;
  }
  if (typeof options.maxTokens === "number") {
    body.max_tokens = options.maxTokens;
  }
  if (options.metadata) {
    body.metadata = options.metadata;
  }
  return body;
}

export async function listHostedModels(
  options: HostedModelsRequestOptions
): Promise<HostedModelsResponse> {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/v1/models`, {
    method: "GET",
    headers: hostedHeaders(options.token, "application/json"),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Hosted model list failed: ${response.status} ${await readError(response)}`);
  }
  return (await response.json()) as HostedModelsResponse;
}

export async function sendHostedChatTurn(
  options: HostedChatRequestOptions
): Promise<HostedChatCompletion> {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: hostedHeaders(options.token, "application/json", options.requestId),
    body: JSON.stringify(buildHostedChatBody(options, false)),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Hosted chat failed: ${response.status} ${await readError(response)}`);
  }
  return (await response.json()) as HostedChatCompletion;
}

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: HostedChatUsage;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
};

async function* parseOpenAISSE(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<unknown, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const readAbortError = () =>
    signal?.reason instanceof Error ? signal.reason : new Error("hosted_chat_aborted");

  try {
    while (true) {
      if (signal?.aborted) throw readAbortError();
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") return;
        yield JSON.parse(data) as unknown;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release-lock failures when the stream is already closed.
    }
  }
}

export async function* streamHostedChatTurn(
  options: HostedChatRequestOptions
): AsyncGenerator<HostedChatStreamDelta, void, unknown> {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: hostedHeaders(options.token, "text/event-stream", options.requestId),
    body: JSON.stringify(buildHostedChatBody(options, true)),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Hosted chat stream failed: ${response.status} ${await readError(response)}`);
  }

  for await (const raw of parseOpenAISSE(response.body, options.signal)) {
    const chunk = raw as OpenAIStreamChunk;
    if (chunk.error) {
      throw new Error(chunk.error.message || "Hosted chat stream error");
    }
    if (chunk.usage) {
      yield { type: "usage", usage: chunk.usage, raw };
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const content = choice.delta?.content;
    if (content) {
      yield { type: "text_delta", text: content, raw };
    }
    const reasoning = choice.delta?.reasoning_content;
    if (reasoning) {
      yield { type: "reasoning_delta", text: reasoning, raw };
    }
    if (typeof choice.finish_reason !== "undefined") {
      yield { type: "finish", finishReason: choice.finish_reason ?? null, raw };
    }
  }
}

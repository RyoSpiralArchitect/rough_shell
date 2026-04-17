import type { JsonGenerationRequest, JsonProvider } from "@rough-shell/core";

export interface OpenAICompatibleProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  model: string;
  retryDelayMs?: number;
  temperature?: number;
  timeoutMs?: number;
}

function buildApiUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBaseUrl);
}

function inferCompatibilityTarget(
  model: string,
  baseUrl: string,
): "claude" | "gemini" | "openai" | undefined {
  if (/^gemini(?:-|$)/i.test(model) || /generativelanguage\.googleapis\.com/i.test(baseUrl)) {
    return "gemini";
  }

  if (/^claude(?:-|$)/i.test(model) || /anthropic\.com/i.test(baseUrl)) {
    return "claude";
  }

  if (/api\.openai\.com/i.test(baseUrl)) {
    return "openai";
  }

  return undefined;
}

function buildCompatibilityHint(
  model: string,
  baseUrl: string,
  status: number,
  errorBody: string,
): string | undefined {
  const target = inferCompatibilityTarget(model, baseUrl);
  if (
    status !== 404 ||
    !/model_not_found/i.test(errorBody) ||
    !/api\.openai\.com/i.test(baseUrl)
  ) {
    return undefined;
  }

  switch (target) {
    case "gemini":
      return [
        `Model "${model}" looks like a Gemini model, but the request went to the OpenAI endpoint (${baseUrl}).`,
        "Use the Gemini OpenAI-compatible base URL `https://generativelanguage.googleapis.com/v1beta/openai` and a `GEMINI_API_KEY` or `OPENAI_COMPAT_API_KEY`.",
      ].join(" ");
    case "claude":
      return [
        `Model "${model}" looks like a Claude model, but the request went to the OpenAI endpoint (${baseUrl}).`,
        "Use the Claude OpenAI-compatible base URL `https://api.anthropic.com/v1` and an `ANTHROPIC_API_KEY` or `OPENAI_COMPAT_API_KEY`.",
      ].join(" ");
    default:
      return undefined;
  }
}

const GEMINI_SCHEMA_KEYS_TO_DROP = new Set([
  "additionalProperties",
  "const",
  "default",
  "description",
  "enum",
  "example",
  "examples",
  "format",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "pattern",
  "required",
  "title",
]);

function simplifySchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => simplifySchemaForGemini(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const simplified: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (GEMINI_SCHEMA_KEYS_TO_DROP.has(key)) {
      continue;
    }

    if (key === "properties" && entry && typeof entry === "object" && !Array.isArray(entry)) {
      simplified.properties = Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).map(([propertyName, propertySchema]) => [
          propertyName,
          simplifySchemaForGemini(propertySchema),
        ]),
      );
      continue;
    }

    simplified[key] = simplifySchemaForGemini(entry);
  }

  return simplified;
}

function buildRequestSchema(model: string, baseUrl: string, schema: unknown): unknown {
  return inferCompatibilityTarget(model, baseUrl) === "gemini"
    ? simplifySchemaForGemini(schema)
    : schema;
}

function extractToolArguments(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new Error("OpenAI-compatible provider returned a non-object response.");
  }

  const choice = (payload as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: unknown } }> } }> }).choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  const argumentsPayload = toolCall?.function?.arguments;

  if (typeof argumentsPayload === "string") {
    return JSON.parse(argumentsPayload) as unknown;
  }

  if (argumentsPayload && typeof argumentsPayload === "object") {
    return argumentsPayload;
  }

  throw new Error("OpenAI-compatible provider did not return tool call arguments.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetriableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(error.message) ||
    /connection termination|socket hang up|upstream connect error|temporarily unavailable/i.test(
      error.message,
    )
  );
}

export class OpenAICompatibleProvider implements JsonProvider {
  public readonly model: string;

  public readonly name = "openai-compat";

  private readonly config: OpenAICompatibleProviderConfig;

  public constructor(config: OpenAICompatibleProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  public async generateJson(request: JsonGenerationRequest): Promise<unknown> {
    const maxAttempts = (this.config.maxRetries ?? 2) + 1;
    let lastError: Error | undefined;
    const requestSchema = buildRequestSchema(
      this.config.model,
      this.config.baseUrl,
      request.schema,
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(buildApiUrl(this.config.baseUrl, "/chat/completions"), {
          method: "POST",
          headers: {
            "authorization": `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
            ...this.config.defaultHeaders,
          },
          body: JSON.stringify({
            model: this.config.model,
            temperature: this.config.temperature ?? 0.2,
            messages: [
              {
                role: "system",
                content: request.systemPrompt,
              },
              {
                role: "user",
                content: request.userPrompt,
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "emit_json",
                  description: `Return JSON matching ${request.schemaName}.`,
                  parameters: requestSchema,
                },
              },
            ],
            tool_choice: {
              type: "function",
              function: {
                name: "emit_json",
              },
            },
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          const compatibilityHint = buildCompatibilityHint(
            this.config.model,
            this.config.baseUrl,
            response.status,
            errorBody,
          );
          const error = new Error(
            [
              `OpenAI-compatible provider request failed (${response.status}): ${errorBody}`,
              compatibilityHint,
            ]
              .filter(Boolean)
              .join("\n"),
          );

          if (!isRetriableStatus(response.status) || attempt >= maxAttempts) {
            throw error;
          }

          lastError = error;
          await delay((this.config.retryDelayMs ?? 750) * attempt);
          continue;
        }

        const payload = (await response.json()) as unknown;
        return extractToolArguments(payload);
      } catch (error) {
        if (!isRetriableError(error) || attempt >= maxAttempts) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        await delay((this.config.retryDelayMs ?? 750) * attempt);
      }
    }

    throw lastError ?? new Error("OpenAI-compatible provider failed without a recoverable response.");
  }
}

import type { JsonGenerationRequest, JsonProvider } from "@rough-shell/core";

export interface MistralProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  maxTokens?: number;
  model: string;
  safePrompt?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

interface MistralMessageContentChunk {
  text?: string;
  type?: string;
}

function sanitizeSchemaName(schemaName: string): string {
  return schemaName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildApiUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBaseUrl);
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .flatMap((chunk) => {
        if (!chunk || typeof chunk !== "object") {
          return [];
        }

        const typedChunk = chunk as MistralMessageContentChunk;
        return typedChunk.type === "text" && typeof typedChunk.text === "string"
          ? [typedChunk.text]
          : [];
      })
      .join("");

    if (text) {
      return text;
    }
  }

  throw new Error("Mistral provider did not return text content for the structured JSON response.");
}

function extractJson(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new Error("Mistral provider returned a non-object response.");
  }

  const choice = (
    payload as {
      choices?: Array<{
        message?: {
          content?: unknown;
        };
      }>;
    }
  ).choices?.[0];

  const content = choice?.message?.content;
  const text = extractTextContent(content);

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Mistral provider returned non-JSON content in structured output mode: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export class MistralProvider implements JsonProvider {
  public readonly model: string;

  public readonly name = "mistral";

  private readonly config: MistralProviderConfig;

  public constructor(config: MistralProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  public async generateJson(request: JsonGenerationRequest): Promise<unknown> {
    const baseUrl = this.config.baseUrl ?? "https://api.mistral.ai/v1";
    const response = await fetch(buildApiUrl(baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
        ...this.config.defaultHeaders,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 4096,
        temperature: this.config.temperature ?? 0,
        safe_prompt: this.config.safePrompt ?? false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: sanitizeSchemaName(request.schemaName),
            schema: request.schema,
          },
        },
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
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Mistral provider request failed (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as unknown;
    return extractJson(payload);
  }
}

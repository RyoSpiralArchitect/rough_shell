import type { JsonGenerationRequest, JsonProvider } from "@rough-shell/core";

export interface AnthropicProviderConfig {
  apiKey: string;
  anthropicVersion?: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  maxTokens?: number;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

function buildApiUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBaseUrl);
}

function extractToolInput(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new Error("Anthropic provider returned a non-object response.");
  }

  const content = (payload as { content?: Array<{ type?: string; name?: string; input?: unknown }> }).content;
  const toolUse = content?.find((block) => block.type === "tool_use" && block.name === "emit_json");

  if (!toolUse) {
    throw new Error("Anthropic provider did not return an emit_json tool call.");
  }

  return toolUse.input;
}

export class AnthropicProvider implements JsonProvider {
  public readonly model: string;

  public readonly name = "anthropic";

  private readonly config: AnthropicProviderConfig;

  public constructor(config: AnthropicProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  public async generateJson(request: JsonGenerationRequest): Promise<unknown> {
    const baseUrl = this.config.baseUrl ?? "https://api.anthropic.com/v1";
    const response = await fetch(buildApiUrl(baseUrl, "/messages"), {
      method: "POST",
      headers: {
        "anthropic-version": this.config.anthropicVersion ?? "2023-06-01",
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        ...this.config.defaultHeaders,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 4096,
        temperature: this.config.temperature ?? 0.2,
        system: request.systemPrompt,
        messages: [
          {
            role: "user",
            content: request.userPrompt,
          },
        ],
        tools: [
          {
            name: "emit_json",
            description: `Return JSON matching ${request.schemaName}.`,
            input_schema: request.schema,
          },
        ],
        tool_choice: {
          type: "tool",
          name: "emit_json",
        },
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic provider request failed (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as unknown;
    return extractToolInput(payload);
  }
}

import type { ModelProvider, ProviderName, ProviderRequest, ProviderResponse } from "./provider-types.js";
import { safeProviderError } from "./provider-errors.js";

export interface OpenAiCompatibleProviderOptions {
  apiKey?: string | null;
  baseUrl: string;
  providerName: ProviderName;
  missingKeyMessage: string;
  fetchFn?: typeof fetch;
  extraHeaders?: Record<string, string>;
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: ProviderName;

  constructor(private readonly options: OpenAiCompatibleProviderOptions) {
    this.name = options.providerName;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const apiKey = this.options.apiKey?.trim();
    if (!apiKey) throw safeProviderError(this.name, new Error(this.options.missingKeyMessage));
    const fetchFn = this.options.fetchFn ?? fetch;
    const started = Date.now();
    const response = await fetchFn(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(this.options.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens,
        response_format: request.metadata?.responseFormat === "json" ? { type: "json_object" } : undefined,
      }),
      signal: request.signal,
    });
    if (!response.ok) {
      throw safeProviderError(this.name, new Error(`${this.name} provider failed: ${response.status} ${await safeResponseText(response)}`));
    }
    const data = await response.json() as any;
    return {
      provider: this.name,
      model: request.model,
      content: data.choices?.[0]?.message?.content ?? "",
      roleName: request.roleName,
      latencyMs: Date.now() - started,
      usage: normalizeUsage(data.usage),
      rawFinishReason: data.choices?.[0]?.finish_reason,
    };
  }
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000);
  } catch {
    return "";
  }
}

function normalizeUsage(usage: any): ProviderResponse["usage"] {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens ?? usage.promptTokens,
    completionTokens: usage.completion_tokens ?? usage.completionTokens,
    totalTokens: usage.total_tokens ?? usage.totalTokens,
  };
}

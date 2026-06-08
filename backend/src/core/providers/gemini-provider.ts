import type { ModelProvider, ProviderRequest, ProviderResponse } from "./provider-types.js";
import { safeProviderError } from "./provider-errors.js";

export class GeminiProvider implements ModelProvider {
  readonly name = "gemini" as const;
  constructor(private readonly options: { apiKey?: string; fetchFn?: typeof fetch } = {}) {}

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    if (!this.options.apiKey) throw safeProviderError(this.name, new Error("Gemini provider unavailable: missing API key"));
    const fetchFn = this.options.fetchFn ?? fetch;
    const started = Date.now();
    const response = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.options.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: request.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
        systemInstruction: request.messages.find((message) => message.role === "system") ? { parts: [{ text: request.messages.find((message) => message.role === "system")?.content }] } : undefined,
        generationConfig: { temperature: request.temperature ?? 0.2, maxOutputTokens: request.maxTokens },
      }),
      signal: request.signal,
    });
    if (!response.ok) throw safeProviderError(this.name, new Error(`Gemini provider failed: ${response.status} ${await response.text()}`));
    const data = await response.json() as any;
    const content = data.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("") ?? "";
    return {
      provider: this.name,
      model: request.model,
      content,
      roleName: request.roleName,
      latencyMs: Date.now() - started,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
      rawFinishReason: data.candidates?.[0]?.finishReason,
    };
  }
}

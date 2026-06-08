import type { RequestKeys } from "../../lib/types.js";

export interface ProviderKeyRequest {
  headers: Record<string, string | string[] | undefined>;
}

export type ProviderKeyEnv = Partial<Record<
  | "GROQ_API_KEY"
  | "OLLAMA_API_KEY"
  | "OLLAMA_BASE_URL"
  | "NVIDIA_API_KEY"
  | "GEMINI_API_KEY"
  | "OPENROUTER_API_KEY"
  | "OPENROUTER_KEY"
  | "GITHUB_MODELS_API_KEY"
  | "GITHUB_TOKEN"
  | "TAVILY_API_KEY"
  | "SERPER_API_KEY"
  | "SERPER_KEY"
  | "EXA_API_KEY"
  | "BRAVE_API_KEY"
  | "BRAVE_KEY"
  | "FIRECRAWL_API_KEY"
  | "JINA_API_KEY"
  | "JINA_KEY"
  | "SCRAPERAPI_KEY"
  | "ZENROWS_API_KEY"
  | "SCRAPINGBEE_API_KEY"
  | "GEEKFLARE_API_KEY"
  | "HF_TOKEN"
  | "CEREBRAS_API_KEY"
  | "OPENAI_API_KEY",
  string | undefined
>>;

export function extractProviderKeys(req: ProviderKeyRequest, env: ProviderKeyEnv = process.env): RequestKeys {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(req.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const h = (name: string): string | null => {
    const value = normalizedHeaders[name.toLowerCase()];
    if (!value) return null;
    const first = Array.isArray(value) ? value[0] : value;
    return first?.trim() || null;
  };

  return {
    groqKey: h("x-groq-api-key") ?? env.GROQ_API_KEY ?? null,
    ollamaKey: h("x-ollama-api-key") ?? env.OLLAMA_API_KEY ?? null,
    ollamaBase: h("x-ollama-base-url") ?? env.OLLAMA_BASE_URL ?? null,
    nvidiaKey: h("x-nvidia-api-key") ?? env.NVIDIA_API_KEY ?? null,
    geminiKey: h("x-gemini-api-key") ?? env.GEMINI_API_KEY ?? null,
    openrouterKey: h("x-openrouter-api-key") ?? env.OPENROUTER_API_KEY ?? env.OPENROUTER_KEY ?? null,
    githubToken: h("x-github-models-api-key") ?? h("x-github-token") ?? env.GITHUB_MODELS_API_KEY ?? env.GITHUB_TOKEN ?? null,
    tavilyKey: h("x-tavily-api-key") ?? env.TAVILY_API_KEY ?? null,
    serperKey: h("x-serper-api-key") ?? env.SERPER_API_KEY ?? env.SERPER_KEY ?? null,
    exaKey: h("x-exa-api-key") ?? env.EXA_API_KEY ?? null,
    braveKey: h("x-brave-api-key") ?? env.BRAVE_API_KEY ?? env.BRAVE_KEY ?? null,
    firecrawlKey: h("x-firecrawl-api-key") ?? env.FIRECRAWL_API_KEY ?? null,
    jinaKey: h("x-jina-api-key") ?? env.JINA_API_KEY ?? env.JINA_KEY ?? null,
    scraperapiKey: h("x-scraperapi-api-key") ?? h("x-scraper-api-key") ?? env.SCRAPERAPI_KEY ?? null,
    zenrowsKey: h("x-zenrows-api-key") ?? env.ZENROWS_API_KEY ?? null,
    scrapingbeeKey: h("x-scrapingbee-api-key") ?? env.SCRAPINGBEE_API_KEY ?? null,
    geekflareKey: h("x-geekflare-api-key") ?? env.GEEKFLARE_API_KEY ?? null,
    hfToken: h("x-hf-token") ?? env.HF_TOKEN ?? null,
    cerebrasKey: h("x-cerebras-api-key") ?? env.CEREBRAS_API_KEY ?? null,
    openaiKey: h("x-openai-api-key") ?? env.OPENAI_API_KEY ?? null,
  };
}

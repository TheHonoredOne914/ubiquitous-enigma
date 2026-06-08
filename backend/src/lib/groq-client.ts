import Groq from "groq-sdk";

export const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY ?? "",
});

export const groqEnabled = !!process.env.GROQ_API_KEY;

export function getGroqClient(overrideKey?: string | null): Groq {
  const key = (overrideKey ?? "").trim();
  if (key) return new Groq({ apiKey: key });
  return groqClient;
}

export function isGroqEnabled(overrideKey?: string | null): boolean {
  return !!(overrideKey?.trim() || process.env.GROQ_API_KEY);
}

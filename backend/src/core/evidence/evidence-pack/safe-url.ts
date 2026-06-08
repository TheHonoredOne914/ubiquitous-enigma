export function safeHostname(url: string | null | undefined): string {
  if (!url?.trim()) return "unknown";
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "unknown";
  } catch {
    return "unknown";
  }
}

export function safeDomainKey(url: string | null | undefined, fallback = "unknown"): string {
  const host = safeHostname(url);
  return host === "unknown" ? fallback || "unknown" : host;
}

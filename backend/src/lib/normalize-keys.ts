function stripLeadingDoubleS(v: string | undefined): string | undefined {
  if (!v) return v;
  if (v.startsWith("ssk-")) return v.slice(1);
  return v;
}

export function normalizeApiKeys(): void {
  let a = stripLeadingDoubleS(process.env.ANTHROPIC_API_KEY);
  let o = stripLeadingDoubleS(process.env.OPENAI_API_KEY);
  let d = stripLeadingDoubleS(process.env.DEEPSEEK_API_KEY);

  const looksLikeOpenAI = (v?: string) => !!v && (v.startsWith("sk-svcacct") || v.startsWith("sk-proj-") || (v.startsWith("sk-") && v.length > 80));
  const looksLikeAnthropic = (v?: string) => !!v && v.startsWith("sk-ant-");
  const looksLikeDeepSeek = (v?: string) => !!v && /^sk-[a-f0-9]{20,40}$/i.test(v);

  if (!looksLikeOpenAI(o) && looksLikeOpenAI(d)) {
    [o, d] = [d, o];
  }
  if (!looksLikeDeepSeek(d) && looksLikeDeepSeek(o)) {
    [o, d] = [d, o];
  }

  if (a && !looksLikeAnthropic(a)) {
    a = undefined;
  }

  if (a) process.env.ANTHROPIC_API_KEY = a;
  else delete process.env.ANTHROPIC_API_KEY;
  if (o && looksLikeOpenAI(o)) process.env.OPENAI_API_KEY = o;
  else delete process.env.OPENAI_API_KEY;
  if (d && looksLikeDeepSeek(d)) process.env.DEEPSEEK_API_KEY = d;
  else delete process.env.DEEPSEEK_API_KEY;
}

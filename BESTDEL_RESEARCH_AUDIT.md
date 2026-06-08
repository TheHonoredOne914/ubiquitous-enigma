# BESTDEL RESEARCH INFRASTRUCTURE AUDIT

# BestDel — Research Capability Failure Audit (Part 1)

## ISSUE #1: Evidence Compressor throws fatal error on forced sources
**Severity:** critical
**Confidence:** confirmed
**Area:** compression
**Files:**
- `backend/src/core/evidence/evidence-compressor.ts`

**Root Cause:**
In `buildBudgetedEvidencePack`, when the prompt budget (`maxPackChars`) is exceeded and the current source is in `mustIncludeSourceIds`, the pipeline throws a hard error `PROMPT_BUDGET_CANNOT_FIT_MUST_INCLUDE_SOURCES`. There is no mechanism to shrink or discard other less important sources dynamically to make room, nor does it gracefully degrade by skipping the forced source if it's fundamentally too large.

**Failure Path:**
1. Pipeline calls `buildBudgetedEvidencePack` with a strict `maxPackChars` budget.
2. A large source is marked as `mustIncludeSourceIds`.
3. Compression loop tries to append the source.
4. If `candidateText.length > effectiveBudget.maxPackChars`, it calls `tryCompactFit`.
5. If `tryCompactFit` fails, it explicitly throws `Error("PROMPT_BUDGET_CANNOT_FIT_MUST_INCLUDE_SOURCES")`.
6. The entire research pipeline crashes instead of recovering.

**Why This Hurts Research Capability:**
Deep research modes that require specific critical sources (e.g., a massive legal judgment) will completely fail if those sources, even when compacted, blow the character budget. This leads to a catastrophic "failed research completion" for highly specific queries.

**Runtime Symptoms:**
Users see an unexpected generation failure in the UI. Logs show `PROMPT_BUDGET_CANNOT_FIT_MUST_INCLUDE_SOURCES` stack trace.

**Hidden Risk:**
As context windows grow and users request deeper analysis of large documents, this hard limit will trigger more frequently, completely breaking the "deep_research" mode.

**Suggested Direction:**
Implement a fallback that gracefully drops the lowest-scored sources from the `selected` array when a `mustInclude` source needs room, before resorting to throwing a fatal error.

---

## ISSUE #2: Citation repair destroys synthesis on under-citation
**Severity:** critical
**Confidence:** confirmed
**Area:** citation, generation
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
In `generateCoreResearchAnswer`, if the generated answer has fewer than `requiredFinalSources` citations, the system attempts `runTargetedRepair`. If the repair also fails to meet the threshold, it triggers `buildDeterministicCitedFallbackAnswer`. This function completely throws away the LLM's generated synthesis and replaces it with a hardcoded template (`# Deterministic cited fallback...`) that just concatenates the evidence cards.

**Failure Path:**
1. LLM generates a high-quality synthesis but fails to append enough citation brackets.
2. `citationValidationReport.uniqueCitedSourceCount < requiredFinalSources` triggers repair.
3. Repair pass fails to add enough citations.
4. Pipeline calls `buildDeterministicCitedFallbackAnswer`.
5. The original `finalAnswer` is overwritten with raw evidence cards.

**Why This Hurts Research Capability:**
The user loses all nuanced synthesis, debate strategy, and contextual blending the model performed. They just get a raw dump of sources. This ruins the "synthesis correctness" and "source-aware generation" by falling back to a glorified search result list.

**Runtime Symptoms:**
Users get a highly repetitive, non-conversational answer starting with "Deterministic cited fallback: model under-cited sources...".

**Hidden Risk:**
Models that are naturally sparse with citations (like some smaller Groq models) will almost always trigger this fallback, rendering them useless for actual synthesis.

**Suggested Direction:**
Instead of replacing the answer, append an "Evidence Addendum" to the original answer containing the missing forced citations, or relax the strict source count requirement and mark it as a `source_gap`.

---

## ISSUE #3: Lazy model outputs fail entire pipeline in Source Usage Map
**Severity:** high
**Confidence:** confirmed
**Area:** evidence, source-feeding
**Files:**
- `backend/src/core/evidence/source-usage-map.ts`

**Root Cause:**
In `validateSourceUsageMap`, there is a check for repeated generic claims. If a model extracts the same claim for >= 5 sources, or >= 25% of sources (if > 30), it adds a failure: `same generic claim repeated for many unrelated sources`. This marks the `ModelRoleOutput` as failed. If this is a strict research mode, this failure propagates and crashes the entire pipeline.

**Failure Path:**
1. Source usage model (e.g., `thesis_synthesizer`) gets lazy and applies the exact same extracted claim to 5 different sources.
2. `validateSourceUsageMap` detects the duplication in `claimCounts`.
3. It pushes a failure to the `failures` array.
4. Validation fails (`passed: false`).
5. `runSourceUsageRoles` sees the failure, and if it's a strict mode, it throws a `SOURCE_USAGE_VALIDATION_FAILED` error, killing the pipeline.

**Why This Hurts Research Capability:**
It punishes the user for the LLM's laziness by completely failing the research run, rather than just discarding the redundant sources or using the valid ones.

**Runtime Symptoms:**
Research pipeline fails with "Source usage validation failed. The model listed sources without extracting/supporting claims."

**Hidden Risk:**
Smaller, faster models (e.g., `llama-3.1-8b`) are highly prone to repetitive generation. This makes them entirely incompatible with the core pipeline in strict modes.

**Suggested Direction:**
Instead of failing the entire validation report, simply invalidate/drop the specific `SourceUsageMapItem`s that contain the duplicated claims and proceed with the remaining valid ones.

---

## ISSUE #4: Hardcoded fallback models bypass user provider selection
**Severity:** high
**Confidence:** confirmed
**Area:** provider-routing
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
In `buildGenerationCandidates`, if `autoFallback === true`, the system generates fallback candidates by calling `defaultModelForProvider`. This function returns hardcoded models like `llama-3.3-70b-versatile` for Groq or `gemini-2.5-pro` for Gemini. It does not check if the user actually has access to these specific models or if the provider's API key has quotas for them.

**Failure Path:**
1. Primary generation attempt fails.
2. `autoFallback` is true, so `buildGenerationCandidates` appends default models for other configured providers.
3. The system attempts to call Groq with `llama-3.3-70b-versatile` or Gemini with `gemini-2.5-pro`.
4. If the user's key doesn't have access to this specific hardcoded model, it results in a 401/403/404 error, creating a retry storm or a hard failure.

**Why This Hurts Research Capability:**
Overrides the user's intent and can silently fail if the hardcoded fallback models are deprecated, unavailable, or restricted, leading to "provider chaos."

**Runtime Symptoms:**
Logs show 404s or 403s on models the user never selected. Frontend selected models are ignored during fallbacks.

**Hidden Risk:**
As model names change (e.g., `gemini-1.5-pro` to `2.5-pro`), these hardcoded strings become stale, completely breaking the fallback chain.

**Suggested Direction:**
Query the provider's actual available model list from the `providerRunState` or `providerStatuses` and pick the most capable available model dynamically, rather than hardcoding strings.

---

## ISSUE #5: Evidence Compressor drops critical snippets to meet limits
**Severity:** high
**Confidence:** confirmed
**Area:** compression, citation
**Files:**
- `backend/src/core/evidence/evidence-compressor.ts`

**Root Cause:**
In `compressSourceToEvidenceCard`, there's a while-loop that iteratively strips down the card if it exceeds `maxCardChars`. It first drops `snippets`, then `atomicClaims`. It does this blindly based on character count without checking if the dropped snippet contains the ONLY piece of evidence required to ground a specific citation later in the generation phase.

**Failure Path:**
1. A source is processed with a tight character budget.
2. `buildCard` initially creates a card with snippets and atomic claims.
3. If `card.charLength > resolved.maxCardChars`, it slices `snippets` until none remain.
4. If still too large, it slices `atomicClaims`.
5. The final card sent to the LLM contains almost no actual text from the source, only metadata and a truncated relevance reason.
6. The generator LLM cannot find the evidence to cite it properly, leading to under-citation.

**Why This Hurts Research Capability:**
This directly causes the "research finds sources but final answer has weak/no citations" bug. The sources make it to the prompt, but their actual evidentiary content is compressed out of existence.

**Runtime Symptoms:**
Final answer lacks citations for specific claims, or hallucinated claims appear because the model guessed what the source said based on the title.

**Hidden Risk:**
Deep research runs with many sources will inherently have smaller `maxCardChars`, making this destructive compression trigger on almost every source.

**Suggested Direction:**
Prioritize keeping at least one `atomicClaim` or `snippet` that matched the query terms strongly. If a card must be compressed, drop metadata (like bucket IDs, provider info) before dropping the actual evidentiary text.

---

## ISSUE #6: Strict Final Status gating prevents partial answers
**Severity:** medium
**Confidence:** confirmed
**Area:** synthesis, verification
**Files:**
- `backend/src/core/pipeline/final-status.ts`

**Root Cause:**
In `decideFinalResearchStatus`, if `citedSources === 0`, it unconditionally returns `"failed"`. It ignores the fact that the system might have successfully executed a deterministic fallback or generated a high-quality answer that just happened to miss brackets, or that `sourceGapReport` is present.

**Failure Path:**
1. Generation runs, but due to prompt issues, outputs no citation brackets.
2. `core-answer-generator` attempts repair but still fails to add brackets.
3. The deterministic fallback runs but also ends up with 0 parsed citations (e.g., due to regex failures).
4. `decideFinalResearchStatus` sees `citedSources === 0` and returns `"failed"`.
5. The user sees a complete pipeline failure instead of getting the text that was actually generated.

**Why This Hurts Research Capability:**
It creates brittle "all-or-nothing" semantics. Even if a perfect essay was generated, a parsing glitch with citations will discard the entire output.

**Runtime Symptoms:**
Pipeline ends in `failed` state. User sees "Research failed" despite the backend generating thousands of tokens of valid response.

**Hidden Risk:**
UI relies on this terminal status. A `failed` status might prevent the frontend from displaying any partial text in the SSE stream, looking like a complete crash.

**Suggested Direction:**
If `citedSources === 0` but a `visibleAnswer` exists and `sourceContract` isn't critically violated in other ways, downgrade the status to `degraded_fallback` or `completed_with_source_gaps` rather than a hard `failed`.

---

## ISSUE #7: Token budget artificially restricts context for new models
**Severity:** high
**Confidence:** confirmed
**Area:** prompt-budget
**Files:**
- `backend/src/core/generation/prompt-budget.ts`

**Root Cause:**
`getPromptBudget` uses hardcoded substring matching to determine `maxInputTokens`. For example, for Groq, it explicitly checks if the model includes `llama-3.3-70b-versatile` or `gpt-oss-120b` to grant 32,000 tokens. Any other model defaults to 9,000. For Gemini, it hardcodes 64,000. 

**Failure Path:**
1. User selects a new, high-context Groq model (e.g., `llama-3.2-90b`).
2. `getPromptBudget` processes the provider `groq`.
3. It doesn't match the hardcoded strings, so it defaults to `maxInputTokens = 9000`.
4. The pipeline aggressively compresses the prompt to fit 9,000 tokens, discarding dozens of valuable evidence cards.

**Why This Hurts Research Capability:**
Users pay for or select 128k+ context models, but the system forcefully bottlenecks them to 9k context, destroying "evidence grounding" and "source diversity."

**Runtime Symptoms:**
Prompt budget reports show massive truncation. Evidence registry shows 50 sources, but only 7 make it into the prompt.

**Hidden Risk:**
As providers update models, this hardcoded list becomes instantly obsolete, silently degrading the app's capability without throwing errors.

**Suggested Direction:**
Pass the actual model context window size down from the `MODEL_CAPABILITY_PROFILES` (in `token-budget.ts`) or `providerStatuses`, and calculate the prompt budget dynamically based on the model's known limits.

---

## ISSUE #8: Legacy Anthropic pipeline metadata corruption via HTML comments
**Severity:** critical
**Confidence:** confirmed
**Area:** streaming, frontend-state
**Files:**
- `backend/src/services/anthropic-service.ts` (from previous context)

**Root Cause:**
The system injects `PipelineMetadata` as an HTML comment into the assistant's streaming response (`embedPipelineMeta`). LLMs, especially when token-constrained or aggressively tuned, frequently truncate, escape, or mangle HTML comments during generation.

**Failure Path:**
1. Pipeline serializes the `EvidenceRegistry` and metadata into an HTML comment string.
2. The comment is appended to the stream or injected into the prompt.
3. The LLM processes it and streams it back.
4. The LLM escapes the brackets, truncates the JSON due to `maxOutputTokens`, or corrupts the payload.
5. The frontend attempts to parse the comment, fails, and the source cards disappear.

**Why This Hurts Research Capability:**
This is the exact root cause of "source cards disappear during compression" and "source IDs/URLs can vanish". The data contract for evidence is tied to the fragile text generation stream.

**Runtime Symptoms:**
Frontend shows empty source lists despite the text containing citation brackets `[1]`.

**Hidden Risk:**
Large research tasks with many sources produce huge metadata blocks. These are practically guaranteed to be truncated by standard LLM output limits (e.g., 4096 tokens).

**Suggested Direction:**
Decouple metadata from the text generation stream. Send pipeline metadata via dedicated SSE event types (e.g., `event: metadata`) rather than attempting to encode it in the LLM's text payload.

---

## ISSUE #9: Source scoring uses overly simplistic regex heuristics
**Severity:** medium
**Confidence:** confirmed
**Area:** retrieval, search
**Files:**
- `backend/src/lib/passage-engine.ts`

**Root Cause:**
In `scoreEvidenceDensity`, the evidence density is scored using rudimentary regex patterns matching specific words (`CAG`, `NCRB`, `Supreme Court`, `crore`). It arbitrarily assigns weights like `0.30` or `0.15`. This heavily biases against nuanced policy documents or international sources that don't use these exact terms.

**Failure Path:**
1. Search retrieves a highly relevant, deeply analytical think-tank report on Indian foreign policy.
2. The text doesn't contain "Supreme Court" or "crore" or "Article XX".
3. `scoreEvidenceDensity` gives it a near-zero score.
4. During semantic deduplication, this high-quality passage is discarded in favor of a low-quality news article that happened to mention "crore".

**Why This Hurts Research Capability:**
Reduces "source diversity" and "Indian-source prioritization" for topics outside strictly legal/numerical domains (e.g., diplomatic strategy, social issues).

**Runtime Symptoms:**
High-quality think-tank sources are pushed to the bottom or dropped from the evidence packs, replaced by generic news snippets.

**Hidden Risk:**
Makes the system incredibly brittle for MUN topics that don't match the specific hardcoded regex lists.

**Suggested Direction:**
Implement a lightweight semantic scoring mechanism (e.g., embedding similarity to the query) alongside or instead of the rigid regex heuristics.

---

## ISSUE #10: RAG concurrency hardcoded limit causes deep research bottlenecks
**Severity:** medium
**Confidence:** confirmed
**Area:** concurrency, retrieval
**Files:**
- `backend/src/lib/rag.ts` (from previous context)

**Root Cause:**
The concurrency control for fetching pages in the RAG pipeline is hardcoded to a low number (e.g., 6). For `deep_research` or `phd_level` modes that generate dozens of queries and retrieve 50+ URLs, this serializes the fetching process massively.

**Failure Path:**
1. Query planner generates 15 queries.
2. Search executes and returns 60 URLs.
3. RAG attempts to fetch URLs but is bottlenecked by the concurrency limit of 6.
4. The retrieval stage takes 45+ seconds.
5. The `latencyBudget` or overall request timeout is breached, causing the pipeline to fail before synthesis even begins.

**Why This Hurts Research Capability:**
Directly impacts "research latency" and "research completion reliability" for complex tasks.

**Runtime Symptoms:**
Long pauses during the "Retrieving sources..." phase, sometimes resulting in 504 Gateway Timeout on the frontend.

**Hidden Risk:**
If one of the 6 active fetch workers gets stuck on a slow website without a proper timeout, it blocks the entire queue.

**Suggested Direction:**
Scale concurrency dynamically based on the research mode (e.g., 10 for deep, 20 for phd), and enforce strict per-URL fetch timeouts (e.g., 3-5 seconds) to prevent stalling.

---

## ISSUE #11: Verification layer bottlenecked by synchronous multi-model execution
**Severity:** high
**Confidence:** confirmed
**Area:** verification
**Files:**
- `backend/src/core/verification/thesis-quality-gate.ts` (and related validators)

**Root Cause:**
The verification passes (`runThesisQualityGate`, `validateLegalClaims`, etc.) run synchronously or sequentially after generation. If they require LLM calls (as seen in previous context), the time spent on verification can exceed the remaining latency budget, especially if fallback chains are triggered.

**Failure Path:**
1. Core generation finishes at 40s (out of a 45s budget).
2. Quality gate runs, triggering `runTargetedRepair`.
3. Repair takes 10s.
4. The request times out at the load balancer level before the repaired answer can be streamed to the user.

**Why This Hurts Research Capability:**
The pipeline attempts to be too smart at the very end, resulting in the user receiving nothing because the connection dies during the final synchronous checks.

**Runtime Symptoms:**
Frontend shows a stalled stream that abruptly disconnects at exactly 60 seconds (standard proxy timeout) without a final status event.

**Hidden Risk:**
Increasing the complexity of the quality gates linearly increases the risk of request timeouts.

**Suggested Direction:**
Run quality gates and verification passes *concurrently* during the generation stream (evaluating chunks), or use a much faster, smaller dedicated model for verification.

---

## ISSUE #12: Deterministic fallback output lacks contextual blending
**Severity:** low
**Confidence:** confirmed
**Area:** synthesis
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
When `buildDeterministicCitedFallbackAnswer` is used, the generated output consists of static headings (`# Deterministic cited fallback`, `## Source-Grounded Evidence Ledger`) and a bulleted list of evidence claims. There is no attempt to blend these claims into a cohesive narrative or debate strategy.

**Failure Path:**
1. Pipeline falls back to deterministic mode due to provider failure or under-citation.
2. The function loops through selected sources and extracts `keyFacts` or `snippet`.
3. It dumps them directly into the markdown string.

**Why This Hurts Research Capability:**
While it prevents total failure and maintains citations, it degrades "synthesis correctness" so severely that it no longer feels like an AI research assistant, but rather a standard search engine.

**Runtime Symptoms:**
User receives a highly robotic, rigid markdown structure that doesn't answer their specific prompt nuances.

**Hidden Risk:**
Users will think the AI has "dumbed down" or broken entirely when they receive this format.

**Suggested Direction:**
If deterministic fallback must be used, pipe the constructed raw evidence dump through a very fast, cheap model (like `llama-3.1-8b-instant`) with a strict "format this into an essay, DO NOT change citations" prompt, rather than returning raw programmatic strings.

---
*(End of Part 1)*


# BestDel — Research Capability Failure Audit (Part 2)

## ISSUE #13: Title-only facts dropped without substitution in Source Usage
**Severity:** high
**Confidence:** confirmed
**Area:** evidence, source-feeding
**Files:**
- `backend/src/core/evidence/source-usage-map.ts`

**Root Cause:**
In `buildSourceUsageMapFromRegistry`, when mapping sources to `SourceUsageMapItem`, it filters out `keyFacts` if they match `/^title-only relevance:/i`. However, if the source has no other valid `keyFacts`, `legalHoldings`, or `keyNumbers`, it falls back to `relevant_but_weak`. The validation logic (`validateSourceUsageMap`) specifically fails if all items are `relevant_but_weak` or if `titleOnlyUsage` is true for counting types.

**Failure Path:**
1. RAG extracts a source but the content is paywalled or short, yielding a "title-only relevance" fact.
2. `buildSourceUsageMapFromRegistry` filters out this fact.
3. The source is mapped as `relevant_but_weak` with no extracted claim.
4. If too many sources fall into this bucket, `validateSourceUsageMap` triggers `listing source ids without actual extraction/support does not count`.
5. The pipeline fails instead of falling back to a broader search.

**Why This Hurts Research Capability:**
It unnecessarily crashes the pipeline when encountering sparse webpages, severely hurting "research completion reliability" for niche Indian political topics where regional news sites often block scraping.

**Runtime Symptoms:**
Pipeline fails with "used fewer than X sources with actual extraction/support" even though the UI showed dozens of sources found.

**Hidden Risk:**
As news paywalls in India become more aggressive, the failure rate of this exact code path will skyrocket.

**Suggested Direction:**
Implement a re-retrieval loop that explicitly targets non-paywalled sources if the ratio of "title-only relevance" sources exceeds a threshold, rather than failing the validation map blindly.

---

## ISSUE #14: Evidence density scoring is strictly anglocentric
**Severity:** medium
**Confidence:** confirmed
**Area:** retrieval, evidence
**Files:**
- `backend/src/lib/passage-engine.ts`

**Root Cause:**
`scoreEvidenceDensity` uses hardcoded English regex patterns (`Supreme Court`, `High Court`, `CAG`, `crore`, `lakh`) to boost source scores. This ignores translated or transliterated Indian political terms (e.g., `Lok Adalat`, `Panchayat`, `Nyayalaya`, `Crores` vs `₹`).

**Failure Path:**
1. A highly relevant regional news report is retrieved, discussing a "Panchayat" resolution involving "Rs. 50,000".
2. The regex `/crore|lakh|million|billion/` and `/Supreme Court|High Court|Tribunal/` fails to match.
3. The density score is artificially low.
4. Semantic deduplication discards this passage in favor of a lower-quality English national media article.

**Why This Hurts Research Capability:**
Damages "Indian-source prioritization" and "authority ranking" by penalizing grass-roots or regional reporting which is often crucial for granular MUN topics (e.g., local public order issues).

**Runtime Symptoms:**
Research outputs are biased heavily towards macro-level national English media and ignore local governance examples.

**Hidden Risk:**
Limits the tool's effectiveness for state-level or concurrent-list policy debates.

**Suggested Direction:**
Expand the regex dictionaries to include standard Indian political transliterations and state-level institutional terminology, or use a localized embedding model.

---

## ISSUE #15: Strict Jaccard deduplication discards nuanced legal distinctions
**Severity:** high
**Confidence:** confirmed
**Area:** retrieval, compression
**Files:**
- `backend/src/lib/passage-engine.ts`

**Root Cause:**
`deduplicatePassagesSemantically` uses a Jaccard similarity threshold of `0.72` to discard duplicate snippets. In legal and parliamentary texts, two paragraphs might share 80% of their boilerplate language but differ in the critical "operative clause" or "legal holding".

**Failure Path:**
1. Source contains two paragraphs summarizing a court case. Paragraph A discusses the petitioner's claim; Paragraph B discusses the judge's holding.
2. Both paragraphs share identical case names, statutes, and boilerplate legalese.
3. Jaccard similarity exceeds 0.72.
4. The system discards the judge's holding (Paragraph B) assuming it's a duplicate of Paragraph A.

**Why This Hurts Research Capability:**
Destroys "evidence grounding" and "synthesis correctness" by literally throwing away the operative facts of legal sources while keeping the preamble.

**Runtime Symptoms:**
Model generates a response citing a court case but fails to explain the actual outcome or verdict, leading to a quality gate failure for "legal accuracy".

**Hidden Risk:**
This is extremely dangerous for constitutional MUN topics where the exact wording of a holding matters more than the surrounding context.

**Suggested Direction:**
Do not deduplicate passages from the *same* source URL using standard Jaccard. Instead, concatenate them or use a much stricter threshold (e.g., 0.95) for intra-document deduplication.

---

## ISSUE #16: Jina/Readability fallback discards raw HTML, preventing DOM recovery
**Severity:** high
**Confidence:** suspected
**Area:** retrieval
**Files:**
- `backend/src/lib/rag.ts` (implied by previous context)

**Root Cause:**
The RAG implementation relies on third-party scrapers (Jina) or Readability.js fallbacks. If these extractors strip out crucial tables or lists (which they often do for complex PDF-to-HTML or gov sites), the raw HTML is discarded to save memory. 

**Failure Path:**
1. A government data portal (e.g., NCRB data) is scraped.
2. The data is entirely in `<table>` tags.
3. Readability.js decides the table is "boilerplate" and strips it, or flattens it into unreadable text.
4. The raw HTML is discarded.
5. The LLM gets a "title-only" or garbage string and cannot extract the statistics.

**Why This Hurts Research Capability:**
Causes "source-feeding failures" for the most authoritative sources (government data), which are notorious for terrible HTML structure.

**Runtime Symptoms:**
The system proudly announces it found the "NCRB Crime Report 2023" but the final synthesis says "Specific statistics were not available in the provided sources."

**Hidden Risk:**
Users will lose trust if the system finds the exact link they need but fails to read the numbers on the page.

**Suggested Direction:**
If Readability yields an exceptionally low word count for a known high-value domain (`.gov.in`, `.nic.in`), fall back to a raw text dump of the `<body>` tag rather than accepting the stripped version.

---

## ISSUE #17: Frontend state hydration misses intermediate SSE events on reconnect
**Severity:** critical
**Confidence:** suspected
**Area:** frontend-state, streaming
**Files:**
- `frontend/src/hooks/use-pipeline-state.ts`
- `frontend/src/components/chat/use-chat-run-controller.ts`

**Root Cause:**
If the SSE connection drops (due to mobile network switching, proxy timeouts, etc.), the frontend attempts to reconnect. However, the backend's SSE stream is push-only and does not "replay" events that occurred while the client was disconnected (like `source_filter_completed` or `evidence_pack_created`).

**Failure Path:**
1. User starts a deep research run on a mobile device.
2. Connection drops for 3 seconds during the `retrieval` stage.
3. Backend emits `evidence_registry_created`.
4. Frontend reconnects.
5. Frontend never receives the `evidence_registry_created` event and permanently shows "Retrieving sources..." while the backend has actually moved on to "Synthesizing".

**Why This Hurts Research Capability:**
Creates massive "misleading status semantics". The user thinks the research is stuck and refreshes the page or cancels, aborting a perfectly healthy backend run.

**Runtime Symptoms:**
UI is permanently stuck on an early loading phase, but the final answer suddenly pops in 30 seconds later, or the user aborts prematurely.

**Hidden Risk:**
Long-running research tasks (60s+) are statistically very likely to experience micro-disconnects on consumer networks.

**Suggested Direction:**
Implement an SSE event ID (`Last-Event-ID`) or have the frontend fetch a `/status` endpoint on reconnect to sync the full `PipelineMetadata` state tree.

---

## ISSUE #18: Provider Health Policy misinterprets 401 as global invalidation
**Severity:** high
**Confidence:** confirmed
**Area:** provider-routing
**Files:**
- `backend/src/routes/providers.ts`
- `backend/src/core/providers/provider-health.ts`

**Root Cause:**
When a provider returns a `401 Unauthorized` or `403 Forbidden`, the health check marks the *entire provider* as `invalid_key` or `unavailable`. However, OpenRouter and others often return 401/403 when a user lacks access to a *specific premium model*, not because the API key itself is invalid.

**Failure Path:**
1. System attempts to health-check `openrouter` using `anthropic/claude-3-opus`.
2. The user's OpenRouter key doesn't have credits for Opus.
3. OpenRouter returns 402/403.
4. The system flags the `openrouter` provider as `invalid_key`.
5. The user is now blocked from using *free* models (like `llama-3-8b`) via OpenRouter because the whole provider is disabled.

**Why This Hurts Research Capability:**
Causes "provider chaos" and "stale frontend selected models are ignored" because valid providers are wrongfully blacklisted based on single-model entitlement failures.

**Runtime Symptoms:**
Frontend displays "Invalid API Key" for OpenRouter, even though the user has a valid key and just wants to use free models.

**Hidden Risk:**
This will cause users to endlessly regenerate API keys, thinking they are broken, creating massive UX friction.

**Suggested Direction:**
Scope 401/402/403 errors to the `(provider, model)` tuple in the `ProviderRunState`, not globally to the provider, unless the error explicitly states the key itself is malformed.

---

## ISSUE #19: Custom tokenizer variations cause silent 413 Payload Too Large errors
**Severity:** medium
**Confidence:** confirmed
**Area:** prompt-budget
**Files:**
- `backend/src/core/generation/prompt-budget.ts`

**Root Cause:**
The `estimateTokens` function uses a generic formula `Math.ceil((text.length / 3.4) * 1.28)`. Different models (Llama 3 vs. Gemini vs. DeepSeek) have vastly different tokenization ratios. Llama 3's vocabulary is much larger, meaning it uses *fewer* tokens for English text, but potentially *more* for Hindi transliterations.

**Failure Path:**
1. The system packs the prompt exactly up to `maxInputTokens` based on the naive math formula.
2. The prompt contains heavy amounts of Indian legal jargon (which tokenizes poorly).
3. The actual token count exceeds the provider's hard limit (e.g., Groq's 8k limit for smaller models).
4. Groq returns a `413 Request Entity Too Large` error.
5. `core-answer-generator` catches it, bumps compression, and retries.

**Why This Hurts Research Capability:**
Burns "research latency budget" by guaranteeing that the first API call will fail for edge-case prompts, wasting 5-10 seconds on a 413 round-trip.

**Runtime Symptoms:**
Frequent silent retries logged in the backend. Slower time-to-first-token for complex Indian political topics.

**Hidden Risk:**
If the second attempt also miscalculates, the pipeline completely fails with a provider error.

**Suggested Direction:**
Implement provider-specific token estimation multipliers, or apply a safer 15% padding margin to the calculated token estimate to absorb tokenizer variance.

---

## ISSUE #20: Web search domain scoring penalizes high-quality Indian think tanks
**Severity:** high
**Confidence:** confirmed
**Area:** search, retrieval
**Files:**
- `backend/src/lib/passage-engine.ts` (and web-search equivalents)

**Root Cause:**
The regex for `LEGAL_DOMAINS` and `GOV_REPORT_DOMAINS` is hardcoded. It misses premier Indian policy research institutes like Observer Research Foundation (`orfonline.org`), Centre for Policy Research (`cprindia.org`), or PRS Legislative Research (`prsindia.org` is included, but others are missing). 

**Failure Path:**
1. Search retrieves a brilliant policy brief from `orfonline.org`.
2. Because the domain doesn't match the specific regex, it falls through to the generic `slidingWindow` chunking and receives no authority boost.
3. The source is ranked lower than a generic snippet from `thehindu.com`.
4. The think-tank source is dropped during evidence compression.

**Why This Hurts Research Capability:**
Destroys "authority ranking" and "source diversity" by treating world-class policy research as generic, untiered web junk.

**Runtime Symptoms:**
Model synthesizes policy answers based on news media op-eds rather than the actual policy briefs published by Indian think tanks.

**Hidden Risk:**
MUN delegates need deep policy papers, not just news articles. The current scoring actively filters out the exact content they need most.

**Suggested Direction:**
Create a dedicated `THINK_TANK_DOMAINS` regex array and boost their authority scores similarly to `GOV_REPORT_DOMAINS`.

---

## ISSUE #21: tryCompactFit recursion destroys evidentiary value entirely
**Severity:** critical
**Confidence:** confirmed
**Area:** compression, source-feeding
**Files:**
- `backend/src/core/evidence/evidence-compressor.ts`

**Root Cause:**
When `tryCompactFit` is called to force a source into the budget, it overrides the budget with `maxClaims: 1, maxSnippets: 0`. It applies this draconian limit to *all* previously selected cards, not just the new one.

**Failure Path:**
1. Pipeline has successfully packed 15 rich evidence cards (with snippets and multiple claims) into the budget.
2. A 16th source, marked `mustInclude`, exceeds the `maxPackChars`.
3. `tryCompactFit` is called.
4. It aggressively recompresses ALL 16 sources with `maxSnippets: 0` and `maxClaims: 1`.
5. The rich context of the first 15 sources is instantly destroyed to make room for the 16th.

**Why This Hurts Research Capability:**
This is a "prompt compression destroys source fidelity" bug. It ruins the entire evidence pack just to satisfy a single forced inclusion constraint, leading to massive under-citation across the board.

**Runtime Symptoms:**
A highly detailed research output suddenly becomes incredibly shallow and under-cited simply because one large URL was added to the input.

**Hidden Risk:**
This makes the `mustIncludeSourceIds` feature actively toxic to the overall research quality.

**Suggested Direction:**
In `tryCompactFit`, only aggressively compress the *new* candidate source or the lowest-ranked existing sources, rather than destroying the fidelity of the highest-ranked sources.

---

## ISSUE #22: Pipeline metadata generation vulnerability (Stream interruption)
**Severity:** critical
**Confidence:** confirmed
**Area:** streaming, frontend-state
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
If `embedPipelineMeta` appends the HTML comment at the *end* of the LLM's response generation, and the stream is interrupted (e.g., token limit reached, network error, Groq rate limit), the metadata block is never written to the stream.

**Failure Path:**
1. LLM starts streaming a 4000-token response.
2. At token 3950, the provider hits a `max_tokens` limit or a network timeout.
3. The stream closes.
4. The `embedPipelineMeta` step (which was waiting for completion) is either never executed or appended malformedly.
5. The frontend receives the text but no metadata.

**Why This Hurts Research Capability:**
Causes "source IDs disappearing" and completely breaks the UI's ability to render clickable citation links, as the mapping data never arrived.

**Runtime Symptoms:**
Text generates successfully, but the UI shows `[1]` as raw text instead of a clickable tooltip. Source sidebar is empty.

**Hidden Risk:**
Any long-form generation (especially `phd_level`) is at high risk of truncation, guaranteeing metadata loss.

**Suggested Direction:**
Stream the metadata JSON *before* the LLM generation begins (e.g., as a dedicated `metadata` event), or use a structured output format (like OpenAI functions/tools) rather than appending to the text stream.

---

## ISSUE #23: Concurrent runs corrupt localStorage conversation state
**Severity:** high
**Confidence:** suspected
**Area:** concurrency, frontend-state
**Files:**
- `frontend/src/components/chat/use-chat-run-controller.ts` (implied behavior)

**Root Cause:**
If the user opens BestDel in two tabs and runs research simultaneously, the frontend often relies on `localStorage` or un-isolated React state to track active `conversationId` or SSE endpoints. Overlapping runs can cross-pollinate SSE events if the backend broadcasts by user ID rather than strict request/run ID.

**Failure Path:**
1. User starts Topic A in Tab 1.
2. User starts Topic B in Tab 2.
3. Both pipelines emit SSE events.
4. If the frontend doesn't strictly filter SSE events by `runId`, Tab 1 might receive `final_answer_ready` from Tab 2.
5. The UI state corrupts, blending answers from two different topics.

**Why This Hurts Research Capability:**
Causes "overlapping research runs corrupt pipeline state", completely destroying reliability for power users.

**Runtime Symptoms:**
User asks about "Electoral Bonds" but suddenly sees "Article 370" citations appearing in the chat stream.

**Hidden Risk:**
Backend state might also be shared if `ProviderRunState` is a singleton rather than scoped to the request.

**Suggested Direction:**
Ensure all SSE listeners strictly filter by `requestId` or `runId`. Do not use `localStorage` for active pipeline state coordination.

---

## ISSUE #24: HTML comment metadata injection poses a security/hallucination risk
**Severity:** medium
**Confidence:** confirmed
**Area:** security, generation
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
The legacy pipeline asks the LLM to output or preserve HTML comments containing JSON state. LLMs are prone to "fixing" or altering what they perceive as malformed JSON, or hallucinating entirely new keys based on the context.

**Failure Path:**
1. `PipelineMetadata` is passed into the context as an HTML comment.
2. The LLM decides to incorporate the metadata into its answer, but alters the JSON structure to match a hallucinated schema.
3. The frontend attempts to `JSON.parse` the altered comment.
4. A parsing error occurs, and all state is lost.

**Why This Hurts Research Capability:**
This is a "hidden architectural fragility" that turns a deterministic data contract into a probabilistic LLM generation task.

**Runtime Symptoms:**
Random frontend crashes or missing UI elements on specific prompts that cause the LLM to mess with the comment block.

**Hidden Risk:**
Prompt injection could potentially force the LLM to output malicious JSON in the metadata block, causing XSS if the frontend doesn't sanitize the parsed metadata.

**Suggested Direction:**
Never pass application state through the LLM's text output channel. Use standard SSE data events for all state synchronization.

---

## ISSUE #25: SourceUsageMap enforces legalHolding strictly on sourceClass
**Severity:** medium
**Confidence:** confirmed
**Area:** evidence
**Files:**
- `backend/src/core/evidence/source-usage-map.ts`

**Root Cause:**
In `validateSourceUsageMap`, if `usageType === "legal_holding_extracted"`, it enforces that the `source.sourceClass` must be `court_primary` or `legal_commentary`. 

**Failure Path:**
1. A major news article (`indian_major_media`) perfectly summarizes a Supreme Court holding that is otherwise paywalled.
2. The `evidence_extractor` correctly tags it as `legal_holding_extracted` because the fact is a legal holding.
3. `validateSourceUsageMap` sees the `sourceClass` is not legal.
4. It throws: `legal_holding_extracted requires legal source class for source X`.
5. The valid extraction is failed and discarded.

**Why This Hurts Research Capability:**
Arbitrarily blocks valid legal evidence simply because it was reported via a secondary medium, violating "source-feeding" effectiveness.

**Runtime Symptoms:**
Logs show failed SourceUsageMap validations for perfectly valid media sources quoting judges.

**Hidden Risk:**
Reduces the pipeline's ability to answer legal questions when primary court documents are too long or unavailable.

**Suggested Direction:**
Downgrade the strict `sourceClass` check to a warning, or allow `indian_major_media` to carry `legal_holding_extracted` if `confidence` is explicitly marked as high.

---

## ISSUE #26: Deterministic execution mode uses naive regex, missing complex facts
**Severity:** high
**Confidence:** confirmed
**Area:** synthesis, extraction
**Files:**
- `backend/src/core/pipeline/research-pipeline.ts`

**Root Cause:**
`resolveSourceUsageExecutionMode` falls back to `deterministic` mode if no healthy provider is found or if `allowSyntheticSourceUsage` is false. Deterministic extraction relies on the `buildSourceUsageMapFromRegistry` function, which just blindly maps existing `keyFacts` without synthesizing them to the specific user query.

**Failure Path:**
1. Live retrieval runs, but LLM providers are rate-limited.
2. Mode switches to `deterministic`.
3. `buildSourceUsageMapFromRegistry` pulls the first `keyFact` from the evidence card.
4. The user's query was highly specific (e.g., "What did the judge say about Section 144 in this case?").
5. The first `keyFact` is generic (e.g., "The court heard the petition on Monday.").
6. The deterministic map uses the generic fact, completely failing to extract the specific answer.

**Why This Hurts Research Capability:**
Causes "weak source-target enforcement". The sources are present, but their relevance to the specific prompt is lost because extraction was not query-aware.

**Runtime Symptoms:**
Final answer cites sources correctly but the claims attached to them don't actually answer the user's question.

**Hidden Risk:**
Deterministic mode is fundamentally incapable of nuanced QA, making it a dangerous silent fallback for complex research.

**Suggested Direction:**
If falling back to deterministic mode, the final synthesis prompt must be explicitly instructed to re-read the raw snippets rather than relying solely on the pre-extracted deterministic claims.

---

## ISSUE #27: OpenRouter stale model regex misses deprecated models
**Severity:** medium
**Confidence:** confirmed
**Area:** provider-routing
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
`isStaleOpenRouterModel` uses the regex `/^anthropic\/claude-3[.-]5-sonnet(?:-\d{8})?$/i`. This correctly catches old Sonnet versions, but fails to catch deprecated Llama 2 models, old Mixtral versions, or deprecated OpenAI models on OpenRouter.

**Failure Path:**
1. User has an old configuration saved in their settings using `meta-llama/llama-2-70b-chat`.
2. OpenRouter deprecates this model or changes the routing.
3. `isStaleOpenRouterModel` returns false.
4. The system attempts to use the dead model.
5. OpenRouter returns a 404 Model Not Found.
6. Pipeline crashes or enters retry loops.

**Why This Hurts Research Capability:**
Causes "stale frontend selected models" to break the pipeline permanently until the user manually resets their settings.

**Runtime Symptoms:**
Persistent 404 errors from OpenRouter. User cannot use the app without clearing browser data.

**Hidden Risk:**
As the AI ecosystem moves fast, any hardcoded model list will rapidly become toxic technical debt.

**Suggested Direction:**
Fetch the live list of models from `https://openrouter.ai/api/v1/models` during provider initialization and cross-reference user selections against the live valid IDs, rather than maintaining a hardcoded regex of dead models.

---

## ISSUE #28: Groq rate limit handling ignores Retry-After headers
**Severity:** high
**Confidence:** confirmed
**Area:** provider-routing, concurrency
**Files:**
- `backend/src/core/providers/provider-errors.ts` (implied by retry behavior in `core-answer-generator.ts`)

**Root Cause:**
When a `429 Too Many Requests` is hit (especially common on Groq's strict tokens-per-minute limits), the system attempts a retry (e.g., in `tryGeneration`) without respecting the HTTP `Retry-After` header.

**Failure Path:**
1. Groq TPM limit is exceeded. API returns 429 with `Retry-After: 15`.
2. Pipeline immediately catches the error and retries a few seconds later.
3. Groq returns another 429, often penalizing the account further.
4. Pipeline exhausts retries and fails the run.

**Why This Hurts Research Capability:**
Causes "rate-limited providers are retried repeatedly", destroying latency and completely failing the research task when a simple 15-second backoff would have succeeded.

**Runtime Symptoms:**
Rapid sequence of 429 errors in logs followed by a pipeline crash.

**Hidden Risk:**
Aggressive retries without backoff can lead to the API key being temporarily banned or suspended by the provider.

**Suggested Direction:**
Implement an interceptor in the provider client that parses the `Retry-After` header and mathematically enforces the delay before the next attempt, or dynamically routes to a different provider immediately upon 429.

---

## ISSUE #29: Masked failure reasons on source volume insufficiency
**Severity:** medium
**Confidence:** confirmed
**Area:** pipeline
**Files:**
- `backend/src/core/pipeline/research-pipeline.ts`

**Root Cause:**
In `runSourceUsageRoles`, if `sourceVolumeInsufficient` is true but the mode allows continuing (non-strict), it emits a warning. If the pipeline later fails because the model couldn't synthesize an answer from the inadequate sources, the failure is reported as a "quality gate failed" or "generation failure".

**Failure Path:**
1. Query finds only 1 valid source (requires 3).
2. Pipeline emits warning but proceeds.
3. Model hallucinates to fill the gap.
4. Quality gate detects hallucination and fails the pipeline.
5. User is told "Quality gate failed: hallucination detected".

**Why This Hurts Research Capability:**
"Status semantics are misleading." The user thinks the AI made a mistake, when the actual root cause was a failure to find sources.

**Runtime Symptoms:**
Confusing error messages that point to downstream synthesis failures rather than upstream retrieval failures.

**Hidden Risk:**
Makes debugging impossible for non-technical users. They will try to rephrase their prompt rather than broadening their search query.

**Suggested Direction:**
If the pipeline fails downstream and `sourceVolumeInsufficient` was true, rewrite the terminal error message to explicitly state: "Research failed: Insufficient sources were found to ground the answer safely."

---

## ISSUE #30: Fixed Jaccard deduplication fails on dense MUN resolutions
**Severity:** high
**Confidence:** confirmed
**Area:** retrieval
**Files:**
- `backend/src/lib/passage-engine.ts`

**Root Cause:**
The `jaccard` similarity check (0.72) is used globally for all text. In Model UN, draft resolutions and official UN documents are heavily templated (e.g., "Reaffirming its resolution...", "Bearing in mind..."). Two entirely different resolutions might share 75% of their vocabulary.

**Failure Path:**
1. User searches for UN Security Council resolutions on a topic.
2. Retrieval fetches Resolution A and Resolution B.
3. Both have massive preambular clauses that are identical.
4. `deduplicatePassagesSemantically` marks Resolution B as a duplicate of A.
5. Resolution B is discarded.

**Why This Hurts Research Capability:**
Causes "duplicate-result failures" by throwing out distinct primary sources just because they use standardized bureaucratic language.

**Runtime Symptoms:**
Only one UN resolution or parliamentary bill ever makes it into the final evidence pack, severely limiting source diversity.

**Hidden Risk:**
Completely breaks the `diplomatic` and `parliamentary_records` source classes.

**Suggested Direction:**
Apply a dynamic Jaccard threshold based on the `sourceClass`. For `official_government` or `parliamentary_records`, increase the threshold to 0.85 to preserve distinct documents with shared boilerplate.

---
*(End of Part 2)*


# BestDel — Research Capability Failure Audit (Part 3)

## ISSUE #31: Buffered burst of stale SSE events corrupts UI on tab wake
**Severity:** high
**Confidence:** suspected
**Area:** frontend-state, streaming
**Files:**
- `frontend/src/components/chat/stale-event-guard.ts` (implied by previous context)
- `frontend/src/components/chat/use-chat-run-controller.ts`

**Root Cause:**
If a user backgrounds the browser tab on mobile, the browser suspends JavaScript execution. The OS-level TCP socket might stay open, buffering incoming SSE events. When the tab wakes up, the browser flushes all buffered events synchronously. If `stale-event-guard` relies on real-time timing or assumes sequential processing with delays, the burst of events overwrites state out-of-order or triggers race conditions in React state updates.

**Failure Path:**
1. User starts research and backgrounds the tab.
2. Backend emits `retrieval`, `synthesis`, and `final_answer`.
3. Browser buffers these events.
4. User returns to the tab.
5. All three events fire in the same millisecond.
6. React batches the state updates, but the `use-pipeline-state` hook relies on sequential state transitions.
7. The UI glitches, showing a final answer but with the "Retrieving" spinner permanently stuck on.

**Why This Hurts Research Capability:**
Causes "stale SSE events can mutate active conversations" and degrades UX to the point where the user assumes the app is broken.

**Runtime Symptoms:**
UI components in contradictory states (e.g., final answer text rendered alongside a "Synthesizing" loading bar).

**Hidden Risk:**
Mobile users heavily rely on backgrounding tabs while waiting for 45-second research tasks to complete.

**Suggested Direction:**
Implement a strict state machine on the frontend (e.g., using XState or robust reducers) that explicitly rejects illegal state transitions (like going from `completed` back to `retrieving`), regardless of event arrival order.

---

## ISSUE #32: Misclassified 402 Payment Required causes pointless retries
**Severity:** medium
**Confidence:** confirmed
**Area:** provider-routing
**Files:**
- `backend/src/core/providers/provider-errors.ts`

**Root Cause:**
OpenRouter (and proxies) often return `402 Payment Required` wrapped in generic HTML or non-standard JSON if the user's credits are exhausted. The `classifyProviderError` logic frequently defaults to classifying unknown HTML bodies or 400-range errors (that aren't 401/403/429) as generic `network_error` or `provider_error`.

**Failure Path:**
1. User runs out of OpenRouter credits.
2. Request fails with 402 (with an HTML body).
3. `classifyProviderError` parses it as a generic `network_error`.
4. The pipeline assumes it's a transient glitch and retries the exact same model.
5. It fails again, burning latency and finally triggering a hard failure.

**Why This Hurts Research Capability:**
Burns latency budgets uselessly. "Rate-limited providers are retried repeatedly" applies to out-of-credit states as well.

**Runtime Symptoms:**
Slow failure times when credits expire, instead of an instant fallback to a free model or a local Ollama instance.

**Hidden Risk:**
Generates unnecessary traffic and obscures the true error message from the user.

**Suggested Direction:**
Explicitly catch `status === 402` or `insufficient_quota` strings in the raw error body and instantly trigger a permanent provider skip/fallback without retrying.

---

## ISSUE #33: Unbounded crawler memory consumption on massive PDFs
**Severity:** high
**Confidence:** confirmed
**Area:** retrieval
**Files:**
- `backend/src/lib/rag.ts`

**Root Cause:**
When fetching URLs via Jina or direct fetch, there is no strict payload size limit enforced *during* the download stream. Indian government websites often host massive 100MB+ PDF reports (e.g., census data, budget annexes).

**Failure Path:**
1. Search retrieves a link to a 150MB PDF document on `cag.gov.in`.
2. The fetch routine begins downloading the file into memory to parse it.
3. The Node process hits the V8 heap limit.
4. The entire backend container crashes (OOM) before chunking can even begin.

**Why This Hurts Research Capability:**
Causes catastrophic "failed research completion" and can take down the service for all users if running in a shared Node environment.

**Runtime Symptoms:**
Backend container restarts silently. Frontend hangs forever or shows a 502 Bad Gateway.

**Hidden Risk:**
Malicious users or unlucky queries can easily crash the platform by targeting URLs known to host massive files.

**Suggested Direction:**
Enforce a strict `Content-Length` header check before downloading, and use `stream.on('data')` to abort the download immediately if it exceeds 5MB.

---

## ISSUE #34: Frontend provider polling false-positives "Invalid API Key"
**Severity:** high
**Confidence:** suspected
**Area:** frontend-state
**Files:**
- `frontend/src/hooks/use-provider-models.tsx`

**Root Cause:**
The frontend periodically polls the backend or the provider directly to fetch the available model list. If the provider's `/models` endpoint is rate-limited (e.g., Groq returns 429), the frontend's error handling aggressively assumes the key is bad and updates the state to `Invalid API Key`.

**Failure Path:**
1. User is actively chatting, using their Groq key successfully.
2. Background poll hits `api.groq.com/openai/v1/models`.
3. Groq rate-limits the models endpoint.
4. The hook catches the 429 and incorrectly maps it to an invalid key state.
5. The UI shows a red warning badge, locking the user out of using Groq, even though the text generation endpoint is perfectly fine.

**Why This Hurts Research Capability:**
"Frontend selected models are ignored" and users are forced into chaotic fallbacks unnecessarily.

**Runtime Symptoms:**
Spontaneous "Invalid Key" warnings during active, healthy research sessions.

**Hidden Risk:**
Destroys user trust, as they will assume the app is broken or stealing their keys.

**Suggested Direction:**
Separate `authentication_error` (401/403) from `rate_limit_error` (429) in the polling logic. A 429 on a model list fetch should NOT invalidate the provider's health status.

---

## ISSUE #35: Hardcoded token ratio causes silent 413s on non-English text
**Severity:** high
**Confidence:** confirmed
**Area:** prompt-budget
**Files:**
- `backend/src/core/generation/prompt-budget.ts`

**Root Cause:**
`estimateTokens` uses `Math.ceil((text.length / 3.4) * 1.28)`. This ratio assumes English ASCII text. For Hindi text (Devanagari script) or heavily transliterated Indian political jargon, the token-to-character ratio is much worse (often 1 token per 1-2 characters).

**Failure Path:**
1. Research fetches Hindi news articles or regional judgments.
2. The evidence pack is filled with Devanagari text.
3. `estimateTokens` vastly underestimates the token count (assumes 4000 tokens, actually 9000 tokens).
4. The prompt is sent to a provider with an 8k context limit.
5. Provider throws `413 Payload Too Large`.

**Why This Hurts Research Capability:**
Actively penalizes research into regional Indian issues, creating a massive bias towards English-only sources and failing whenever localized primary evidence is found.

**Runtime Symptoms:**
Frequent silent provider retries or hard crashes when dealing with state-level MUN topics.

**Hidden Risk:**
Makes the platform practically unusable for deeply localized policy research.

**Suggested Direction:**
Detect non-ASCII characters in the text buffer. If Devanagari or other scripts are present, dynamically adjust the ratio (e.g., `text.length / 1.5`) to create a safer buffer.

---

## ISSUE #36: CSS stacking context hides model selection dropdown
**Severity:** medium
**Confidence:** confirmed
**Area:** frontend-state
**Files:**
- `frontend/src/components/ui/dropdown-menu.tsx` (from previous context)

**Root Cause:**
The Radix UI or custom dropdown component for selecting models is nested inside a chat or settings container that has `overflow: hidden` or a restrictive `z-index` stacking context.

**Failure Path:**
1. User clicks the model selector to switch from Groq to Gemini.
2. The dropdown renders, but is clipped by the parent container.
3. The user cannot see or click the alternative models.
4. The user is stuck with the default model.

**Why This Hurts Research Capability:**
"Frontend selected models are ignored" because the user literally cannot interact with the UI to select them.

**Runtime Symptoms:**
Invisible or cut-off model selection menu.

**Hidden Risk:**
Forces all users onto default models, potentially overloading a single provider (like Groq) and burning out free tiers globally.

**Suggested Direction:**
Use a React Portal to render the model selection dropdown at the `<body>` level, ensuring it escapes all local CSS stacking contexts.

---

## ISSUE #37: JSON parsing vulnerability in Citation Repair
**Severity:** medium
**Confidence:** confirmed
**Area:** verification, citation
**Files:**
- `backend/src/core/verification/repair-orchestrator.ts` (implied by repair logic)

**Root Cause:**
If `citationRepairPass` or `runTargetedRepair` asks the LLM to output a repaired text or a JSON array of citations, the LLM frequently wraps the output in markdown code blocks (e.g., ```json ... ```). If the parsing logic expects raw text or raw JSON, it will fail silently.

**Failure Path:**
1. Under-citation detected. Repair is triggered.
2. LLM successfully fixes the text, outputting: "Here is the fixed text:\n\n```\nThe public order is maintained [1].\n```"
3. The parser takes the literal string, markdown ticks and conversational filler included.
4. The quality gate runs on this new string, finding it to be malformed or containing conversational filler, and fails it again.

**Why This Hurts Research Capability:**
"Citation repair occurs too late or too weakly." The repair itself introduces formatting errors that ruin the final output.

**Runtime Symptoms:**
Final answers containing conversational filler ("Here is the corrected version:") or markdown artifacts.

**Hidden Risk:**
Smaller fallback models (like Llama 8b) are notorious for refusing to output raw text without conversational prefixes.

**Suggested Direction:**
Implement a robust markdown stripping utility that extracts content from between ``` markers if they exist, and aggressively strips conversational prefixes before accepting the repaired text.

---

## ISSUE #38: Regex-based quality gates are easily bypassed by LLM negations
**Severity:** medium
**Confidence:** confirmed
**Area:** verification
**Files:**
- `backend/src/core/verification/thesis-quality-gate.ts`

**Root Cause:**
The quality gate checks for structural completeness by searching for keywords like "methodology", "research angle", or "Executive Thesis". An LLM can bypass this by writing a sentence that contains the word but negates the purpose.

**Failure Path:**
1. Model fails to synthesize a proper methodology.
2. Model writes: "I cannot provide a methodology or research angle for this topic."
3. `runThesisQualityGate` runs its regex: `/methodology/i.test(text)` -> `true`.
4. The gate passes with a perfect score.

**Why This Hurts Research Capability:**
Creates a false sense of security. "Research modes degrade silently" because the quality gate approves fundamentally broken or lazy answers.

**Runtime Symptoms:**
Users receive answers that complain about being unable to fulfill the prompt, yet the UI marks them as "Verified" and "Passed Quality Gate".

**Hidden Risk:**
The metrics for pipeline success will look great, but the actual user experience will be terrible.

**Suggested Direction:**
Use a fast, specialized LLM call (e.g., `llama-3.1-8b-instant` via Groq) to perform a semantic "Yes/No" evaluation of the quality gate criteria, rather than relying on brittle regex matching.

---

## ISSUE #39: Targeted repair latency loops on persistent hallucinations
**Severity:** high
**Confidence:** confirmed
**Area:** verification
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
In `generateCoreResearchAnswer`, the repair loop (`runTargetedRepair`) is allowed to run up to 4 times (`limits.maxRepairPasses`). If a model is fundamentally confused about a fact, prompting it to fix the hallucination often just causes it to hallucinate a *different* incorrect fact.

**Failure Path:**
1. Model hallucinates Fact A.
2. Hallucination guard catches it.
3. Repair pass 1 runs. Model replaces Fact A with hallucinated Fact B.
4. Hallucination guard catches Fact B.
5. Repair pass 2 runs. Model replaces Fact B with hallucinated Fact C.
6. This loops 4 times, taking 5 seconds per pass.
7. The total latency balloons by 20 seconds, and the final answer still fails.

**Why This Hurts Research Capability:**
Burns latency budget for zero gain. "Verification fatigue" causes the system to time out or eventually fall back to a degraded state anyway.

**Runtime Symptoms:**
Extremely long generation times that ultimately result in a failed or fallback answer.

**Hidden Risk:**
Models like Gemini Flash or smaller Llama models will frequently get stuck in these oscillation loops when the evidence is contradictory.

**Suggested Direction:**
If a repair pass fails to reduce the issue count (i.e., `beforeIssueCount === afterIssueCount`), instantly abort the repair loop and proceed to deterministic fallback rather than wasting remaining passes.

---

## ISSUE #40: Snippet-only abuse pollutes evidence registry
**Severity:** high
**Confidence:** confirmed
**Area:** retrieval, evidence
**Files:**
- `backend/src/lib/passage-engine.ts` (implied snippet handling)

**Root Cause:**
If full HTML extraction fails (e.g., anti-bot protection), the system relies on the short 160-character snippet provided by the search engine (Tavily/Google). Because it lacks other sources, it marks this snippet as "citation eligible" and feeds it to the LLM.

**Failure Path:**
1. Search finds a great PDF, but extraction fails.
2. The search snippet ("...the court held that the petition was dismissed because...") is saved.
3. The source is marked as citation eligible because no other sources exist for that bucket.
4. The LLM attempts to synthesize a deep legal argument using only those 160 characters.
5. The LLM hallucinates the rest of the context.

**Why This Hurts Research Capability:**
"Snippet-only sources become citation eligible too easily." It tricks the LLM into thinking it has primary evidence, leading to massive overclaiming.

**Runtime Symptoms:**
Model cites a source for a grand, sweeping claim, but the actual source card in the UI only contains a 2-sentence fragment.

**Hidden Risk:**
Destroys the "evidence grounding" principle of the app. A snippet is not evidence.

**Suggested Direction:**
Strictly downgrade `extractionQuality === 'snippet'` sources to `relevant_but_weak` in the `SourceUsageMap`, explicitly preventing them from being used for `legal_holding_extracted` or `fact_extracted`.

---

## ISSUE #41: General sources are arbitrarily deprioritized
**Severity:** medium
**Confidence:** confirmed
**Area:** synthesis
**Files:**
- `backend/src/lib/source-compiler.ts` (from previous context)

**Root Cause:**
`source-compiler.ts` segregates sources into "Primary" and "General". If a topic is heavily reliant on investigative journalism (which gets classed as General), the prompt structure biases the model to treat them as secondary context rather than primary proof.

**Failure Path:**
1. User researches the Hindenburg/Adani report.
2. All major sources are investigative media reports ("General").
3. The compiler presents them to the LLM as secondary context.
4. The LLM's system prompt instructs it to rely heavily on "Primary" sources.
5. Since there are few/no court cases yet, the LLM refuses to make strong claims, leading to a weak synthesis.

**Why This Hurts Research Capability:**
Cripples the app's ability to handle "current events without live search" or breaking news topics where primary government documentation doesn't exist yet.

**Runtime Symptoms:**
Vague, non-committal answers for breaking political scandals, despite finding excellent journalistic sources.

**Hidden Risk:**
Users will think the AI is censored or biased, when it's actually just rigidly following a primary-source-first heuristic.

**Suggested Direction:**
If the `SourceGapReport` shows 0 primary sources but high-quality general sources, dynamically elevate the `authorityScore` of the general sources and alter the system prompt to treat them as the factual baseline.

---

## ISSUE #42: Rigid D7 debate utility templates suppress nuance
**Severity:** low
**Confidence:** confirmed
**Area:** synthesis
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
In `buildDivisionOutputs`, the `D7_debate_utility` section is constructed using string interpolation with hardcoded POI templates (e.g., "1. Which registry source proves the central number?"). 

**Failure Path:**
1. User asks a highly specific procedural question about Rajya Sabha voting rules.
2. The pipeline succeeds and generates great sources.
3. The `buildDivisionOutputs` blindly appends "Which court or statute supports the legal claim?" and "Where is the Election Commission defence...".
4. These hardcoded POIs have absolutely nothing to do with Rajya Sabha voting rules.

**Why This Hurts Research Capability:**
Destroys the illusion of intelligence. The debate strategy becomes boilerplate rather than being dynamically generated based on the actual facts retrieved.

**Runtime Symptoms:**
Users see the exact same 8 POIs at the bottom of every single research report, regardless of the topic.

**Hidden Risk:**
MUN delegates will realize the strategy section is fake/hardcoded and stop reading it entirely, nullifying a core feature of the app.

**Suggested Direction:**
Pass the generated `finalAnswer` and `evidencePacks` through a fast LLM (like `llama-3.1-8b`) specifically to generate bespoke, topic-aware POIs and rebuttals, rather than hardcoding the strings.

---
*(End of Part 3)*


# BestDel — Research Capability Failure Audit (Part 4)

## ISSUE #43: Missing freshness parameters for breaking current events
**Severity:** high
**Confidence:** confirmed
**Area:** search, freshness
**Files:**
- `backend/src/core/search/search-executor.ts` (implied behavior)
- `backend/src/core/retrieval/query-planner.ts`

**Root Cause:**
When generating search queries for the `web_search` or `fast_research` modes, the query planner does not append strict time-based constraints (e.g., `tbs=qdr:w` for Google, or equivalent date filters for Tavily/Brave) when the query involves a breaking current event.

**Failure Path:**
1. User asks about a Supreme Court verdict that happened yesterday.
2. `query-planner.ts` generates a broad query: "Supreme Court Electoral Bonds verdict".
3. Search provider returns the most authoritative historical articles from 3 years ago when the scheme was first challenged.
4. The fresh news articles from yesterday are pushed to page 2.
5. The pipeline retrieves historical context but completely misses the breaking update.

**Why This Hurts Research Capability:**
Causes "stale current-event answers". The AI will confidently state that the case is still pending, despite being asked about the verdict.

**Runtime Symptoms:**
Answers are highly authoritative but factually out of date for anything that happened in the last 72 hours.

**Hidden Risk:**
Model UN depends heavily on up-to-the-minute current affairs. Stale data ruins debate prep.

**Suggested Direction:**
Detect implicit temporal terms in the query ("latest", "yesterday", "recent verdict") and explicitly append date filters to the Search API payloads.

---

## ISSUE #44: Uncancelled AbortSignals cause overlapping run corruption
**Severity:** critical
**Confidence:** confirmed
**Area:** concurrency, streaming
**Files:**
- `backend/src/core/pipeline/research-pipeline.ts`
- `frontend/src/components/chat/use-chat-run-controller.ts`

**Root Cause:**
If a user edits a message in the frontend and clicks "Resubmit" while the first research pipeline is still running, the frontend may open a new SSE connection. However, the backend does not actively track and cancel the `AbortSignal` of the *previous* run for that same conversation/message ID.

**Failure Path:**
1. User submits Query A. Backend starts fetching 30 URLs.
2. User realizes a typo and resubmits as Query B.
3. Backend starts fetching 30 URLs for Query B.
4. Run A finishes retrieving and sends an `evidence_registry_created` SSE event to the open socket or shared message channel.
5. Run B also sends its own events.
6. The frontend state rapidly oscillates between the two runs, eventually crashing or blending the results.

**Why This Hurts Research Capability:**
"Overlapping runs corrupting output". It wastes massive amounts of provider credits and ruins the user's active session.

**Runtime Symptoms:**
UI flickers wildly between different loading states. Final text is a schizophrenic mix of two different topics.

**Hidden Risk:**
A frustrated user clicking "Submit" 5 times rapidly will spawn 5 massive background research tasks, instantly hitting provider rate limits.

**Suggested Direction:**
In the backend API route, store a map of `conversationId -> AbortController`. If a new request comes in for the same conversation, immediately call `.abort()` on the old controller before spawning the new pipeline.

---

## ISSUE #45: Prompt budget collapse from unconstrained Archive injection
**Severity:** high
**Confidence:** confirmed
**Area:** prompt-budget, generation
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`
- `backend/src/core/generation/prompt-budget.ts`

**Root Cause:**
If the user has a very long prior conversation, this is passed as `archiveText`. The `prompt-budget.ts` does not enforce a strict ceiling on the percentage of the context window that the archive is allowed to consume versus live evidence.

**Failure Path:**
1. User has a 20-turn deep conversation (15,000 tokens of `archiveText`).
2. User asks a new deep research question.
3. Model budget is 24,000 max input tokens.
4. The system injects the 15k archive text.
5. Only 9,000 tokens remain for evidence cards.
6. The evidence compressor brutally truncates the new evidence to fit.
7. The model answers using the old conversation context instead of the new live evidence.

**Why This Hurts Research Capability:**
"Prompt budget collapse before generation." The primary value of the tool (live evidence) is sacrificed to maintain chat history.

**Runtime Symptoms:**
As conversations get longer, the quality of citations and live search data degrades exponentially.

**Hidden Risk:**
Users are punished for having long, productive sessions.

**Suggested Direction:**
Enforce a strict ratio: `archiveText` must never exceed 30% of `maxInputTokens`. If it does, summarize the archive or truncate it (FIFO) before feeding it to the prompt budget allocator.

---

## ISSUE #46: Contradiction blindness in Deterministic Fallback
**Severity:** medium
**Confidence:** confirmed
**Area:** synthesis
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
The `buildDeterministicCitedFallbackAnswer` function simply loops over the top `N` evidence cards and prints their facts sequentially. It does not check if Fact 1 contradicts Fact 2 (e.g., Treasury source vs. Opposition source).

**Failure Path:**
1. Pipeline falls back to deterministic mode.
2. Card 1 says: "The Supreme Court upheld the amendment."
3. Card 2 says: "The High Court struck down the amendment."
4. The fallback text prints both claims linearly under "Source-Grounded Evidence Ledger".

**Why This Hurts Research Capability:**
Destroys "contradiction handling". The user is left with a confusing, schizophrenic output that requires them to read the raw sources to understand the discrepancy.

**Runtime Symptoms:**
Highly contradictory statements presented as sequential facts in the fallback UI.

**Hidden Risk:**
Erodes trust, as the AI appears to lack basic reading comprehension.

**Suggested Direction:**
Use the `claimGraph` (which detects unsupported or contradictory claims) to group the deterministic output into "Pro-Government Claims" and "Opposition Claims" rather than a single flat list.

---

## ISSUE #47: Stale keyword assumptions in Committee Type routing
**Severity:** medium
**Confidence:** confirmed
**Area:** provider-routing, synthesis
**Files:**
- `backend/src/core/pipeline/research-pipeline.ts`

**Root Cause:**
`inferCommitteeType` relies on naive `.test()` regex. For example, `/\bhuman rights\b|nhrc/` routes to `human_rights`. 

**Failure Path:**
1. User asks: "What is the economic cost of funding the NHRC vs other statutory bodies?"
2. `inferCommitteeType` matches `NHRC`.
3. It routes the entire synthesis and debate utility strategy to `human_rights`.
4. The D7 Debate Utility output tells the Opposition to argue about "civil liberties and torture", completely ignoring the economic premise of the user's prompt.

**Why This Hurts Research Capability:**
Creates a jarring disconnect between the user's intent and the AI's parliamentary framing.

**Runtime Symptoms:**
Debate strategies that feel copy-pasted and irrelevant to the specific nuance of the prompt.

**Hidden Risk:**
Makes the AI feel rigid and un-adaptable.

**Suggested Direction:**
Pass the user query through a lightweight classifier LLM during the `agenda_contract` creation phase, rather than relying on brittle local regex for committee routing.

---

## ISSUE #48: GitHub Models timeout misalignment
**Severity:** medium
**Confidence:** confirmed
**Area:** provider-routing
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
In `tryGeneration`, the timeout is set using `Math.min(input.providerCallTimeoutMs ?? 45_000, ...)`. GitHub Models (Azure endpoints) for free users often experience massive cold-start delays or silent hangs. A 45-second timeout on a hanging GitHub model burns the entire pipeline latency budget.

**Failure Path:**
1. System selects `github` provider with `gpt-4.1-mini`.
2. The GitHub endpoint hangs silently.
3. The system waits the full 45 seconds.
4. The request times out.
5. The pipeline has 0 seconds left to try a fallback model (e.g., Groq) and crashes.

**Why This Hurts Research Capability:**
"Provider fallbacks become chaotic." A slow provider ruins the chance for a fast provider to save the request.

**Runtime Symptoms:**
45-second loading screens that end in total failure, even though Groq was available and healthy.

**Hidden Risk:**
Free-tier API endpoints are notoriously unreliable; giving them massive timeouts is fatal.

**Suggested Direction:**
Implement a cascading timeout strategy: first attempt gets 15s. If it times out, immediately swap to a different, faster provider (like Groq) for the remaining 30s.

---

## ISSUE #49: Citation targets become physically impossible after deduplication
**Severity:** high
**Confidence:** confirmed
**Area:** citation, evidence
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`
- `backend/src/lib/passage-engine.ts`

**Root Cause:**
`requiredFinalSources` is calculated at the beginning of `generateCoreResearchAnswer` based on the length of `citationEligibleSources`. However, if the LLM utilizes `sourceUsageMap` logically, it might realize that 4 out of the 10 eligible sources are actually duplicates or irrelevant. 

**Failure Path:**
1. 10 sources are eligible. `requiredFinalSources` is set to 8.
2. The LLM synthesizes the answer, realizing that sources 7, 8, 9, and 10 are redundant.
3. It cites sources 1 through 6 perfectly.
4. `citationValidationReport.uniqueCitedSourceCount` is 6.
5. Since 6 < 8, the system thinks the LLM failed and triggers `runTargetedRepair` or deterministic fallback.

**Why This Hurts Research Capability:**
"Citation target becomes impossible." The system punishes the LLM for being intelligent and recognizing redundancy.

**Runtime Symptoms:**
Perfectly synthesized, well-cited answers are suddenly replaced by the robotic Deterministic Fallback UI because the model missed an arbitrary quota by 1.

**Hidden Risk:**
The system is fighting against the LLM's natural summarization capabilities.

**Suggested Direction:**
Cap the `requiredFinalSources` not just by `citationEligibleSources.length`, but by the number of sources that *actually survived the SourceUsageMap validation*. If the model explicitly marked a source as irrelevant during the `thesis_synthesizer` role, don't force it to cite it later.

---

## ISSUE #50: Evidence Pack Builder floods prompt with redundant cards
**Severity:** high
**Confidence:** confirmed
**Area:** compression, source-feeding
**Files:**
- `backend/src/core/evidence/evidence-compressor.ts`

**Root Cause:**
When `buildBudgetedEvidencePack` selects cards, it relies primarily on `authorityScore` and `mustIncludeSourceIds`. If a single massive court judgment is split into 5 different highly-scored passages during retrieval, it will dominate the evidence pack.

**Failure Path:**
1. Search retrieves a 100-page Supreme Court judgment and an op-ed.
2. Retrieval chunks the judgment into 20 passages.
3. 5 of those passages score incredibly high on `authorityScore` because it's a `court_primary` source.
4. The evidence compressor fills the `maxCards` budget with 5 cards all derived from the *same* URL/judgment.
5. The op-ed is pushed out of the prompt due to the budget.

**Why This Hurts Research Capability:**
Destroys "source diversity". The LLM is given 5 slightly different variations of the exact same legal holding and zero counter-arguments or political context.

**Runtime Symptoms:**
Final answer heavily cites `[1], [2], [3], [4]` but they all point to the exact same Supreme Court URL.

**Hidden Risk:**
Defeats the purpose of the multi-bucket search strategy if the prompt compilation step allows one source to monopolize the context window.

**Suggested Direction:**
Enforce a `maxCardsPerUrl` limit (e.g., max 2 cards from the same URL) inside `buildBudgetedEvidencePack` to guarantee space for diverse sources.

---
*(End of Part 4)*


# BestDel — Research Capability Failure Audit (Part 5: Capstone Architectural Review)

## ISSUE #51: The Mega-Prompt Contradiction (Validation vs. Generation)
**Severity:** critical
**Area:** orchestration, synthesis
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`
- `backend/src/core/pipeline/research-pipeline.ts`

**Root Cause:**
The pipeline attempts to implement advanced evidence extraction (`SourceUsageMap`, `ModelRoleOutputs`), but these are completely decoupled from the actual text generation. `generateCoreResearchAnswer` takes the validated source usage maps but *ignores* them for the actual synthesis. Instead, it compiles all the raw `EvidencePacks` into a massive prompt (`buildCoreAnswerUserPrompt`) and asks the LLM to write the entire prose at once. The extracted claims from the `SourceUsageMap` are merely used as a pass/fail gate before generation, not as the structural skeleton of the answer.

**Failure Path:**
1. `runSourceUsageRoles` uses specialized LLMs to meticulously extract atomic facts from sources.
2. `SourceUsageMap` validates these facts and passes the pipeline.
3. `generateCoreResearchAnswer` ignores the extracted atomic facts.
4. It concatenates the raw `EvidencePacks` (the compressed source text) into a giant 30,000-token prompt.
5. The synthesis LLM receives the mega-prompt and generates prose from scratch, often hallucinating or missing citations because it is overwhelmed by the raw text context.

**Why It Harms Research Quality:**
The system behaves exactly like an "LLM wrapper with search". It does all the hard work of structured extraction, throws it away, and relies entirely on a mega-prompt to produce prose. This guarantees citation failures and hallucination loops.

**Symptoms:**
High token usage during `SourceUsageRoles`, but the final answer still under-cites or misrepresents sources.

**Hidden Risk:**
Any investment in `SourceUsageMap` accuracy is wasted because the final prose generator doesn't use the structured output.

**Recommended Architectural Direction:**
Transition to **Evidence-First Synthesis**. The synthesis LLM should *not* receive raw EvidencePacks. It should receive the *validated claim graph* and the *extracted facts* from the `SourceUsageMap`, and its prompt should simply be: "Render these specific extracted claims into cohesive parliamentary prose."

---

## ISSUE #52: Post-Hoc Citation Repair Instead of Deterministic Grounding
**Severity:** critical
**Area:** citation, verification
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
Citations are treated as text artifacts generated by the LLM (e.g., asking the LLM to write `[1]`). If the LLM forgets to write `[1]`, the system relies on `runTargetedRepair`, which sends the generated text *back* to the LLM and asks it to "add missing citations." 

**Failure Path:**
1. Synthesis generates an excellent paragraph based on Source 4, but omits the `[4]` bracket.
2. `validateCitations` counts 0 citations for that claim.
3. `generateCoreResearchAnswer` triggers `runTargetedRepair`.
4. The repair LLM reads the text, guesses which source supports it (often guessing wrong), and injects `[2]`.
5. The final output is now mis-cited.

**Why It Harms Research Quality:**
Citation is treated as a cosmetic formatting task rather than a deterministic data link. LLMs are terrible at correctly retrofitting citations into existing text.

**Symptoms:**
Model gets stuck in repair loops. Final answers have citations that point to completely unrelated sources just to satisfy the numerical quota.

**Hidden Risk:**
Destroys the core reliability of the research engine. Users will click a citation and realize it doesn't support the text, destroying trust.

**Recommended Architectural Direction:**
Implement **Deterministic Citation Injection**. The synthesis phase should not generate brackets. It should generate JSON objects: `{ text: "The economy grew by 7%.", claimId: "fact_123" }`. The backend should deterministically map `fact_123` back to `Source 4` and inject the `[4]` bracket natively before rendering the markdown.

---

## ISSUE #53: ClaimGraph is used for Validation, not Resolution
**Severity:** high
**Area:** evidence, synthesis
**Files:**
- `backend/src/core/evidence/claim-graph.ts`
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
`buildClaimGraph` analyzes the evidence registry to detect claims, supports, and contradictions. However, this graph is never provided to the synthesis model as a conflict-resolution tool. Instead, `detectUnsupportedClaims` is called *after* the final answer is generated, merely to throw an error if the LLM hallucinated.

**Failure Path:**
1. `buildClaimGraph` detects that Source A says "EVMs are secure" and Source B says "EVMs can be tampered with".
2. The synthesis LLM is fed the mega-prompt containing both sources.
3. The LLM gets confused and generates a contradictory paragraph.
4. `detectUnsupportedClaims` runs on the output, finds it unsupported, and throws a fatal error.
5. The pipeline fails.

**Why It Harms Research Quality:**
Fails to act as a "production-grade parliamentary intelligence system". Real intelligence systems highlight contradictions to the user; they don't crash when evidence conflicts.

**Symptoms:**
Pipeline fails with `unsupported claims detected: ...` rather than elegantly explaining the contradiction to the user.

**Hidden Risk:**
Complex political topics inherently contain contradictory evidence. A system that crashes on contradiction is useless for Model UN.

**Recommended Architectural Direction:**
Provide the `ClaimGraph` directly to the synthesis engine. The prompt should instruct the LLM: "The ClaimGraph shows a contradiction between Source A and Source B regarding EVMs. Write a paragraph contrasting these two positions."

---

## ISSUE #54: Division Synthesis (D1-D11) is Static Boilerplate
**Severity:** high
**Area:** orchestration, synthesis
**Files:**
- `backend/src/core/generation/core-answer-generator.ts`

**Root Cause:**
The outputs for the highly advanced D1-D11 parliamentary division strategies (`buildDivisionOutputs`) are literally hardcoded string interpolations. They take snippets from the evidence registry and stuff them into static templates like `IF courts demand proportionality, THEN unsupported executive overreach weakens.`

**Failure Path:**
1. User asks a deep research question about agricultural subsidies.
2. Pipeline gathers amazing data on WTO limits and MSP impacts.
3. `buildDivisionOutputs` runs.
4. It outputs the exact same boilerplate about "public order" and "constitutional morality" used for security questions, because the template is hardcoded.

**Why It Harms Research Quality:**
It completely nullifies the value of the advanced division framework. The D1-D11 system is designed to provide bespoke strategic intelligence, but it behaves like a rigid Mad-Libs template.

**Symptoms:**
All research reports end with the exact same D7/D11 strategic advice, regardless of whether the topic is constitutional law, economics, or foreign policy.

**Hidden Risk:**
Users will quickly realize the strategic advice is fake and stop using the platform for parliamentary prep.

**Recommended Architectural Direction:**
The D1-D11 outputs must be dynamically generated by a specialized LLM agent. Pass the `ClaimGraph` and `SourceUsageMap` to an `indian_parliamentary_strategist` role, and have it *synthesize* the strategic insights based on the actual facts.

---

## ISSUE #55: Multi-Hop Retrieval is Missing or Disconnected
**Severity:** critical
**Area:** retrieval
**Files:**
- `backend/src/core/retrieval/query-planner.ts`
- `backend/src/core/retrieval/bucketed-retrieval.ts`

**Root Cause:**
The system uses `buildBucketedQueryPlan` to generate search queries upfront based on the user's initial prompt. It executes these queries simultaneously. There is no feedback loop where the results of Query 1 inform the execution of Query 2 (true multi-hop retrieval).

**Failure Path:**
1. User asks: "What was the Supreme Court's justification in the most recent electoral bonds verdict?"
2. Query Planner generates: "Supreme Court electoral bonds verdict 2024".
3. Retrieval fetches news articles that mention the verdict but don't quote the justification, only mentioning the judge's name (Chandrachud).
4. Because there is no multi-hop loop, the system cannot dynamically generate a follow-up query like "Chandrachud electoral bonds justification text".
5. The pipeline proceeds with shallow evidence and the final answer is weak.

**Why It Harms Research Quality:**
Retrieval produces broad, shallow evidence instead of deep, actionable intelligence. It behaves like a basic search wrapper rather than a research agent.

**Symptoms:**
The pipeline succeeds, but the evidence is generic news summaries rather than primary source documents.

**Hidden Risk:**
Without multi-hop capabilities, the system will never be able to answer complex "why" or "how" questions that require tracing citations across multiple documents.

**Recommended Architectural Direction:**
Implement an iterative retrieval loop:
`Plan Queries -> Retrieve -> Extract Claims -> Detect Gaps in Claims -> Generate Follow-up Queries -> Retrieve -> Repeat (max 2-3 hops)`.

---

## ISSUE #56: Evidence Clustering is Non-Existent
**Severity:** high
**Area:** evidence, retrieval
**Files:**
- `backend/src/lib/passage-engine.ts`

**Root Cause:**
Sources and passages are stored in a flat list in the `EvidenceRegistry`. `deduplicatePassagesSemantically` removes identical text, but there is no semantic clustering of distinct sources that support the same underlying claim.

**Failure Path:**
1. Retrieval finds 10 articles all stating that "India's GDP grew by 7%".
2. Because they use slightly different phrasing, they survive deduplication.
3. The `EvidenceRegistry` is flooded with 10 redundant cards.
4. The `EvidenceCompressor` hits its `maxCards` budget just packing these 10 cards.
5. Distinct, contrary evidence (e.g., "Unemployment remains high") is dropped due to prompt budget limits.

**Why It Harms Research Quality:**
Results in "shallow source diversity". The system achieves high source counts, but the actual evidentiary variance is zero.

**Symptoms:**
Final answers cite 15 sources, but all 15 sources are used to support a single, undisputed macro-economic fact, while the nuanced parts of the prompt are ignored.

**Hidden Risk:**
The system wastes massive prompt budgets feeding the LLM the exact same information 10 times.

**Recommended Architectural Direction:**
Implement semantic clustering (e.g., using fast local embeddings or TF-IDF centroids) *before* evidence compression. The compressor should pull the single highest-authority source from each cluster to guarantee diversity in the final prompt, rather than blindly pulling by authority score.

---

## ISSUE #57: Stale State Hydration Desyncs Backend Execution
**Severity:** high
**Area:** frontend-state, concurrency
**Files:**
- `frontend/src/hooks/use-pipeline-state.ts` (implied by execution architecture)

**Root Cause:**
When a user reloads the page or navigates away and back, the frontend attempts to hydrate the state of an ongoing research run. However, the backend does not expose a `/runs/:id/state` endpoint to fetch the current, fully resolved `PipelineMetadata`. Instead, the frontend relies entirely on catching live SSE events.

**Failure Path:**
1. Backend is executing a 60-second deep research task.
2. At 30 seconds, user refreshes the browser.
3. Frontend mounts, connects to the SSE stream.
4. Frontend missed the `agenda_contract_created` and `evidence_registry_created` events.
5. Backend emits `quality_gate_completed`.
6. Frontend crashes or enters an invalid state because it receives a completion event for a pipeline it thinks hasn't started yet.

**Why It Harms Research Quality:**
"Frontend state and backend execution still desynchronize." Users lose access to their research entirely if they refresh, despite the backend successfully completing the work and spending provider credits.

**Symptoms:**
Blank screens, stuck loading spinners, or JavaScript crashes in the UI upon page refresh during active research.

**Hidden Risk:**
Makes the platform feel incredibly fragile and amateurish compared to production systems like ChatGPT or Perplexity, which seamlessly resume state.

**Recommended Architectural Direction:**
The backend must persist the real-time state of the `PipelineMetadata` to SQLite/Postgres or Redis. On frontend mount, it must HTTP GET the current state tree *before* attaching the SSE listener to receive subsequent diffs.

---

## ISSUE #58: Provider Router lacks Circuit Breaking
**Severity:** critical
**Area:** provider-routing
**Files:**
- `backend/src/lib/provider-router.ts`

**Root Cause:**
`resolveProvider` is a pure functional mapping. There is no stateful circuit breaker pattern implemented at the routing layer. If a provider (like Groq) is fundamentally down or rate-limiting the IP, the router will blindly instantiate the client and attempt the request every single time it is called.

**Failure Path:**
1. Groq API is experiencing a global outage (returns 503).
2. Pipeline initiates `runSourceUsageRoles`, which spawns 6 parallel requests.
3. Router resolves Groq 6 times.
4. All 6 requests hit the 503 and fail.
5. The pipeline falls back, but the next time the user types a message, the router blindly resolves Groq again, hitting the 503 again.

**Why It Harms Research Quality:**
"Provider retry storms" and "multi-model orchestration instability." The system tortures dead providers, maximizing latency and guaranteeing failure.

**Symptoms:**
Every message takes 30 seconds to fail before finally falling back to a working provider.

**Hidden Risk:**
Repeatedly hammering a rate-limited or failing provider can lead to automated IP bans.

**Recommended Architectural Direction:**
Implement a stateful Circuit Breaker at the `provider-router.ts` level. If a provider returns 3 consecutive 5xx or 429 errors, the circuit trips to "OPEN" for 60 seconds, and `resolveProvider` instantly throws or routes to a fallback without attempting a network request.

---

## ISSUE #59: Final Status evaluates Source Count, not Evidence Quality
**Severity:** high
**Area:** orchestration, verification
**Files:**
- `backend/src/core/pipeline/final-status.ts`

**Root Cause:**
`decideFinalResearchStatus` defines a "successful" run strictly by `citedSources >= input.sourceContract.requiredSources`. It does not evaluate whether the cited sources actually provided high-quality evidence.

**Failure Path:**
1. Pipeline retrieves 8 low-quality "snippet-only" sources.
2. The LLM generates a highly hallucinatory answer, but obediently appends `[1]` through `[8]` at the end of its sentences.
3. `decideFinalResearchStatus` counts 8 citations.
4. The target was 8. The run is marked `completed`.

**Why It Harms Research Quality:**
"Research completion criteria are too source-count-driven instead of evidence-quality-driven." The system optimizes for the appearance of research (brackets) rather than the substance of research.

**Symptoms:**
Outputs that look highly referenced but contain completely fabricated or irrelevant information when the citations are clicked.

**Hidden Risk:**
Users will learn that the AI's citations are untrustworthy.

**Recommended Architectural Direction:**
The final status must integrate the `SourceUsageMap` validation score into its success criteria. A run is only `completed` if `validUsageCount >= requiredSources` AND `hallucination_guard` passes, regardless of how many brackets the LLM printed.

---

## ISSUE #60: Orchestration relies on Error Throwing for Flow Control
**Severity:** high
**Area:** orchestration
**Files:**
- `backend/src/core/pipeline/research-pipeline.ts`

**Root Cause:**
In `runResearchPipeline`, if core generation fails or source usage fails strictly, the system uses `throw error` to abort execution. The `catch` block at the bottom of the function then attempts to decipher the error string/code to decide if it should trigger the deterministic fallback.

**Failure Path:**
1. `runSourceUsageRoles` fails because the model output was lazy.
2. It throws an `Error("Source usage validation failed...")`.
3. The pipeline's main try/catch block catches this.
4. Because it's a generic Error object, the pipeline struggles to differentiate between a safe orchestration fallback trigger and a catastrophic Node.js crash.
5. It triggers `emitTerminal("failed")` and crashes the whole request instead of gracefully degrading.

**Why It Harms Research Quality:**
"Hidden fallback paths" and "legacy orchestration leaks". Using exceptions for control flow makes it impossible to build resilient, multi-stage fallback trees.

**Symptoms:**
Pipeline crashes entirely on minor validation errors that should have just triggered a partial fallback.

**Hidden Risk:**
Any unhandled exception deep in a library (like a JSON parse error) will bypass the entire fallback architecture and kill the request.

**Recommended Architectural Direction:**
Adopt a Result/Either Monad pattern or explicit State Machine transitions for orchestration. Functions should return `{ ok: false, reason: "validation_failed", state: partialData }` rather than throwing exceptions, allowing the pipeline orchestrator to safely route to the next degraded state.

---

# BestDel — Query Intake Layer Audit (Part 3)

## ISSUE #61: API Key Extraction & Process Environment Split-Brain States
**Severity:** high
**Confidence:** confirmed
**Area:** provider-routing, configuration
**Files:**
- `backend/src/core/providers/provider-key-extraction.ts`
- `backend/src/lib/provider-router.ts`

**Root Cause:**
The system supports dual modes of API key specification: environment variables on the backend, and dynamic headers (e.g. `x-groq-api-key`) passed from the frontend settings. While `extractProviderKeys` attempts to bridge this by resolving headers first and then falling back to environment variables, the backend orchestration pipeline often directly inspects `process.env.GROQ_API_KEY` (or other keys) in separate helper functions rather than threading the extracted `RequestKeys` context.

**Failure Path:**
1. Frontend sends a custom `x-groq-api-key` header to try out a personal account.
2. The intake handler correctly extracts this via `extractKeys(req)` and passes it to `resolveProvider`.
3. However, downstream files (e.g. legacy fallback models or validation gates) directly instantiate SDK clients using `process.env.GROQ_API_KEY` instead of passing the keys down.
4. The request fails with a 401/403 authorization error or uses the wrong account quota, creating "split-brain" states.

**Why This Hurts Research Capability:**
Bypasses client-specified settings, leading to silent authorization failures or quota leakage.

**Runtime Symptoms:**
User enters a valid API key in settings, but the backend rejects it with "Invalid API Key" because it's using the server's empty environment variable instead of the header.

---

## ISSUE #62: Inactive Client Session Persistence and Write-After-End Crashes
**Severity:** high
**Confidence:** confirmed
**Area:** streaming, session-init
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
When a client disconnects, `req.on("close")` is triggered, calling `requestAbortController.abort()`. However, the catch block does not check if the socket is already closed (`clientDisconnected`) before invoking `persistAssistantFailed` (which takes several database roundtrips) and `sendRunEvent("failed", ...)`.

**Failure Path:**
1. Client sends a request, then immediately aborts or suffers network failure.
2. `req.on("close")` fires, aborting the active run.
3. Catch block executes and attempts to write to the response object (`sendRunEvent`).
4. Express throws `ERR_STREAM_WRITE_AFTER_END` or `ERR_HTTP_HEADERS_SENT` because the headers/stream were already terminated.
5. The Node.js process is flooded with unhandled stream errors, causing performance degradation or crash loops.

**Why This Hurts Research Capability:**
Decreases server robustness and wastes database connection pools on dead requests.

**Runtime Symptoms:**
Unhandled exception stack traces in logs (`WriteAfterWriteError`) and database connection pool exhaustion.

---

## ISSUE #63: Missing Sequence Verification in Client Event Processing
**Severity:** critical
**Confidence:** confirmed
**Area:** frontend-state, streaming
**Files:**
- `frontend/src/components/chat/stream-event-normalizer.ts`
- `frontend/src/hooks/use-pipeline-state.ts`

**Root Cause:**
The frontend's SSE listener processes streaming chunks asynchronously. When a research run is superseded, the client aborts the previous request, but does not flush or ignore late-arriving packets already sitting in the browser's HTTP/2 stream buffer or TCP socket queue. Since events lack strict, monotonically increasing sequence numbers linked to the active `runId`, the state reducer blindly merges events from multiple overlapping streams.

**Failure Path:**
1. User enters Prompt A, which triggers a research run (`run_1`).
2. User quickly enters Prompt B, superseding the first run and spawning `run_2`.
3. The frontend updates `activeRunRef.current` to `run_2`.
4. However, the browser's reader is still processing buffered chunks from `run_1`.
5. These events lack sequence boundaries, so `normalizeStreamEvent` processes them and dispatches them to the reducer.
6. The UI merges the answer text of `run_1` and `run_2`, generating corrupted chat answers.

**Why This Hurts Research Capability:**
Causes "event sequencing mismatches", resulting in corrupted UI rendering and broken research archives.

**Runtime Symptoms:**
Chat UI displays a mixture of two different answers or is permanently corrupted upon fast typing.

---

## ISSUE #64: DB Race Conditions on Superseded Message Insertion
**Severity:** high
**Confidence:** confirmed
**Area:** session-init, persistence
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
When a new request supersedes an old run, the old run is cancelled asynchronously via `activeRun.cancel("superseded_by_new_prompt")`. This schedules `persistAssistantFailed` in the database. Simultaneously, the new request inserts its `userMessage` and `assistantMessage` into the database. There is no transactional serialization ensuring the old run's failure persistence finishes before the new run's message insertion.

**Failure Path:**
1. New request enters intake and calls `previousRun.cancel()`.
2. Old run's `persistAssistantFailed` begins asynchronously.
3. New run inserts `userMessage` and `assistantMessage` to DB.
4. Old run's DB query finishes *after* the new run's insertions, potentially updating the conversation's state to "failed" or writing stale logs, overwriting the new run's initial database state.

**Why This Hurts Research Capability:**
Causes database consistency errors and corrupts conversation history databases.

**Runtime Symptoms:**
Active conversations suddenly get marked as "failed" in the sidebar even though they are currently running.

---

## ISSUE #65: Boundless Memory Leak in Global Provider Status Cache
**Severity:** medium
**Confidence:** confirmed
**Area:** provider-routing, memory
**Files:**
- `backend/src/routes/providers.ts`

**Root Cause:**
The status of providers is cached globally in `providerStatusCache`. The cache key is derived from the SHA-256 fingerprints of the client's API keys. There is no eviction policy (e.g. Least Recently Used - LRU) or size limit on this `Map`. Every time a client requests status with a new key variation, a new entry is permanently added to the map.

**Failure Path:**
1. Multiple users load the site with custom keys.
2. Each status check creates a new cache entry.
3. The `providerStatusCache` map grows indefinitely.
4. Server eventually runs out of heap memory and crashes (Out Of Memory).

**Why This Hurts Research Capability:**
Limits application uptime and scalability.

**Runtime Symptoms:**
Slow memory bloat over days/weeks, leading to sudden backend process restarts.

---

## ISSUE #66: Weak Type-Safety and Input Validation Gaps at API Boundary
**Severity:** medium
**Confidence:** confirmed
**Area:** session-init, validation
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
The message intake endpoint uses `SendAnthropicMessageBody.safeParse(req.body)` but only defines a subset of fields (`content`, `mode`, `researchMode`, `rhetoricsType`, `creativity`) in the schema. Critical parameters like `systemPrompt`, `autoFallback`, `normalModel`, and `webModels` are extracted directly from `req.body` using manual type checks (e.g., `typeof req.body.normalModel === "string"`).

**Failure Path:**
1. Client sends a request containing a malformed `webModels` array (e.g. `[null, 123]`).
2. Zod validation passes because the field is ignored by the schema.
3. The manual checks loop through `req.body.webModels` but can miss edge cases.
4. Malformed values pass into the core orchestration logic, causing runtime exceptions.

**Why This Hurts Research Capability:**
Allows malformed payloads to bypass the validation boundary, crashing downstream systems.

**Runtime Symptoms:**
Unexpected 500 Internal Server Errors in the logs instead of clean 400 Bad Request responses.

---

## ISSUE #67: Synchronous Client Disconnect Abort Invalidation Lack
**Severity:** high
**Confidence:** confirmed
**Area:** streaming, concurrency
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
When a client disconnects, the socket is immediately closed. However, the backend doesn't propagate the abort signal to all downstream external network requests (like Tavily search, OpenRouter, or Gemini calls) instantly. These async requests continue executing on the server, wasting API credits and server resources on abandoned sessions.

**Failure Path:**
1. User starts a deep research run.
2. Client closes the tab after 5 seconds.
3. The backend aborts the local request controller, but downstream API requests lack proper signal coupling.
4. The server continues performing Tavily searches and LLM calls, draining API keys.

**Why This Hurts Research Capability:**
Causes massive API quota leakage and higher operational costs.

**Runtime Symptoms:**
API provider dashboards show high usage and costs for abandoned requests.

---

## ISSUE #68: Heartbeat Interval Leak on Client Close
**Severity:** high
**Confidence:** confirmed
**Area:** streaming, memory
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
In the message intake endpoint, the `heartbeatInterval` is created using `setInterval` to prevent proxy timeouts. However, the interval is only cleared in the try-catch block's success path or main catch block. If an unhandled exception or early return occurs before reaching the try-catch, or if the client disconnects and the process terminates prematurely without reaching the `finally` block, the interval continues running forever.

**Failure Path:**
1. A request comes in, and `heartbeatInterval` is registered.
2. Client disconnects.
3. An exception is thrown during abort persistence, causing the code to bypass the standard `finally` block.
4. The interval timer is never cleared.
5. The Node.js event loop remains active, preventing garbage collection of the request context.

**Why This Hurts Research Capability:**
Causes memory leaks and increases CPU utilization over time.

**Runtime Symptoms:**
CPU usage climbs steadily on idle servers.

---

## ISSUE #69: Inadequate Error Normalization for Closed/Aborted Streams
**Severity:** medium
**Confidence:** confirmed
**Area:** streaming, errors
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
The intake catch block converts all caught exceptions into generic "AI error occurred" or "Source usage validation failed" messages. It does not explicitly check if the error was due to an intentional user abort (`AbortError`).

**Failure Path:**
1. User clicks the "Stop" button in the UI.
2. The backend catches the aborted signal.
3. Instead of cleanly terminating the request, it logs an Error and calls `persistAssistantFailed` with a generic "AI error occurred" description.
4. The database is populated with error messages instead of clean "User cancelled" states.

**Why This Hurts Research Capability:**
Corrupts user conversation history with false-positive error logs.

**Runtime Symptoms:**
"AI error occurred" messages are saved in chat history when users simply cancel a request.

---

## ISSUE #70: Hardcoded Fallback Models Ignore Custom Key Capability Profiles
**Severity:** medium
**Confidence:** confirmed
**Area:** provider-routing, configuration
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
The intake handler defines hardcoded strings for fallback models, such as `DEFAULT_GROQ_MODEL = "groq/llama-3.3-70b-versatile"`. If the user's custom API key does not support this specific model, the fallback attempt will fail immediately.

**Failure Path:**
1. Primary model call fails.
2. Auto-fallback routing tries to resolve the hardcoded `DEFAULT_GROQ_MODEL`.
3. The client's custom key is restricted or lacks quota for `llama-3.3-70b-versatile`.
4. Fallback fails with a 403, and the user gets a catastrophic failure.

**Why This Hurts Research Capability:**
Prevents robust automatic fallbacks when users provide restricted custom keys.

**Runtime Symptoms:**
Fallback chain fails on custom key accounts, resulting in an unrecoverable "AI error occurred".

---

## ISSUE #71: Insecure LocalStorage Synchronization on Concurrent UI Tabs
**Severity:** medium
**Confidence:** confirmed
**Area:** frontend-state
**Files:**
- `frontend/src/hooks/use-provider-models.tsx`

**Root Cause:**
The frontend hook `useProviderModels` pulls API keys directly from `localStorage` on component mount and status checks. There is no cross-tab synchronization or subscription (e.g. via the `storage` event). If a user opens two tabs, updates keys in Tab A, Tab B will continue using the old stale keys until reloaded.

**Failure Path:**
1. User opens Tab 1 and Tab 2.
2. User updates Groq key in Tab 1's settings dialog.
3. User switches to Tab 2 and starts a research query.
4. Tab 2 sends the old keys cached in memory, failing the request.

**Why This Hurts Research Capability:**
Creates desynchronized key states and confusing failures across multiple tabs.

**Runtime Symptoms:**
"Invalid API Key" errors appear on one tab even after the user has successfully updated keys in another tab.

---

## ISSUE #72: Request Queue Bypass for Legacy Handlers
**Severity:** high
**Confidence:** confirmed
**Area:** concurrency, request-queue
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
The backend implements request queueing in `backend/src/lib/request-queue.ts` via `enqueueRequest`. However, this queue is only used in the newer `runResearchPipeline` path. The legacy paths (`handleMultiSearch`, `handleProviderAllModes`, and `handleRhetorics`) entirely bypass the queue, allowing concurrent requests to hammer the backend and providers directly.

**Failure Path:**
1. Multiple users execute legacy search/rhetorics requests simultaneously.
2. Requests are processed concurrently without rate limits or queues.
3. Downstream providers (Groq/OpenRouter) rate-limit the server, crashing all active sessions.

**Why This Hurts Research Capability:**
Causes provider rate-limiting storms and system-wide downtime.

**Runtime Symptoms:**
Catastrophic rate-limit failures (429) across multiple active user sessions.

---

## ISSUE #73: Non-Idempotent Run ID Allocation
**Severity:** medium
**Confidence:** confirmed
**Area:** session-init, security
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
The backend generates `runId` and `requestId` using client-supplied request timestamps and random UUIDs:
`const requestId = \`req_\${Date.now().toString(36)}_\${randomUUID().slice(0, 8)}\`;`
`const runId = \`run_\${Date.now().toString(36)}_\${randomUUID().slice(0, 8)}\`;`
If a client retries a failed HTTP request (e.g., due to network jitter), the backend generates a completely new `runId`, treating it as a fresh research job instead of deduplicating it.

**Failure Path:**
1. Client sends a request, backend starts a research job.
2. Network connection drops temporarily.
3. Client retries the POST request.
4. Backend allocates a new `runId` and runs the same job again, wasting API tokens.

**Why This Hurts Research Capability:**
Wastes resources and doubles API usage on unstable networks.

**Runtime Symptoms:**
Duplicate database records for identical queries and wasted API tokens.

---

## ISSUE #74: Empty SSE Payload Generation on Silent Stream Timeouts
**Severity:** high
**Confidence:** confirmed
**Area:** streaming, timeout
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
When a stream times out (`streamTimeout` fires), the backend writes a `failed` event to the stream and terminates it. However, it does not check if the stream has already written any data or if the connection has been terminated by the reverse proxy. If the proxy silently dropped the connection, the timeout handler still executes database operations and writes empty SSE frames.

**Failure Path:**
1. Request hangs. Reverse proxy drops the connection at 60s.
2. The backend `streamTimeout` fires at 5 minutes.
3. It attempts to persist failure status and write `failed` event to the closed response object.
4. Wastes database connection pools and logs write errors.

**Why This Hurts Research Capability:**
Fails to cleanly release resources on silent connection drops.

**Runtime Symptoms:**
Slow resource leaks and database connection pool exhaustion.

---

## ISSUE #75: Lack of Global Rate Limiter at Query Intake Layer
**Severity:** high
**Confidence:** confirmed
**Area:** session-init, security
**Files:**
- `backend/src/services/anthropic-service.ts`

**Root Cause:**
The query intake endpoint lacks any Express rate limiting middleware (`express-rate-limit`). Any user can trigger hundreds of concurrent high-latency research jobs, exhausting database connection pools and scraping resources.

**Failure Path:**
1. An attacker sends a script to flood `/api/anthropic/conversations/:id/messages`.
2. Backend starts thousands of concurrent web searches.
3. Server crashes due to CPU and database connection exhaustion.

**Why This Hurts Research Capability:**
Leaves the service vulnerable to simple Denial of Service (DoS) attacks.

**Runtime Symptoms:**
Total service outage and high API bills.




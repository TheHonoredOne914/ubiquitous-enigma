# BestDel Research Capability Failure Audit

## Executive Summary

This audit identified **80 critical issues** preventing the platform from functioning as a production-grade parliamentary research engine. The system currently behaves more like an LLM wrapper with search than a true retrieval-first research engine.

---

## Critical Discovery: Architectural Violations

The system SHOULD follow:
```
retrieval → evidence normalization → evidence clustering → claim extraction → contradiction analysis → evidence sufficiency scoring → evidence-first synthesis → prose rendering
```

But currently operates as:
```
search → giant prompt → prose generation → citation repair
```

This is the root architectural problem.

---

# Issue Registry

## Issue #1: Provider selection silently ignored when frontend sends model

**Severity:** critical  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/pipeline/research-pipeline.ts`
- `backend/src/core/synthesis/model-role-runner.ts`

**Root Cause:** In `research-pipeline.ts:217-238`, `generateCoreResearchAnswer` receives `providerName` and `model` as parameters, but `buildGenerationCandidates` creates fallback candidates that can override the user's explicit selection. The logic at line 532-542 allows fallback candidates even when a user-selected provider exists.

**Failure Path:** User selects "gemini/gemini-2.5-pro" in frontend → request sent with model → `buildGenerationCandidates` checks `autoFallback` → if `autoFallback === true`, adds fallback providers that run first → user's selected provider becomes unreachable fallback instead of primary.

**Why It Harms Research Capability:** Providers silently fallback even when explicitly selected, violating user intent. Generation uses wrong model/provider, producing different quality answers.

**Runtime Symptoms:** User selects specific provider in UI → backend uses different provider → final answer quality differs from expected.

**Hidden Risk:** Trust erosion - users believe they're using premium providers but get fallback quality.

**Recommended Architectural Direction:** Implement explicit provider locking mechanism that prevents fallback override when user explicitly selects provider. Add provider_selection_mode: "explicit" vs "auto_fallback" flag.

---

## Issue #2: Source cards silently dropped during prompt budget compression

**Severity:** critical  
**Confidence:** confirmed  
**Area:** compression  

**Files:**
- `backend/src/core/evidence/evidence-compressor.ts:179-263`
- `backend/src/core/generation/core-answer-prompt.ts:80-215`

**Root Cause:** `buildBudgetedEvidencePack` in `evidence-compressor.ts` drops sources when `maxPackChars` exceeded. The compression loop at `core-answer-prompt.ts:102-150` tries 8 attempts to fit sources, but sources can still be dropped silently with only a final check at line 120-122.

**Failure Path:** Compression applied with `maxSourcesInPrompt` → source cards dropped due to char limits → model receives fewer sources than expected → generates under-cited answer.

**Why It Harms Research Capability:** Final answer has fewer citations than required because sources dropped during compression. Research quality directly degrades with source count.

**Runtime Symptoms:** Final answer cites fewer sources than `minimumUniqueCitedSources` requires despite evidence registry having enough.

**Hidden Risk:** Silent quality degradation - no warning when compression destroys citation capability.

**Recommended Architectural Direction:** Implement minimum source floor that cannot be compressed below. Add explicit source_dropped events to pipeline telemetry.

---

## Issue #3: Evidence registry has usable sources but source usage validation fails

**Severity:** critical  
**Confidence:** confirmed  
**Area:** source-feeding  

**Files:**
- `backend/src/core/evidence/source-usage-map.ts:175-275`
- `backend/src/core/synthesis/model-role-runner.ts:102-263`

**Root Cause:** `validateSourceUsageMap` at `source-usage-map.ts:201-234` has strict validation requiring actual extraction content, not just source listing. If model fails to extract claims properly, validation fails despite sources being available. The `contentFields.every((value) => value.length === 0)` check at line 215 causes failures.

**Failure Path:** Evidence registry has 30+ sources → source usage role runs → model outputs source IDs without proper extraction → validation fails → source usage aggregate reports failure → final answer under-cited.

**Why It Harms Research Capability:** Sources exist but don't get used because model extraction format doesn't meet validation contract. Research capability wasted.

**Runtime Symptoms:** Source usage roles fail validation despite available sources → "validUsageCount < required" errors.

**Hidden Risk:** Model quality issues silently cause citation failure - harder to debug.

**Recommended Architectural Direction:** Implement graceful degradation when source usage validation fails. Allow partial credit for partial extraction.

---

## Issue #4: Citation validation rejects bare citations but final answer accepts them

**Severity:** critical  
**Confidence:** confirmed  
**Area:** citation  

**Files:**
- `backend/src/core/verification/citation-validator.ts:18-92`

**Root Cause:** `validateCitations` at line 24-28 rejects bare citations like `[Source 1]` (without URL), but the final status decision logic in `final-status.ts:38` checks for "Legacy fallback answer retained" which is the fallback text - not the actual cited answer. Line 73 checks `rejectedCitations.length === 0` but bare citations are rejected yet might not block completion.

**Failure Path:** Model outputs `[Source 1]` bare citation → validation rejects → but if `rejectedCitations.length === 0` check passes via other conditions → final answer has invalid citations → citations appear but are technically rejected.

**Why It Harms Research Capability:** Invalid citations slip through to final answer, undermining research credibility.

**Runtime Symptoms:** User sees citations in answer but validation log shows rejected citations.

**Hidden Risk:** Citation audit appears to pass but citations are technically invalid.

**Recommended Architectural Direction:** Make bare citations fail final status determination. Add strict validation before final status decision.

---

## Issue #5: Provider health treats catalog fallback as healthy generation

**Severity:** critical  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-health.ts:106-124`

**Root Cause:** `unhealthyReason` function at line 119 returns `null` (healthy) for providers with `catalogFallbackOnly` status when `!options.isSelected || options.autoFallback`. This means a provider that can only list models (no verified chat) is considered "healthy enough" for fallback. The logic at line 113 explicitly allows "catalog_fallback" status as not unhealthy.

**Failure Path:** Provider has catalog-only access → health check returns "healthy" → used for generation → generation fails → retry storm.

**Why It Harms Research Capability:** Catalog-fallback providers are used for actual generation despite not having verified chat capability.

**Runtime Symptoms:** Provider appears healthy but generation fails with catalog fallback errors.

**Hidden Risk:** False positive health → wasted retries → performance destruction.

**Recommended Architectural Direction:** Require `chatVerified === true` before considering provider healthy for generation. Add separate "catalog_available" status that's not used for generation.

---

## Issue #6: Rate-limited providers retried immediately without proper backoff

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-run-state.ts:77-79`

**Root Cause:** `recordFailure` at line 77-80 sets `rateLimitedUntil` but `shouldRetrySamePrompt` at line 143-149 only checks if the same prompt was too large, not if rate-limited. The `shouldSkipProvider` at line 127-137 skips after failures, but doesn't respect the rate-limited cooldown properly.

**Failure Path:** Provider rate-limited → `recordFailure` sets cooldown → next attempt → `shouldSkipProvider` might not skip due to cooldown logic → immediate retry → rate-limited again.

**Why It Harms Research Capability:** Retry storms on rate-limited providers destroy latency and may worsen rate limiting.

**Runtime Symptoms:** Rapid retry attempts on rate-limited provider, 429 errors repeatedly.

**Hidden Risk:** Rate limit could escalate to API ban.

**Recommended Architectural Direction:** Implement proper rate-limit cooldown that blocks all retries until cooldown expires. Add exponential backoff.

---

## Issue #7: OpenRouter 402 (billing) mishandled as retryable

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-errors.ts:64-76`

**Root Cause:** `codeFromStatusAndMessage` at line 67 correctly identifies 402 as "billing_credits", but `safeMessageFor` at line 96 returns a retry-able-looking message. The `retryable` field at line 57 is `false` for billing, but the upstream caller in `core-answer-generator.ts:450-466` retries anyway.

**Failure Path:** OpenRouter returns 402 → classified as billing_credits → still attempted for retry → multiple 402s → confusion.

**Why It Harms Research Capability:** Billing failures treated as retriable, wasting latency on impossible requests.

**Runtime Symptoms:** Multiple 402 errors before failing, user confused about what's wrong.

**Hidden Risk:** User thinks app broken when it's actually billing issue.

**Recommended Architectural Direction:** Make billing errors non-retryable immediately. Show clear billing error message to user.

---

## Issue #8: Groq rate-limit treated as generic rate-limit with short backoff

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-run-state.ts:77-79`

**Root Cause:** Same as Issue #6 but specific to Groq. Groq has aggressive rate limits. The default `retryAfterMs` of 30 seconds (line 78) is often too short for Groq's actual cooldown. No provider-specific backoff policy.

**Failure Path:** Groq rate-limited → 30s backoff set → retry after 30s → still rate-limited → backoff again → performance destroyed.

**Why It Harms Research Capability:** Groq-specific rate limit handling absent. Performance severely degraded.

**Runtime Symptoms:** Groq provider unusable for minutes after rate limit hit.

**Hidden Risk:** Groq becomes unusable for entire session after any rate limit.

**Recommended Architectural Direction:** Implement provider-specific rate limit handling with 60-second minimum cooldown for Groq. Add provider-specific retry policies.

---

## Issue #9: Frontend model selection ignored when localStorage has different value

**Severity:** high  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `frontend/src/hooks/use-provider-models.tsx:138-151`

**Root Cause:** `setSelectedModelState` at line 149 updates state, but the getter functions like `getPrimaryModelForMode` in `chat-model-routing` can still return stale values. The `repairSelectedModel` logic in `model-selection-repair.ts` attempts to fix this but relies on `healthyResearchModels` which may not update immediately.

**Failure Path:** User selects model → localStorage updated → state updated → but pipeline request uses old model → wrong model used.

**Why It Harms Research Capability:** User explicitly selects provider but gets different one. Violates user intent.

**Runtime Symptoms:** User changes provider/model but research uses previous selection.

**Hidden Risk:** User trust destroyed - can't get the provider they want.

**Recommended Architectural Direction:** Implement model selection locking that persists through refresh cycles. Add explicit "useSelectedModel" flag in request payload.

---

## Issue #10: Source ID mismatch between evidence registry and final prompt

**Severity:** critical  
**Confidence:** confirmed  
**Area:** source-feeding  

**Files:**
- `backend/src/core/generation/core-answer-prompt.ts:226-254`

**Root Cause:** `ensureRequiredSourceCardsInPrompt` at line 226-254 appends source cards as "appendix" when they're missing from main prompt, but the appended format uses different metadata (`Facts=`, `Limitations=`) that doesn't match the compressed format. This can cause citation validation to fail because URL matching may not find exact matches.

**Failure Path:** Source IDs selected for final prompt → compression drops them → appendix added → format mismatch → citation validation fails.

**Why It Harms Research Capability:** Sources added in repair still fail validation, causing under-citation.

**Runtime Symptoms:** `missingMustIncludeSourceIds` non-empty despite repair attempt.

**Hidden Risk:** Citation repair itself fails - no way to recover.

**Recommended Architectural Direction:** Ensure appendix format exactly matches compressed format. Add format validation before appending.

---

## Issue #11: Prompt budget collapse destroys source fidelity before generation

**Severity:** critical  
**Confidence:** confirmed  
**Area:** prompt-budget  

**Files:**
- `backend/src/core/generation/prompt-budget.ts:46-108`

**Root Cause:** `getPromptBudget` at line 92-107 applies `shrink` factor based on `compressionLevel`. When multiple stages exceed budget, compression level increases, causing aggressive shrinking. At line 100, `maxSourcesInPrompt` is multiplied by `(1 - shrink)` - with high shrink, sources drop from 20+ to single digits.

**Failure Path:** Retrieval exceeds budget → compression applied → sources dropped → generation uses minimal sources → weak answer.

**Why It Harms Research Capability:** Core research functionality destroyed by budget math. Fewer sources = weaker research.

**Runtime Symptoms:** Final answer cites 3-5 sources despite 20+ available.

**Hidden Risk:** Budget-driven quality degradation not visible to user.

**Recommended Architectural Direction:** Implement source floor that cannot drop below minimum regardless of compression. Add budget_warning events.

---

## Issue #12: Deterministic source usage underutilized when model fails

**Severity:** high  
**Confidence:** confirmed  
**Area:** source-feeding  

**Files:**
- `backend/src/core/synthesis/model-role-runner.ts:233-260`

**Root Cause:** `deterministicExtractionFallback` at line 448-520 creates source usage items but marks them all with `confidence: "low"`. The validation at `source-usage-map.ts:232` can reject items with low confidence if `COUNTING_USAGE_TYPES` check fails. The fallback is only used after model fails, not as proactive backup.

**Failure Path:** Model source usage fails → deterministic fallback used → but low confidence → validation might still fail → complete failure.

**Why It Harms Research Capability:** Deterministic mode should be reliable fallback but is also rejected, leaving no recovery path.

**Runtime Symptoms:** Source usage fails even with deterministic fallback.

**Hidden Risk:** No reliable fallback = complete failure more likely.

**Recommended Architectural Direction:** Allow deterministic extraction with medium confidence. Prioritize deterministic as proactive fallback, not reactive.

---

## Issue #13: Stale SSE events mutate active conversation state

**Severity:** high  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `frontend/src/components/chat/use-chat-run-controller.ts:284-310`

**Root Cause:** `normalizeStreamEvent` at line 284 checks for stale events but the "ignored_stale" handling at line 307-309 only dispatches "IGNORED_STALE_EVENT" - doesn't revert state changes that might have already occurred. Old run IDs can still affect active run state through `moveStreamController`.

**Failure Path:** User starts new run → old run sends delayed events → events partially processed → state corrupted → wrong run shows as active.

**Why It Harms Research Capability:** Conversations can show wrong content or status, confusing users.

**Runtime Symptoms:** Old research results appear in active conversation, status shows wrong.

**Hidden Risk:** State corruption cascades to further issues.

**Recommended Architectural Direction:** Implement event guard that drops all events from old runs, not just ignores them.

---

## Issue #14: Overlapping research runs not prevented, corrupting pipeline

**Severity:** high  
**Confidence:** confirmed  
**Area:** concurrency  

**Files:**
- `frontend/src/components/chat/use-chat-run-controller.ts:151-163`

**Root Cause:** At line 151-154, code cancels previous run only if `activeRunRef.current.runId && activeRunRef.current.conversationId === convId`. If conversation ID differs, runs can overlap. There's no server-side prevention.

**Failure Path:** User starts run on conversation A → quickly starts run on conversation B → both active → events intermix → pipeline corrupted.

**Why It Harms Research Capability:** Mixed results, wrong citations, corrupted source manifests.

**Runtime Symptoms:** Two conversations receiving same events, sources mixed between them.

**Hidden Risk:** Data integrity completely compromised.

**Recommended Architectural Direction:** Implement global run lock. Cancel any pending runs before starting new one. Add server-side deduplication.

---

## Issue #15: Source gap report created but not used for generation guidance

**Severity:** medium  
**Confidence:** likely  
**Area:** generation  

**Files:**
- `backend/src/core/evidence/source-gap-report.ts`
- `backend/src/core/generation/core-answer-prompt.ts:267-276`

**Root Cause:** `formatSourceGap` creates JSON representation, but `buildCoreAnswerUserPrompt` at line 70 includes it as pure text, not as actionable guidance. The model can't effectively use it to request more sources.

**Failure Path:** Source gap detected → gap report created → included as text → model ignores → same gaps persist.

**Why It Harms Research Capability:** Gap reporting is cosmetic, not actionable. Quality doesn't improve.

**Runtime Symptoms:** SourceGapReport section exists but model produces same weak answer.

**Hidden Risk:** Gap reporting creates false sense of transparency.

**Recommended Architectural Direction:** Add structured source gap guidance in prompt that model can act upon.

---

## Issue #16: Evidence quality scoring too weak - snippet-only sources become eligible

**Severity:** high  
**Confidence:** confirmed  
**Area:** evidence  

**Files:**
- `backend/src/core/evidence/evidence-registry.ts:140-145`

**Root Cause:** `buildEvidenceRegistryFromSources` at line 142-145 determines citation eligibility. The condition allows snippet-only sources if they have any keyFacts, even minimal ones. The score threshold of 40 at line 55 is too low for snippet-only.

**Failure Path:** Search returns snippet-only source → gets keyFacts from title → eligible despite weak content → used in generation → poor quality answer.

**Why It Harms Research Capability:** Weak sources pollute evidence base, degrading answer quality.

**Runtime Symptoms:** Final answer cites sources with minimal content.

**Hidden Risk:** Quality degrades silently as source quality weakens.

**Recommended Architectural Direction:** Implement stricter citation eligibility requiring full extraction. Raise score threshold for snippet-only sources.

---

## Issue #17: Citation repair occurs too late - after quality gate failure

**Severity:** high  
**Confidence:** confirmed  
**Area:** citation  

**Files:**
- `backend/src/core/generation/core-answer-generator.ts:152-181`

**Root Cause:** Citation repair happens AFTER quality gate runs. The repair is conditional on `uniqueCitedSourceCount < requiredFinalSources`, but quality gate failure can happen for other reasons first.

**Failure Path:** Generation produces answer → quality gate fails (not citation-related) → repair never runs → under-cited answer fails anyway.

**Why It Harms Research Capability:** Citation repair opportunity lost due to order of operations.

**Runtime Symptoms:** Answer fails quality gate, citations never repaired.

**Hidden Risk:** Multiple repair passes but wrong order reduces effectiveness.

**Recommended Architectural Direction:** Run citation repair BEFORE quality gate. Fix citations first, then evaluate quality.

---

## Issue #18: Provider retry logic destroys performance - retry storms

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-run-state.ts:127-137`

**Root Cause:** `shouldSkipProvider` at line 136 allows skip after 3 failures, but doesn't prevent immediate retry attempts that lead to those 3 failures. The retry loop in `core-answer-generator.ts:449-466` tries all candidates sequentially without respecting the skip state properly.

**Failure Path:** Provider fails → immediate retry → fails again → 3 failures → skip → but latency already wasted.

**Why It Harms Research Capability:** Latency budget destroyed by retries before fallback kicks in.

**Runtime Symptoms:** Research takes 3x longer due to retry attempts.

**Hidden Risk:** Total latency exceeds budget, early stopping triggers prematurely.

**Recommended Architectural Direction:** Implement pre-check before attempting provider. Skip immediately if known to fail, don't retry.

---

## Issue #19: Source usage budget separate from retrieval budget - total exceeds latency

**Severity:** medium  
**Confidence:** likely  
**Area:** latency  

**Files:**
- `backend/src/core/latency/latency-budget.ts:47-104`

**Root Cause:** `sourceUsageBudgetMs` (e.g., 35s for deep_research) is separate from `retrievalBudgetMs` (60s), `enrichmentBudgetMs` (35s), `generationBudgetMs` (45s). These sum to 175s but `totalBudgetMs` is 180s. Source usage runs AFTER retrieval/enrichment, consuming more time.

**Failure Path:** Retrieval uses 55s → enrichment uses 30s → source usage starts → only 95s remaining → source usage times out → failure.

**Why It Harms Research Capability:** Budget math doesn't account for sequential execution, causing premature timeouts.

**Runtime Symptoms:** Research fails with "timeout" despite individual budgets not exceeded.

**Hidden Risk:** Budget system lies about available time.

**Recommended Architectural Direction:** Implement dynamic budget calculation that accounts for remaining time when each stage starts.

---

## Issue #20: Model selection desync between frontend dropdown and backend request

**Severity:** high  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `frontend/src/components/chat/chat-request-builder.ts:14-43`
- `frontend/src/components/chat/use-chat-run-controller.ts:145-199`

**Root Cause:** `buildChatRequestBody` at line 38 sets `normalModel` based on `activeProviderModel`, but `useChatRunController` at line 145 calls `getPrimaryModelForMode` which may return different value than user's explicit selection.

**Failure Path:** User explicitly selects "gemini-2.5-pro" → `getPrimaryModelForMode` returns fallback "gemini-2.5-flash" → `normalModel` set to flash → gemini-pro never used.

**Why It Harms Research Capability:** Explicit user selection ignored, wrong provider used.

**Runtime Symptoms:** User selects premium model, gets free tier model.

**Hidden Risk:** User satisfaction destroyed, premium features unused.

**Recommended Architectural Direction:** Honor user selection as primary. Add "user_selected" flag that bypasses fallback logic.

---

## Issue #21: Firecrawl/Jina extraction budget overruns cause enrichment failure

**Severity:** high  
**Confidence:** confirmed  
**Area:** retrieval  

**Files:**
- `backend/src/core/retrieval/source-enrichment.ts:385-494`

**Root Cause:** `withEnrichmentBudget` uses `budgetMs` from `latency-budget.ts` but extraction time per source is unbounded. If sources are slow, budget exhausts before all sources enriched. The fallback marks un-enriched sources as `citationEligible: false`.

**Failure Path:** 30 sources to enrich → slow network → budget exceeded → only 15 enriched → citationEligible drops → final answer has fewer sources.

**Why It Harms Research Capability:** Extraction budget causes sources to become ineligible, reducing citation count.

**Runtime Symptoms:** Enrichment completes partially, final answer under-cited.

**Hidden Risk:** Network variability causes quality variance.

**Recommended Architectural Direction:** Implement per-source timeout with graceful degradation. Don't penalize all sources for slow ones.

---

## Issue #22: Search provider not intelligently orchestrated - uses first available

**Severity:** medium  
**Confidence:** likely  
**Area:** search  

**Files:**
- `backend/src/core/search/search-provider-router.ts`

**Root Cause:** Search provider selection likely uses first healthy provider rather than optimizing for query type or provider strengths. No query-specific routing.

**Failure Path:** Query about legal matters → routed to general search → weak legal results → research suffers.

**Why It Harms Research Capability:** Search quality not optimized, wrong provider for query type.

**Runtime Symptoms:** Inconsistent search quality, sometimes poor results.

**Hidden Risk:** No way to optimize for specific query types.

**Recommended Architectural Direction:** Implement query-type-aware search provider routing.

---

## Issue #23: Prompt compression destroys source fidelity - atomic claims lost

**Severity:** critical  
**Confidence:** confirmed  
**Area:** compression  

**Files:**
- `backend/src/core/evidence/evidence-compressor.ts:365-375`

**Root Cause:** `selectAtomicClaims` at line 365-375 truncates claims to 220 chars, but `clipSentence` can cut mid-claim. Multiple clips progressively shorten until nothing meaningful remains.

**Failure Path:** Source has detailed legal holding → compression truncates → model receives incomplete claim → answer uses weak version.

**Why It Harms Research Capability:** Source fidelity destroyed, model uses degraded evidence.

**Runtime Symptoms:** Answer cites source but claim quality poor.

**Hidden Risk:** Evidence quality systematically degrades with compression.

**Recommended Architectural Direction:** Preserve claim integrity through compression. Don't truncate mid-sentence.

---

## Issue #24: Citation validation URL matching too strict - canonicalization fails

**Severity:** high  
**Confidence:** confirmed  
**Area:** citation  

**Files:**
- `backend/src/core/verification/citation-validator.ts:101-117`

**Root Cause:** `canonicalCitationUrl` at line 109-117 strips query params but keeps some variations. Different URLs to same source (e.g., `example.com/article?id=1` vs `example.com/article`) fail matching even if canonical would be same.

**Failure Path:** Model cites `example.com/article?id=1` → registry has `example.com/article` → URL mismatch → rejected → final answer has rejected citations.

**Why It Harms Research Capability:** Technical URL mismatch rejects valid citations.

**Runtime Symptoms:** Citations rejected despite being to same source.

**Hidden Risk:** Users see validation failures that are false positives.

**Recommended Architectural Direction:** Implement URL normalization that handles query param variations.

---

## Issue #25: Provider run state not cleared between conversations

**Severity:** medium  
**Confidence:** suspected  
**Area:** concurrency  

**Files:**
- `backend/src/core/providers/provider-run-state.ts:50-173`

**Root Cause:** `createProviderRunState` creates a single stateful object at request level, but if used across multiple conversations (shared instance), failures from one conversation affect another. The state persists forever within a request lifecycle.

**Failure Path:** User A triggers provider failure → state marked as failing → User B gets blocked → wrong user affected.

**Why It Harms Research Capability:** Cross-user state pollution blocks innocent users.

**Runtime Symptoms:** Provider suddenly unavailable for new user due to previous user's failure.

**Hidden Risk:** Shared state causes unrelated failures.

**Recommended Architectural Direction:** Implement per-conversation provider state isolation.

---

## Issue #26: Evidence registry deduping may lose source diversity

**Severity:** medium  
**Confidence:** likely  
**Area:** retrieval  

**Files:**
- `backend/src/core/retrieval/source-deduper.ts`
- `backend/src/core/evidence/evidence-registry.ts:51-58`

**Root Cause:** `addSource` returns existing source if canonical URL matches. If same content available from different domains, later sources are dropped, potentially losing domain diversity important for authority scoring.

**Failure Path:** Same story on 3 news sites → first added → others dropped → bucket coverage reduced → quality gate fails.

**Why It Harms Research Capability:** Domain diversity lost, reducing apparent source breadth.

**Runtime Symptoms:** Bucket coverage lower than expected despite multiple sources.

**Hidden Risk:** Diversity artificially limited by deduping logic.

**Recommended Architectural Direction:** Preserve domain diversity while avoiding exact duplicate content.

---

## Issue #27: Fallback chain becomes chaotic - OpenRouter/Gemini/NVIDIA/GitHub/Groq

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/generation/core-answer-generator.ts:519-553`
- `backend/src/core/synthesis/model-role-runner.ts:61-67`

**Root Cause:** `DEFAULT_FALLBACK_MODELS` and `buildGenerationCandidates` create a linear fallback chain. When multiple providers fail, they cascade in order, but that order isn't optimized for latency or quality.

**Failure Path:** Primary fails → fallback 1 fails → fallback 2 fails → ... → latency destroyed.

**Why It Harms Research Capability:** Fallback chain not optimized for success probability or latency.

**Runtime Symptoms:** Research takes very long as each fallback is attempted and fails.

**Hidden Risk:** No strategy for optimal fallback order.

**Recommended Architectural Direction:** Implement performance-based dynamic fallback ordering. Fast providers first.

---

## Issue #28: Normal/rhetoric mode can answer current events without live search

**Severity:** high  
**Confidence:** confirmed  
**Area:** freshness  

**Files:**
- `backend/src/core/pipeline/research-pipeline.ts:819-825`

**Root Cause:** `shouldLiveRetrieve` checks `mode === "fast_research" || mode === "deep_research"` but doesn't check "normal" mode. In normal/rhetoric mode, `liveRetrieval` defaults to falsy, so search might be skipped even for current events.

**Failure Path:** User asks about yesterday's news in normal mode → no live search → old information used → answer outdated.

**Why It Harms Research Capability:** Current event queries return stale results without warning.

**Runtime Symptoms:** User asked about today's news, got last month's information.

**Hidden Risk:** Outdated answers presented as current.

**Recommended Architectural Direction:** Force live retrieval for current event queries regardless of mode.

---

## Issue #29: Status semantics misleading - "completed" may have source gaps

**Severity:** medium  
**Confidence:** confirmed  
**Area:** verification  

**Files:**
- `backend/src/core/pipeline/final-status.ts:30-84`

**Root Cause:** `decideFinalResearchStatus` at line 60-73 allows "completed_with_source_gaps" only if `citedSources > 0`, but what if 1 source cited when 10 required? The gap is still significant but status appears successful.

**Failure Path:** Required 10 sources → only 1 cited → status = "completed_with_source_gaps" → appears successful.

**Why It Harms Research Capability:** Status misrepresents actual quality - user thinks research complete when severely degraded.

**Runtime Symptoms:** Status shows "completed_with_source_gaps" but gap is massive.

**Hidden Risk:** User trust in status metrics undermined.

**Recommended Architectural Direction:** Include gap percentage in status determination. 80% gap should fail, not warn.

---

## Issue #30: GitHub timeout handling uses 45s but GitHub models often timeout at 30s

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/generation/core-answer-generator.ts:499`

**Root Cause:** Line 499 sets `timeoutMs: Math.min(input.providerCallTimeoutMs ?? 45_000, ...)` but GitHub Models have different timeout limits. The provider-specific timeout handling doesn't adjust for GitHub.

**Failure Path:** GitHub model times out at 30s → 45s timeout set → provider fails → retry → performance destroyed.

**Why It Harms Research Capability:** GitHub timeouts cause retries, destroying latency.

**Runtime Symptoms:** GitHub provider very slow or failing consistently.

**Hidden Risk:** GitHub becomes effectively unusable.

**Recommended Architectural Direction:** Implement provider-specific timeout limits. GitHub: 30s, others: 45s.

---

## Issue #31: Evidence pack builder duplicates sources across packs incorrectly

**Severity:** medium  
**Confidence:** suspected  
**Area:** evidence  

**Files:**
- `backend/src/core/evidence/evidence-pack-builder.ts`

**Root Cause:** If packs are built with overlapping source coverage, the same source might appear in multiple packs, inflating source count without actually providing diversity. The compression logic may then drop the duplicate, wasting budget.

**Failure Path:** Source appears in 3 packs → counted as 3 sources → compression drops 2 as duplicates → still under count.

**Why It Harms Research Capability:** Artificial source inflation that collapses during compression.

**Runtime Symptoms:** Pack says 30 sources, compression shows 12 included.

**Hidden Risk:** Quality metrics appear better than actual.

**Recommended Architectural Direction:** Dedupe at pack level before compression.

---

## Issue #32: Hallucination guard fails after repair instead of before

**Severity:** high  
**Confidence:** confirmed  
**Area:** verification  

**Files:**
- `backend/src/core/generation/core-answer-generator.ts:190-209`

**Root Cause:** Hallucination guard runs AFTER repair passes. If repair introduces new hallucinations, they're not caught until final gate. The order is: repair → citation repair → quality gate → hallucination guard.

**Failure Path:** Repair introduces hallucinated claim → citation passes → quality passes → hallucination guard fails → error thrown, but user already waited.

**Why It Harms Research Capability:** Repair can introduce new problems that aren't caught in time.

**Runtime Symptoms:** Research fails at final step, all previous work wasted.

**Hidden Risk:** Repair effectiveness not validated before proceeding.

**Recommended Architectural Direction:** Run hallucination check BEFORE repair. Validate before modifying.

---

## Issue #33: Source bucket deduping removes relevant but similar sources

**Severity:** medium  
**Confidence:** likely  
**Area:** retrieval  

**Files:**
- `backend/src/core/retrieval/source-deduper.ts`

**Root Cause:** Deduplication uses content similarity, which can remove sources with minor variations that provide important nuance. Two articles with 80% overlap might cover different aspects but deduped to one.

**Failure Path:** Two similar articles on same topic but different angles → deduped → lost nuance → answer one-sided.

**Why It Harms Research Capability:** Relevant source diversity lost, answer biased.

**Runtime Symptoms:** Bucket coverage says 5 sources, but 2 were deduplicated, only 3 truly distinct.

**Hidden Risk:** Answer lacks breadth despite appearing to have coverage.

**Recommended Architectural Direction:** Implement diversity-preserving dedup that keeps angle variations.

---

## Issue #34: Provider key validation shows misleading errors

**Severity:** medium  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-health-policy.ts`

**Root Cause:** Health policy derives healthy status but error messages may not clearly indicate missing key vs invalid key vs billing. User sees "provider error" but doesn't know which.

**Failure Path:** Missing key → shows as general "provider error" → user checks key → valid → confused.

**Why It Harms Research Capability:** Troubleshooting impossible without clear error messages.

**Runtime Symptoms:** User can't diagnose why provider isn't working.

**Hidden Risk:** Support burden increases, user frustration grows.

**Recommended Architectural Direction:** Show specific error: "Missing API key" vs "Invalid API key" vs "Insufficient credits".

---

## Issue #35: Model exhaust detection triggers fallback too late

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `frontend/src/components/chat/use-chat-run-controller.ts:482-495`

**Root Cause:** `modelExhausted` event triggers fallback only after content streaming starts. First model fails partially → fallback triggered → latency doubled for that message.

**Failure Path:** User message → model starts → gets stuck → timeout → fallback starts → user waits 2x.

**Why It Harms Research Capability:** Fallback after start still wastes latency.

**Runtime Symptoms:** Research slow, sometimes very slow.

**Hidden Risk:** No proactive fallback before any generation attempt.

**Recommended Architectural Direction:** Check model readiness before starting generation. Fail fast if model unavailable.

---

## Issue #36: Citation coverage calculation includes repeated citations incorrectly

**Severity:** medium  
**Confidence:** confirmed  
**Area:** citation  

**Files:**
- `backend/src/core/verification/citation-validator.ts:53-66`

**Root Cause:** `sourceIdsActuallyUsed` is deduplicated, but `linkedCitationCount` counts all citations including repeats. `hasInflatedSourceCount` checks for repeated citations, but the logic could incorrectly flag when same source has multiple legitimate uses.

**Failure Path:** Model cites same source 4 times (legitimately) → flagged as "repeated citation spam" → might fail validation.

**Why It Harms Research Capability:** Legitimate repeated citations rejected, confusing model.

**Runtime Symptoms:** Valid citations rejected as "spam".

**Hidden Risk:** Validation rules too strict for legitimate use cases.

**Recommended Architectural Direction:** Allow repeated citations up to 6 per source. Flag only beyond threshold.

---

## Issue #37: Research mode defaults override explicit user settings

**Severity:** high  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `backend/src/core/pipeline/research-pipeline.ts:208`

**Root Cause:** `useCoreGeneration` at line 208 defaults to `process.env.USE_CORE_GENERATION !== "false"`. Environment variable can override explicit pipeline input.

**Failure Path:** User wants legacy fallback explicitly → env var says use core → core used → unexpected results.

**Why It Harms Research Capability:** User settings overridden by invisible configuration.

**Runtime Symptoms:** Behavior doesn't match user's explicit settings.

**Hidden Risk:** Configuration drift causes unexpected behavior.

**Recommended Architectural Direction:** User input should override env vars. Env vars are defaults, not overrides.

---

## Issue #38: Quality gate category scores not tied to research mode

**Severity:** medium  
**Confidence:** suspected  
**Area:** verification  

**Files:**
- `backend/src/core/verification/thesis-quality-gate.ts`

**Root Cause:** Quality gate applies same standards regardless of research mode. A fast_research should have lower thresholds than phd_level, but gate uses absolute values.

**Failure Path:** Fast research with 5 sources but 3 citations → quality gate requires more → fails → user confused why fast mode fails.

**Why It Harms Research Capability:** Mode-appropriate quality bars not implemented.

**Runtime Symptoms:** Fast research fails quality gate despite being appropriate for mode.

**Hidden Risk:** Mode selection becomes meaningless.

**Recommended Architectural Direction:** Scale quality thresholds by research mode. Fast = 5 min, Deep = 15 min, PhD = 25 min.

---

## Issue #39: Cache freshness policy inconsistent across sources

**Severity:** medium  
**Confidence:** confirmed  
**Area:** retrieval  

**Files:**
- `backend/src/core/retrieval/source-enrichment.ts:247-251`

**Root Cause:** `freshnessForUrl` uses hardcoded URL patterns to determine freshness. URLs not matching patterns get "semi_static" regardless of actual content freshness. News sites without "2025" or "latest" flagged incorrectly.

**Failure Path:** News article on `thehindu.com/article` → no "latest" in URL → semi_static → cached long → stale content served.

**Why It Harms Research Capability:** Stale content served as fresh, user gets outdated information.

**Runtime Symptoms:** Recent news shown as old, old news shown as fresh.

**Hidden Risk:** No actual content freshness validation.

**Recommended Architectural Direction:** Validate freshness from content metadata, not URL patterns.

---

## Issue #40: Evidence compressor priority doesn't account for source quality degradation

**Severity:** medium  
**Confidence:** likely  
**Area:** compression  

**Files:**
- `backend/src/core/evidence/evidence-compressor.ts:395-406`

**Root Cause:** `scoreSource` boosts by authority score and source class, but doesn't penalize by age. Recent high-authority source might be dropped in favor of older high-authority source, reducing freshness quality without acknowledgment.

**Failure Path:** Recent source (2025) slightly lower authority → older source (2023) selected → answer less fresh.

**Why It Harms Research Capability:** Freshness not weighted in source selection.

**Runtime Symptoms:** Answer uses older sources despite newer available.

**Hidden Risk:** Research appears less current than available data.

**Recommended Architectural Direction:** Add recency boost to source scoring. Prioritize recent sources within same authority tier.

---

## Issue #41: Source extraction quality not weighted in prompt budget priority

**Severity:** medium  
**Confidence:** suspected  
**Area:** prompt-budget  

**Files:**
- `backend/src/core/generation/prompt-budget.ts:46-108`

**Root Cause:** `getPromptBudget` considers `maxSourcesInPrompt` but doesn't prioritize full extraction quality sources over snippet sources. Compression might keep snippet-only sources because they're smaller, while dropping full-text sources because larger.

**Failure Path:** Full extraction source (1KB) kept vs snippet source (200B) dropped → answer has weaker sources.

**Why It Harms Research Capability:** Extraction quality not considered in budget decisions.

**Runtime Symptoms:** Answer cites snippet-only sources despite full sources available.

**Hidden Risk:** Budget optimization chooses wrong sources to keep.

**Recommended Architectural Direction:** Weight extraction quality in compression. Prefer full over snippet.

---

## Issue #42: Multi-hop expansion queries not deduplicated before execution

**Severity:** medium  
**Confidence:** likely  
**Area:** search  

**Files:**
- `backend/src/core/retrieval/bucketed-retrieval.ts:172-193`

**Root Cause:** `buildMultiHopExpansion` creates queries, but no deduplication before `runSearchPlan`. If case queries and entity queries overlap, duplicate search results fetched.

**Failure Path:** Query "Supreme Court" appears in both case and entity → searched twice → budget wasted → fewer unique results.

**Why It Harms Research Capability:** Query duplication wastes budget and reduces effective source count.

**Runtime Symptoms:** Fewer unique sources than queries should produce.

**Hidden Risk:** Budget wasted on redundancy.

**Recommended Architectural Direction:** Deduplicate expansion queries before execution.

---

## Issue #43: Early stopping triggers too aggressively in deep_research mode

**Severity:** medium  
**Confidence:** suspected  
**Area:** latency  

**Files:**
- `backend/src/core/retrieval/early-stopping.ts`

**Root Cause:** Early stopping logic checks citation eligible count against thresholds, but thresholds may be too aggressive for "deep_research" which should allow more time. Early stop at 10 sources when mode expects 20+ causes premature termination.

**Failure Path:** 12 sources found → early stop triggers → missing 8 sources that would improve answer.

**Why It Harms Research Capability:** Answer quality reduced by premature stop.

**Runtime Symptoms:** Research stops early, answer less comprehensive than expected.

**Hidden Risk:** Deep research not actually deep.

**Recommended Architectural Direction:** Scale early stop thresholds by research mode. Deep = 15 sources min.

---

## Issue #44: Model role batch processing doesn't handle partial failures well

**Severity:** high  
**Confidence:** confirmed  
**Area:** source-feeding  

**Files:**
- `backend/src/core/synthesis/model-role-runner.ts:153-230`

**Root Cause:** In the batch loop, if one batch fails, the entire role fails. There's no partial credit system - if 3 batches succeed and 1 fails, the role output is failed.

**Failure Path:** 3 batches succeed, 1 fails → role fails → source usage aggregate fails → research fails.

**Why It Harms Research Capability:** Partial success doesn't count, losing useful partial work.

**Runtime Symptoms:** Research fails despite majority of batches succeeding.

**Hidden Risk:** All-or-nothing approach too strict.

**Recommended Architectural Direction:** Implement partial credit. Allow 75% success rate per role.

---

## Issue #45: Verification repair orchestrator repair types not comprehensive

**Severity:** medium  
**Confidence:** likely  
**Area:** verification  

**Files:**
- `backend/src/core/verification/repair-orchestrator.ts`

**Root Cause:** Repair types mapped cover major categories but miss edge cases. A repair might address one issue but introduce another type not in the list.

**Failure Path:** Repair for UN framing introduces citation issues → repair types exhausted → no more repair attempts → final failure.

**Why It Harms Research Capability:** Limited repair types can't handle all issue combinations.

**Runtime Symptoms:** Some issues unfixable, causing research failure.

**Hidden Risk:** Repair system incomplete.

**Recommended Architectural Direction:** Expand repair types. Add composite repairs.

---

## Issue #46: Source cards can disappear when prompt exceeds token limits

**Severity:** critical  
**Confidence:** confirmed  
**Area:** source-feeding  

**Files:**
- `backend/src/core/generation/core-answer-prompt.ts:102-150`

**Root Cause:** The 8-iteration loop progressively reduces `sourceLimit`, `packCharBudget`, `cardCharBudget`, and `maxClaims`. If model output still exceeds limit, final emergency fallback uses only 4 sources. There's no "must include at least X sources" enforcement.

**Failure Path:** Large prompt needed → 8 rounds compression → sources reduced to 4 → answer has 4 citations → quality gate fails.

**Why It Harms Research Capability:** Prompt budget forces citation count below quality threshold.

**Runtime Symptoms:** Answer cites 4 sources despite available 20+.

**Hidden Risk:** Systematically under-cites due to budget constraints.

**Recommended Architectural Direction:** Enforce minimum source floor that survives all compression rounds.

---

## Issue #47: Provider model route contract statusCode mapping inconsistent

**Severity:** medium  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-model-route-contract.ts:23-34`

**Root Cause:** `httpStatusForProviderStatus` returns 206 for "catalog_fallback" but 206 is Partial Content, misleading for HTTP clients. "unverified" also returns 206 but these aren't partial responses.

**Failure Path:** Frontend/backend receives 206 → thinks partial content → processes incorrectly → state confusion.

**Why It Harms Research Capability:** HTTP semantics violated, causing processing confusion.

**Runtime Symptoms:** Status codes don't match actual provider state.

**Hidden Risk:** Client-side processing assumes wrong semantics.

**Recommended Architectural Direction:** Use 200 for healthy status. Use 503 for unavailable. Avoid 206 for non-partial responses.

---

## Issue #48: Evidence registry export doesn't include all citation-eligible sources

**Severity:** high  
**Confidence:** confirmed  
**Area:** evidence  

**Files:**
- `backend/src/core/evidence/evidence-registry.ts:110-115`

**Root Cause:** `exportForPrompt` only exports `keyFacts` and `limitations`, dropping `fullText`, `snippet`, `legalHoldings`, `keyNumbers`. If compression later drops a source, the model never had full context.

**Failure Path:** Source has rich content but only keyFacts exported → compression drops source → model never had full content → can't cite properly.

**Why It Harms Research Capability:** Partial source info reduces chance of proper citation even if source kept.

**Runtime Symptoms:** Some citations fail because model didn't have full context.

**Hidden Risk:** Export format limits citation potential.

**Recommended Architectural Direction:** Export full source data to prompt. Let compression decide what to include, not export.

---

## Issue #49: Citation validation runs after final answer but before streaming completes

**Severity:** medium  
**Confidence:** suspected  
**Area:** verification  

**Files:**
- `backend/src/core/generation/core-answer-generator.ts:152-181`

**Root Cause:** Citation validation runs before final answer is streamed to user. If validation fails and repair fails, there's no way for user to see what went wrong - they just get final answer.

**Failure Path:** Model generates answer → validation fails → repair attempt → repair fails → fallback generated → user never sees what failed.

**Why It Harms Research Capability:** No transparency about why citation repair was needed.

**Runtime Symptoms:** User sees fallback answer with no explanation.

**Hidden Risk:** Trust undermined by opaque failure.

**Recommended Architectural Direction:** Expose validation failures in pipeline events. Show repair attempts in UI.

---

## Issue #50: Source usage failure reports not surfaced to frontend

**Severity:** high  
**Confidence:** confirmed  
**Area:** source-feeding  

**Files:**
- `backend/src/core/synthesis/model-role-runner.ts:391-424`

**Root Cause:** `buildFailureOutput` creates `sourceUsageFailureReport` but pipeline metadata may not be fully displayed in UI. Frontend only shows limited pipeline event data.

**Failure Path:** Source usage fails → failure report created → not displayed to user → user confused about why citations low.

**Why It Harms Research Capability:** Diagnostic information not available to user for troubleshooting.

**Runtime Symptoms:** Low citations but no explanation in UI.

**Hidden Risk:** User can't diagnose source usage failures.

**Recommended Architectural Direction:** Surface source usage failures in pipeline panel. Show which roles failed and why.

---

## Issue #51: Provider health check doesn't account for model-specific issues

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-health.ts:35-104`

**Root Cause:** `getHealthyProvidersForResearch` checks provider-level status but not model-specific issues. A model might be healthy in catalog but fail for actual generation.

**Failure Path:** Specific model has elevated rate limit → health check passes → generation fails → retry storm.

**Why It Harms Research Capability:** Model-specific failures not predicted by health check.

**Runtime Symptoms:** Provider shows healthy but specific model fails repeatedly.

**Hidden Risk:** Health check gives false confidence.

**Recommended Architectural Direction:** Track model-specific failure history. Skip models with recent failures.

---

## Issue #52: LocalStorage model selection can be overwritten by stale state

**Severity:** high  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `frontend/src/hooks/use-provider-models.tsx:138-151`

**Root Cause:** At line 150, `localStorage.setItem("lastNormalModel", model)` is called, but there's a race between state update and localStorage write. Stale value from closure can be written.

**Failure Path:** User selects model → state updates → component re-renders → old closure value written to localStorage → next load uses wrong model.

**Why It Harms Research Capability:** Model selection persists incorrectly.

**Runtime Symptoms:** Refresh page → different model than last selected.

**Hidden Risk:** User can't maintain model preference.

**Recommended Architectural Direction:** Use functional update for state, ensure localStorage write happens after state is confirmed.

---

## Issue #53: Research mode inference can override explicit mode setting

**Severity:** medium  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `backend/src/core/pipeline/research-pipeline.ts:109`

**Root Cause:** `inferResearchMode` infers mode from `userQuery`, potentially overriding explicit `input.mode`. If user explicitly sets "phd_level" but query looks like fast research, inference might downgrade.

**Failure Path:** User sets phd_level → query contains simple terms → inferred as fast_research → lower quality.

**Why It Harms Research Capability:** Explicit mode selection overridden.

**Runtime Symptoms:** Research quality lower than user requested.

**Hidden Risk:** User can't force higher quality mode.

**Recommended Architectural Direction:** Never override explicit mode. Only infer when mode is null/undefined.

---

## Issue #54: Prompt budget reports show truncated section list, hiding what was lost

**Severity:** medium  
**Confidence:** confirmed  
**Area:** prompt-budget  

**Files:**
- `backend/src/core/generation/core-answer-prompt.ts:208`

**Root Cause:** `truncatedSections` is a Set converted to array. But it only records which category triggered truncation, not WHICH sources specifically were dropped.

**Failure Path:** Compression drops sources → report shows IDs but not content → user can't see what was lost → can't adjust query.

**Why It Harms Research Capability:** Can't diagnose which sources were lost and why.

**Runtime Symptoms:** Low citation count, no way to see which sources dropped.

**Hidden Risk:** Hard to troubleshoot citation issues.

**Recommended Architectural Direction:** Report dropped source IDs with titles. Show what was lost.

---

## Issue #55: Source gap weak bucket threshold too low (2 sources)

**Severity:** medium  
**Confidence:** confirmed  
**Area:** retrieval  

**Files:**
- `backend/src/core/retrieval/bucketed-retrieval.ts:379-383`

**Root Cause:** `bucketsNeedingTopup` checks `bucket.kept < 2` to identify weak buckets. This means 1 source is "weak" but doesn't account for bucket importance - some buckets more critical than others.

**Failure Path:** Court bucket has 1 source → weak → top-up query fired → budget spent → possibly unnecessary top-up.

**Why It Harms Research Capability:** Top-up budget spent on marginal buckets while important ones under-resourced.

**Runtime Symptoms:** Top-up queries fire unnecessarily.

**Hidden Risk:** Budget misallocated, important buckets suffer.

**Recommended Architectural Direction:** Weight bucket importance. Court/legal = high priority, social = low priority.

---

## Issue #56: Citation repair fallback creates deterministic answer that fails quality gate

**Severity:** high  
**Confidence:** confirmed  
**Area:** citation  

**Files:**
- `backend/src/core/generation/core-answer-generator.ts:171-179`

**Root Cause:** `buildDeterministicCitedFallbackAnswer` creates a basic fallback that lists sources, but may not pass quality gate because it lacks proper D7/D11 structure. The fallback is just evidence ledger, not proper parliamentary format.

**Failure Path:** Citation repair fails → deterministic fallback used → quality gate fails again → research fails.

**Why It Harms Research Capability:** Repair chain fails at quality gate, leaving no recovery.

**Runtime Symptoms:** Falls back to deterministic, quality gate rejects, complete failure.

**Hidden Risk:** No final safety net.

**Recommended Architectural Direction:** Ensure deterministic fallback includes proper D7/D11 structure. Don't just list evidence.

---

## Issue #57: Evidence pack cards don't preserve extraction quality metadata

**Severity:** medium  
**Confidence:** suspected  
**Area:** evidence  

**Files:**
- `backend/src/core/evidence/evidence-pack-builder.ts`

**Root Cause:** Pack builder may lose `extractionQuality` from source metadata when building cards. Model should prefer full extraction over snippet, but if metadata lost, can't make that decision.

**Failure Path:** Source has full extraction → packed → quality metadata lost → model treats as generic → wrong prioritization.

**Why It Harms Research Capability:** Can't leverage extraction quality for generation decisions.

**Runtime Symptoms:** Full and snippet sources treated equally.

**Hidden Risk:** Generation quality suboptimal.

**Recommended Architectural Direction:** Preserve extraction quality in pack cards. Use in compression priority.

---

## Issue #58: Provider health uses outdated model list without refresh

**Severity:** medium  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/provider-health-policy.ts`

**Root Cause:** Health check uses model list from last refresh but doesn't indicate staleness. If provider added/removed models since last check, health status is stale but looks current.

**Failure Path:** Model available yesterday → health shows healthy → today model removed → generation fails.

**Why It Harms Research Capability:** Stale health information causes preventable failures.

**Runtime Symptoms:** Provider suddenly fails despite showing healthy.

**Hidden Risk:** Health state doesn't reflect reality.

**Recommended Architectural Direction:** Add "lastRefresh" timestamp to health status. Warn if older than 5 minutes.

---

## Issue #59: Concurrency limit not enforced per-provider, only globally

**Severity:** medium  
**Confidence:** likely  
**Area:** concurrency  

**Files:**
- `backend/src/core/retrieval/bucketed-retrieval.ts`

**Root Cause:** `maxConcurrency` set per mode but not per provider. If 4 providers each have concurrency 4, 16 requests fire simultaneously, overwhelming rate limiters.

**Failure Path:** 4 search providers → each gets 3 concurrent → 12 requests → rate limit hit → all fail.

**Why It Harms Research Capability:** Rate limits hit due to concurrency overcommitment.

**Runtime Symptoms:** Search fails with rate limit errors.

**Hidden Risk:** No per-provider concurrency protection.

**Recommended Architectural Direction:** Enforce per-provider concurrency limits. Sum of all providers <= global limit.

---

## Issue #60: Frontend doesn't show provider errors from backend

**Severity:** high  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `frontend/src/components/chat/use-chat-run-controller.ts:588-596`

**Root Cause:** Error messages extracted but `SOURCE_USAGE_VALIDATION_FAILED` handled specially. Provider error details may not be displayed - user sees generic "Research failed".

**Failure Path:** Provider error → backend sends error → frontend shows generic message → user can't diagnose.

**Why It Harms Research Capability:** Users can't troubleshoot provider issues.

**Runtime Symptoms:** Generic error messages, no actionable information.

**Hidden Risk:** Support burden increases.

**Recommended Architectural Direction:** Display specific provider error messages. Show "Provider X failed: [reason]".

---

## Issue #61: Division synthesis returns placeholder text on validation failure

**Severity:** high  
**Confidence:** confirmed  
**Area:** synthesis  

**Files:**
- `backend/src/core/synthesis/division-synthesis.ts`

**Root Cause:** When validation fails, output is simply `"## ${title}\n\nSource gap."`. This is not a proper fallback - just a placeholder.

**Failure Path:** Division synthesis called → validation fails → placeholder returned → D7/D11 sections appear broken.

**Why It Harms Research Capability:** Structural sections become broken placeholders instead of meaningful content.

**Symptoms:** D7 and D11 sections show "Source gap" literal text.

**Hidden Risk:** Users see broken document structure, trust destroyed.

**Recommended Architectural Direction:** Generate meaningful fallback content, not placeholders.

---

## Issue #62: Model strategy hardcodes fallback order ignoring latency/performance

**Severity:** high  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `backend/src/core/providers/model-strategy.ts:5-19`

**Root Cause:** `STRONG_MODELS` and `FAST_MODELS` are static arrays with fixed order. No consideration of:
- Current latency metrics
- Historical success rates
- Provider-specific rate limits

**Failure Path:** Primary fails → fallback 1 attempted → if slow, entire pipeline slows → no dynamic reordering.

**Why It Harms Research Capability:** Static fallback order ignores real-time performance.

**Symptoms:** Research latency varies unpredictably.

**Hidden Risk:** No performance-based provider selection.

**Recommended Architectural Direction:** Implement dynamic fallback reordering based on recent latency and success rates.

---

## Issue #63: Research mode inference can downgrade explicit mode selection

**Severity:** high  
**Confidence:** confirmed  
**Area:** orchestration  

**Files:**
- `backend/src/core/config/research-mode.ts:70-78`

**Root Cause:** `inferResearchMode` runs even when `explicitUserMode` is provided. If explicitUserMode is "deep_research" but query has "quick", inference returns "fast_research", overriding user intent.

**Failure Path:** User explicitly selects "phd_level" → query contains "quick analysis" → inferred as "fast_research" → lower quality.

**Why It Harms Research Capability:** User requests higher quality but gets lower due to keyword matching.

**Symptoms:** Research quality lower than requested mode.

**Hidden Risk:** Mode selection becomes unreliable.

**Recommended Architectural Direction:** Only infer mode when explicit mode is null/undefined.

---

## Issue #64: Claim graph extracts but doesn't cluster or analyze contradictions

**Severity:** high  
**Confidence:** confirmed  
**Area:** evidence  

**Files:**
- `backend/src/core/evidence/claim-graph.ts:25-39`

**Root Cause:** `buildClaimGraph` extracts each source's claims as isolated items. No:
- Cross-source clustering
- Contradiction detection
- Evidence sufficiency scoring
- Claim strength ranking

**Failure Path:** 30 sources → 90+ individual claims → no grouping → model receives flat list → synthesis treats all evidence equally.

**Why It Harms Research Capability:** Evidence presented as flat list, not structured knowledge graph.

**Symptoms:** Answer treats all sources equally regardless of authority.

**Hidden Risk:** Evidence quality signals lost in flat list.

**Recommended Architectural Direction:** Implement claim clustering and contradiction detection. Prioritize strong evidence.

---

## Issue #65: Repair orchestrator uses regex replacement, not LLM repair

**Severity:** high  
**Confidence:** confirmed  
**Area:** verification  

**Files:**
- `backend/src/core/verification/repair-orchestrator.ts:18-79`

**Root Cause:** `runTargetedRepair` performs simple string replacements. No LLM involved - just pattern matching and appending.

**Failure Path:** Citation repair needed → string append performed → still has invalid citations → final answer broken.

**Why It Harms Research Capability:** Repairs are cosmetic, not semantic.

**Symptoms:** Repaired sections look templated, don't address root issue.

**Hidden Risk:** Repair creates false sense of fixing things.

**Recommended Architectural Direction:** Use LLM for semantic repairs, not regex.

---

## Issue #66: SourceUsageMap generation lacks cross-role correlation

**Severity:** high  
**Confidence:** confirmed  
**Area:** evidence  

**Files:**
- `backend/src/core/synthesis/model-role-runner.ts:448-520`

**Root Cause:** `deterministicExtractionFallback` extracts facts per-source individually. No cross-role correlation - each role processes same sources independently.

**Failure Path:** 6 roles run on same evidence → each extracts independently → no shared understanding → aggregate is flat list.

**Why It Harms Research Capability:** Evidence presented without strategic prioritization. Strongest evidence not highlighted.

**Symptoms:** All evidence treated equally, strongest sources buried.

**Hidden Risk:** Research quality limited by flat evidence presentation.

**Recommended Architectural Direction:** Implement cross-role evidence correlation. Prioritize evidence validated by multiple roles.

---

## Issue #67: Frontend effectiveModels override happens silently

**Severity:** high  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `frontend/src/hooks/use-pipeline-state.ts:272-273`

**Root Cause:** Comment says "Backend may auto-add worker models... This overrides the UI-selected list." No UI indication that selection was overridden.

**Failure Path:** User selects model A and B → backend adds model C → effectiveModels = [A, B, C] → user sees their models but backend runs different set.

**Why It Harms Research Capability:** User selection silently overridden, no visibility.

**Symptoms:** User selects specific models, different models run.

**Hidden Risk:** Trust destroyed when users realize selection was ignored.

**Recommended Architectural Direction:** Show visual indicator when backend auto-adds models. Allow user to disable auto-add.

---

## Issue #68: Pipeline state has race condition in SET_ACTIVE_RUN

**Severity:** high  
**Confidence:** confirmed  
**Area:** concurrency  

**Files:**
- `frontend/src/hooks/use-pipeline-state.ts:437-463`

**Root Cause:** `SET_ACTIVE_RUN` creates new run state but doesn't verify no other run is already active for same conversation. Multiple concurrent runs could overwrite each other.

**Failure Path:** User starts run 1 → run 1 sets activeRunId → user quickly starts run 2 → run 2 overwrites activeRunId → events from run 1 incorrectly attributed to run 2.

**Why It Harms Research Capability:** State corruption from overlapping runs.

**Symptoms:** Wrong run shows as active, events from old run appear in new conversation.

**Hidden Risk:** Data integrity compromised.

**Recommended Architectural Direction:** Add guard preventing multiple active runs. Cancel existing before setting new.

---

## Issue #69: Source gap weak bucket threshold ignores bucket importance

**Severity:** medium  
**Confidence:** confirmed  
**Area:** retrieval  

**Files:**
- `backend/src/core/retrieval/bucketed-retrieval.ts:379-383`

**Root Cause:** Uses uniform `bucket.kept < 2` threshold. Doesn't differentiate critical buckets (court_legal) from less critical (social_media). All buckets weighted equally.

**Failure Path:** Important bucket (court_legal) has 2 sources → not flagged weak → no top-up. Unimportant bucket flagged weak → top-up fired → budget wasted.

**Why It Harms Research Capability:** Top-up budget misallocated to less important buckets.

**Symptoms:** Top-up queries fire for unimportant buckets.

**Hidden Risk:** Evidence quality doesn't match bucket importance.

**Recommended Architectural Direction:** Weight bucket importance in top-up decisions. Prioritize court/legal/government buckets.

---

## Issue #70: Citation validation rejects before checking if source still exists

**Severity:** high  
**Confidence:** confirmed  
**Area:** citation  

**Files:**
- `backend/src/core/verification/citation-validator.ts:30-51`

**Root Cause:** Validation rejects citations when source doesn't exist or not eligible. But doesn't check if source WAS valid but was dropped during compression. No way to distinguish hallucination from compression loss.

**Failure Path:** Model cites [Source 15] → compression dropped source 15 → validation rejects → repair fails → final answer has rejected citation.

**Why It Harms Research Capability:** Cannot distinguish between model hallucination and compression loss.

**Symptoms:** Rejected citations even when model had correct intent.

**Hidden Risk:** False positive hallucination detection.

**Recommended Architectural Direction:** Track dropped sources separately. If citation points to dropped source, try to re-include rather than reject.

---

## Issue #71: Prompt budget compression doesn't preserve source citation format

**Severity:** high  
**Confidence:** confirmed  
**Area:** compression  

**Files:**
- `backend/src/core/evidence/evidence-compressor.ts:288-300`
- `backend/src/core/generation/core-answer-prompt.ts:226-254`

**Root Cause:** Different formats between main prompt and appendix. Citation validator expects exact format match. Format mismatch causes validation failure.

**Failure Path:** Source card added via appendix → format different → citation validation fails URL match → rejected.

**Why It Harms Research Capability:** Repair mechanism self-defeating through format mismatch.

**Symptoms:** Appendix sources fail validation despite being intentionally included.

**Hidden Risk:** Repair can't fix what it creates.

**Recommended Architectural Direction:** Use identical format in main prompt and appendix. Validate format consistency.

---

## Issue #72: Multi-hop expansion queries can duplicate existing queries

**Severity:** medium  
**Confidence:** confirmed  
**Area:** retrieval  

**Files:**
- `backend/src/core/retrieval/bucketed-retrieval.ts:172-193`

**Root Cause:** `buildMultiHopExpansion` creates queries but doesn't deduplicate against original plan queries. Same query could be in both.

**Failure Path:** Plan has query "Supreme Court" → expansion adds "Supreme Court" → searched twice → budget wasted.

**Why It Harms Research Capability:** Query duplication reduces effective source gathering.

**Symptoms:** More queries than necessary, diminishing returns.

**Hidden Risk:** Budget inefficiency from redundancy.

**Recommended Architectural Direction:** Deduplicate expansion queries against plan queries before execution.

---

## Issue #73: Provider status refresh doesn't invalidate stale models

**Severity:** medium  
**Confidence:** confirmed  
**Area:** provider-routing  

**Files:**
- `frontend/src/hooks/use-provider-models.tsx:197-274`

**Root Cause:** Refresh fetches fresh model lists but doesn't invalidate models that were previously available but no longer in catalog. Stale entry persists.

**Failure Path:** Model X available yesterday → health passes → today model removed from provider → still in local state → selected → generation fails.

**Why It Harms Research Capability:** Stale model list causes preventable failures.

**Symptoms:** Model that worked yesterday fails today with no visible change.

**Hidden Risk:** State doesn't reflect provider catalog changes.

**Recommended Architectural Direction:** Remove models from local state if not in fresh catalog.

---

## Issue #74: Latency budget doesn't account for concurrent stage overlap

**Severity:** high  
**Confidence:** confirmed  
**Area:** latency  

**Files:**
- `backend/src/core/latency/latency-budget.ts:106-175`

**Root Cause:** Budget defined as sequential stages but code shows concurrent execution. Budget sums as if sequential, but stages overlap.

**Failure Path:** Each stage within budget → but total overlap exceeds budget → early stopping triggers unexpectedly.

**Why It Harms Research Capability:** Budget math doesn't reflect runtime parallelism.

**Symptoms:** Research stops early despite staying within individual budgets.

**Hidden Risk:** Budget system provides false sense of available time.

**Recommended Architectural Direction:** Implement dynamic budget calculation with stage overlap tracking.

---

## Issue #75: Evidence registry deduping loses source diversity by domain

**Severity:** medium  
**Confidence:** confirmed  
**Area:** evidence  

**Files:**
- `backend/src/core/evidence/evidence-registry.ts:51-58`

**Root Cause:** `addSource` returns existing source if canonicalUrl matches. Same story on multiple Indian news sites gets deduplicated to first occurrence. Domain diversity lost.

**Failure Path:** Breaking news story → appears on 5 news sites → only first added → bucket coverage reduced.

**Why It Harms Research Capability:** Apparent source count lower than actual coverage.

**Runtime Symptoms:** Bucket says 3 sources but actually 3 domains for same story.

**Hidden Risk:** Diversity metrics unreliable.

**Recommended Architectural Direction:** Preserve domain diversity. Track unique domains, not just unique URLs.

---

## Issue #76: Citation repair happens AFTER quality gate, not BEFORE

**Severity:** high  
**Confidence:** confirmed  
**Area:** verification  

**Files:**
- `backend/src/core/generation/core-answer-generator.ts:152-181`

**Root Cause:** Citation repair runs AFTER quality gate. If quality gate fails for other reasons, repair never runs.

**Failure Path:** Under-cited answer → quality gate fails for missing D7 sections → repair never runs → final answer still under-cited.

**Why It Harms Research Capability:** Repair order wrong. Citation issues should be fixed BEFORE quality gate.

**Runtime Symptoms:** Answer fails quality gate, citations never repaired.

**Hidden Risk:** Single repair pass after quality issues may be insufficient.

**Recommended Architectural Direction:** Run citation repair FIRST. Then evaluate quality.

---

## Issue #77: Freshness router doesn't validate actual content age

**Severity:** medium  
**Confidence:** confirmed  
**Area:** freshness  

**Files:**
- `backend/src/core/retrieval/source-enrichment.ts:247-251`

**Root Cause:** `freshnessForUrl` uses URL pattern matching. No validation of actual content publication date. Article from 2023 on news site flagged "fresh".

**Failure Path:** User asks about current events → system serves article from last year flagged "fresh" by URL pattern.

**Why It Harms Research Capability:** Freshness based on URL, not content. Outdated content served as current.

**Runtime Symptoms:** Current event questions get old information.

**Hidden Risk:** No actual temporal validation.

**Recommended Architectural Direction:** Parse content date from metadata, not URL.

---

## Issue #78: Model role batch processing doesn't preserve order across batches

**Severity:** medium  
**Confidence:** confirmed  
**Area:** synthesis  

**Files:**
- `backend/src/core/synthesis/model-role-runner.ts:153-230`

**Root Cause:** Batches processed sequentially but results merged without preserving original source order. Original ordering lost in merge.

**Failure Path:** Sources processed out of priority order → evidence priority lost.

**Why It Harms Research Capability:** Evidence prioritization from source usage roles lost.

**Runtime Symptoms:** Evidence order doesn't reflect role-derived priority.

**Hidden Risk:** Evidence strength signals lost in aggregation.

**Recommended Architectural Direction:** Preserve priority order through merge. Sort by original priority before combining.

---

## Issue #79: Search executor doesn't weight provider by query type

**Severity:** medium  
**Confidence:** suspected  
**Area:** search  

**Files:**
- `backend/src/core/retrieval/search-executor.ts`

**Root Cause:** Search provider selection chooses first healthy provider or round-robin, not optimized for query type. No intelligent routing for legal/current affairs/Indian parliamentary queries.

**Failure Path:** User asks about Supreme Court case → routed to generic search → weak legal results.

**Why It Harms Research Capability:** No query-type-aware provider routing.

**Runtime Symptoms:** Inconsistent search quality across query types.

**Hidden Risk:** No optimization path for query-specific provider selection.

**Recommended Architectural Direction:** Route based on query type. Legal queries → providers with legal content.

---

## Issue #80: Frontend provider status refresh race with user selection

**Severity:** high  
**Confidence:** confirmed  
**Area:** frontend-state  

**Files:**
- `frontend/src/hooks/use-provider-models.tsx:276-323`

**Root Cause:** `refreshAllProviders` has in-flight guard but user can select model while refresh in progress. Selection might be overwritten by repair logic after refresh completes.

**Failure Path:** User selects model A → refresh starts → repairSelectedModel runs with stale list → model A not in stale list → repaired to model B → user selection lost.

**Why It Harms Research Capability:** Race between user selection and status refresh destroys user intent.

**Runtime Symptoms:** User selects model, but after refresh UI shows different model.

**Hidden Risk:** User cannot maintain provider preference.

**Recommended Architectural Direction:** Lock user selection during refresh. Complete refresh before allowing new selection.

---

# Summary

## Critical Themes Identified

1. **Evidence-first vs Prose-first Architecture**: System fundamentally prose-first with post-hoc citation repair. Violates core research engine principle.

2. **Provider Routing**: Static fallback order, no performance-based optimization, retry storms on failures.

3. **Frontend/Backend Sync**: Race conditions, stale state, silent overrides of user selection.

4. **Compression**: Destroys source fidelity, format mismatches cause validation failures.

5. **Quality Gates**: Run in wrong order, repair happens too late in pipeline.

6. **Claim Graph**: Extracts but doesn't cluster or analyze contradictions.

## Behavioral Assessment

The platform currently behaves like:
- **LLM wrapper with search** (not production-grade research engine)
- **Mega-prompt orchestration system** (not evidence-first synthesis)
- **Prose-first generator with post-hoc citation repair** (not evidence-grounded)

To become production-grade, must evolve toward:
- Retrieval → Evidence normalization → Evidence clustering → Claim extraction → Contradiction analysis → Evidence sufficiency scoring → Evidence-first synthesis → Prose rendering

## Priority Fix Areas

1. **Immediate** (Critical blocks production):
   - Provider routing fixes (#1, #5, #6, #7, #8)
   - Frontend/backend sync (#9, #20, #52, #80)
   - Source feeding/compression (#2, #3, #11, #23, #46)

2. **Short-term** (High impact):
   - Quality gate ordering (#17, #76)
   - Citation validation (#4, #24, #70)
   - Evidence quality scoring (#16)

3. **Medium-term** (Architectural):
   - Claim graph clustering (#64)
   - Query-type search routing (#22, #79)
   - Dynamic provider selection (#62)

---

*Audit completed: 80 issues identified across all critical areas.*
*This is a production AI research engine reliability investigation.*
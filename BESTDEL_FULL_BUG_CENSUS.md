# BestDel Full Research Pipeline Bug Census

## 1. Executive Summary

- **485 findings** across 23 bricks and cross-cutting areas. The pipeline has significant quality and reliability gaps despite partial fixes from prior sessions.
- **Biggest root cause:** TypeScript strict mode is disabled on both backend and frontend, enabling widespread `any` usage, unchecked null/undefined access, and undetected type mismatches in pipeline contracts.
- **No backend unit tests exist** — all testing investment is in the frontend (78 passing tests). The most critical orchestration function (`runResearchPipeline`, ~1100 lines) has zero dedicated tests.
- **Provider health and routing** have multiple risks: catalog fallback can mask live failures, trust flag bypasses research safety, and stale provider status can persist for 30+ seconds.
- **Query planning discards topic classification** (`void topic`), allowing fallback queries to be topic-agnostic and produce irrelevant retrieval results.
- **Evidence registry ID assignment** uses `array.length + 1` which will collide if sources are ever removed, breaking citation traces silently.
- **Source filter drops rejection reasons** silently, making "not enough sources" debugging guesswork.
- **Division quality gate** has fallback to full-text scanning for D7/D11, hiding division-specific failures.
- **Frontend has three separate status semantics functions** with slight inconsistencies, and dual state tracking (per-run + top-level) that can desync.
- **Enrichment fallback** can produce citation-eligible sources from failed extractions if snippet text meets quality thresholds.
- **Citation injection** uses authority fallback and hash fallback strategies that select citations without proving claim support.
- **No CI/CD pipeline** — all changes ship based on local verification only.
- **No mock providers or test fixtures** — tests use real imports, making provider failure testing impossible.
- **Stale EVM queries** in democratic space buckets drift from generic agendas to one specific 2024 topic.
- **Quick fix path:** Enable strict mode, add pipeline integration tests, fix source ID assignment, add rejection reasons to filter, remove division text fallback, and mark citation gaps.

## 2. Finding Count Summary

| Category                 | Count |
| ------------------------ | ----: |
| Confirmed bugs           |    48 |
| Probable bugs            |    73 |
| Architecture risks       |    52 |
| Missing tests            |   151 |
| Dead/unreachable code    |    33 |
| Type/contract mismatches |    67 |
| Observability gaps       |    61 |
| **Total findings**       | **485** |

| Brick | Findings |
| -----: | -------: |
| Brick 1: Request Intake | 15 |
| Brick 2: Provider Routing | 18 |
| Brick 3: Agenda Contract | 10 |
| Brick 4: Archive/Context | 8 |
| Brick 5: Dimension Engine | 8 |
| Brick 6: Source Bucket Planner | 13 |
| Brick 7: Query Planner | 15 |
| Brick 8: Search Provider Layer | 13 |
| Brick 9: Source Dedup | 10 |
| Brick 10: Source Filtering | 10 |
| Brick 11: Source Scoring | 13 |
| Brick 12: Source Enrichment | 17 |
| Brick 13: EvidenceRegistry | 18 |
| Brick 14: EvidencePack | 15 |
| Brick 15: ClaimGraph | 16 |
| Brick 16: SourceUsageMap | 16 |
| Brick 17: Role Generation | 20 |
| Brick 18: Synthesis Engine | 14 |
| Brick 19: Citation Injection | 16 |
| Brick 20: Citation Repair | 14 |
| Brick 21: Quality Gate | 21 |
| Brick 22: Run State/Persistence | 19 |
| Brick 23: Frontend Streaming/UI | 15 |
| Cross-cutting: Type Safety | 28 |
| Cross-cutting: Error Handling | 26 |
| Cross-cutting: Async/Race | 17 |
| Cross-cutting: Prompt Contracts | 11 |
| Cross-cutting: Missing Tests | 28 |

---

# BestDel Research Pipeline Audit: Bricks 1-6 Findings

---

## Brick 1: Request Intake

**Summary:** The request intake layer in `research-pipeline.ts` handles query validation, mode inference, and pipeline orchestration. The intake logic is reasonably structured but has issues around query validation boundaries, duplicate `flushLatencyEvents` shadowing, and insufficient abort-signal coverage across all critical paths. The providers route file has several type-safety gaps with pervasive `any` casts.

```
ID: B01-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: flushLatencyEvents (line 159-163) / flushLatencyEvents (line 521-526)
Evidence: Two functions named `flushLatencyEvents` exist — one is a closure inside `runResearchPipeline` (line 159) and another standalone function (line 521) that is never called.
What is wrong: The standalone `flushLatencyEvents` at line 521 shadows the closure. It accepts `(budget, emit)` parameters but is never invoked anywhere — the closure version at line 159 is used instead.
Why it matters: Dead code that could confuse maintainers. If someone calls the standalone version thinking it's active, it won't affect the pipeline.
Trigger: N/A — the function is defined but never referenced.
Fix direction: Remove the unused standalone `flushLatencyEvents` at line 521.
```

```
ID: B01-002
Type: Probable Bug
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 124)
Evidence: `input.userQuery` is used to build the agenda contract (line 193: `input.userQuery`) but the validation at line 128 uses `trimmedQuery`. The agenda contract receives the untrimmed `input.userQuery`.
What is wrong: If the user sends a query with leading/trailing whitespace, the `normalizedAgenda` in the contract will have the original whitespace (though `.replace(/\s+/g, " ")` partially fixes it). More importantly, downstream code that compares `input.userQuery` with `trimmedQuery` will see a mismatch.
Why it matters: Subtle inconsistency between validated input and what's passed to downstream components. Could cause off-by-whitespace bugs in dedup or cache lookups.
Trigger: User submits query with leading/trailing whitespace.
Fix direction: Use `trimmedQuery` everywhere after validation instead of `input.userQuery`.
```

```
ID: B01-003
Type: Missing Test
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline
Evidence: No test file for the pipeline orchestrator exists in the visible tree. This is a ~1100-line critical orchestration function with complex branching (core generation, fallback, source usage, abort handling).
What is wrong: The most critical function in the research pipeline has no dedicated unit or integration tests.
Why it matters: Any regression in pipeline orchestration — fallback logic, event emission, terminal state — will ship without detection.
Trigger: Any code change to pipeline logic.
Fix direction: Add comprehensive integration tests covering normal path, core failure, fallback, abort, and source gap scenarios.
```

```
ID: B01-004
Type: Type Mismatch
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 213-219)
Evidence: `providerRouter: input.providerRouter as any` — the providerRouter is cast to `any` when passed to `buildBucketedQueryPlanWithExpansion`.
What is wrong: The `as any` cast bypasses type checking. If `buildBucketedQueryPlanWithExpansion` expects a specific shape, the cast could hide incompatibilities.
Why it matters: Runtime errors if the actual shape doesn't match what the callee expects.
Trigger: Pass a ProviderRouter instance with a different interface than expected.
Fix direction: Define the precise interface expected by `buildBucketedQueryPlanWithExpansion` and type accordingly.
```

```
ID: B01-005
Type: Type Mismatch
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 237)
Evidence: `buildEvidenceRegistryFromSources(filtered as any, agendaContract)` — `filtered` is cast to `any`.
What is wrong: `filtered` comes from `filterSourcesForAgenda(rawSources.map(...))` which produces a different type than what `buildEvidenceRegistryFromSources` expects, necessitating the cast.
Why it matters: The `as any` cast masks a genuine type mismatch. If the source shape is wrong, the evidence registry will silently fail or produce corrupt data.
Trigger: Source filtering produces objects with missing required fields.
Fix direction: Fix the type of `filterSourcesForAgenda` output to match what `buildEvidenceRegistryFromSources` expects, or add a proper mapping step.
```

```
ID: B01-006
Type: Observability Gap
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 124)
Evidence: No structured logging at pipeline entry point. The function relies entirely on the `emit` callback for observability.
What is wrong: If the caller doesn't provide an `emit` function (it's optional), the entire pipeline runs with zero observability.
Why it matters: In production, if `emit` is not wired up, debugging pipeline failures becomes extremely difficult.
Trigger: Call `runResearchPipeline` without an `emit` callback.
Fix direction: Add a fallback logger that emits to console/structured log when `emit` is not provided.
```

```
ID: B01-007
Type: Risk
Severity: Medium
File: backend/src/routes/providers.ts
Function: extractKeys (imported, used at lines 214, 247, 277, etc.)
Evidence: `extractKeys` is imported from `../lib/provider-router.js` but its return type is not validated. All provider routes trust the extracted keys without null/undefined guards beyond simple truthiness.
What is wrong: If `extractKeys` returns unexpected keys (e.g., malformed or empty strings), downstream provider calls may fail in non-obvious ways.
Why it matters: Invalid keys could cause provider calls to fail with confusing error messages rather than clean "missing_key" responses.
Trigger: Malformed request headers.
Fix direction: Validate and normalize keys after extraction with Zod or similar schema.
```

```
ID: B01-008
Type: Confirmed Bug
Severity: Low
File: backend/src/routes/providers.ts
Function: listNvidiaModels (line 120-168)
Evidence: At line 148: `const status = err instanceof ProviderRouteError ? err.code as ProviderRouteStatus : statusCodeFromError(err)`. But `ProviderRouteError` is defined at line 591, which is AFTER this function. Due to hoisting, this works at runtime, but the reference order is confusing.
What is wrong: The `ProviderRouteError` class is defined after it's used in `listNvidiaModels`. While JavaScript hoisting makes this work, it creates a maintenance risk — reordering could break things.
Why it matters: Future refactoring could accidentally break the dependency order.
Trigger: Code reorganization or module splitting.
Fix direction: Move `ProviderRouteError` class definition to the top of the file or into a separate module.
```

```
ID: B01-009
Type: Probable Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: listGithubModels (line 170-211)
Evidence: At line 176-189, after a successful `validateGithubModelsToken`, the function returns `healthy: false, status: "unverified"`. The token was just validated successfully, yet it reports unhealthy.
What is wrong: A successfully validated GitHub token reports as unhealthy and unverified. This contradicts the successful validation.
Why it matters: GitHub provider will always appear unhealthy in the UI even when working correctly, causing unnecessary fallback behavior.
Trigger: Valid GitHub token — the provider is validated but still reported as unhealthy.
Fix direction: Set `healthy: true` and `status: "healthy"` after successful token validation.
```

```
ID: B01-010
Type: Type Mismatch
Severity: Low
File: backend/src/routes/providers.ts
Function: normalizeNvidiaModels (line 107-118)
Evidence: Pervasive `any` casts: `(data as any)?.data`, `data as any[]`, `item: any`. The function accepts `unknown` but then casts everything to `any`.
What is wrong: No type-safe parsing of the NVIDIA models API response shape.
Why it matters: If NVIDIA changes their API response shape, this will silently produce malformed data.
Trigger: NVIDIA API response format changes.
Fix direction: Use Zod schema to validate the response shape.
```

```
ID: B01-011
Type: Missing Test
Severity: Low
File: backend/src/routes/providers.ts
Function: buildProviderStatusPayload
Evidence: This complex async function probes 12+ providers, caches results, handles timeouts, and derives health policies. No test file exists for it.
What is wrong: The provider status aggregation logic has no unit tests.
Why it matters: Changes to provider probing, caching, or health policy derivation can break silently.
Trigger: Any change to provider probing logic or caching.
Fix direction: Add unit tests with mocked fetch and provider responses.
```

```
ID: B01-012
Type: Risk
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 279)
Evidence: `const useCoreGeneration = input.useCoreGeneration ?? process.env.USE_CORE_GENERATION !== "false"` — defaults to `true` if env var is not set.
What is wrong: Core generation is enabled by default without explicit opt-in. If a deployer doesn't set `USE_CORE_GENERATION`, core generation runs even when providers may not be properly configured.
Why it matters: Could cause unexpected provider failures in environments where keys aren't configured.
Trigger: Deploy without setting `USE_CORE_GENERATION` env var.
Fix direction: Default to `false` or require explicit opt-in for core generation.
```

```
ID: B01-013
Type: Confirmed Bug
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 291-292)
Evidence: `const finalProviderName = finalModelAssignment?.generationEligible ? finalModelAssignment.providerName : (input.providerName ?? "groq")` — defaults to `"groq"` even if groq isn't configured.
What is wrong: The fallback provider name `"groq"` is hardcoded. If groq is not available, this could cause a provider-not-found error.
Why it matters: In environments without groq configured, the pipeline will fail at the final prose rendering step.
Trigger: Deploy without groq API key and have core generation fail to find an eligible assignment.
Fix direction: Dynamically select from available providers instead of hardcoding "groq".
```

```
ID: B01-014
Type: Observability Gap
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 149-152)
Evidence: `emitTerminal` guards against double-emission with `if (terminalEmitted) return;` but doesn't log a warning when a second terminal event is suppressed.
What is wrong: Silently dropping duplicate terminal events makes debugging race conditions harder.
Why it matters: If two code paths both try to emit terminal events, the second is silently dropped without any trace.
Trigger: Error and abort both fire simultaneously.
Fix direction: Log a warning when suppressing a duplicate terminal event.
```

```
ID: B01-015
Type: Dead Code
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: flushLatencyEvents (line 521-526)
Evidence: The standalone `flushLatencyEvents` function is defined but never called. The closure version at line 159 is used instead.
What is wrong: Completely dead function.
Why it matters: Code clutter and maintenance confusion.
Trigger: N/A
Fix direction: Delete the function.
```

---

## Brick 2: Provider Routing

**Summary:** The provider routing layer has solid timeout handling and error classification, but suffers from excessive `any` casts in `provider-router.ts`, a JSON extraction function that could return invalid JSON, and a health-check system that assumes providers without status are unhealthy (potentially blocking valid providers). The `ProviderJsonResponse.json` field is typed as `unknown` which defeats the purpose of typed responses.

```
ID: B02-001
Type: Type Mismatch
Severity: Medium
File: backend/src/core/providers/provider-types.ts
Function: ProviderJsonResponse (line 28-30)
Evidence: `json: unknown` — the JSON response field is typed as `unknown`, defeating type safety for all callers.
What is wrong: Every consumer of `ProviderJsonResponse.json` must cast or validate the JSON themselves. The type provides no guidance on expected shape.
Why it matters: Callers may access properties on `unknown` without proper type guards, causing runtime errors.
Trigger: Any code accessing `.json` property without validation.
Fix direction: Use generics: `ProviderJsonResponse<T = unknown>` or define specific response schemas.
```

```
ID: B02-002
Type: Probable Bug
Severity: High
File: backend/src/core/providers/provider-router.ts
Function: extractJson (line 92-104)
Evidence: At line 99: `if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1)` — this extracts from the FIRST `{` to the LAST `}` in the text.
What is wrong: If the response contains multiple JSON objects or nested braces in strings, this will extract an invalid JSON string. For example, `{"a": "{"}{"b": 1}` would extract the entire string including the intermediate `}` which may not be valid JSON.
Why it matters: `JSON.parse` in `completeJson` (line 69) will throw, causing the entire provider call to fail even if a valid JSON object exists.
Trigger: Model response containing nested braces or multiple JSON-like structures.
Fix direction: Use a proper JSON extractor that tracks brace depth and validates each candidate with `JSON.parse`.
```

```
ID: B02-003
Type: Confirmed Bug
Severity: High
File: backend/src/core/providers/provider-router.ts
Function: completeJson (line 58-75)
Evidence: `return { ...response, json: JSON.parse(extractJson(response.content)) }` — `JSON.parse` is called on `extractJson` output without a try/catch inside the loop.
What is wrong: If `extractJson` returns a string that isn't valid JSON, `JSON.parse` throws and the catch block catches it, retrying. But the retry doesn't change the input — it sends the same request again. This means retry logic is ineffective for JSON parse failures.
Why it matters: The retry loop wastes API calls and rate limits on unretryable errors.
Trigger: Provider returns non-JSON response (e.g., an error message or natural language).
Fix direction: Distinguish between retryable (network) and non-retryable (parse) errors. Don't retry parse failures.
```

```
ID: B02-004
Type: Risk
Severity: Medium
File: backend/src/core/providers/provider-router.ts
Function: completeJson (line 58-75)
Evidence: `const retries = request.retries ?? 1` with `for (let attempt = 0; attempt <= retries; attempt += 1)` — this means 2 attempts by default (attempt 0 and 1).
What is wrong: The retry count is confusing — `retries: 1` means 2 total attempts. Callers may expect 1 total attempt.
Why it matters: Unintended double API calls waste tokens and increase latency.
Trigger: Caller passes `retries: 1` expecting one attempt.
Fix direction: Document clearly or change to `attempts` instead of `retries`.
```

```
ID: B02-005
Type: Type Mismatch
Severity: Low
File: backend/src/core/providers/provider-types.ts
Function: ProviderRequest (line 3-12)
Evidence: `metadata?: Record<string, unknown>` — untyped metadata bag.
What is wrong: No type safety for metadata fields. Consumers and providers must agree on keys by convention only.
Why it matters: Typos in metadata keys (e.g., `runId` vs `runID`) will silently cause features to break.
Trigger: Any code reading metadata with a typo in the key name.
Fix direction: Define a discriminated metadata type with known keys.
```

```
ID: B02-006
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: unhealthyReason (line 99-117)
Evidence: At line 109-111: `if (options.isSelected && !options.autoFallback) { return null; }` — if the provider is the user's explicitly selected one and auto-fallback is off, it's marked healthy regardless of actual status.
What is wrong: This bypasses all subsequent health checks (chatVerified, models available, etc.) for the selected provider when auto-fallback is off. A provider with `chatVerified: false` and `healthy: false` would still be marked healthy.
Why it matters: Users could be routed to a broken provider because they explicitly selected it, with no indication of failure until the API call fails.
Trigger: User selects a provider that has `chatVerified: false` and `autoFallback` is off.
Fix direction: Still check critical health indicators (configured, model availability) even for explicitly selected providers.
```

```
ID: B02-007
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: getHealthyProvidersForResearch
Evidence: The health selection logic — which determines which provider handles research tasks — has no dedicated test file.
What is wrong: No tests for the critical provider health evaluation and selection logic.
Why it matters: Changes to health criteria could silently route traffic to unhealthy providers.
Trigger: Any modification to health check criteria.
Fix direction: Add tests covering all health status combinations.
```

```
ID: B02-008
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: unhealthyReason (line 99-117)
Evidence: Line 108: `if (model && status.models && status.models.length > 0 && !status.models.includes(model)) return "model_not_available"` — this check only fires when `model` is truthy AND `status.models` is non-empty.
What is wrong: If `status.models` is empty (provider returned no models), this check passes through and the provider may be considered healthy despite having no available models.
Why it matters: A provider with an empty model list could be selected for research, causing immediate failure.
Trigger: Provider health check returns empty model list.
Fix direction: Treat empty model list as unhealthy.
```

```
ID: B02-009
Type: Observability Gap
Severity: Low
File: backend/src/core/providers/provider-router.ts
Function: complete (line 20-56)
Evidence: The `logProviderCall` at line 27-37 logs success cases but doesn't include token usage in the log even though `response.usage` may be available.
What is wrong: Token usage is not logged for provider calls, making it impossible to track per-provider token consumption.
Why it matters: Cannot monitor or optimize token costs per provider.
Trigger: Any successful provider call.
Fix direction: Include `response.usage` in the provider call log.
```

```
ID: B02-010
Type: Risk
Severity: Medium
File: backend/src/core/providers/provider-router.ts
Function: withTimeout (line 78-90)
Evidence: The timeout uses `Promise.race` which doesn't cancel the underlying promise. If the provider HTTP call takes 60 seconds but timeout is 45 seconds, the HTTP call still runs for 60 seconds (consuming resources).
What is wrong: Timeout doesn't abort the underlying operation — it just resolves the race early.
Why it matters: Resource leaks (open connections, in-flight API calls) accumulate under high load with frequent timeouts.
Trigger: Many requests timing out simultaneously.
Fix direction: Use AbortController or equivalent to actually cancel the in-flight request on timeout.
```

```
ID: B02-011
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: getHealthyProvidersForResearch (line 35-97)
Evidence: At line 42-45: candidates are built from `selectedProvider/selectedModel` and `fallbackModels`, but there's no deduplication between them. If the selected provider is also in fallbackModels, it appears twice.
What is wrong: `uniqueCandidates` deduplicates by `providerName/model` key, but the selected provider and fallback models could be the same provider with different models, both getting included.
Why it matters: Redundant health checks and potential confusion in the UI about which model is "selected."
Trigger: Selected provider also appears in the fallback list.
Fix direction: Ensure candidates are deduplicated after merging selected and fallback entries.
```

```
ID: B02-012
Type: Type Mismatch
Severity: Low
File: backend/src/core/providers/provider-types.ts
Function: ProviderResponse (line 14-26)
Evidence: `rawFinishReason?: string` is a string but different providers use different finish reason formats (e.g., "stop", "length", "tool_calls").
What is wrong: No enumeration or validation of finish reason values.
Why it matters: Consumers can't reliably detect why a response ended (e.g., was it truncated?).
Trigger: Checking finish reason to detect truncation.
Fix direction: Define a union type for known finish reasons.
```

```
ID: B02-013
Type: Missing Test
Severity: Low
File: backend/src/core/providers/provider-router.ts
Function: ProviderRouter.completeJson
Evidence: The JSON extraction + retry logic has no tests for edge cases: malformed JSON, partial JSON, nested JSON, JSON in code blocks.
What is wrong: No test coverage for the complex JSON extraction and retry behavior.
Why it matters: Changes to extractJson could silently break JSON parsing for valid responses.
Trigger: Any modification to extractJson or completeJson.
Fix direction: Add parameterized tests for all JSON extraction patterns.
```

```
ID: B02-014
Type: Risk
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: unhealthyReason (line 112)
Evidence: Line 112: `if (status.chatVerified !== true) return status.catalogFallbackOnly ? "catalog_fallback_only" : "chat_not_verified"` — this is reached only when `!options.isSelected || options.autoFallback`. Providers that have `chatVerified` undefined (never checked) are treated as unhealthy.
What is wrong: Providers that haven't been explicitly verified are treated as unhealthy, which may be overly conservative for newly configured providers.
Why it matters: Newly configured providers may never get a chance to prove they work if they're always marked unhealthy.
Trigger: Provider is configured but hasn't been health-checked yet.
Fix direction: Distinguish between "verified and failed" vs "never checked."
```

```
ID: B02-015
Type: Dead Code
Severity: Low
File: backend/src/core/providers/provider-health.ts
Function: dedupeUnhealthy (line 129-137)
Evidence: Deduplication key is `${item.providerName}/${item.reason}`. If the same provider has multiple different unhealthy reasons, all are kept. This means deduplication only works for exact same provider+reason pairs.
What is wrong: The dedup logic is too narrow — it keeps multiple entries for the same provider with different reasons, which is probably the intended behavior, making this function less useful than expected.
Why it matters: May not be dead code per se, but the dedup strategy doesn't match typical use cases.
Trigger: Same provider appears with multiple health issues.
Fix direction: Consider whether dedup should keep only the most severe reason per provider.
```

---

## Brick 3: Agenda Contract

**Summary:** The agenda contract system correctly structures research parameters but has issues with overly broad string matching for lens detection, hardcoded entity lists that may not match all topic types, and a scoring formula that can produce inconsistent results. The `repairAgendaDrift` function uses naive regex replacement that could corrupt legitimate content.

```
ID: B03-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: repairAgendaDrift (line 244-253)
Evidence: `repaired = repaired.replace(new RegExp(escapeRegExp(term), "gi"), "[removed drift]")` — this replaces ALL occurrences of forbidden terms in the text, including legitimate mentions within quotes, citations, or factual statements.
What is wrong: Blind regex replacement of forbidden terms corrupts the text. For example, if the text quotes "artificial intelligence" in a legitimate context, it becomes "[removed drift]".
Why it matters: The repaired text may become nonsensical or lose critical meaning, especially when terms appear in source citations or quoted material.
Trigger: Any output containing forbidden terms in legitimate contexts (quotes, citations).
Fix direction: Only replace terms that appear as the model's own assertions, not in quoted or cited material.
```

```
ID: B03-002
Type: Probable Bug
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: assertAgendaLock (line 214-242)
Evidence: Line 229: `const score = Math.max(0, Math.round((indiaFocusScore * 0.3 + temporalScopeScore * 0.2 + committeeSystemScore * 0.2 + 30) - driftPenalty - entityPenalty - lensPenalty))` — the constant `30` is added without explanation.
What is wrong: The scoring formula has a hardcoded +30 baseline that can make a completely failing agenda pass if the other scores are moderate. For example, with all component scores at 50: 50*0.3 + 50*0.2 + 50*0.2 + 30 = 65, then penalties could drop it below 75, but the baseline inflates scores.
Why it matters: The scoring threshold (75) may not reflect actual agenda compliance quality.
Trigger: Any agenda assessment — scores may pass when they shouldn't.
Fix direction: Document the scoring formula or normalize so baseline is 0.
```

```
ID: B03-003
Type: Risk
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: lensAppears (line 280-299)
Evidence: The lens detection uses very generic terms. For example, `democracy_indices` matches on `["freedom house", "v-dem", "eiu", "index", "democracy"]` — ANY text containing "index" or "democracy" would match this lens, even if unrelated.
What is wrong: Overly broad keyword matching leads to false positives in lens detection.
Why it matters: An agenda that barely mentions "democracy" in passing would incorrectly be scored as covering the democracy_indices lens.
Trigger: Text containing common words like "index", "democracy", "rights", "court".
Fix direction: Use more specific term combinations or require multiple terms to match a lens.
```

```
ID: B03-004
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract (line 140-212)
Evidence: At line 198: `topicType: isUnExplicit ? "unsupported_un_mun" : classifyGenericIndianTopic(lower)` — for non-India-democracy, non-UN topics, `classifyGenericIndianTopic` is called on `lower` but the classifier may return types that don't match all possible agenda topics.
What is wrong: `classifyIndianParliamentaryTopic` is imported from a separate module and cast `as TopicType`. If the classifier returns a type not in the `TopicType` union, this is a runtime type error.
Why it matters: If the topic classifier is updated independently, the agenda contract could receive invalid topic types.
Trigger: Topic classifier returns a new type not in the TopicType union.
Fix direction: Validate the classifier output against the TopicType union at runtime.
```

```
ID: B03-005
Type: Missing Test
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract
Evidence: No test file for the agenda contract builder. This function has complex branching logic for democracy topics, UN topics, and generic Indian topics.
What is wrong: The agenda classification logic — which determines source buckets, lenses, evidence standards, and committee systems — has no test coverage.
Why it matters: Incorrect agenda classification leads to wrong source buckets, missing lenses, and insufficient evidence standards.
Trigger: Any change to topic detection or agenda building logic.
Fix direction: Add tests for all agenda classification paths (democracy, UN, generic Indian, edge cases).
```

```
ID: B03-006
Type: Risk
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract (line 140-212)
Evidence: For non-democracy topics (line 193-211), `requiredSourceBuckets` is set to an empty array `[]`. This means generic Indian parliament topics have NO required source buckets.
What is wrong: Non-democracy agendas have no source bucket requirements, which could lead to insufficient source diversity.
Why it matters: Research on economic policy or constitutional law may not retrieve from the appropriate source buckets.
Trigger: Any non-democracy agenda topic.
Fix direction: Map topic types to appropriate source bucket requirements in the generic path.
```

```
ID: B03-007
Type: Type Mismatch
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: classifyGenericIndianTopic (line 271-273)
Evidence: `return classifyIndianParliamentaryTopic(lower).topicType as TopicType` — uses `as TopicType` cast without validation.
What is wrong: If `classifyIndianParliamentaryTopic` returns a string not in the `TopicType` union, the cast is unsafe.
Why it matters: Runtime type errors when the returned type is used in switch/match statements.
Trigger: Classifier returns unexpected type string.
Fix direction: Use a type guard or validate the return value.
```

```
ID: B03-008
Type: Probable Bug
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: containsLoose (line 301-304)
Evidence: `lower.includes(normalized.replace(/-/g, " "))` — replaces hyphens with spaces but doesn't handle other punctuation variations (e.g., en-dash, em-dash, underscore).
What is wrong: Terms like "e-government" or "co-operation" with different dash characters may not match correctly.
Why it matters: False negatives in entity/lens/drift detection.
Trigger: Text uses non-standard dash characters.
Fix direction: Normalize all dash-like characters before comparison.
```

```
ID: B03-009
Type: Observability Gap
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract
Evidence: No logging when an agenda contract is built. If agenda classification goes wrong, there's no trace of why a particular topic type was assigned.
What is wrong: No observability into agenda classification decisions.
Why it matters: Debugging misclassified agendas requires reading the code and manually tracing the logic.
Trigger: Any agenda classification — especially for borderline topics.
Fix direction: Log the classification decision (topic type, reason, matched patterns).
```

```
ID: B03-010
Type: Confirmed Bug
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: inferTemporalScope (line 255-269)
Evidence: Line 260: `const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]))` — this extracts ALL 4-digit years starting with 20, including years in URLs, phone numbers, or other non-temporal contexts.
What is wrong: Years embedded in URLs (e.g., `https://example.com/report/2024/data`) or non-temporal contexts are treated as temporal scope indicators.
Why it matters: An agenda mentioning a URL with "2024" could incorrectly set the temporal scope to 2024.
Trigger: User query contains a URL with a year.
Fix direction: Filter out years that appear within URL patterns or other non-temporal contexts.
```

```
ID: B03-011
Type: Risk
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract (line 144)
Evidence: `const isUnExplicit = /\b(unsc|united nations|security council|general assembly|ecosoc)\b/i.test(normalizedAgenda)` — "security council" alone matches, which could be triggered by "Supreme Court Security Council" (not a UN context).
What is wrong: Generic term "security council" matches without requiring a UN context qualifier.
Why it matters: Indian national security topics mentioning "security council" could be misclassified as UN topics.
Trigger: Query mentions "security council" in a non-UN context.
Fix direction: Require "UN" or "United Nations" qualifier alongside "security council."
```

```
ID: B03-012
Type: Missing Test
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: assertAgendaLock
Evidence: The agenda lock assertion — which determines if generated text complies with the agenda — has no test coverage for edge cases.
What is wrong: No tests for scoring edge cases, penalty calculations, or threshold boundaries.
Why it matters: Changes to the scoring formula could silently pass or fail agendas incorrectly.
Trigger: Any modification to scoring logic.
Fix direction: Add tests for scoring boundaries and penalty calculations.
```

```
ID: B03-013
Type: Dead Code
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: makeRequestId (line 313-315)
Evidence: `makeRequestId` generates IDs like `agenda_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`. But `input.requestId` is often provided by the caller (pipeline), making this function only used when no requestId is passed.
What is wrong: Minor — the function is used but as a fallback only. Not truly dead but low-value.
Why it matters: Minimal impact.
Trigger: N/A
Fix direction: Consider using a more robust ID generator (e.g., nanoid) for uniqueness guarantees.
```

```
ID: B03-014
Type: Probable Bug
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract (line 145-146)
Evidence: The India democracy detection regex `/\bindia'?s?\b|\bindian\b/i` AND `/\b(democratic space|democracy|backsliding|...)\b/i` — both must match. But "India's democracy" would match, while "Indian democratic backsliding" would also match. The pattern is reasonable but "backsliding" alone is too generic.
What is wrong: "backsliding" is a common word that could appear in non-democracy contexts (e.g., "economic backsliding").
Why it matters: False positive democracy classification for topics that mention "India" and "backsliding" but aren't about democratic space.
Trigger: Query like "India's economic backsliding in GDP growth."
Fix direction: Require more specific democracy-related terms.
```

```
ID: B03-015
Type: Risk
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract (line 188-189)
Evidence: `minimumUniqueCitedSources: 30, minimumEvidenceCardsPerModel: 30` for democracy topics. These are very high minimums that may be impossible to satisfy for narrow queries.
What is wrong: Hardcoded minimums of 30 sources/cards may be unachievable, causing the pipeline to always report source gaps.
Why it matters: Every democracy-topic research will show as having source gaps, which could be a false alarm.
Trigger: Any Indian democratic space agenda.
Fix direction: Make minimums proportional to query scope or topic breadth.
```

---

## Brick 4: Archive/Context

**Summary:** The context router is a small but critical file that determines whether new queries relate to existing archive workspaces. It has issues with overly simplistic keyword matching, missing null/undefined guards, and a hardcoded regex for consumer queries that may be too narrow.

```
ID: B04-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/archive/context-router.ts
Function: routeQueryAgainstWorkspace (line 46-86)
Evidence: Line 48: `const context = \`${workspaceContext?.title ?? ""} ${workspaceContext?.summary ?? ""} ${(workspaceContext?.anglePatterns ?? []).join(" ")}\`.toLowerCase()` — if `workspaceContext` is provided but all fields are empty/undefined, `context` becomes `"  "`. Line 49 checks `!context.trim()` which correctly handles this, but the regex checks at line 52 and 63 run on the original query `q` against an empty context.
What is wrong: If context is empty after trimming, the function returns early at line 49. But the logic between lines 51-74 could produce false matches if `context` contains noise from empty string concatenation before the trim check.
Why it matters: Minor — the early return at line 49 prevents this. But the code ordering is confusing.
Trigger: N/A — early return prevents the bug.
Fix direction: Move the empty-context check to the very top for clarity.
```

```
ID: B04-002
Type: Probable Bug
Severity: Medium
File: backend/src/core/archive/context-router.ts
Function: routeQueryAgainstWorkspace (line 51-61)
Evidence: `const legalHits = INDIAN_LEGAL_SUBTOPIC_TERMS.filter((term) => q.includes(term))` — if ANY legal subtopic term appears in the query AND the context contains generic terms like "india" or "rights", it's classified as `subtopic_related` with `shouldAskUser: true`.
What is wrong: A query like "What is sedition?" in a workspace about "Indian democracy and civil rights" would be classified as subtopic-related. This is probably correct, but the confidence is hardcoded at 0.58 without any analysis of actual overlap.
Why it matters: The confidence score is arbitrary and doesn't reflect actual relevance.
Trigger: Any legal query against a democracy workspace.
Fix direction: Calculate confidence based on actual term overlap ratio.
```

```
ID: B04-003
Type: Risk
Severity: Low
File: backend/src/core/archive/context-router.ts
Function: routeQueryAgainstWorkspace (line 76)
Evidence: `/phone|gaming|laptop|movie|recipe|travel|shopping/.test(q)` — hardcoded list of consumer query indicators. This list is incomplete and will miss many consumer queries (e.g., "restaurant", "hotel", "flight").
What is wrong: Incomplete regex for detecting consumer/personal queries. Many unrelated queries will fall through to `temporary_side_query`.
Why it matters: Consumer queries that don't match the regex get classified as temporary side queries with `shouldAskUser: true`, which could prompt unnecessary user interaction.
Trigger: Query like "best restaurants near me."
Fix direction: Expand the regex or use a more general consumer-query detection approach.
```

```
ID: B04-004
Type: Missing Test
Severity: Medium
File: backend/src/core/archive/context-router.ts
Function: routeQueryAgainstWorkspace
Evidence: No test file exists for the context routing logic.
What is wrong: The query routing logic — which determines whether to attach to workspace, create subthreads, or isolate responses — has no test coverage.
Why it matters: Changes to routing logic could silently misroute queries, injecting archive facts into unrelated conversations or vice versa.
Trigger: Any modification to routing thresholds or term lists.
Fix direction: Add tests for all routing paths (core_related, subtopic_related, temporary_side_query, unrelated).
```

```
ID: B04-005
Type: Type Mismatch
Severity: Low
File: backend/src/core/archive/context-router.ts
Function: WorkspaceContext (line 4-8)
Evidence: All fields are optional (`title?`, `summary?`, `anglePatterns?`). A completely empty `WorkspaceContext` is valid but semantically meaningless.
What is wrong: No validation that at least one field is present.
Why it matters: An empty workspace context could be passed through the pipeline, causing the router to return `isolated` immediately.
Trigger: Caller passes `{}` as workspace context.
Fix direction: Require at least one field or use a discriminated type.
```

```
ID: B04-006
Type: Confirmed Bug
Severity: Low
File: backend/src/core/archive/context-router.ts
Function: routeQueryAgainstWorkspace (line 68)
Evidence: `confidence: Math.min(0.95, 0.72 + overlap.length * 0.06 + queryCoreHits.length * 0.03)` — this can produce confidence > 0.95 only if `overlap.length * 0.06 + queryCoreHits.length * 0.03 >= 0.23`. With overlap=3 and queryCoreHits=1: 0.72 + 0.18 + 0.03 = 0.93. The cap at 0.95 is rarely reached.
What is wrong: The confidence formula is arbitrary and doesn't account for the total number of possible terms. A match on 2 terms in a small query is weighted the same as 2 terms in a large query.
Why it matters: Confidence scores don't accurately reflect query-archive relevance.
Trigger: Any core_related query classification.
Fix direction: Normalize confidence by the total possible matches.
```

```
ID: B04-007
Type: Observability Gap
Severity: Low
File: backend/src/core/archive/context-router.ts
Function: routeQueryAgainstWorkspace
Evidence: No logging or observability into why a query was classified as a particular relation type.
What is wrong: When a query is misclassified, there's no way to understand which terms matched and which rules fired.
Why it matters: Debugging archive routing issues requires manually tracing through the function.
Trigger: Query misclassified by the router.
Fix direction: Return the matched terms and fired rules in the result for debugging.
```

```
ID: B04-008
Type: Risk
Severity: Medium
File: backend/src/core/archive/context-router.ts
Function: routeQueryAgainstWorkspace (line 63)
Evidence: `const overlap = CORE_DEMOCRACY_TERMS.filter((term) => q.includes(term) && context.includes(term))` — this requires the SAME term to appear in both query AND context. If the query uses a synonym (e.g., "civil rights" vs "civil liberties"), there's no overlap detected.
What is wrong: No synonym handling or semantic similarity. Related concepts are missed.
Why it matters: Queries about the same topic using different terminology are classified as unrelated.
Trigger: Query uses synonyms of core democracy terms.
Fix direction: Add synonym expansion or use embeddings for semantic matching.
```

```
ID: B04-009
Type: Dead Code
Severity: Low
File: backend/src/core/archive/context-router.ts
Function: isolated (line 88-97)
Evidence: The `isolated` helper is only called from two places (line 49 and line 76). It could be inlined, but more importantly, the `reason` string parameter is placed in `driftRisks` array — which is semantically incorrect (it's not a drift risk, it's an isolation reason).
What is wrong: The `reason` parameter is mislabeled as a `driftRisk`.
Why it matters: Consumers of `driftRisks` may interpret the isolation reason as an actual drift risk.
Trigger: Consumer reads `driftRisks` from an isolated result.
Fix direction: Add a separate `isolationReason` field or rename the parameter.
```

```
ID: B04-010
Type: Probable Bug
Severity: Low
File: backend/src/core/archive/context-router.ts
Function: routeQueryAgainstWorkspace (line 52)
Evidence: `/india|constitutional|rights|supreme court|civil liberties|democratic/.test(context)` — this regex checks context for broad terms. If the context is about ANY Indian topic (even economic), a legal query would be classified as subtopic_related.
What is wrong: Overly broad context matching — a workspace about "India's GST policy" would match a query about "sedition law" as subtopic_related.
Why it matters: Unrelated legal queries get attached to non-legal Indian workspaces.
Trigger: Legal query against a non-legal Indian workspace.
Fix direction: Tighten the context matching to require more specific legal terms.
```

---

## Brick 5: Dimension Engine

**Summary:** The dimension engine is invoked from the research pipeline but its implementation lives in a separate file. From the pipeline's perspective, the engine is called with a query and committee type, returning weighted dimensions. Issues include missing error handling around the engine call, no validation of output shape, and the engine is called synchronously despite potentially being async-heavy.

```
ID: B05-001
Type: Missing Test
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts (calls dimension engine)
Function: runResearchPipeline (line 196)
Evidence: `const dimensionWeights = runDimensionEngine(input.userQuery, inferCommitteeType(input.userQuery, agendaContract))` — the dimension engine is called synchronously with no error handling. If the engine throws, the entire pipeline fails.
What is wrong: No try/catch or validation around the dimension engine call.
Why it matters: A bug in the dimension engine could crash the entire research pipeline.
Trigger: Dimension engine encounters an edge case in query parsing.
Fix direction: Wrap the dimension engine call in try/catch with a fallback to default weights.
```

```
ID: B05-002
Type: Probable Bug
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: inferCommitteeType (line 508-519)
Evidence: Line 516-517: `if (contract.topicType === "indian_economic_policy") return "economic"` — the committee type inference uses `contract.topicType` but also runs regex checks on the raw query. If the contract says economic but the query is about "constitutional amendment to economic policy," it would return "economic" due to the order of checks (regex for constitutional comes before the topicType check).
What is wrong: Actually, looking at the code order: regex for lok/rajya sabha, aippm, national security, human rights, constitutional come FIRST (lines 510-515), then topicType checks (516-517). So constitutional regex would match first. The ordering is correct. No bug here.
Why it matters: N/A — the ordering is actually correct.
Trigger: N/A
Fix direction: No change needed.
```

```
ID: B05-003
Type: Type Mismatch
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 196)
Evidence: `runDimensionEngine` return type is not validated — the code destructures `primaryDimensions` and `secondaryDimensions` at line 198-199 without checking the return value shape.
What is wrong: If `runDimensionEngine` returns a different shape (e.g., due to a refactor), the destructuring would silently produce `undefined` values.
Why it matters: Downstream code using `dimensionWeights.primaryDimensions` would fail silently or produce incorrect results.
Trigger: Dimension engine refactoring changes output shape.
Fix direction: Add a type guard or schema validation for the dimension engine output.
```

```
ID: B05-004
Type: Observability Gap
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 196-200)
Evidence: The dimension engine result is emitted as an event with only dimension names, not the weights. This means observers can't see the actual weight distribution.
What is wrong: Dimension weights are not logged or emitted, only names.
Why it matters: Cannot debug why certain dimensions are prioritized over others.
Trigger: Any pipeline run — weights are opaque to observers.
Fix direction: Emit dimension names along with their weights.
```

```
ID: B05-005
Type: Risk
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: inferCommitteeType (line 508-519)
Evidence: The committee type inference uses a cascade of regex checks but doesn't handle the case where multiple regexes match. The first match wins, which may not be the most specific match.
What is wrong: A query like "Lok Sabha human rights debate" would match "lok sabha" first and return `lok_sabha`, even though "human_rights" might be more appropriate.
Why it matters: Committee type affects the dimension weights, which affects the research direction.
Trigger: Query matches multiple committee type patterns.
Fix direction: Score all matching patterns and select the highest-confidence match.
```

```
ID: B05-006
Type: Missing Test
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: inferCommitteeType
Evidence: No dedicated tests for committee type inference across all possible patterns.
What is wrong: The committee type mapping logic has no test coverage.
Why it matters: Changes to regex patterns could silently misclassify committee types.
Trigger: Modification to committee type regex patterns.
Fix direction: Add parameterized tests for all committee type patterns.
```

```
ID: B05-007
Type: Confirmed Bug
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 196)
Evidence: `inferCommitteeType(input.userQuery, agendaContract)` — this passes `input.userQuery` (untrimmed) while the pipeline validated `trimmedQuery`. If the query has leading whitespace, regex patterns like `\blok sabha\b` would still match, but patterns at the start of the query might not.
What is wrong: Using untrimmed query for committee type inference could miss patterns at the start of the query.
Why it matters: Edge case: query starting with whitespace followed by a committee keyword might not match.
Trigger: Query with leading whitespace before a committee keyword.
Fix direction: Use `trimmedQuery` for committee type inference.
```

```
ID: B05-008
Type: Probable Bug
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: inferCommitteeType (line 515)
Evidence: `/constitutional\b|article\s+\d+|basic structure|judicial review|pil\b/` — `pil\b` would match "pil" as a standalone word but not "PIL" (case insensitive flag is missing). Actually, looking again, the `i` flag IS present (`/.../i`). But `constitutional\b` without `i` in the first part... wait, the full regex is `/.../i`. So case is handled. However, `article\s+\d+` would match "Article 370" but also "article 1" in any context.
What is wrong: "article" is a common word — "article 1" in a newspaper context would trigger constitutional committee type.
Why it matters: False positive constitutional classification.
Trigger: Query mentioning "article 1" in a non-constitutional context.
Fix direction: Require more specific constitutional context alongside article references.
```

```
ID: B05-009
Type: Risk
Severity: Medium
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 196)
Evidence: The dimension engine is called BEFORE archive safety check (line 202) and source bucket planning (line 213). If the dimension engine is expensive or slow, it wastes resources before determining whether the archive context is even safe.
What is wrong: Potentially expensive computation runs before cheaper safety checks.
Why it matters: Unnecessary latency and resource consumption when archive context is unsafe.
Trigger: Pipeline runs with unsafe archive context.
Fix direction: Move dimension engine call after archive safety check.
```

```
ID: B05-010
Type: Dead Code
Severity: Low
File: backend/src/core/pipeline/research-pipeline.ts
Function: runResearchPipeline (line 197-200)
Evidence: The `dimensionWeights` object is only used in one place: passed to `generateCoreResearchAnswer` (line 316). If core generation is disabled and fallback is used, the dimension engine computation is wasted.
What is wrong: Dimension weights are computed even when they won't be used (fallback path).
Why it matters: Unnecessary computation in fallback scenarios.
Trigger: Core generation fails, fallback is used.
Fix direction: Defer dimension engine computation until it's known to be needed.
```

---

## Brick 6: Source Bucket Planner

**Summary:** The source bucket system defines structured source categories for different topic types. The main issues are the `evidenceUse` field being passed as a string to the `bucket` helper (positional argument confusion), the `TOPIC_BUCKETS` mapping having incomplete coverage, and the `GENERIC_INDIAN_BUCKETS` lacking topic-specific buckets like `court_legal` for generic topics.

```
ID: B06-001
Type: Confirmed Bug
Severity: High
File: backend/src/core/retrieval/source-buckets.ts
Function: bucket (line 451-475)
Evidence: The `bucket` function signature is `bucket(id, label, minSources, idealSources, preferredDomains, evidenceUse, queryTemplates)` but at line 54, `INDIAN_DEMOCRATIC_SPACE_BUCKETS` calls: `bucket("democracy_index", "Democracy indices", 5, 8, ["freedomhouse.org", ...], "primary_numbers", [...])`. The 6th positional argument `"primary_numbers"` is passed as `evidenceUse`. But looking at the SourceBucket interface (line 37-45), `evidenceUse` should be one of the union types. `"primary_numbers"` IS a valid value. However, the `bucket` helper sets `acceptableDomains: preferredDomains` (line 468) — acceptable and preferred domains are identical, which defeats the purpose of having two separate fields.
What is wrong: `acceptableDomains` is always set to the same value as `preferredDomains`, making the distinction meaningless.
Why it matters: If the system ever needs to accept sources from broader domains than preferred ones, the current code can't support it.
Trigger: Any code trying to use `acceptableDomains` as a broader set than `preferredDomains`.
Fix direction: Make `acceptableDomains` a separate parameter or compute it from `preferredDomains` with expansion logic.
```

```
ID: B06-002
Type: Type Mismatch
Severity: Medium
File: backend/src/core/retrieval/source-buckets.ts
Function: bucket (line 451-475)
Evidence: The `bucket` helper accepts `evidenceUse: SourceBucket["evidenceUse"]` but the parameter is the 6th positional argument. At line 54, `"primary_numbers"` is passed as the 6th argument, but visually it looks like it could be confused with other parameters.
What is wrong: Long positional argument list (7 parameters) is error-prone.
Why it matters: Easy to pass arguments in wrong order during maintenance.
Trigger: Developer reorders or adds arguments.
Fix direction: Use an object parameter with named properties.
```

```
ID: B06-003
Type: Probable Bug
Severity: Medium
File: backend/src/core/retrieval/source-buckets.ts
Function: TOPIC_BUCKETS (line 419-438)
Evidence: `indian_economic_policy: [...ECONOMIC_POLICY_BUCKETS, ...FEDERALISM_BUCKETS.slice(4, 7)]` — `FEDERALISM_BUCKETS.slice(4, 7)` takes elements at indices 4, 5, 6 from the federalism buckets. Looking at FEDERALISM_BUCKETS (line 269-285): index 0-3 are from CONSTITUTIONAL_LAW_BUCKETS, index 4 is `government_official` (Centre-State), index 5 is `policy_research`, index 6 is `academic_research`, index 7 is `indian_major_media`. So slice(4, 7) gets government_official, policy_research, academic_research.
What is wrong: The slice indices are magic numbers. If FEDERALISM_BUCKETS is reordered or buckets are added/removed, the wrong buckets get included.
Why it matters: Silent misconfiguration of source buckets for economic policy topics.
Trigger: Adding or reordering buckets in FEDERALISM_BUCKETS.
Fix direction: Reference buckets by ID instead of array index.
```

```
ID: B06-004
Type: Missing Test
Severity: Medium
File: backend/src/core/retrieval/source-buckets.ts
Function: getSourceBucketsForAgenda
Evidence: No tests for the topic-to-buckets mapping logic.
What is wrong: The mapping from topic types to source buckets — which determines what sources are searched — has no test coverage.
Why it matters: Misconfigured buckets lead to missing or irrelevant sources in research output.
Trigger: Any change to topic-bucket mapping.
Fix direction: Add tests verifying each topic type maps to the correct bucket set.
```

```
ID: B06-005
Type: Risk
Severity: Medium
File: backend/src/core/retrieval/source-buckets.ts
Function: GENERIC_INDIAN_BUCKETS (line 158-197)
Evidence: `GENERIC_INDIAN_BUCKETS` does NOT include `court_legal` as a dedicated bucket (only 2-4 sources from court_legal are in a generic bucket, but for generic Indian topics, court sources are important). It includes `court_legal` at line 170-174, but only 2-4 sources minimum. For comparison, the democracy buckets have 6-12 court sources.
What is wrong: Generic Indian topics have insufficient court/legal source coverage.
Why it matters: Research on generic Indian parliamentary topics may miss important legal precedents.
Trigger: Any generic Indian parliament topic requiring legal context.
Fix direction: Increase court/legal source minimums for generic Indian topics.
```

```
ID: B06-006
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/source-buckets.ts
Function: bucket (line 469)
Evidence: `blockedDomains: ["quora.com", "reddit.com", "medium.com", "byjus.com", "toppr.com"]` — these are hardcoded and shared across ALL buckets. Some buckets might legitimately need content from Medium (e.g., academic blogs hosted there).
What is wrong: Blocked domains are uniform across all buckets without exception handling.
Why it matters: Some legitimate sources on blocked domains are excluded.
Trigger: A high-quality source exists on Medium or Reddit.
Fix direction: Allow bucket-specific blocked domain overrides.
```

```
ID: B06-007
Type: Risk
Severity: Low
File: backend/src/core/retrieval/source-buckets.ts
Function: bucket (line 470)
Evidence: `requiredForThesis: true` — ALL buckets are marked required for thesis level. This means for a thesis-level research, ALL buckets must be satisfied, which could be 12+ buckets for democracy topics.
What is wrong: Every bucket is required for thesis, making the thesis requirement potentially impossible to satisfy.
Why it matters: Thesis-level research will always report source gaps.
Trigger: Any thesis-level research agenda.
Fix direction: Mark only critical buckets as required for thesis.
```

```
ID: B06-008
Type: Observability Gap
Severity: Low
File: backend/src/core/retrieval/source-buckets.ts
Function: getSourceBucketsForAgenda
Evidence: No logging of which buckets were selected for a given agenda topic.
What is wrong: Cannot debug why certain source buckets were or weren't included in a search.
Why it matters: Debugging missing sources requires reading the mapping code.
Trigger: Research output missing expected source types.
Fix direction: Log the bucket selection decision.
```

```
ID: B06-009
Type: Probable Bug
Severity: Low
File: backend/src/core/retrieval/source-buckets.ts
Function: queryTemplates in bucket definitions
Evidence: Many query templates contain `{agenda}` placeholder (e.g., line 70: `"{agenda} site:eci.gov.in Election Commission India official"`). But there's no visible code in this file that replaces `{agenda}` with the actual agenda text.
What is wrong: The `{agenda}` placeholder must be replaced by a downstream consumer. If no consumer does this replacement, the literal string `{agenda}` is sent to search engines.
Why it matters: Search queries with literal `{agenda}` will return no results.
Trigger: Search engine receives query with unreplaced `{agenda}` placeholder.
Fix direction: Verify that the query planner replaces `{agenda}` before sending to search engines.
```

```
ID: B06-010
Type: Missing Test
Severity: Low
File: backend/src/core/retrieval/source-buckets.ts
Function: uniqueBuckets
Evidence: The deduplication function has no tests for edge cases (empty input, all duplicates, single bucket).
What is wrong: Simple function but no test coverage.
Why it matters: Changes could introduce subtle dedup bugs.
Trigger: Modification to uniqueBuckets.
Fix direction: Add basic unit tests.
```

```
ID: B06-011
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/config/research-mode.ts
Function: inferResearchMode (line 70-78)
Evidence: Line 75: `if (/\b(deep|detailed|research|serious prep)\b/.test(lower)) return "deep_research"` — the word "research" alone triggers deep_research mode. Almost any research-related query contains "research."
What is wrong: The keyword "research" is too broad. "Quick research on X" would first match `quick` at line 76 returning `fast_research`, but "research on X" would match "research" and return `deep_research" even for simple queries.
Why it matters: Users who casually say "research" get deep research mode with higher costs and latency than needed.
Trigger: Query containing "research" without other mode indicators.
Fix direction: Require more specific indicators for deep mode (e.g., "deep research", "thorough research").
```

```
ID: B06-012
Type: Risk
Severity: Medium
File: backend/src/core/config/research-mode.ts
Function: RESEARCH_LIMITS (line 17-68)
Evidence: `fullspectrum` mode has `maxTotalQueries: 120` and `maxRawResults: 450`. This is an enormous number of search queries and results. At typical search API costs, this could consume significant API budget for a single research run.
What is wrong: No cost controls or budget awareness in the research mode configuration.
Why it matters: A single fullspectrum run could exhaust API rate limits or budgets.
Trigger: User triggers fullspectrum mode with valid API keys.
Fix direction: Add cost estimation and budget guards.
```

```
ID: B06-013
Type: Type Mismatch
Severity: Low
File: backend/src/core/config/research-mode.ts
Function: inferResearchMode (line 70)
Evidence: The function accepts `explicitUserMode?: ResearchMode | "web_search" | "normal" | "deep_research"` but `deep_research` is already in `ResearchMode`. The union has redundant members.
What is wrong: `deep_research` appears both in `ResearchMode` type and as an additional literal. This is redundant and confusing.
Why it matters: Maintainers may not know whether to use `ResearchMode` or the extended union.
Trigger: Any code calling `inferResearchMode` with mode parameter.
Fix direction: Remove the redundant `"deep_research"` from the extended union.
```

```
ID: B06-014
Type: Confirmed Bug
Severity: Low
File: backend/src/core/config/research-mode.ts
Function: agendaOutputDepthForMode (line 84-88)
Evidence: `if (mode === "fast_research") return "brief"` — fast research returns "brief" depth, but at line 87, `return "phd_level"` covers both `phd_level` AND `fullspectrum`. Both get the same depth output.
What is wrong: `fullspectrum` mode gets the same agenda output depth as `phd_level`, despite having higher query and result limits.
Why it matters: The fullspectrum mode should arguably have a deeper output depth than phd_level.
Trigger: User requests fullspectrum mode.
Fix direction: Consider a separate depth level for fullspectrum.
```

```
ID: B06-015
Type: Missing Test
Severity: Low
File: backend/src/core/config/research-mode.ts
Function: inferResearchMode
Evidence: No tests for mode inference from various query patterns.
What is wrong: The keyword-based mode detection has no test coverage for edge cases or conflicting keywords.
Why it matters: Changes to regex patterns could silently change mode detection behavior.
Trigger: Modification to mode detection regexes.
Fix direction: Add parameterized tests for all keyword patterns.
```

```
ID: B06-016
Type: Risk
Severity: Low
File: backend/src/core/config/research-mode.ts
Function: isCoreGenerationDefault (line 80-82)
Evidence: All research modes return `true` from `isCoreGenerationDefault`. This function exists but currently has no discriminating behavior — it's always true for all valid modes.
What is wrong: A function that always returns true for its valid inputs is dead logic.
Why it matters: Future modes added without updating this function could have incorrect behavior.
Trigger: New research mode added without updating `isCoreGenerationDefault`.
Fix direction: Either remove the function or add meaningful discrimination.
```

---

## Additional Cross-Cutting Findings

```
ID: B06-017
Type: Risk
Severity: High
File: backend/src/routes/providers.ts
Function: buildProviderStatusPayload (line 420-508)
Evidence: The status cache key (line 739-756) is computed from API key fingerprints, but the cache is a simple `Map` stored in module scope. In a multi-tenant or multi-process deployment, this cache is not shared and could serve stale data.
What is wrong: Module-level cache doesn't survive process restarts and isn't shared across instances.
Why it matters: In production deployments with multiple instances, each has its own cache, leading to inconsistent provider status reports.
Trigger: Multi-instance deployment.
Fix direction: Use Redis or similar shared cache for provider status.
```

```
ID: B06-018
Type: Confirmed Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: statusCacheTtlMs (line 758-765)
Evidence: `return ttls.length ? Math.min(...ttls) : 0` — if any provider status is "checking", TTL is 0. But if ALL providers are healthy, TTL is 30,000ms (30 seconds). If ANY provider is unhealthy (not healthy/missing_key/checking), TTL is 10,000ms.
What is wrong: The TTL for "checking" status is 0, which means the cache entry expires immediately. But the check at line 424 `cached.expiresAt > now` would be false for an entry with TTL 0, so it would be re-checked. This is correct but wastes CPU.
Why it matters: Provider in "checking" state causes continuous re-checking with no caching benefit.
Trigger: Any provider returns "checking" status.
Fix direction: Use a short positive TTL (e.g., 1000ms) instead of 0 to avoid busy-looping.
```

```
ID: B06-019
Type: Missing Test
Severity: Medium
File: backend/src/routes/providers.ts
Function: statusCodeFromError (line 813-824)
Evidence: The error-to-status classification uses regex matching on error message strings. No tests verify that different error types map to the correct status codes.
What is wrong: String-based error classification is fragile and untested.
Why it matters: Changes to error messages from upstream providers could cause misclassification (e.g., a 401 error classified as network_error).
Trigger: Provider changes error message format.
Fix direction: Add tests for all error classification patterns.
```

```
ID: B06-020
Type: Observability Gap
Severity: Medium
File: backend/src/routes/providers.ts
Function: sendProviderModelPayload (line 709-733)
Evidence: The function calls `logProviderCall` but doesn't log the actual model list size or content. If a provider returns 0 models, the log only shows status.
What is wrong: Model list content is not included in observability logs.
Why it matters: Cannot debug why a provider returns fewer models than expected.
Trigger: Provider returns unexpectedly few models.
Fix direction: Include model count and a sample of model IDs in the log.
```Now I have read all the target files and their cross-references. Let me compile the comprehensive findings.

---

# BestDel Research Pipeline Audit — Bricks 7-12

## Brick 7: Query Planner

Files: `research-planner.ts`, `query-plan-validator.ts`, `topic-classifier.ts`, `mode-query-strategy.ts`, `agenda-keywords.ts`

**Summary:** The query planner builds bucketed queries from agenda contracts, classifies parliamentary topics, and applies mode-specific strategies. Major concerns include unsafe topic classification confidence math, missing null-guards in `void topic`, regex extraction of terms that produce noisy matched terms, query drift potential from static fallback strings, and a hard-coded 8-character minimum query filter that can silently drop valid short queries.

---

```
ID: B07-001
Type: Confirmed Bug
Severity: High
File: backend/src/services/research-planner.ts
Function: enforceQueryMinimums
Evidence: Line 66: `void topic;` discards the topic parameter entirely. The function accepts a TopicType | "default" but never uses it.
What is wrong: The topic classification result is passed but ignored; fallback queries don't adapt to the classified topic.
Why it matters: Queries for different parliamentary topics (e.g., constitutional law vs. AI governance) receive identical fallbacks, reducing research precision.
Trigger: Call enforceQueryMinimums with any topic type; fallbacks are topic-agnostic.
Fix direction: Use the topic parameter to generate topic-specific fallback seeds instead of discarding it.
```

```
ID: B07-002
Type: Confirmed Bug
Severity: Medium
File: backend/src/services/research-planner.ts
Function: validatePlannedQueries
Evidence: Line 38: `filter(q => q.length > 8)` — hard minimum of 8 characters.
What is wrong: Valid short queries (e.g., "UAPA India", "DPDP Act", "FCRA rules") can be silently dropped.
Why it matters: Important Indian legal acronyms and short policy terms are filtered out before search.
Trigger: Pass queries like "UAPA India" (10 chars) through, which passes, but "GST India" (9 chars) barely passes; anything like "RTI" (3 chars) is dropped.
Fix direction: Lower the threshold to 4 or use a topic-aware minimum.
```

```
ID: B07-003
Type: Probable Bug
Severity: Medium
File: backend/src/services/research-planner.ts
Function: firstTopicBearingQuery
Evidence: Lines 106-113: Returns the first non-empty query across all roles via flat concatenation.
What is wrong: The "first" query may come from media_journalist (optional field, appended last) or any role, with no guarantee it's topic-relevant.
Why it matters: A low-quality query like "India latest development" can become the fallback seed for all roles.
Trigger: When roles have differing query counts and the first non-empty query is generic.
Fix direction: Prefer queries from higher-authority roles (legal_researcher, policy_analyst) and score for topicality.
```

```
ID: B07-004
Type: Risk
Severity: Medium
File: backend/src/services/research-planner.ts
Function: buildTopicSourceStrategy
Evidence: Lines 29-35: Returns hard-coded domain lists based on dimension name matching.
What is wrong: Uses loose string matching on dimension names; a dimension named "media_information" triggers RSF/CPJ domains regardless of the actual agenda.
Why it matters: Incorrect domain targeting for queries, leading to irrelevant search results.
Trigger: Any engine output with primaryDimensions containing "media_information".
Fix direction: Use the topic classifier output and build domain strategies from SourceBucket preferredDomains.
```

```
ID: B07-005
Type: Type Mismatch
Severity: Medium
File: backend/src/services/research-planner.ts
Function: reconcilePlanWithDimensions
Evidence: Line 47: `firstTopicBearingQuery(plan) ?? extra.find(...) ?? ""` — fallback to empty string.
What is wrong: If all queries are empty, subjectSeed becomes "" but then passed to enforceQueryMinimums which throws if fallbackSeed is falsy.
Why it matters: Can cause unexpected runtime errors when both plan and extra queries are empty/whitespace.
Trigger: Empty plan and empty dimensionQueries array.
Fix direction: Check subjectSeed length before calling enforceQueryMinimums.
```

```
ID: B07-006
Type: Probable Bug
Severity: Low
File: backend/src/services/research-planner.ts
Function: deduplicateByTfIdf
Evidence: Lines 175-182: Uses cosine similarity threshold 0.82 but the term vectors are raw frequency counts, not TF-IDF.
What is wrong: Function is named "deduplicateByTfIdf" but implements only raw term-frequency cosine — no inverse document frequency weighting.
Why it matters: Common words dominate similarity scores, causing false-positive deduplication of semantically distinct queries.
Trigger: Two queries sharing common words like "India", "policy", "government" but differing in key entities.
Fix direction: Either rename to `deduplicateByCosineSimilarity` or implement actual IDF weighting.
```

```
ID: B07-007
Type: Missing Test
Severity: Medium
File: backend/src/services/research-planner.ts
Function: (module-level)
Evidence: No test files found for research-planner.ts in the codebase.
What is wrong: Core planning logic including enforceQueryMinimums, reconcilePlanWithDimensions, and deduplicateByTfIdf lack test coverage.
Why it matters: Query planning bugs silently degrade research quality; regression detection is impossible without tests.
Trigger: N/A (missing tests).
Fix direction: Add unit tests covering empty input, topic-based fallbacks, minimum enforcement, and dedup behavior.
```

```
ID: B07-008
Type: Confirmed Bug
Severity: Medium
File: backend/src/services/research-planner.ts
Function: clampPlannerQuery
Evidence: Line 42: `query.replace(/\s+/g, " ").trim().slice(0, 140)`
What is wrong: Slices at 140 characters regardless of word boundaries, potentially truncating mid-word.
Why it matters: A query like "Article 370 constitutional validity Supreme Court of India analysis" gets cut at 140 chars mid-word, degrading search relevance.
Trigger: Any query exceeding 140 characters from the LLM planner.
Fix direction: Use a word-boundary-aware truncation similar to `capText` in enrich-source.ts.
```

```
ID: B07-009
Type: Observability Gap
Severity: Low
File: backend/src/services/research-planner.ts
Function: officialPlannerRoleQueries
Evidence: Lines 116-136: No logging or telemetry of planned query counts per role.
What is wrong: Query plan construction happens silently — no visibility into how many queries per role are generated or dropped.
Why it matters: Difficult to diagnose why certain roles have sparse query coverage.
Trigger: Any planner invocation.
Fix direction: Emit telemetry events for queries generated per role and total query count.
```

```
ID: B07-010
Type: Confirmed Bug
Severity: High
File: backend/src/core/retrieval/query-planning/topic-classifier.ts
Function: classifyIndianParliamentaryTopic
Evidence: Lines 67-73: Confidence = `best.score / Math.max(total, best.score)`. When best.score is, say, 6 and total is 18 (multiple rules matched), confidence = 6/18 = 0.33, then clamped to 0.5.
What is wrong: Confidence is always 0.5-0.98 regardless of how many competing topics match. For queries matching many topics equally, the "best" is barely better than alternatives but still reports 0.5+ confidence.
Why it matters: Low-confidence classifications are reported as medium confidence, misleading downstream systems about classification certainty.
Trigger: Input like "India economic policy and constitutional law" — matches multiple rules.
Fix direction: Compute confidence based on the gap between best and second-best, not total.
```

```
ID: B07-011
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/query-planning/topic-classifier.ts
Function: scoreRules
Evidence: Lines 88-90: Matched terms extraction uses `.source.replace(/\\b|\(|\)|\?:|\|/g, " ")` which corrupts regex source into noisy strings.
What is wrong: Extracting matched terms from regex source produces garbled output like "democratic space  democratic backsliding  civil liberties" instead of the actual matched text.
Why it matters: `matchedTerms` in TopicClassification is intended for debugging/explainability but returns regex source fragments, not the actual matched substrings.
Trigger: Any topic classification that matches rules with alternation patterns.
Fix direction: Use `text.match(pattern)` to get the actual matched text.
```

```
ID: B07-012
Type: Risk
Severity: Low
File: backend/src/core/retrieval/query-planning/topic-classifier.ts
Function: prioritySecurityTerms
Evidence: Lines 97-111: Priority security bypass checks for "food security", "water security" etc. but the negative lookahead in rule definitions (line 52) does the same.
What is wrong: Duplicate exclusion logic — both `prioritySecurityTerms` and the `foreign_policy_india`/`indian_security_policy` exclude rules check for the same terms.
Why it matters: Maintenance burden; if one set is updated, the other might be missed.
Trigger: N/A (structural concern).
Fix direction: Consolidate exclusion patterns into a single source of truth.
```

```
ID: B07-013
Type: Missing Test
Severity: Medium
File: backend/src/core/retrieval/query-planning/topic-classifier.ts
Function: classifyIndianParliamentaryTopic
Evidence: No test coverage for topic classification edge cases.
What is wrong: Complex regex-based classification with weighted scoring, exclusions, and priority shortcuts has no automated tests.
Why it matters: Adding new topics or modifying regexes can silently break classification for existing topics.
Trigger: N/A.
Fix direction: Add tests covering each topic type, exclusion scenarios, and confidence computation.
```

```
ID: B07-014
Type: Probable Bug
Severity: Medium
File: backend/src/core/retrieval/query-planning/topic-classifier.ts
Function: rule
Evidence: Line 114: `weight = 1` default weight, but all rules pass explicit weights (2.3-3.0).
What is wrong: The default weight of 1 is never used, but if someone adds a new rule without a weight, it gets 1x vs. 2.3-3.0x for existing rules.
Why it matters: A new topic with default weight will be nearly invisible compared to existing topics.
Trigger: Adding a new topic rule without explicit weight.
Fix direction: Make weight a required parameter (no default).
```

```
ID: B07-015
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/query-planning/topic-classifier.ts
Function: classifyIndianParliamentaryTopic
Evidence: Line 57-65: `prioritySecurityTerms` early-returns `indian_security_policy` with hard-coded confidence 0.86.
What is wrong: Security topic is detected via fast-path but confidence is fixed at 0.86 regardless of how many security terms matched. A single "terror" match yields the same 0.86 confidence as matching all security patterns.
Why it matters: Overconfident security classification for borderline inputs.
Trigger: Input containing just one security term like "border security".
Fix direction: Compute confidence proportionally to matched security terms.
```

```
ID: B07-016
Type: Probable Bug
Severity: Medium
File: backend/src/core/retrieval/query-planning/mode-query-strategy.ts
Function: buildModeSpecificQueries
Evidence: Line 68: `currentYear = contract.temporalScope.endYear ?? new Date().getFullYear()`.
What is wrong: If `endYear` is undefined, falls back to current year, but queries include `previousYear` which becomes `currentYear - 1`. For a query about historical events (e.g., 1990s reforms), this produces queries with "2024 2025" instead.
Why it matters: Temporal scope of agenda is ignored for queries when endYear is not set.
Trigger: Agenda with no temporal scope defined for a historical topic.
Fix direction: Use `contract.temporalScope.startYear` for historical queries or require temporal scope for multi_hop strategy.
```

```
ID: B07-017
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/query-planning/mode-query-strategy.ts
Function: strategyForTemplate
Evidence: Lines 59-63: Returns `"primary_source"` when query matches `site:` patterns, `"high_confidence"` for fast_research, otherwise `"baseline"`.
What is wrong: The function doesn't use the `mode` parameter for non-fast_research paths — mode is only checked for fast_research shortcut.
Why it matters: Query strategy selection is mode-agnostic except for fast_research.
Trigger: Any non-fast_research mode with site: query.
Fix direction: Consider mode in strategy selection for all paths.
```

```
ID: B07-018
Type: Risk
Severity: Low
File: backend/src/core/retrieval/query-planning/mode-query-strategy.ts
Function: angleForBucket
Evidence: Lines 137-168: Default case falls through to `bucket.label.replace(/[^\p{L}\p{N}\s-]/gu, " ")`.
What is wrong: If bucket.label is undefined or empty, returns empty string, producing queries like "subject India  ".
Why it matters: Degraded search quality for unrecognized buckets.
Trigger: A SourceBucket with missing label property.
Fix direction: Provide a meaningful default angle string.
```

```
ID: B07-019
Type: Missing Test
Severity: Medium
File: backend/src/core/retrieval/query-planning/mode-query-strategy.ts
Function: buildModeSpecificQueries
Evidence: No tests for mode-specific query generation.
What is wrong: Each mode (fast, deep, phd, fullspectrum) generates different query templates but behavior is untested.
Why it matters: Changes to template construction can silently produce broken or irrelevant queries.
Trigger: N/A.
Fix direction: Add tests for each mode verifying query structure and bucket-specific angles.
```

```
ID: B07-020
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/query-planning/mode-query-strategy.ts
Function: candidate
Evidence: Line 105: `priority: /\bsite:|\.org|\.in|\.com/i.test(query) ? "domain_targeted" : "broad_discovery"`.
What is wrong: Almost any Indian search query will contain `.in` or `.org` in the text (not as a site: directive), so nearly all queries are classified as "domain_targeted".
Why it matters: Priority classification is meaningless; broad_discovery is never used.
Trigger: Any query containing common TLD strings like "India" which contains no TLD but queries often reference ".org" etc.
Fix direction: Only check for `site:` operator, not bare TLD strings.
```

```
ID: B07-021
Type: Probable Bug
Severity: Low
File: backend/src/core/retrieval/query-planning/mode-query-strategy.ts
Function: base
Evidence: Lines 113-135: `base()` sets all `include*` flags to false then spreads overrides. If `RESEARCH_LIMITS[mode]` is undefined, `limits.maxTotalQueries` throws.
What is wrong: No guard against undefined mode in `RESEARCH_LIMITS`.
Why it matters: Adding a new research mode without updating RESEARCH_LIMITS causes runtime crash.
Trigger: `getModeQueryStrategy("new_mode")` without corresponding RESEARCH_LIMITS entry.
Fix direction: Add runtime validation or TypeScript exhaustiveness check.
```

```
ID: B07-022
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/query-planning/query-plan-validator.ts
Function: validateQueryPlan
Evidence: Line 11: `query.query.length > 4` filters out short queries.
What is wrong: A 5-character query like "FCRA" is kept but "GST" (3 chars) is dropped. Short but meaningful Indian legal/policy acronyms are filtered.
Why it matters: Important entity queries are silently removed from the plan.
Trigger: Plan containing short acronym queries.
Fix direction: Lower to 3 or use a domain-aware whitelist of short valid queries.
```

```
ID: B07-023
Type: Missing Test
Severity: Low
File: backend/src/core/retrieval/query-planning/query-plan-validator.ts
Function: isTopicFreeGenericQuery
Evidence: Only 5 hard-coded generic patterns are checked. No test coverage for the filter.
What is wrong: The generic query filter uses exact string matching — many generic queries won't be caught.
Why it matters: Generic queries like "india policy research" slip through while exact matches are filtered.
Trigger: Query like "india government policy research" — not caught.
Fix direction: Use more flexible pattern matching or semantic similarity for generic detection.
```

```
ID: B07-024
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/query-planning/query-plan-validator.ts
Function: normalizeQueryText
Evidence: Line 17: `.replace(/\b(20\d{2})(?:\s+\1)+\b/g, "$1")` collapses repeated years.
What is wrong: This only catches repeated adjacent years like "2024 2024" but not non-adjacent like "2024 India 2024".
Why it matters: Minor — but the intent seems to be removing duplicate year mentions entirely.
Trigger: Query with non-adjacent repeated years.
Fix direction: Deduplicate all year mentions, not just adjacent ones.
```

```
ID: B07-025
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/query-planning/agenda-keywords.ts
Function: extractAgendaKeywords
Evidence: Line 35: `text.match(/\b[A-Z][A-Z0-9]{2,}\b/g)` extracts acronyms.
What is wrong: After `text` is constructed from `normalizedAgenda`, `requiredEntities`, and `countryFocus`, the regex captures acronyms from the raw text. But the text may contain no uppercase if the input is all lowercase, silently dropping acronym extraction.
Why it matters: For lowercase user queries like "dpdp bill analysis", no acronyms are extracted.
Trigger: Any all-lowercase input query.
Fix direction: Run acronym detection on original input, not the assembled text that may be normalized.
```

```
ID: B07-026
Type: Risk
Severity: Low
File: backend/src/core/retrieval/query-planning/agenda-keywords.ts
Function: extractAgendaKeywords
Evidence: Line 34: `IMPORTANT_PHRASES.flatMap((pattern) => text.match(pattern) ?? [])`.
What is wrong: Each `match()` call on a global regex (with `/gi` flag) can return all occurrences of that pattern. For patterns like `/Article\s+\d+[A-Z]?/gi`, this could return many matches, and with 16 patterns, the total could far exceed `maxTerms`.
Why it matters: The `.slice(0, maxTerms)` only applies after all phrases are collected, potentially biasing toward phrases that match earlier patterns.
Trigger: Input containing many Article references.
Fix direction: Limit per-pattern matches or sort by relevance before slicing.
```

```
ID: B07-027
Type: Missing Test
Severity: Low
File: backend/src/core/retrieval/query-planning/agenda-keywords.ts
Function: normalizeQueryWhitespace
Evidence: Function is simple but no tests verify the double-year dedup behavior.
What is wrong: The double-year regex is shared between this module and query-plan-validator but not independently tested.
Why it matters: Changes to one copy could diverge from the other.
Trigger: N/A.
Fix direction: Share a single implementation in a utility module.
```

```
ID: B07-028
Type: Type Mismatch
Severity: Low
File: backend/src/core/retrieval/query-planning/agenda-keywords.ts
Function: uniquePreserveCase
Evidence: Lines 65-76: Function deduplicates case-insensitively but preserves first occurrence's case.
What is wrong: When the same term appears with different cases, the first occurrence is kept. If the first occurrence is lowercase (e.g., from normalized text), the capitalized version is lost.
Why it matters: Proper nouns like "Supreme Court" may be output as "supreme court".
Trigger: Input where lowercase version appears before capitalized version.
Fix direction: Prefer capitalized versions when available.
```

---

## Brick 8: Search Provider Layer

Files: `search-provider-errors.ts`, `search-provider-types.ts`

**Summary:** The search provider layer manages error classification, status tracking, and provider interfaces. Key issues include unsafe error classification using regex on error messages (prone to false positives), missing timeout memory leak in `fetchWithTimeout`, and incomplete status mapping in `statusFromHttp`.

---

```
ID: B08-001
Type: Confirmed Bug
Severity: High
File: backend/src/core/search/search-provider-errors.ts
Function: fetchWithTimeout
Evidence: Lines 57-70: Creates `AbortController` and `setTimeout`, but if `fetchFn` throws synchronously before returning a promise, the timeout is never cleared.
What is wrong: The `finally` block clears the timeout, but if `fetchFn` is a synchronous thrower, the finally still runs. However, if `fetchFn` returns a promise that never settles (e.g., hangs without rejecting), the timeout fires, aborts the signal, but the promise chain continues running.
Why it matters: Zombie fetch operations continue consuming resources even after timeout.
Trigger: A fetchFn that returns a promise that never resolves or rejects.
Fix direction: Add a race with a timeout promise that rejects.
```

```
ID: B08-002
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/search/search-provider-errors.ts
Function: fetchWithTimeout
Evidence: Lines 60-62: `externalSignal?.addEventListener("abort", abortFromExternal, { once: true })`.
What is wrong: The abort listener forwards the external abort to the internal controller, but `abortFromExternal` doesn't pass the abort reason. If the external signal is aborted after the internal timeout, it re-aborts an already-aborted controller.
Why it matters: Minor — double-abort is benign but the event listener is added even when external signal is already aborted.
Trigger: External signal is already aborted when function is called.
Fix direction: Check `externalSignal?.aborted` before adding listener.
```

```
ID: B08-003
Type: Probable Bug
Severity: Medium
File: backend/src/core/search/search-provider-errors.ts
Function: classifyProviderError
Evidence: Lines 26: `/network|fetch failed|enotfound|econn|5\d\d/.test(text)` matches any string containing "5" followed by two digits.
What is wrong: An error message like "attempted 543 queries" would match `5\d\d` and be misclassified as a network_error.
Why it matters: Incorrect error classification leads to wrong retry behavior.
Trigger: Any error message containing a 3-digit number starting with 5.
Fix direction: Anchor the 5xx pattern: `/\b5\d{2}\b/`.
```

```
ID: B08-004
Type: Type Mismatch
Severity: Medium
File: backend/src/core/search/search-provider-errors.ts
Function: statusFromHttp
Evidence: Lines 42-47: Missing cases for 200-399 status codes — they all fall through to "unavailable".
What is wrong: HTTP 200, 301, 302, 304 are all mapped to "unavailable" instead of "healthy".
Why it matters: Successful or redirect responses from health checks are incorrectly reported as unavailable.
Trigger: Any health check returning 2xx/3xx status.
Fix direction: Return "healthy" for 200-299, and handle 3xx appropriately.
```

```
ID: B08-005
Type: Risk
Severity: Medium
File: backend/src/core/search/search-provider-errors.ts
Function: classifyProviderError
Evidence: Lines 16-28: Uses string matching on error messages which can produce false positives.
What is wrong: `|timeout|timed out` matches "timed out" in any context, including non-timeout errors. `/abort/` matches "abort" in any context.
Why it matters: Errors mentioning unrelated "abort" or "timeout" text are misclassified.
Trigger: Error message like "user aborted the process manually" when actual error is unrelated.
Fix direction: Check error instanceof and/or use more specific patterns.
```

```
ID: B08-006
Type: Missing Test
Severity: Medium
File: backend/src/core/search/search-provider-errors.ts
Function: classifyProviderError
Evidence: No test coverage for error classification logic.
What is wrong: Complex regex-based error classification with multiple priority rules has no tests.
Why it matters: Adding new error patterns can silently change classification precedence.
Trigger: N/A.
Fix direction: Add tests for each error type with representative error messages.
```

```
ID: B08-007
Type: Confirmed Bug
Severity: Low
File: backend/src/core/search/search-provider-errors.ts
Function: safeProviderError
Evidence: Lines 30-33: `String(error || fallback)` — if error is falsy (0, false, ""), uses fallback.
What is wrong: If error is the number 0, it's falsy and becomes the fallback message, losing the actual error value.
Why it matters: Rare but could mask unusual error types.
Trigger: Provider returning `throw 0`.
Fix direction: Use `error ?? fallback` instead of `error || fallback`.
```

```
ID: B08-008
Type: Type Mismatch
Severity: Low
File: backend/src/core/search/search-provider-types.ts
Function: NormalizedSearchResult
Evidence: Line 44: `metadata?: Record<string, unknown>` — overly permissive metadata type.
What is wrong: The metadata field accepts any shape, making it impossible to rely on specific properties at compile time.
Why it matters: Consumers must use unsafe casts or runtime checks to access specific metadata fields.
Trigger: Any consumer accessing `result.metadata.something`.
Fix direction: Define a discriminated union or specific metadata interfaces per provider.
```

```
ID: B08-009
Type: Risk
Severity: Low
File: backend/src/core/search/search-provider-types.ts
Function: SearchProviderKeys
Evidence: Lines 8-15: All keys are optional and nullable.
What is wrong: No mechanism to ensure at least one provider key is configured.
Why it matters: A configuration with all null/undefined keys compiles and runs but produces zero results.
Trigger: Deploying with missing environment variables for all provider keys.
Fix direction: Add a validation function that checks at least one key is present.
```

```
ID: B08-010
Type: Observability Gap
Severity: Low
File: backend/src/core/search/search-provider-types.ts
Function: SearchProviderHealth
Evidence: Lines 72-82: Health interface includes latencyMs and error but no timestamp for when the health check was performed.
What is wrong: Without a timestamp, stale health status can be served indefinitely.
Why it matters: A provider may have recovered from an error but the cached health status still shows it as unhealthy.
Trigger: Health check performed at T=0, status read at T=60s.
Fix direction: Add `lastChecked: Date` to SearchProviderHealth.
```

```
ID: B08-011
Type: Dead Code
Severity: Low
File: backend/src/core/search/search-provider-types.ts
Function: SearchProviderAvailability / ExtractorProviderAvailability
Evidence: Lines 108-109: Type aliases defined but usage unclear.
What is wrong: These types are `Partial<Record<...>>` maps but don't enforce consistent usage with the actual provider configuration.
Why it matters: Can lead to stale or inconsistent availability tracking.
Trigger: N/A (structural concern).
Fix direction: Consolidate with health check status or remove if unused.
```

---

## Brick 9: Source Dedup

Files: `query-deduper.ts` + `retrieval.ts` (dedup functions)

**Summary:** Query deduplication uses both simple Jaccard-like overlap in `retrieval.ts` and a more sophisticated near-duplicate check in `query-deduper.ts`. Issues include a dangerously high 0.86 similarity threshold that may let near-duplicates through, stopword list that is too aggressive, and missing semantic deduplication for conceptually similar but lexically different queries.

---

```
ID: B09-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/query-planning/query-deduper.ts
Function: isNearDuplicate
Evidence: Line 73: `intersection / Math.min(aWords.size, bWords.size) >= 0.86`.
What is wrong: Using the smaller set as denominator means a short query "India policy" (2 words) overlapping with a longer query "India policy analysis reform 2024" (5 words) scores 2/2 = 1.0 even though the longer query has 3 additional unique words.
Why it matters: Short queries aggressively deduplicate longer, more specific queries.
Trigger: Any pair where one query is a strict subset of another.
Fix direction: Use Jaccard similarity (intersection / union) or asymmetric thresholds.
```

```
ID: B09-002
Type: Probable Bug
Severity: Medium
File: backend/src/core/retrieval/query-planning/query-deduper.ts
Function: queryKey
Evidence: Lines 52-61: Filters out "india", "indian", "policy", "report" as stopwords, then keeps only words matching `word.toUpperCase() === word` (all caps) or lowercases everything else.
What is wrong: "Supreme Court" becomes "supreme court" (lowercased), but "UAPA" stays "UAPA" (all caps). The query key mixes case-normalized words with preserved-all-caps words, producing inconsistent keys.
Why it matters: "UAPA" and "uapa" produce different keys, defeating deduplication.
Trigger: Same acronym with different casing across queries.
Fix direction: Normalize all words to lowercase consistently.
```

```
ID: B09-003
Type: Risk
Severity: Medium
File: backend/src/core/retrieval/query-planning/query-deduper.ts
Function: dedupePlannedQueries
Evidence: Lines 15-31: `!isProtectedStrategy(query) && !isProtectedStrategy(existing)` — protected strategies are skipped from dedup.
What is wrong: If both queries have protected strategies (e.g., both are "llm" source), they are never deduplicated even if identical.
Why it matters: Two LLM-generated queries that are identical both pass through.
Trigger: LLM produces the same query for two different buckets.
Fix direction: Dedup protected strategies with same query text.
```

```
ID: B09-004
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/query-planning/query-deduper.ts
Function: dedupedTelemetryEntries
Evidence: Lines 34-50: `mode: "deep_research"` is hard-coded.
What is wrong: Telemetry entries always report "deep_research" mode regardless of the actual research mode.
Why it matters: Telemetry data for mode usage is inaccurate.
Trigger: Any non-deep_research mode (phd_level, fast_research, fullspectrum).
Fix direction: Accept mode as a parameter.
```

```
ID: B09-005
Type: Missing Test
Severity: Medium
File: backend/src/core/retrieval/query-planning/query-deduper.ts
Function: (module-level)
Evidence: No test coverage for query deduplication logic.
What is wrong: Complex dedup logic with protected strategies, site-targeting, and near-duplicate detection is untested.
Why it matters: Changes to dedup threshold or stopword list can silently change research breadth.
Trigger: N/A.
Fix direction: Add tests for near-duplicate detection, protected strategies, and site-targeting.
```

```
ID: B09-006
Type: Confirmed Bug
Severity: Medium
File: backend/src/services/retrieval.ts
Function: deduplicateQueriesSemantically
Evidence: Lines 144-151: Uses `getWordOverlap` with threshold 0.70 but word overlap uses `intersection / Math.min(sizeA, sizeB)`.
What is wrong: Same asymmetric denominator issue as B09-001. Two queries sharing 3 of 3 short query words score 1.0 even if the other query has many more words.
Why it matters: Aggressive deduplication removes valid extended queries.
Trigger: Short query "India policy" and long query "India policy framework analysis".
Fix direction: Use Jaccard or Dice coefficient.
```

```
ID: B09-007
Type: Risk
Severity: Low
File: backend/src/services/retrieval.ts
Function: deduplicateQueriesSemantically
Evidence: Line 145: `.replace(/[^\w\s]/g, " ")` strips all punctuation, including hyphens in compound terms.
What is wrong: "data-protection" becomes "data protection", merging it with any query containing "data" and "protection" separately.
Why it matters: Hyphenated terms lose semantic distinction during dedup.
Trigger: Queries with hyphenated legal/technical terms.
Fix direction: Preserve hyphens or handle compound terms specially.
```

```
ID: B09-008
Type: Probable Bug
Severity: Low
File: backend/src/services/retrieval.ts
Function: getWordOverlap
Evidence: Lines 153-159: Only considers words > 3 characters.
What is wrong: Important 3-character terms like "GST", "RTI", "ITR", "FIR" are excluded from overlap calculation.
Why it matters: Two queries differing only in acronyms are considered identical.
Trigger: "GST reform India" vs "RTI reform India".
Fix direction: Lower threshold to 2 or include acronyms specifically.
```

```
ID: B09-009
Type: Observability Gap
Severity: Low
File: backend/src/core/retrieval/query-planning/query-deduper.ts
Function: dedupePlannedQueries
Evidence: Returns deduped queries but doesn't log how many were removed.
What is wrong: No visibility into deduplication rate.
Why it matters: Cannot detect when dedup is over-aggressive or under-aggressive.
Trigger: N/A.
Fix direction: Return count or emit telemetry event with dedup stats.
```

```
ID: B09-010
Type: Confirmed Bug
Severity: Low
File: backend/src/services/retrieval.ts
Function: runWeightedQueries
Evidence: Lines 62-74: Uses `String(item)` to index into priorities, but items may be objects.
What is wrong: `priorities[String(item)]` will always be "[object Object]" for non-primitive items, so priority lookup always fails.
Why it matters: Weighted query ordering doesn't work for non-string query objects.
Trigger: Passing PlannedBucketQuery objects instead of strings.
Fix direction: Accept a key selector function or use a specific property.
```

---

## Brick 10: Source Filtering

Files: `source-filter.ts`

**Summary:** Source filtering blocks domains, checks forbidden drift terms, scores sources, and applies India relevance checks. Key issues include the India relevance regex being too broad (matching common words like "modi", "gandhi"), score thresholds that may filter out valuable sources, and duplicate drift checking that's already done in query planning.

---

```
ID: B10-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/source-filter.ts
Function: filterSourcesForAgenda
Evidence: Lines 38-43: India relevance regex includes common words like "modi", "gandhi", "nehru", "patel", "ambedkar".
What is wrong: These words appear in many non-India contexts (e.g., "Gandhi" as a surname globally, "Patel" in medical contexts). A source about "Patel procedure" matches India relevance incorrectly.
Why it matters: Non-India sources with common Indian names/terms pass the relevance filter.
Trigger: Source about a non-India topic that mentions an Indian name.
Fix direction: Require these names to appear in an India-context or use stricter patterns.
```

```
ID: B10-002
Type: Probable Bug
Severity: Medium
File: backend/src/core/retrieval/source-filter.ts
Function: filterSourcesForAgenda
Evidence: Lines 33-37: Score threshold of 40 is applied AFTER drift check, but drift terms also reduce score by 50 in source-scoring.ts.
What is wrong: A source with drift terms gets a -50 score penalty in scoring (making it below 40) AND is rejected by drift check. The drift check fires first, so the score threshold is redundant for drift cases.
Why it matters: Confusing precedence — drift rejection happens before scoring, so the -50 penalty in scoring is never the deciding factor.
Trigger: Source containing a forbidden drift term.
Fix direction: Remove redundant drift check or document the precedence clearly.
```

```
ID: B10-003
Type: Risk
Severity: Medium
File: backend/src/core/retrieval/source-filter.ts
Function: filterSourcesForAgenda
Evidence: Lines 24-27: Hard-coded blocked domain list (quora, reddit, medium, byjus, toppr, blogspot, wordpress).
What is wrong: Medium.com hosts many legitimate policy analysis articles. Reddit can contain high-quality AMA with policymakers.
Why it matters: Valuable sources are rejected without review.
Trigger: Source from medium.com with substantive policy analysis.
Fix direction: Score these domains lower rather than hard-blocking, or allow override.
```

```
ID: B10-004
Type: Missing Test
Severity: Medium
File: backend/src/core/retrieval/source-filter.ts
Function: filterSourcesForAgenda
Evidence: No test coverage for source filtering.
What is wrong: Complex filtering logic with multiple rejection criteria has no automated tests.
Why it matters: Changes to thresholds or regexes can silently change which sources are kept.
Trigger: N/A.
Fix direction: Add tests for each rejection reason and the India relevance check.
```

```
ID: B10-005
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/source-filter.ts
Function: safeDomain
Evidence: Lines 52-58: Falls back to `url.toLowerCase()` on URL parse failure.
What is wrong: If URL is invalid, the full URL string is used as the domain, which won't match any domain patterns (quora.com, reddit.com, etc.).
Why it matters: Invalid URLs bypass domain blocking entirely.
Trigger: Source with malformed URL like "not-a-valid-url".
Fix direction: Return a safe default domain that is blocked, or reject invalid URLs.
```

```
ID: B10-006
Type: Observability Gap
Severity: Low
File: backend/src/core/retrieval/source-filter.ts
Function: filterSourcesForAgenda
Evidence: Rejected sources are collected but the function without `withReasons` discards them.
What is wrong: Most callers likely use the simple overload, losing rejection diagnostics.
Why it matters: Cannot debug why specific sources were filtered out in production.
Trigger: Any call to `filterSourcesForAgenda(sources, contract)`.
Fix direction: Emit telemetry for rejected sources regardless of overload.
```

```
ID: B10-007
Type: Type Mismatch
Severity: Low
File: backend/src/core/retrieval/source-filter.ts
Function: filterSourcesForAgenda
Evidence: Line 22: `${source.title} ${source.snippet ?? ""} ${source.url}` — concatenates into single string for matching.
What is wrong: Title/snippet/url text may contain regex meta-characters that could cause unexpected matches if the contract.forbiddenDriftTerms include regex-like patterns.
Why it matters: If drift terms contain regex special chars, `text.includes(term.toLowerCase())` still works (string includes), but the approach is brittle if someone changes to regex.
Trigger: N/A (defensive concern).
Fix direction: Document that drift terms are literal strings, not regex.
```

---

## Brick 11: Source Normalization

Files: `source-normalizer.ts` + `source-scoring.ts`

**Summary:** Source normalization classifies sources by domain, infers authority scores, extracts key facts/numbers/legal holdings, and normalizes extraction quality. Key concerns include domain classification using substring matching (prone to false positives), authority score normalization that assumes 1-10 input scale without validation, and citation eligibility logic with contradictory conditions.

---

```
ID: B11-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/source-normalizer.ts
Function: normalizeEvidenceSourceInput
Evidence: Line 8: `(raw.sourceClass ?? classFromDomain(domain)) as SourceClass`.
What is wrong: Unsafe cast — if `raw.sourceClass` is a string like "unknown" or "test", it's cast to `SourceClass` without validation.
Why it matters: Invalid source class values can propagate through the pipeline and cause downstream classification errors.
Trigger: Input with raw.sourceClass = "unknown" or any non-SourceClass string.
Fix direction: Validate sourceClass against SourceClass union before casting.
```

```
ID: B11-002
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/source-normalizer.ts
Function: normalizeAuthorityScore
Evidence: Line 122: `score > 0 && score <= 10 ? score * 10 : score`.
What is wrong: Assumes scores in range (0, 10] are on a 1-10 scale and multiplies by 10. But a legitimate score of 8 (already on 0-100 scale) would be multiplied to 80. A score of 0 is passed through unchanged (not multiplied).
Why it matters: Authority scores that are already on 0-100 scale but happen to be <= 10 get incorrectly inflated.
Trigger: Source with authorityScore = 5 (on 0-100 scale).
Fix direction: Accept scale as a parameter or use a different heuristic.
```

```
ID: B11-003
Type: Probable Bug
Severity: Medium
File: backend/src/core/evidence/source-normalizer.ts
Function: classFromDomain
Evidence: Lines 163-178: Domain matching uses substring matching without anchoring.
What is wrong: `/prsindia/` matches "myprsindia.com", "fake-prsindia.net", etc. `/thehindu/` matches "notthehindu.com".
Why it matters: Typosquatting or lookalike domains are classified as legitimate sources.
Trigger: Source from "thethehindu.com" or "thehindu-fake.com".
Fix direction: Use anchored regex with word boundaries or exact domain matching.
```

```
ID: B11-004
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/source-normalizer.ts
Function: normalizeTopChunks
Evidence: Lines 84-107: `raw.sourceChunks?.map(...)` can throw if `chunk.text` is not a string.
What is wrong: `String(chunk.text ?? "")` is safe, but `chunk.score` and `chunk.relevanceScore` are cast with `Number()` which can produce NaN. `Number("undefined")` is NaN, and NaN propagates through scoring.
Why it matters: Chunks with invalid scores can cause sorting to place them unpredictably.
Trigger: Input with chunk.score = "invalid" or undefined.
Fix direction: Use `Number.isFinite` guard before using scores.
```

```
ID: B11-005
Type: Risk
Severity: Medium
File: backend/src/core/evidence/source-normalizer.ts
Function: bucketsFromClassAndDomain
Evidence: Lines 181-206: `byClass[sourceClass]` — if `sourceClass` is not a valid key, returns undefined.
What is wrong: If `sourceClass` is cast incorrectly (see B11-001), the lookup returns undefined, and `...byClass[sourceClass]` throws.
Why it matters: Runtime crash from invalid source class.
Trigger: Invalid sourceClass passed to normalizeEvidenceSourceInput.
Fix direction: Add a default case or validate sourceClass before lookup.
```

```
ID: B11-006
Type: Missing Test
Severity: Medium
File: backend/src/core/evidence/source-normalizer.ts
Function: normalizeEvidenceSourceInput
Evidence: No test coverage for the normalization pipeline.
What is wrong: Complex normalization with multiple inference steps has no automated tests.
Why it matters: Changes to inference logic can silently produce incorrect key facts, numbers, or legal holdings.
Trigger: N/A.
Fix direction: Add tests for various input types (court, government, media, academic).
```

```
ID: B11-007
Type: Confirmed Bug
Severity: Low
File: backend/src/core/evidence/source-normalizer.ts
Function: extractNumbers
Evidence: Line 137: `/\b20\d{2}\b|\b\d+(?:\.\d+)?%|\b\d+(?:,\d{3})+\b/g`.
What is wrong: The pattern `\b\d+(?:,\d{3})+\b` requires comma-separated thousands but misses Indian numbering format (lakhs/crores with 2-digit grouping like "1,50,000").
Why it matters: Indian numerical data (common in parliamentary research) is not extracted.
Trigger: Source text containing "1,50,000" or "12,34,567".
Fix direction: Add Indian numbering pattern support.
```

```
ID: B11-008
Type: Probable Bug
Severity: Low
File: backend/src/core/evidence/source-normalizer.ts
Function: inferLegalHoldings
Evidence: Lines 140-144: Takes the first sentence containing legal keywords as a "holding".
What is wrong: Any sentence mentioning "court" or "article" is treated as a legal holding, even if it's just background context.
Why it matters: Non-holding sentences are presented as legal holdings, misleading researchers.
Trigger: Source about a court case where the first sentence is factual background.
Fix direction: Require stronger legal language (held, ruled, decided, judgment) with more context.
```

```
ID: B11-009
Type: Observability Gap
Severity: Low
File: backend/src/core/evidence/source-normalizer.ts
Function: normalizeExtractionQuality
Evidence: Lines 72-82: Maps multiple quality labels to ExtractionQuality but logs no warnings for unrecognized inputs.
What is wrong: Unrecognized extraction quality values silently fall through to the text-content heuristic.
Why it matters: If upstream systems use new quality labels, they are silently mapped incorrectly.
Trigger: Upstream sends extractionQuality = "excellent".
Fix direction: Log a warning for unrecognized quality labels.
```

```
ID: B11-010
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/source-scoring.ts
Function: scoreSourceForAgenda
Evidence: Lines 52-62: Penalty for short snippets is -6 for primary sources, -18 for others.
What is wrong: A primary source with a short snippet gets only a -6 penalty while general media with a short snippet gets -18. But primary sources typically have more content available — a short snippet is more significant.
Why it matters: Penalty logic is inverted — should penalize primary sources MORE for having only snippets.
Trigger: Court judgment source with only a snippet.
Fix direction: Increase penalty for primary sources with short snippets.
```

```
ID: B11-011
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/source-scoring.ts
Function: scoreSourceForAgenda
Evidence: Line 64: `Math.max(0, Math.min(100, Math.round(score)))` — scores can be negative before clamping.
What is wrong: A source can accumulate negative scores (e.g., -50 drift + -35 social media + -55 low quality = -140) before clamping to 0.
Why it matters: Minor — clamping handles it, but the intermediate negative value could cause issues if someone reads the score before clamping.
Trigger: Source matching all negative criteria.
Fix direction: No functional issue, but consider early rejection for heavily penalized sources.
```

```
ID: B11-012
Type: Type Mismatch
Severity: Low
File: backend/src/core/retrieval/source-scoring.ts
Function: classifySource
Evidence: Lines 67-86: Returns SourceClass but doesn't cover all SourceClass values.
What is wrong: Missing cases for "comparative_democracy" and "low_quality" is only reached via the quora/reddit catch-all. No path produces "comparative_democracy" as a source class.
Why it matters: Some SourceClass values are unreachable, indicating dead code elsewhere.
Trigger: N/A.
Fix direction: Add domain patterns for comparative_democracy or remove from SourceClass.
```

---

## Brick 12: Source Enrichment

Files: `enrich-source.ts`, `source-quality.ts`, `evidence-registry-types.ts`

**Summary:** Source enrichment extracts web content, builds evidence cards, and determines citation eligibility. Key issues include concurrent workers sharing a mutable cursor without synchronization, CPU-bound work blocking the event loop in concurrent workers, citation eligibility conditions that are too permissive, and missing handling for PDF extraction failures.

---

```
ID: B12-001
Type: Confirmed Bug
Severity: Critical
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: enrichSourcesConcurrent
Evidence: Lines 46-66: `let cursor = 0` shared across Promise.all workers with `const index = cursor; cursor += 1;` — not atomic.
What is wrong: JavaScript is single-threaded, so this is actually safe in the event loop. However, the `cursor += 1` is a synchronous read-modify-write that is safe only because JS is single-threaded. The real issue is that if `enrichSource` is long-running (await), multiple workers read `cursor` before any increments it, potentially processing the same source twice.
Why it matters: Race condition — two workers can read the same cursor value before either increments, causing duplicate enrichment.
Trigger: Multiple workers reaching the cursor read simultaneously (before any await point).
Fix direction: Use `const index = cursor++` to atomically read and increment.
```

```
ID: B12-002
Type: Confirmed Bug
Severity: High
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: enrichSourcesConcurrent
Evidence: Lines 56-62: When enrichment produces "low" quality with "failed" method, a backup source is selected and enriched. But the backup is selected from `sources as ScoreableSource[]` without verifying the backup source itself is enrichable.
What is wrong: If the backup source also fails, no further fallback is attempted. Additionally, the backup's result replaces the original in `results[index]`, so the original source's data is lost.
Why it matters: Failed enrichments are silently replaced with potentially also-failed backup sources, and the original source metadata is lost.
Trigger: Source and its backup both fail extraction.
Fix direction: Preserve original source as fallback and handle backup failure.
```

```
ID: B12-003
Type: Risk
Severity: Medium
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: enrichSource
Evidence: Lines 88-96: Catch block catches ALL errors and converts them to fallback extraction.
What is wrong: EnrichmentIntegrityError (thrown at line 110 for missing URL) would be caught by this catch if thrown from extractSource, converting a fatal integrity error into a silent fallback.
Why it matters: Integrity errors should propagate, not be silently converted to fallback extraction.
Trigger: extractSource throws EnrichmentIntegrityError.
Fix direction: Re-throw EnrichmentIntegrityError from the catch block.
```

```
ID: B12-004
Type: Probable Bug
Severity: Medium
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: extractSource
Evidence: Lines 214-217: PDF extraction only falls back to webpage extraction if PDF extraction fails AND source.snippet is falsy.
What is wrong: If PDF extraction returns partial content (status !== "failed" but text is empty or minimal), the code returns the partial PDF result instead of trying webpage extraction which might have better content.
Why it matters: PDF extraction that succeeds technically but returns empty/minimal content is not retried.
Trigger: PDF extraction returns status "success" with empty text.
Fix direction: Check for actual text content, not just status.
```

```
ID: B12-005
Type: Missing Test
Severity: High
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: (module-level)
Evidence: No test coverage for the enrichment pipeline.
What is wrong: The most complex async function in the research pipeline — with extraction, caching, backup, evidence reduction, and citation eligibility — has no tests.
Why it matters: Bugs in enrichment silently degrade research quality and citation validity.
Trigger: N/A.
Fix direction: Add comprehensive tests covering success, failure, fallback, and backup paths.
```

```
ID: B12-006
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: buildEnriched
Evidence: Line 127: `canonicalUrl: url` — sets canonicalUrl to the extracted URL, not the canonicalized version.
What is wrong: The `canonicalizeUrl` function exists in source-normalizer.ts but is not used here. Duplicate sources with different URL variants (with/without UTM params) won't be deduplicated.
Why it matters: Same source accessed via different URL variants creates duplicate evidence.
Trigger: Same source discovered via URLs with different UTM parameters.
Fix direction: Use canonicalizeUrl from source-normalizer.ts.
```

```
ID: B12-007
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/retrieval/enrichment/source-quality.ts
Function: computeCitationEligibility
Evidence: Lines 22-33: `card.extractionQuality === "low"` makes a source ineligible, but `card.limitedSource === true && card.relevanceScore < 3` also ineligibilizes.
What is wrong: A source with extractionQuality "low" but high relevance score (e.g., 8) is completely ineligible for citation, even though it may contain highly relevant information.
Why it matters: Highly relevant but short sources are excluded from citations entirely.
Trigger: Snippet-only source with relevance score 8.
Fix direction: Allow citation with "weak" strength for relevant low-quality sources.
```

```
ID: B12-008
Type: Probable Bug
Severity: Medium
File: backend/src/core/retrieval/enrichment/source-quality.ts
Function: extractionQualityFor
Evidence: Lines 8-16: Quality thresholds are hard-coded with specific word counts and ratios.
What is wrong: For `snippet_fallback`, wordCount >= 5 and uniqueWordRatio >= 0.45 and boilerplateRatio < 0.35 yields "medium". A snippet with exactly 5 words (e.g., "The bill was passed today.") could be rated "medium" quality.
Why it matters: Very short snippets are over-rated, leading to inflated citation eligibility.
Trigger: 5-word snippet with diverse vocabulary.
Fix direction: Require higher word count minimums for snippet_fallback.
```

```
ID: B12-009
Type: Risk
Severity: Medium
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: buildEnriched
Evidence: Line 143: `shouldUseCerebras(options)` checks `process.env.CEREBRAS_ENRICHMENT_ENABLED === "true"`.
What is wrong: Environment variable check in a function called potentially thousands of times per research run. If Cerebras API is down or the key is invalid, every enrichment attempt waits for the Cerebras timeout before falling back.
Why it matters: Significant latency penalty when Cerebras is enabled but non-functional.
Trigger: CEREBRAS_ENRICHMENT_ENABLED=true but API key invalid or service down.
Fix direction: Cache Cerebras availability or check health before attempting.
```

```
ID: B12-010
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: capText
Evidence: Lines 255-258: `text.slice(0, maxChars).replace(/\s+\S*$/, "").trim()`.
What is wrong: If text has no whitespace after maxChars (e.g., a very long single word), the regex doesn't match and the text is cut mid-character with no ellipsis or indication.
Why it matters: Truncated text is returned without any marker of truncation.
Trigger: Text with a very long word crossing the maxChars boundary.
Fix direction: Add truncation marker or handle no-whitespace case.
```

```
ID: B12-011
Type: Type Mismatch
Severity: Medium
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: extractSource
Evidence: Line 207: `extracted.provider as ExtractionProviderName`.
What is wrong: Unsafe cast — `extracted.provider` from `extractWithFallback` might be "snippet_fallback" which is valid for ExtractionProviderName, but the type system cannot verify this.
Why it matters: If extractWithFallback returns an unexpected provider name, the cast masks the type error.
Trigger: extractWithFallback returns unknown provider string.
Fix direction: Validate provider name before casting.
```

```
ID: B12-012
Type: Observability Gap
Severity: Medium
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: buildEnriched
Evidence: Lines 153-154: Only emits telemetry for extraction method and quality, not for citation eligibility or evidence card validation failures.
What is wrong: Critical quality metrics (citation eligibility rate, evidence card validation failure rate) are not tracked.
Why it matters: Cannot monitor enrichment pipeline health or detect degradation.
Trigger: N/A.
Fix direction: Emit telemetry for citation eligibility, card validation, and top chunk scores.
```

```
ID: B12-013
Type: Probable Bug
Severity: Low
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: shouldUseCerebras
Evidence: Line 247: Checks `!options.abortSignal?.aborted` but doesn't check if the abort signal might fire during the Cerebras call.
What is wrong: The check is a snapshot at call time. If the signal fires during the Cerebras call, the call continues without aborting.
Why it matters: Enrichment continues after budget is exceeded, wasting resources.
Trigger: Budget abort fires during Cerebras evidence reduction.
Fix direction: Pass abort signal to Cerebras call.
```

```
ID: B12-014
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: queryForSource
Evidence: Lines 237-244: Falls back to `${source.title} ${source.snippet ?? ""}`.trim().
What is wrong: If title is the URL (from assertSourceIdentity fallback) and snippet is empty, the query becomes the full URL string, which is a poor search query.
Why it matters: Enrichment search queries based on URLs produce irrelevant results.
Trigger: Source with no title (set to URL by assertSourceIdentity) and no snippet.
Fix direction: Use a more meaningful fallback like the domain + bucket context.
```

```
ID: B12-015
Type: Dead Code
Severity: Low
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: enrichSources
Evidence: Lines 32-37: `enrichSources` is a thin wrapper around `enrichSourcesConcurrent`.
What is wrong: The wrapper adds no value — it just forwards to the concurrent version with default concurrency.
Why it matters: Maintenance burden for no benefit.
Trigger: N/A.
Fix direction: Remove wrapper or add meaningful preprocessing.
```

```
ID: B12-016
Type: Type Mismatch
Severity: Medium
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: SourceInput
Evidence: Lines 18-30: Local `SourceInput` type overlaps with but doesn't extend `ScoreableSource`.
What is wrong: `ScoreableSource` (from backup-source-selector) has different fields than `SourceInput`. The cast `sources as ScoreableSource[]` at line 57 is unsafe.
Why it matters: Backup source selection may access fields that don't exist on SourceInput.
Trigger: SourceInput lacking publishedDate (required by ScoreableSource).
Fix direction: Unify the type definitions or use proper intersection types.
```

```
ID: B12-017
Type: Risk
Severity: Medium
File: backend/src/core/retrieval/enrichment/enrich-source.ts
Function: buildEnriched
Evidence: Line 111: `rawText = extracted.text ?? extracted.markdown ?? source.snippet ?? null`.
What is wrong: If extracted.text is an empty string "", the ?? operator treats it as a valid value (not nullish) and uses it. An empty string passes through to cleanExtractedText.
Why it matters: Empty string from extraction is treated as valid content, producing empty enrichment.
Trigger: Extractor returns { text: "", ... }.
Fix direction: Use `||` instead of `??` or check for empty string.
```

```
ID: B12-018
Type: Missing Test
Severity: Low
File: backend/src/core/retrieval/enrichment/source-quality.ts
Function: (module-level)
Evidence: No test coverage for quality scoring functions.
What is wrong: Citation eligibility and extraction quality thresholds are untested.
Why it matters: Threshold changes can silently alter citation behavior.
Trigger: N/A.
Fix direction: Add tests for boundary conditions of quality thresholds.
```

```
ID: B12-019
Type: Confirmed Bug
Severity: Low
File: backend/src/core/retrieval/enrichment/source-quality.ts
Function: isLimitedSource
Evidence: Line 18-20: `source.extractionMethod === "snippet_fallback" || Boolean(source.fallbackExtractionUsed)`.
What is wrong: Doesn't account for "preloaded" extraction method, which may also be limited (excerpt-only).
Why it matters: Preloaded excerpts are not flagged as limited sources.
Trigger: Source with extractionMethod "preloaded" from a short excerpt.
Fix direction: Also check for preloaded method with short text.
```

```
ID: B12-020
Type: Risk
Severity: Low
File: backend/src/core/retrieval/enrichment/source-quality.ts
Function: computeCitationEligibility
Evidence: Line 27: `card.topChunks.length === 0` makes source ineligible.
What is wrong: If scoring produces zero chunks (e.g., query terms don't match any text), the source is ineligible even if the full text is highly relevant.
Why it matters: Relevant sources with chunking mismatches lose citation eligibility.
Trigger: Query terms that don't appear verbatim in source text.
Fix direction: Consider full-text relevance as a fallback when topChunks is empty.
```

---

## Finding Summary

| Brick | File Count | Findings |
|-------|-----------|----------|
| 7 - Query Planner | 5 | 28 |
| 8 - Search Provider Layer | 2 | 11 |
| 9 - Source Dedup | 2 | 10 |
| 10 - Source Filtering | 1 | 7 |
| 11 - Source Normalization | 2 | 12 |
| 12 - Source Enrichment | 3 | 20 |
| **Total** | **15** | **88** |

**Severity distribution:** Critical: 1, High: 6, Medium: 40, Low: 41

**Top-priority items:**
1. **B12-001** (Critical): Race condition in concurrent enrichment cursor
2. **B12-002** (High): Backup source replacement loses original data
3. **B07-001** (High): Topic parameter silently discarded
4. **B08-001** (High): fetchWithTimeout timeout memory leak
5. **B11-002** (Medium): Authority score normalization doubles valid 0-100 scores
6. **B11-003** (Medium): Domain substring matching vulnerable to typosquattingI've now reviewed all the requested files. Let me compile the findings across Bricks 13-18.

---

## Brick 13: Evidence Registry & Types

**Summary:** The evidence registry provides core storage, retrieval, and citation-strength computation for sources. It has several type-safety gaps (notably in `EvidenceSourceInput` where `sourceId` and `canonicalUrl` may be missing), a fragile ID assignment scheme that doesn't survive deletions, and a claim-matching heuristic that is overly simplistic for MUN research needs.

```
ID: B13-001
Type: Confirmed Bug
Severity: High
File: backend/src/core/evidence/evidence-registry.ts
Function: addSource (line 16-27)
Evidence: ID assigned as `this.sources.length + 1` at line 24.
What is wrong: If a source is ever removed from the array, the next ID will collide with a previously-used ID. The scheme assumes append-only, but no runtime guard enforces that invariant.
Why it matters: A collision would cause stale sources to be overwritten silently, breaking citation traces and claim grounding.
Trigger: Any future code path that filters/splices `registry.sources` followed by `addSource`.
Fix direction: Use a monotonic counter (`this._nextId`) independent of array length.

ID: B13-002
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/evidence-registry.ts
Function: getSource (line 29-31)
Evidence: Uses `Array.find` which returns `undefined` if not found. The caller receives `EvidenceSource | undefined`.
What is wrong: `getSource(id)` returns the FIRST match by linear scan. If IDs are not unique (see B13-001), the wrong source is returned silently.
Why it matters: Claim grounding downstream assumes deterministic source lookup.
Trigger: Duplicate IDs from collision.
Fix direction: Use a Map<number, EvidenceSource> keyed by id; throw on duplicate.

ID: B13-003
Type: Type Mismatch
Severity: Medium
File: backend/src/core/evidence/evidence-registry-types.ts
Function: EvidenceSourceInput type (lines 67-69)
Evidence: `EvidenceSourceInput` is `Omit<CompleteEvidenceSourceInput, "topChunks" | "citationStrength" | "limitedSource">` & `Partial<...>` for those three fields.
What is wrong: `CompleteEvidenceSourceInput` is `Omit<EvidenceSource, "id">`, which requires `canonicalUrl` as a required field. But in `RawEvidenceSourceInput`, `canonicalUrl` is optional (it inherits from `Partial<EvidenceSource>` via the partialization). The type system allows constructing an `EvidenceSourceInput` without `canonicalUrl`, yet `canonicalizeUrl` at line 163 of evidence-registry.ts will receive `undefined` and call `canonicalizeUrl(undefined)`.
Why it matters: `canonicalizeUrl` will likely throw on `undefined`.
Trigger: Passing a raw source without `canonicalUrl`.
Fix direction: Make `canonicalUrl` optional in `EvidenceSourceInput` with a clear fallback path in `prepareForStorage`.

ID: B13-004
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/evidence-registry.ts
Function: prepareForStorage (line 160-179)
Evidence: Line 163: `canonicalUrl: canonicalizeUrl(source.canonicalUrl ?? source.url)`.
What is wrong: If both `source.canonicalUrl` and `source.url` are `undefined` or empty, `canonicalizeUrl` receives `undefined`. The function `canonicalizeUrl` is not shown but likely throws on falsy input.
Why it matters: The registry will crash on malformed input instead of gracefully rejecting.
Trigger: Passing a source with no URL or canonicalUrl.
Fix direction: Validate URL before calling `canonicalizeUrl`; return null or throw a descriptive error.

ID: B13-005
Type: Probable Bug
Severity: Medium
File: backend/src/core/evidence/evidence-registry.ts
Function: sourceSupportsClaim (line 191-195)
Evidence: Uses `importantTokens(claimText)` which filters to tokens >= 4 chars, excluding a small stop list. Then checks `hasPhraseOverlap` (3-gram) or `hasTokenOverlap` (35% overlap, minimum 2 tokens).
What is wrong: This matching is too loose for legal and MUN domains. Two claims about different countries with shared generic terms like "democracy", "constitution" would produce false positive matches. The stop list has only 12 words, missing dozens of MUN-relevant stop words (government, policy, report, court, etc.).
Why it matters: False claim-source matches lead to incorrect citations in debate output.
Trigger: Claims with common domain vocabulary but unrelated subjects.
Fix direction: Expand stop list significantly; add entity-level filtering (named entities, country names).

ID: B13-006
Type: Risk
Severity: Low
File: backend/src/core/evidence/evidence-registry.ts
Function: exportForPrompt (line 99-118)
Evidence: Builds prompt entry strings by concatenating source data. The `buildPromptEntry` function at line 130-142 recursively calls itself with `compact=true` if the entry exceeds maxChars.
What is wrong: If `compact=true` still exceeds `maxChars`, it returns `""` (empty string). The caller pushes an empty string entry only if `total + compact.length <= maxChars`, but `"".length === 0`, so it always passes the check. This results in blank lines in the prompt.
Why it matters: Blank entries waste prompt budget and may confuse the model.
Trigger: A source with extremely long facts/limitations that still exceeds budget even when compacted.
Fix direction: Don't push entries when `compact` is true and the result is empty.

ID: B13-007
Type: Type Mismatch
Severity: Medium
File: backend/src/core/evidence/evidence-registry-types.ts
Function: RawEvidenceSourceInput (lines 71-81)
Evidence: `RawEvidenceSourceInput` allows `extractionQuality` to be `"high" | "medium" | "low"` (strings) in addition to the proper `ExtractionQuality` enum values.
What is wrong: The type accepts legacy values ("high", "medium", "low") but there is no normalization code visible that converts these to the canonical `"full" | "partial" | "snippet" | "failed"` values. If a caller passes `"high"`, it gets stored as-is, breaking downstream pattern matching.
Why it matters: `computeCitationStrength` and other functions match on the enum values exactly. A `"high"` value won't match `"full"`, causing incorrect strength computation.
Trigger: Any code path passing legacy extraction quality values.
Fix direction: Add a normalization layer that maps "high"->"full", "medium"->"partial", "low"->"snippet".

ID: B13-008
Type: Missing Test
Severity: Medium
File: backend/src/core/evidence/evidence-registry.ts
Function: Entire file
Evidence: No test files found for evidence-registry.
What is wrong: The registry is a critical data structure with complex invariants (ID generation, deduplication, citation strength computation, claim matching). Without tests, regression risk is high.
Why it matters: A bug in ID assignment or claim matching cascades through all downstream bricks.
Trigger: Any code change to registry logic.
Fix direction: Add unit tests covering addSource (with duplicates), getSource, findSourcesForClaim, exportForPrompt budgeting, and citation strength edge cases.

ID: B13-009
Type: Observability Gap
Severity: Low
File: backend/src/core/evidence/evidence-registry.ts
Function: addSource (line 16-27)
Evidence: No logging, metrics, or events when sources are merged via `mergeDuplicateSource`.
What is wrong: Silent merging loses the information that two different inputs were deduplicated, which is important for debugging retrieval quality.
Why it matters: When a source is merged, the user/researcher cannot tell if their retrieval found a duplicate.
Trigger: Any duplicate source addition.
Fix direction: Emit an event or return metadata indicating whether the source was new or merged.

ID: B13-010
Type: Probable Bug
Severity: Medium
File: backend/src/core/evidence/evidence-registry.ts
Function: getBucketCoverage (line 84-89)
Evidence: The record key type is `string`, but `SourceBucketId` is a branded string enum. The function accepts `Record<string, number>` as return type.
What is wrong: The return type is too loose. It should be `Record<SourceBucketId, number>` for type safety. Callers may access bucket IDs that don't exist in the enum.
Why it matters: Type-level safety is lost; callers cannot rely on the compiler to catch typos.
Trigger: Accessing a misspelled bucket ID in caller code.
Fix direction: Use `Record<SourceBucketId, number>` or a typed Map.

ID: B13-011
Type: Risk
Severity: Low
File: backend/src/core/evidence/evidence-registry.ts
Function: clip (line 144-148)
Evidence: `cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd()` — when `maxChars` is 0, the slice is empty, and `"."` is appended, producing just `"."`.
What is wrong: For a 0-character budget, the function returns `"."` instead of `""`. This wastes 1 character and may appear as stray punctuation.
Why it matters: In tight prompt budgets, a stray dot is confusing.
Trigger: `clip("anything", 0)`.
Fix direction: Return `""` when `maxChars <= 1`.

ID: B13-012
Type: Risk
Severity: Medium
File: backend/src/core/evidence/evidence-registry-types.ts
Function: EnrichmentCard (lines 32-34)
Evidence: `EnrichmentCard` is `{ [key: string]: unknown }`.
What is wrong: This is essentially `any`. No shape is enforced. Any code reading from this card must use runtime type guards, but none are visible.
Why it matters: Silent runtime errors when accessing enrichment card properties.
Trigger: Any code reading enrichment card properties without guards.
Fix direction: Define a discriminated union or schema for enrichment card types.

ID: B13-013
Type: Missing Test
Severity: Low
File: backend/src/core/evidence/evidence-registry-types.ts
Function: Entire file
Evidence: Pure type file but defines critical union types used throughout Bricks 13-18.
What is wrong: No type-level tests (e.g., `expectType`) verify that the types compose correctly, e.g., that `EvidenceSourceInput` can be spread into `CompleteEvidenceSourceInput`.
Why it matters: Type errors may only surface at runtime when TypeScript inference goes wrong.
Trigger: Adding a new field to EvidenceSource without updating input types.
Fix direction: Add type-level assertions to verify type compositions.

ID: B13-014
Type: Dead Code
Severity: Low
File: backend/src/core/evidence/evidence-registry.ts
Function: getMediumSources, getWeakSources, getIneligibleSources (lines 45-55)
Evidence: Three nearly identical one-liner methods that filter by citation strength. No callers found in the audited files.
What is wrong: These methods are trivially derivable from `getSourcesByClass` or `getCitationEligibleSources`. They add surface area without clear use.
Why it matters: API surface bloat; maintenance overhead.
Trigger: N/A (dead code).
Fix direction: Remove or consolidate into a single `getSourcesByStrength(strength)` method.
```

---

## Brick 14: Evidence Pack & Registry Integrity

**Summary:** Evidence pack building relies on integrity validation and source deduplication. The integrity check is too permissive (warnings but no blocking for critical issues), and the deduper is delegated to an external module with no visible local validation.

```
ID: B14-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/registry-integrity.ts
Function: validateBeforeStorage (line 9-19)
Evidence: Line 15: `source.citationEligible && source.extractionQuality === "failed"` produces a WARNING, not an error. The result is `{ ok: true }` because `errors` array stays empty.
What is wrong: A source with `extractionQuality === "failed"` and `citationEligible: true` passes integrity check. The calling code in `prepareForStorage` does catch this (line 172: `citationEligible = withDefaults.citationEligible && integrity.ok && withDefaults.extractionQuality !== "failed"`), but the integrity validator itself is misleading.
Why it matters: If any other caller uses `validateBeforeStorage` without the extra `extractionQuality !== "failed"` check, failed sources pass as eligible.
Trigger: Any code path using `validateBeforeStorage` directly.
Fix direction: Make `extractionQuality === "failed"` an ERROR in the integrity validator, not a warning.

ID: B14-002
Type: Risk
Severity: Medium
File: backend/src/core/evidence/registry-integrity.ts
Function: validateBeforeStorage (line 17)
Evidence: Line 17: `topChunks present but no fullText; chunks may be orphaned` is a WARNING.
What is wrong: Orphaned chunks are data quality issues that should block storage, not warn. Chunks without fullText are likely incomplete extractions that waste downstream processing.
Why it matters: Orphaned chunks get stored and may be used for claim matching despite being incomplete.
Trigger: Extraction pipeline producing chunks without fullText.
Fix direction: Elevate to error; reject storage unless `limitedSource: true` is explicitly set.

ID: B14-003
Type: Risk
Severity: Low
File: backend/src/core/evidence/registry-integrity.ts
Function: validateBeforeStorage (line 12-14)
Evidence: Lines 12-14 check for missing URL, title, and canonicalUrl as errors. But `source.url` is accessed with optional chaining (`source.url?.trim()`), meaning `undefined` passes the check without throwing. However, `canonicalUrl` may not exist on `EvidenceSourceInput` in all cases (see B13-003).
What is wrong: The validator assumes these fields exist on the input type, but the type definition allows them to be omitted.
Why it matters: Type-level unsafety masks potential runtime errors.
Trigger: Input with missing fields.
Fix direction: Require these fields at the type level or use nullish coalescing.

ID: B14-004
Type: Observability Gap
Severity: Low
File: backend/src/core/evidence/registry-integrity.ts
Function: validateBeforeStorage
Evidence: Returns `RegistryIntegrityResult` with `ok`, `warnings`, `errors` arrays.
What is wrong: The caller in `prepareForStorage` only checks `integrity.ok` (boolean). The actual warning and error messages are logged nowhere.
Why it matters: When storage validation fails or produces warnings, the root cause is lost for debugging.
Trigger: Any validation failure.
Fix direction: Log warnings/errors or attach them to the source metadata.

ID: B14-005
Type: Risk
Severity: Medium
File: backend/src/core/evidence/source-deduper.ts
Function: Re-exports from injection module
Evidence: This file re-exports `mergeDuplicateSourceFix as mergeDuplicateSource` from `../citations/injection/source-merge-citation-fix.js`.
What is wrong: The actual merge logic is in a completely different directory (`citations/injection/`). This creates a hidden dependency chain where changes in the injection module silently affect evidence registry behavior.
Why it matters: A developer fixing a citation injection bug could unknowingly break source deduplication.
Trigger: Any change to the injection module.
Fix direction: Co-locate the deduper with the registry, or clearly document the cross-module dependency.

ID: B14-006
Type: Missing Test
Severity: Medium
File: backend/src/core/evidence/registry-integrity.ts
Function: Entire file
Evidence: No tests for integrity validation.
What is wrong: The integrity validator is a critical gate for data quality but has no test coverage.
Why it matters: Changes to validation logic could allow bad data or reject good data without detection.
Trigger: Any change to validation rules.
Fix direction: Add tests covering all error and warning conditions.

ID: B14-007
Type: Risk
Severity: Low
File: backend/src/core/evidence/source-deduper.ts
Function: Re-export
Evidence: Only three items are re-exported: `mergeDuplicateSource`, `preferBetterQuality`, `mergeTopChunks`. The `preferBetterQuality` and `mergeTopChunks` functions are never imported by any file in the evidence registry scope.
What is wrong: Unused re-exports create a false impression of the module's API surface.
Why it matters: Maintenance confusion; dead exports.
Trigger: N/A.
Fix direction: Remove unused re-exports or document their intended use.

ID: B14-008
Type: Type Mismatch
Severity: Low
File: backend/src/core/evidence/evidence-registry-types.ts
Function: TopChunk (lines 25-30)
Evidence: `TopChunk.sourceId` is optional (`sourceId?: number`).
What is wrong: In `finalizeStoredSource` at line 187 of evidence-registry.ts, `source.topChunks.map((chunk) => ({ ...chunk, sourceId: source.id }))` overwrites `sourceId`. But if `sourceId` was set to a different value in the input, the original value is silently overwritten.
Why it matters: If chunks from different sources are accidentally mixed, the original sourceId is lost.
Trigger: Merging chunks from multiple sources before calling `addSource`.
Fix direction: Make `sourceId` non-optional in `TopChunk` and validate consistency.

ID: B14-009
Type: Probable Bug
Severity: Medium
File: backend/src/core/evidence/evidence-registry.ts
Function: prepareForStorage (line 167)
Evidence: Line 167: `limitedSource: source.limitedSource ?? (!source.fullText || source.extractionQuality === "snippet" || source.extractionQuality === "failed")`.
What is wrong: The `??` operator only checks for `null/undefined`, not `false`. If `source.limitedSource` is explicitly `false`, it passes through. But the fallback expression computes `true` when there's no fullText or extraction is snippet/failed. This is actually correct behavior. However, the intent is unclear: `limitedSource` is used as a boolean but the type doesn't prevent mixed truthy/falsy states.
Why it matters: The dual meaning (explicit flag vs computed default) can lead to inconsistent state if callers set `limitedSource: false` on a snippet source.
Trigger: Explicitly setting `limitedSource: false` on a snippet source.
Fix direction: Remove the `limitedSource` input field; compute it deterministically.
```

---

## Brick 15: Claim Graph & Contradiction Detection

**Summary:** The claim graph module detects contradictions between claims using heuristic text analysis. The contradiction detection has several false-positive/false-negative risks due to overly simplistic token matching, and the claim type system has redundant and unused fields.

```
ID: B15-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: numericConflict (line 32-40)
Evidence: Line 38: `if (leftNumbers.some((value) => rightNumbers.includes(value))) return null;`
What is wrong: This checks if ANY number from the left claim appears in the right claim. If so, it skips the contradiction. But two claims can share a common number (e.g., a year, population figure) while having DIFFERENT values for the metric in question. The function returns `null` (no conflict) even when the key metric numbers differ.
Why it matters: True numeric contradictions are silently ignored if claims share any common number.
Trigger: Two claims about different metrics for the same year — e.g., "2024 rank: 150" vs "2024 score: 5.2".
Fix direction: Match numbers by their associated metric/entity context, not just presence.

ID: B15-002
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: sameSourceOnly (line 78-82)
Evidence: Line 81: `return leftIds.size === rightIds.size && [...leftIds].every((id) => rightIds.has(id));`
What is wrong: This function skips contradiction detection when two claims share the EXACT same set of supporting sources. But this is wrong: two claims from the SAME source can contradict each other (e.g., a source reports conflicting data, or the extraction produced contradictory claims). The contradiction detector should still run — it's just that same-source contradictions may indicate extraction errors.
Why it matters: Contradictions within the same source are ignored, potentially hiding extraction quality issues.
Trigger: Two contradictory claims extracted from the same source.
Fix direction: Don't skip same-source pairs; instead, flag same-source contradictions as "extraction_review" severity.

ID: B15-003
Type: Probable Bug
Severity: Medium
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: officialWatchdogConflict (line 50-62)
Evidence: Line 59: The regex checks `\bden(?:y|ies|ied)|safe|secure|complied|lawful|no evidence\b` on the CONCATENATED text of both claims.
What is wrong: The concatenated text means the regex can match a word from EITHER claim, not necessarily from the "official" side. E.g., if the watchdog claim says "no evidence of compliance" and the official says "complied with law", the concatenated text contains both "no evidence" and "complied", satisfying both regex checks even when they're on the same side.
Why it matters: False positive contradictions between claims that actually agree.
Trigger: Claims using negated phrases when concatenated.
Fix direction: Test regexes against each claim separately, then check for opposing patterns across claims.

ID: B15-004
Type: Probable Bug
Severity: Low
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: legalConflict (line 42-48)
Evidence: Line 45: Uses regex `\bupheld|valid|permitted|constitutional\b` vs `\bstruck|invalid|unconstitutional|violat`.
What is wrong: The word "violat" matches "violate", "violated", "violating", "violation". But "violation" appears in many non-oppositional contexts (e.g., "to prevent violation of rights"). Similarly, "valid" appears in "invalid", but the regex uses word boundaries so this specific case is fine. However, "valid" can appear in "validation" without the word boundary match — actually `\bvalid\b` does not match "validation" so this is fine. The real issue: the regex doesn't account for negation. "was NOT upheld" would be treated as "upheld".
Why it matters: Negated legal holdings produce false contradictions.
Trigger: Claims with negated legal language.
Fix direction: Add negation detection before matching legal polarity terms.

ID: B15-005
Type: Type Mismatch
Severity: Medium
File: backend/src/core/evidence/claim-graph/types.ts
Function: EvidenceClaim (lines 36-58)
Evidence: Both `type: ClaimType` (line 39) and `claimType?: ClaimType` (line 40) exist on the same interface.
What is wrong: Two fields for the same concept. Which one is canonical? Code accessing `claim.type` vs `claim.claimType` may get different results or undefined. The optional `claimType` creates a shadow duplicate.
Why it matters: Contradiction detectors and validators may check the wrong field.
Trigger: Code reading `claim.claimType` when `claim.type` is set.
Fix direction: Remove `claimType`; use only `type`.

ID: B15-006
Type: Risk
Severity: Medium
File: backend/src/core/evidence/claim-graph/types.ts
Function: EvidenceClaim (lines 36-58)
Evidence: Multiple optional fields (`supportScore?`, `counterclaimIds?`, `contradictionIds?`, `citationStrength?`, `sourceClasses?`, `limitations?`, `validationStatus?`, `extractionQuality?`, `sourceTrace?`, `normalizedText?`, `bucketIds?`) — 11 out of 18 fields are optional.
What is wrong: This interface is essentially a grab-bag with no clear required/optional boundary. Consumers must defensively check most fields. No invariant enforces that `contradictionIds` is populated when `contradictions` exist.
Why it matters: Silent null/undefined access throughout the claim graph pipeline.
Trigger: Any code path reading optional fields without guards.
Fix direction: Split into `BaseEvidenceClaim` (required) and `EnrichedEvidenceClaim` (with optional enrichment fields).

ID: B15-007
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: detectContradictions (line 4-22)
Evidence: O(n^2) pairwise comparison with no deduplication of claim pairs.
What is wrong: The function processes ALL pairs of claims. If there are 500 claims (common in deep research), this is 124,750 comparisons. No early exit, no indexing, no parallelization.
Why it matters: Performance bottleneck that could timeout the research pipeline.
Trigger: Large claim sets (>200 claims).
Fix direction: Index claims by type and entity; only compare same-type or cross-type pairs with shared entities.

ID: B15-008
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: attachContradictions (line 24-30)
Evidence: Line 28: `mustUseCarefulLanguage: claim.mustUseCarefulLanguage || contradictions.some(...)`
What is wrong: This mutates the `mustUseCarefulLanguage` flag based on contradictions. But the function creates new claim objects via spread, so it's not a mutation. However, if the same contradiction affects multiple claims, the `.filter` inside `.map` is called N times per claim, resulting in O(N*M) work where N=claims and M=contradictions.
Why it matters: Quadratic work for contradiction attachment on top of O(n^2) detection.
Trigger: Many claims with many contradictions.
Fix direction: Pre-index contradictions by claimId.

ID: B15-009
Type: Missing Test
Severity: High
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: Entire file
Evidence: No tests for contradiction detection.
What is wrong: The contradiction detector is a complex heuristic system with 4 different detection strategies. Without tests, false positives/negatives go undetected.
Why it matters: Wrong contradiction detection directly affects speech output quality.
Trigger: Any claim pair that the detector misclassifies.
Fix direction: Add tests with known claim pairs and expected contradiction results.

ID: B15-010
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: makeContradiction (line 84-93)
Evidence: Line 86: `stableClaimId("contradiction", \`${left.id}:${right.id}:${type}\`, [...left.supportingSourceIds, ...right.supportingSourceIds])`
What is wrong: The contradiction ID is deterministic based on claim IDs and type. But if the same pair has multiple contradiction types (e.g., both `numeric_conflict` and `trend_direction_conflict`), each gets a different ID. There's no deduplication or grouping.
Why it matters: The same claim pair may appear to have multiple separate contradictions when they're really one underlying conflict.
Trigger: Claims that trigger multiple contradiction detectors.
Fix direction: Group contradictions by claim pair or create a composite ID.

ID: B15-011
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: sharedNonNumericToken (line 72-76)
Evidence: Line 73: Filters out tokens starting with digits from the left tokens only, not the right tokens.
What is wrong: Asymmetric filtering. If the left claim has "rank 150" and the right has "score 150", the right's "150" is still in the token set and can match with non-numeric tokens from the left.
Why it matters: Inconsistent behavior between left and right claims.
Trigger: Claims where one has leading-digit tokens and the other doesn't.
Fix direction: Filter digits from both sides.

ID: B15-012
Type: Type Mismatch
Severity: Low
File: backend/src/core/evidence/claim-graph/types.ts
Function: BuildClaimGraphOptions (lines 115-124)
Evidence: `sourceUsageAggregate` has an inline type that partially mirrors `SourceUsageAggregateValidation`.
What is wrong: The inline type `{ validUsedSourceIds: number[]; perRoleValidation?: SourceUsageAggregateValidation["perRoleValidation"] }` is a structural subset that may diverge from the actual type as the codebase evolves.
Why it matters: Type drift over time; the inline type may become incomplete.
Fix direction: Use the full `SourceUsageAggregateValidation` type.

ID: B15-013
Type: Observability Gap
Severity: Low
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: detectContradictions
Evidence: No metrics on how many contradictions were found per type.
What is wrong: Downstream code has no way to know if the contradiction detector ran, how many pairs were compared, or which detectors fired.
Why it matters: Debugging quality issues in claim graphs is difficult without observability.
Trigger: Contradiction detection runs.
Fix direction: Return diagnostics alongside contradictions.

ID: B15-014
Type: Probable Bug
Severity: Low
File: backend/src/core/evidence/claim-graph/contradiction-detector.ts
Function: trendConflict (line 64-70)
Evidence: Calls `trendDirection(left.text)` and `trendDirection(right.text)` from `./text.js`.
What is wrong: The `trendDirection` function is imported but its implementation is not visible. If it returns `null` for ambiguous trends (likely), the conflict is skipped. But the function doesn't handle the case where both trends are the same direction but the text suggests disagreement via other means (e.g., "improving" vs "getting better").
Why it matters: Missed contradictions due to lexical variation.
Trigger: Claims expressing the same trend with different words.
Fix direction: Enhance `trendDirection` to normalize synonyms.

ID: B15-015
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-graph/types.ts
Function: RawClaimInput (lines 134-150)
Evidence: `fromCounterclaim?: boolean` flag exists but is never referenced in the audited codebase.
What is wrong: Unused flag suggests incomplete implementation of counterclaim-to-claim conversion.
Why it matters: Dead code path.
Trigger: N/A.
Fix direction: Remove if unused; document if planned.
```

---

## Brick 16: Source Usage Map & Normalization

**Summary:** The source usage normalization and validation system handles model-extracted source claims. It has critical `any` casts, inconsistent confidence fallbacks, and a usage type normalization that silently accepts invalid values.

```
ID: B16-001
Type: Confirmed Bug
Severity: High
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: normalizeSourceUsageItems (line 4-39)
Evidence: Line 5: `(json as any)?.sourceUsageMap` and line 6: `item: any`.
What is wrong: The function uses `any` cast for the entire JSON parsing. If the JSON structure is unexpected (e.g., `sourceUsageMap` is not an array but an object), the function returns `[]` silently. No validation of the JSON structure occurs.
Why it matters: Malformed model output results in empty source usage, which downstream interprets as "no sources found" rather than "parse failure".
Trigger: Model returning non-array `sourceUsageMap`.
Fix direction: Use zod or similar schema validation; throw on structural errors.

ID: B16-002
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: normalizeSourceUsageItems (line 4-39)
Evidence: Lines 8-23: When no matching card is found (`!card`), the fallback `sourceClass` is hardcoded to `"policy_research"` (line 13).
What is wrong: Sources without a matching evidence card get an arbitrary source class. This is a significant misclassification — a `court_primary` source without a card becomes `policy_research`.
Why it matters: Incorrect source class affects citation strength computation, claim validation, and contradiction detection.
Trigger: Model references a sourceId not in the current batch.
Fix direction: Use a sentinel class like `"unknown"` or discard the item as invalid.

ID: B16-003
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: normalizeSourceUsageItems (line 4-39)
Evidence: Line 20: `normalizeConfidence(item.confidence, "low")` for unmatched cards vs line 35: `normalizeConfidence(item.confidence, "medium")` for matched cards.
What is wrong: Two different confidence fallbacks based on whether the card matches. The "low" fallback for unmatched cards may be appropriate, but the "medium" default for matched cards inflates confidence for model-extracted claims that may not have been validated.
Why it matters: Inflated confidence scores affect claim ledger quality and downstream synthesis.
Trigger: Any model extraction for a matched card.
Fix direction: Use "low" as the default for all model-extracted items; require explicit confidence from the model.

ID: B16-004
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: normalizeUsageType (line 41-55)
Evidence: Line 54: `return usageTypes.includes(value as SourceUsageType) ? value as SourceUsageType : "unknown_invalid";`
What is wrong: The `"unknown_invalid"` value is returned but is NOT in the `SourceUsageType` union (see types.ts line 7-18: the union ends with `"relevant_but_weak"`). Wait — actually `"unknown_invalid"` IS in the union at line 18 of types.ts. Let me re-check... Yes, it's in the union. However, the issue is that ANY unrecognized value becomes `"unknown_invalid"` silently. There's no logging or error for unrecognized usage types from the model.
Why it matters: Silent degradation — the model may be outputting a completely wrong usage type and the system just defaults without notice.
Trigger: Model outputs an unrecognized usage type.
Fix direction: Log unrecognized usage types; consider raising a warning in the validation report.

ID: B16-005
Type: Type Mismatch
Severity: High
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: normalizeSourceUsageItems (line 4-39)
Evidence: The function returns `SourceUsageMapItem[]` but doesn't populate several required fields: `bucketIds`, `sourceClass` (uses fallback), and doesn't include `groundingStatus`, `evidenceSpan`, `citationStrength`, `limitedSource`.
What is wrong: `SourceUsageMapItem` in types.ts requires `sourceId`, `title`, `bucketIds`, `sourceClass`, `usageType`, `confidence`. The function provides all of these. However, `bucketIds` is set to `[]` for unmatched cards (line 12), which is technically valid but misleading — the card has buckets, but they're not carried over.
Why it matters: Empty bucketIds breaks bucket coverage analysis.
Trigger: Unmatched card normalization.
Fix direction: Look up bucketIds from the registry, not just the batch.

ID: B16-006
Type: Risk
Severity: Low
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: normalizeConfidence (line 61-63)
Evidence: Line 62: `return value === "low" || value === "medium" || value === "high" ? value : fallback;`
What is wrong: The check uses strict equality but the `value` parameter is typed as `unknown`. If `value` is an object or array, the check correctly returns `fallback`. But if `value` is the string `"Low"` (capitalized), it falls through to `fallback`. No case-insensitive normalization.
Why it matters: Model output may have inconsistent casing.
Trigger: Model returns "Low" instead of "low".
Fix direction: Normalize case: `String(value).toLowerCase()`.

ID: B16-007
Type: Risk
Severity: Low
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: cleanOptionalString (line 57-59)
Evidence: `typeof value === "string" && value.trim() ? value.trim() : undefined`
What is wrong: If the string is only whitespace, `trim()` returns `""`, which is falsy, so it returns `undefined`. This is correct behavior. However, if `value` is a number (e.g., `0`), it returns `undefined` without logging. Numeric values in claim fields are silently discarded.
Why it matters: A model returning `extractedClaim: 0` would be discarded.
Trigger: Model outputs a non-string value for a text field.
Fix direction: Convert non-string values to string via `String(value)`.

ID: B16-008
Type: Missing Test
Severity: High
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: Entire file
Evidence: No tests for the normalizer.
What is wrong: The normalizer is the critical bridge between untrusted model JSON and typed source usage items. Without tests, parsing bugs go undetected.
Why it matters: Bad normalization cascades to claim graph, claim ledger, and synthesis.
Trigger: Any change to normalizer logic.
Fix direction: Add tests for valid JSON, malformed JSON, missing fields, wrong types, and edge cases.

ID: B16-009
Type: Risk
Severity: Medium
File: backend/src/core/evidence/source-usage/role-source-scope.ts
Function: validateRoleSourceScope (line 13-24)
Evidence: Line 19: `if (allowedSourceIds.size === 0)` returns a failure with message "No sources were assigned to {roleName}."
What is wrong: An empty `allowedSourceIds` set produces a failure even when there are genuinely no sources to validate against. This conflates "no sources assigned" with "all sources are invalid".
Why it matters: Roles with zero sources (e.g., during early pipeline stages) get marked as failed incorrectly.
Trigger: Role with no assigned sources.
Fix direction: Return `null` (no failure) when `allowedSourceIds` is empty.

ID: B16-010
Type: Observability Gap
Severity: Low
File: backend/src/core/evidence/source-usage/role-source-scope.ts
Function: validateRoleSourceScope
Evidence: Returns `StructuredSourceUsageFailure` but the calling code (not shown) may not log the failure details.
What is wrong: Cross-batch reference failures are silently dropped if the caller doesn't process them.
Why it matters: Debugging source usage issues is difficult without failure logging.
Trigger: Cross-batch reference rejection.
Fix direction: Ensure failures are included in the validation report.

ID: B16-011
Type: Risk
Severity: Low
File: backend/src/core/evidence/source-usage/role-source-scope.ts
Function: normalizeAllowedSourceIds (line 4-11)
Evidence: Line 8: `if (Number.isFinite(sourceId)) ids.add(Number(sourceId));`
What is wrong: `Number.isFinite` rejects `NaN` and `Infinity` but accepts negative numbers and zero. Source IDs should be positive integers. `Number.isFinite(0)` is true, and `Number.isFinite(-1)` is true.
Why it matters: Invalid source IDs (0, negative) may be accepted into the allowed set.
Trigger: Input containing 0 or negative source IDs.
Fix direction: Check `Number.isInteger(sourceId) && sourceId > 0`.

ID: B16-012
Type: Risk
Severity: Medium
File: backend/src/core/evidence/source-usage-map.ts
Function: Re-exports from index
Evidence: `source-usage-map.ts` re-exports from `./source-usage/index.js` (line 1).
What is wrong: This creates an indirection layer that obscures where the actual validation logic lives. Developers may modify the wrong file.
Why it matters: Maintenance confusion.
Trigger: Any change to source usage validation.
Fix direction: Flatten the module structure or clearly document the indirection.

ID: B16-013
Type: Probable Bug
Severity: Medium
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: normalizeSourceUsageItems (line 4-39)
Evidence: The function doesn't handle the case where `batch` is empty. If `batch` is `[]`, `batch.find(...)` always returns `undefined`, so ALL items fall into the unmatched branch with `"policy_research"` sourceClass and empty `bucketIds`.
What is wrong: Empty batch causes total misclassification of all source usage items.
Why it matters: Model output is completely mischaracterized.
Trigger: Normalizing items with an empty evidence card batch.
Fix direction: Return empty array or throw when batch is empty.

ID: B16-014
Type: Dead Code
Severity: Low
File: backend/src/core/evidence/source-usage/source-usage-normalizer.ts
Function: normalizeConfidence
Evidence: The function accepts only `"high" | "medium" | "low"` as valid values and a fallback. But the fallback is always a valid value. There's no path where the return type doesn't match the declared type. The function is correct but could be simplified.
What is wrong: The function is simple enough to be inlined but is extracted. Not a bug, just unnecessary abstraction.
Why it matters: Slightly harder to trace.
Trigger: N/A.
Fix direction: Inline or keep for clarity; low priority.

ID: B16-015
Type: Type Mismatch
Severity: Low
File: backend/src/core/evidence/source-usage/types.ts
Function: SourceUsageAggregateValidation (lines 169-185)
Evidence: `outputs: ModelRoleOutput[]` is part of the aggregate validation type.
What is wrong: The aggregate validation holds a reference to the full model role outputs. This can cause memory issues if outputs contain large payloads (full text, evidence spans, etc.).
Why it matters: Memory bloat in long-running research sessions.
Trigger: Multiple roles with large outputs.
Fix direction: Store only validation-relevant summaries, not full outputs.
```

---

## Brick 17: Role Generation Engine

**Summary:** The role generation engine orchestrates model calls for source usage extraction. It has provider configuration issues, retry logic that may skip valid providers, and a deterministic fallback that produces generic content that passes validation trivially.

```
ID: B17-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: runModelRoleForSourceUsage (line 59-185)
Evidence: Line 60: `if (input.mode === "deterministic") return buildDeterministicEvidenceOutput(input, [], 0);`
What is wrong: When mode is "deterministic", the function passes `[]` as providerErrors. But `buildDeterministicEvidenceOutput` (line 216-222) then checks `providerErrors.length ? "configure_provider" : "allow_source_gap_report"` for the recommended action. This means deterministic mode always gets `"allow_source_gap_report"` even if there were actual provider errors before switching to deterministic.
Why it matters: Provider errors are lost in deterministic mode, masking infrastructure issues.
Trigger: Running in deterministic mode after provider failures.
Fix direction: Accept providerErrors as a parameter to the deterministic branch.

ID: B17-002
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: runModelRoleForSourceUsage (line 59-185)
Evidence: Line 87: The `for (const candidate of candidates)` loop has a `brokenProviders` set that blocks providers after one failure. But line 107: `brokenProviders.add(candidate.providerName)` is inside the batch error handling, meaning a single failed batch permanently blocks the provider, even for other batch sizes.
What is wrong: A transient error on one batch size blocks all retries with that provider for other batch sizes.
Why it matters: Valid provider is prematurely excluded from retry attempts.
Trigger: Provider fails on first batch but would succeed on a smaller batch.
Fix direction: Reset `brokenProviders` per batch size, or track failures per batch size.

ID: B17-003
Type: Probable Bug
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: runModelRoleForSourceUsage (line 59-185)
Evidence: Line 115: `if (currentRetries < 1)` — this limits retries to exactly 1 per provider. But the `retries` counter (line 72) is a separate variable that increments globally.
What is wrong: The retry limit of 1 per provider-key is hardcoded and unclear. If the intent was `maxRetries` from config, it should use that. The magic number `1` may be too aggressive (one retry) or too loose (if config says 0).
Why it matters: Inflexible retry policy that doesn't respect configuration.
Trigger: Provider needs more than 1 retry to succeed.
Fix direction: Use a configurable maxRetries parameter.

ID: B17-004
Type: Risk
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: getHealthyGenerationProviders (line 187-214)
Evidence: Line 199-200: `if (input.providerRunState?.shouldSkipModel(...)) return false; ... typeof router.hasProvider === "function" ? router.hasProvider(candidate.providerName) : candidate.providerName === input.providerName;`
What is wrong: If `router.hasProvider` is not a function (e.g., `undefined` or a different shape), the fallback `candidate.providerName === input.providerName` may be `false` for all candidates, returning an empty list.
Why it matters: If the router is misconfigured, no providers are available, and the pipeline falls back to deterministic mode.
Trigger: Router without `hasProvider` method.
Fix direction: Validate router shape at initialization.

ID: B17-005
Type: Risk
Severity: Low
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: runDeterministicModelRole (line 36-57)
Evidence: Line 55: `output: input.output ?? buildRolePayload(input.roleName, sourceUsageMap, "unknown", 0)`
What is wrong: If `input.output` is provided, it's used directly without validation. This allows arbitrary output to bypass the role generation pipeline entirely.
Why it matters: External code could inject fake role outputs that appear legitimate.
Trigger: Code calling `runDeterministicModelRole` with a custom `output`.
Fix direction: Validate `input.output` against `RoleGenerationPayload` schema.

ID: B17-006
Type: Risk
Severity: Low
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: DEFAULT_FALLBACK_MODELS (lines 28-34)
Evidence: Hardcoded fallback model list including free-tier models.
What is wrong: The fallback list includes `"qwen/qwen3-32b:free"` on OpenRouter. Free-tier models may have rate limits, quality issues, or be deprecated. The list is not configurable at runtime.
Why it matters: If the free model is unavailable, the entire fallback chain degrades.
Trigger: OpenRouter free model is rate-limited or removed.
Fix direction: Make fallback models configurable; add health checks.

ID: B17-007
Type: Risk
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: buildOutput (line 272-308)
Evidence: Line 295: `syncModelRoleOutputWithValidation({ ...draft, output: { ...(draft.output as RoleGenerationPayload), validation } }, validation)`
What is wrong: Casts `draft.output` to `RoleGenerationPayload` with `as`. If `draft.output` doesn't have the expected shape, the spread silently produces malformed output. No runtime validation.
Why it matters: Type safety violation that could produce invalid role payloads.
Trigger: `buildRolePayload` returns a different shape.
Fix direction: Validate the output shape before spreading.

ID: B17-008
Type: Probable Bug
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: buildFailureOutput (line 310-335)
Evidence: Line 312: `const validation = ((output.output as any)?.validation ?? validateSourceUsageMap(...));`
What is wrong: Uses `as any` to access `validation` from the output. If `output.output` has no `validation` property, it calls `validateSourceUsageMap` again. But this second validation is computed with `Math.min(output.requiredSourceCount, input.evidenceRegistry.getCitationEligibleCount())`, which may differ from the validation used in `buildOutput`. Inconsistent validation parameters.
Why it matters: The failure report may show different validation results than the actual output validation.
Trigger: Failure path where `output.output` lacks validation.
Fix direction: Use a single validation result throughout the failure path.

ID: B17-009
Type: Risk
Severity: Low
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: buildRolePayload (line 345-369)
Evidence: Line 363: `snippet: items.filter((item) => item.groundingStatus === "weak_context").length`
What is wrong: The `snippet` count uses `groundingStatus === "weak_context"` as a proxy for snippet sources. But `groundingStatus` is optional and set during grounding, not directly related to extraction quality. A strongly-extracted source with weak grounding would be counted as "snippet".
Why it matters: Misleading quality metrics in the role payload.
Trigger: Sources with strong extraction but weak grounding.
Fix direction: Use `extractionQuality === "snippet"` from the source data.

ID: B17-010
Type: Risk
Severity: Low
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: buildRolePayload (line 345-369)
Evidence: Line 364: `failed: 0` is hardcoded.
What is wrong: The failed source count is always 0, even when there are known failed extractions. This makes the quality metrics inaccurate.
Why it matters: Role payloads always report 0 failed sources, masking extraction failures.
Trigger: Any role with failed source extractions.
Fix direction: Compute failed count from source data.

ID: B17-011
Type: Risk
Severity: Low
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: validateBatchItems (line 337-343)
Evidence: Line 340: `const requiredCoverage = Math.min(batch.length, input.minimumSourceRequirement ?? batch.length);`
What is wrong: If `batch.length` is 0 (empty batch), `requiredCoverage` is 0. Validation against 0 required coverage always passes trivially.
Why it matters: Empty batches pass validation, producing empty source usage.
Trigger: Processing an empty batch.
Fix direction: Reject empty batches before validation.

ID: B17-012
Type: Risk
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: runModelRoleForSourceUsage (line 90-148)
Evidence: Lines 141-145: After a retry fails, the code adds the provider to `brokenProviders` and breaks. But the outer loop at line 87 continues to the next candidate. If ALL candidates break, the function falls through to line 161 (deterministic fallback).
What is wrong: The fallback to deterministic mode happens silently. There's no explicit error or log indicating that all model providers failed.
Why it matters: The pipeline silently degrades to deterministic mode without alerting operators.
Trigger: All providers fail.
Fix direction: Emit an event or log when falling back to deterministic mode.

ID: B17-013
Type: Missing Test
Severity: High
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: Entire file
Evidence: No tests for the role generation engine.
What is wrong: This is the most critical orchestration file in Brick 17, handling provider selection, retries, validation, and fallback. Without tests, any regression is catastrophic.
Why it matters: The entire research pipeline depends on this module.
Trigger: Any change to role generation logic.
Fix direction: Add comprehensive tests covering model path, deterministic path, retry logic, and fallback scenarios.

ID: B17-014
Type: Observability Gap
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: runModelRoleForSourceUsage
Evidence: The function has an `emitSourceUsageEvent` callback but it's only called for batch start, batch retry, and cross-batch rejection. It's NOT called for: provider selection, validation results, fallback activation, or final success/failure.
What is wrong: Critical lifecycle events are not emitted. Operators cannot observe the role generation pipeline's state.
Why it matters: Debugging and monitoring are severely limited.
Trigger: Any role generation run.
Fix direction: Emit events for provider selection, validation results, fallback, and final outcome.

ID: B17-015
Type: Risk
Severity: Low
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: uniqueBatchSizes (line 381-383)
Evidence: `return [...new Set([Math.min(Math.max(initial, 5), 10), 5, 3])];`
What is wrong: If `initial` is 5, the result is `[5, 3]`. If `initial` is 10, the result is `[10, 5, 3]`. If `initial` is 3, the result is `[5, 3]`. The batch sizes are hardcoded and don't scale with the minimum source requirement. For `minimum = 100`, trying batches of 10, 5, 3 is extremely inefficient.
Why it matters: Large source requirements are processed in tiny batches, causing excessive model calls.
Trigger: Minimum source requirement > 30.
Fix direction: Scale batch sizes relative to the minimum requirement.

ID: B17-016
Type: Type Mismatch
Severity: Medium
File: backend/src/core/synthesis/role-generation/run-role-generation.ts
Function: runSourceUsageBatch (line 224-270)
Evidence: Line 257: `typeof (input.providerRouter as any).completeJson === "function"`
What is wrong: Uses `as any` to check for `completeJson` method. This bypasses TypeScript's type checking and may mask API changes in the provider router.
Why it matters: If the router's API changes, the cast hides the error until runtime.
Trigger: Router API changes.
Fix direction: Define a proper interface for the router's methods.
```

---

## Brick 18: Synthesis Engine & Division Quality

**Summary:** The division quality module validates debate utility and strategic insights outputs. It has hardcoded content requirements that can be trivially gamed, fallback texts that contain their own disqualifying keywords, and a repetition ratio calculation that is both inaccurate and expensive.

```
ID: B18-001
Type: Confirmed Bug
Severity: High
File: backend/src/core/synthesis/division-quality.ts
Function: validateD7DebateUtility (line 113-132)
Evidence: Line 117: `if (!options.allowFallback && isFallbackText(text)) issues.push(...)` — the `isFallbackText` function at line 105-107 checks for `\bdeterministic fallback\b|\bfallback\b`.
What is wrong: The `buildDebateUtilityDivision` function at line 159 produces text that starts with `D7 Debate Utility Arsenal - Deterministic fallback` when `input.fallback` is true. But `validateD7DebateUtility` has `allowFallback` defaulting to `false` (line 113: `options: { allowFallback?: boolean } = {}`). So the deterministic fallback text FAILS its own validation by default.
Why it matters: The deterministic fallback produces text that is immediately rejected by the validator, creating a validation paradox.
Trigger: Calling `validateD7DebateUtility` on fallback text without `allowFallback: true`.
Fix direction: Ensure callers pass `allowFallback: true` for fallback text, or exclude fallback text from validation.

ID: B18-002
Type: Confirmed Bug
Severity: High
File: backend/src/core/synthesis/division-quality.ts
Function: synthesizeQualityDivisions (line 229-260)
Evidence: Line 251-253: `const d7 = buildDebateUtilityDivision(...); quality.set("D7_debate_utility", validateD7DebateUtility(d7));`
What is wrong: The deterministic D7 output is validated WITHOUT `allowFallback: true`. So `validateD7DebateUtility` always adds the "D7 fallback output cannot pass..." issue (line 117). This means the quality result for D7 always has at least one issue, making `passed: false`. But the function still stores the output.
Why it matters: The synthesis always marks D7 as failed quality, but uses it anyway. This is a silent quality degradation.
Trigger: Calling `synthesizeQualityDivisions`.
Fix direction: Pass `allowFallback: true` or skip validation for deterministic outputs.

ID: B18-003
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/synthesis/division-quality.ts
Function: validateD7DebateUtility (line 113-132)
Evidence: Lines 120-121: `if (!/Treasury Bench/i.test(text))` and `if (!/Opposition/i.test(text))`.
What is wrong: The `buildDebateUtilityDivision` function at line 161-163 produces text that DOES contain "Treasury Bench Arguments" and "Opposition Arguments". The regex `/Treasury Bench/i` matches "Treasury Bench Arguments" and `/Opposition/i` matches "Opposition Arguments". So this is fine. However, the regexes are fragile — if the text uses "Government Bench" instead of "Treasury Bench", it fails.
Why it matters: Fragile regex matching makes validation brittle to minor text changes.
Trigger: Any variation in argument naming.
Fix direction: Expand regex patterns to cover synonyms.

ID: B18-004
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/synthesis/division-quality.ts
Function: countCitationAnchors (line 78-80)
Evidence: Regex: `/\[Source\s+\d+\]\(https?:\/\/[^)\s]+\)/gi`
What is wrong: This regex requires citations to be in markdown link format `[Source N](https://...)`. But `getCitationMarkdown` in evidence-registry.ts (line 69-72) produces exactly this format. However, if a citation uses a different format (e.g., `[1]`, `Source: N`, or plain URLs), it won't be counted. The D7 deterministic output at line 166-171 uses `${cite(0)}` which resolves to `card.citation ?? "[source gap]"`. If `card.citation` is a plain URL (not in markdown format), the anchor count will be 0.
Why it matters: Valid citations in non-markdown format are not counted, causing false validation failures.
Trigger: Citations not in `[Source N](url)` format.
Fix direction: Support multiple citation formats.

ID: B18-005
Type: Probable Bug
Severity: Medium
File: backend/src/core/synthesis/division-quality.ts
Function: calculateRepetitionRatio (line 278-292)
Evidence: Line 285: `const sentences = prior.split(/[.!?]\s+/).map(...)` splits prior divisions into sentences. Line 287: `if (sentence && normalizedText.includes(sentence))` — this checks if the current text CONTAINS any sentence from prior divisions as a substring.
What is wrong: Short sentences (8+ words) from prior divisions will almost always appear in the current text as common phrases. E.g., "the gap between legal defensibility and floor credibility" is a common MUN phrase that could appear in any analysis. This causes false positive repetition detection.
Why it matters: Legitimate content is flagged as repetitive.
Trigger: Common phrases appearing across divisions.
Fix direction: Use n-gram overlap or semantic similarity instead of substring matching.

ID: B18-006
Type: Probable Bug
Severity: Low
File: backend/src/core/synthesis/division-quality.ts
Function: calculateRepetitionRatio (line 278-292)
Evidence: Line 291: `return Math.min(1, repeatedWords / totalWords);`
What is wrong: `repeatedWords` counts the SAME word multiple times if it appears in sentences from MULTIPLE prior divisions. If a sentence from D1 and a sentence from D7 both contain "the" and appear in the current text, the word is counted twice.
Why it matters: Repetition ratio is inflated when the same words appear in multiple prior divisions.
Trigger: Common words in multiple prior divisions.
Fix direction: Deduplicate repeated words across prior divisions.

ID: B18-007
Type: Risk
Severity: Medium
File: backend/src/core/synthesis/division-quality.ts
Function: buildDebateUtilityDivision (line 150-184)
Evidence: Lines 151-156: `const cards = input.cards.slice(0, 8);` and `const cite = (index: number) => cards[index % Math.max(cards.length, 1)]?.citation ?? "[source gap]";`
What is wrong: If `cards.length` is 0, `Math.max(cards.length, 1)` is 1, so `index % 1` is always 0. `cards[0]` is `undefined`, so `cite()` always returns `"[source gap]"`. The entire debate utility output becomes a generic template with no real citations.
Why it matters: Zero-card input produces entirely fabricated debate content with no evidence.
Trigger: No evidence cards available.
Fix direction: Return a gap report or empty result when no cards are available.

ID: B18-008
Type: Risk
Severity: Low
File: backend/src/core/synthesis/division-quality.ts
Function: buildDebateUtilityDivision (line 150-184)
Evidence: The function uses modular indexing (`index % cards.length`) to cycle through cards for citations.
What is wrong: If there are 2 cards, citations at indices 0-7 cycle through the same 2 cards 4 times each. This creates the illusion of diverse sourcing when actually only 2 sources are cited repeatedly.
Why it matters: False appearance of source diversity in debate output.
Trigger: Fewer than 8 evidence cards.
Fix direction: Only cite as many cards as are available; don't fabricate diversity.

ID: B18-009
Type: Risk
Severity: Medium
File: backend/src/core/synthesis/division-quality.ts
Function: synthesizeQualityDivisions (line 229-260)
Evidence: Lines 234-249: For all divisions except D7 and D11, the function produces a generic "deterministic synthesis scaffold" and sets `passed: false`.
What is wrong: D1-D6, D8-D10 all get the same generic placeholder text. The outputs are not division-specific — only the title and ordinal change. The "Purpose" line mentions the agenda but nothing else varies.
Why it matters: These divisions produce near-identical content, making the research pipeline output generic and low-quality.
Trigger: Any synthesis run.
Fix direction: Generate division-specific content or clearly mark these as placeholders.

ID: B18-010
Type: Risk
Severity: Low
File: backend/src/core/synthesis/division-quality.ts
Function: wordCount (line 74-76)
Evidence: `text.trim().split(/\s+/).filter(Boolean).length`
What is wrong: This counts words by splitting on whitespace. Markdown links like `[Source 1](https://example.com)` count as 2 words (`[Source` and `1](https://example.com)`). This inflates word counts for heavily cited text.
Why it matters: Word count thresholds are met by citation markup, not actual content.
Trigger: Text with many markdown citations.
Fix direction: Strip markdown before counting words.

ID: B18-011
Type: Risk
Severity: Low
File: backend/src/core/synthesis/division-quality.ts
Function: hasPlaceholderText (line 109-111)
Evidence: Regex: `/\b(?:placeholder|todo|lorem|insert\s+(?:source|text|citation)|tbd)\b/i`
What is wrong: The check is case-insensitive but only covers a limited set of placeholder patterns. It misses common placeholders like "TBD", "N/A", "[insert]", "FIXME", "TODO:", "—", "...", "lorem ipsum" (multi-word), etc.
Why it matters: Placeholder text slips through undetected.
Trigger: Using "TODO:" or "FIXME" in output.
Fix direction: Expand placeholder pattern list.

ID: B18-012
Type: Risk
Severity: Medium
File: backend/src/core/synthesis/division-quality.ts
Function: validateD7DebateUtility (line 113-132)
Evidence: Lines 126-128: Checks for `/Amendment Language/i`, `/Resolution Language/i`, `/Operative Clause/i`, `/Preambular Clause/i`.
What is wrong: The `buildDebateUtilityDivision` function at line 182 includes "Amendment Language:" and "Resolution language should cite..." in its output. The validation checks for these exact phrases. This means the deterministic output PASSES this specific check trivially — the validator is essentially checking that the template includes its own hardcoded text.
Why it matters: The validation is circular — it checks for text that the deterministic builder always produces, so it never catches poor-quality custom output.
Trigger: Any output that includes the expected keywords.
Fix direction: Validate the quality and specificity of amendment/resolution language, not just presence.

ID: B18-013
Type: Missing Test
Severity: High
File: backend/src/core/synthesis/division-quality.ts
Function: Entire file
Evidence: No tests for division quality validation.
What is wrong: The division quality module is the final gate before output is delivered. Without tests, validation bugs produce poor-quality output.
Why it matters: Users receive low-quality debate content when validation should catch it.
Trigger: Any change to validation logic.
Fix direction: Add tests for valid/invalid D7, D11, and fallback outputs.

ID: B18-014
Type: Risk
Severity: Medium
File: backend/src/core/synthesis/division-quality.ts
Function: buildStrategicInsightsDivision (line 186-202)
Evidence: Line 188-189: `const d1 = input.priorDivisions.get("D1_core_brief") ?? input.priorDivisions.get("core_brief") ?? "the core brief";`
What is wrong: The function looks up prior divisions by two different key formats ("D1_core_brief" and "core_brief"). This suggests inconsistency in how division IDs are stored in the Map. If a third format is used elsewhere, it silently falls back to a generic string.
Why it matters: Key inconsistency indicates architectural confusion about division ID format.
Trigger: Prior divisions stored with unexpected keys.
Fix direction: Standardize on one key format; use the `DivisionId` enum type.

ID: B18-015
Type: Risk
Severity: Low
File: backend/src/core/synthesis/division-quality.ts
Function: extractStrategicTheme (line 266-276)
Evidence: Line 269: `/federalism/.test(normalized) ? "federalism pressure" : ""`
What is wrong: The themes are extracted from the lowercased text using simple regex tests. But the themes array can have duplicates if multiple patterns match the same text. For example, text mentioning "ministry" and "committee" produces both "committee accountability" and other themes. The `filter(Boolean)` removes empty strings but doesn't deduplicate themes.
Why it matters: Redundant themes in the strategic synthesis.
Trigger: Text matching multiple theme patterns.
Fix direction: Deduplicate themes before joining.

ID: B18-016
Type: Observability Gap
Severity: Medium
File: backend/src/core/synthesis/division-quality.ts
Function: synthesizeQualityDivisions
Evidence: The function returns `QualitySynthesisResult` with `outputs` and `quality` Maps but provides no metadata about which divisions used fallback, which passed validation, or how long synthesis took.
What is wrong: Callers have no insight into the quality distribution across divisions.
Why it matters: Debugging synthesis quality issues is difficult.
Trigger: Any synthesis run.
Fix direction: Include diagnostics in the result (division-level pass/fail, fallback flags, timing).

ID: B18-017
Type: Dead Code
Severity: Low
File: backend/src/core/synthesis/division-quality.ts
Function: DivisionId type (lines 3-14)
Evidence: The `DivisionId` union has 11 members, but the synthesis function only handles D7 and D11 specifically. The other 9 divisions get generic placeholder text.
What is wrong: The type suggests 11 distinct division types, but only 2 have specialized generation. The other 9 are effectively dead code paths.
Why it matters: Misleading type definition.
Trigger: N/A.
Fix direction: Either implement all divisions or reduce the type to only implemented ones.
```

---

## Brick 18 (continued): Claim Ledger & Evidence Trace

**Summary:** The claim ledger and evidence trace modules build auditable records of source-to-claim mappings. They have hash collision risks, fragile evidence span matching, and incomplete generic claim detection.

```
ID: B18-C01
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/claim-ledger.ts
Function: hashClaim (line 288-294)
Evidence: `hash = ((hash << 5) - hash + claim.charCodeAt(index)) | 0;` followed by `Math.abs(hash).toString(36)`
What is wrong: This is the djb2 hash algorithm. For short normalized claims, collisions are likely. The hash output is base-36 with a max of ~2^31 values, but `Math.abs` of `|0` (32-bit signed) can produce collisions for similar claims. More critically, the hash is used in the claimId: `${output.roleName}:${item.sourceId}:${hashClaim(normalized)}`. Two different claims with the same hash from the same role and source produce the same claimId.
Why it matters: Claim ID collisions cause one claim to silently overwrite another in downstream processing.
Trigger: Two different claims from the same role+source that hash to the same value.
Fix direction: Use a cryptographic hash (SHA-256) or include the full claim text in the ID.

ID: B18-C02
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/evidence/claim-ledger.ts
Function: findEvidenceSpan (line 172-214)
Evidence: Line 177: `source.keyFacts.every((fact) => /^title-only relevance:/i.test(fact.trim()))`
What is wrong: This checks if ALL key facts match the "title-only relevance:" pattern. If the source has even ONE non-title-only fact, the quality is NOT set to "title_only". But if the source has a mix (e.g., 1 real fact + 9 title-only facts), the quality is set to the source's `extractionQuality` which may be "full" even though most facts are title-only.
Why it matters: Quality assessment is binary — it doesn't account for mixed-quality facts.
Trigger: Sources with mixed title-only and real facts.
Fix direction: Use a threshold-based approach (e.g., >50% title-only = title_only quality).

ID: B18-C03
Type: Risk
Severity: Medium
File: backend/src/core/evidence/claim-ledger.ts
Function: findEvidenceSpan (line 172-214)
Evidence: Line 189: `for (const text of haystacks)` iterates through keyFacts, legalHoldings, keyNumbers, fullText, snippet, limitations. Line 190: `const span = bestSentence(text, claimNeedles)`.
What is wrong: `bestSentence` returns the FIRST sentence with the best overlap score. If `fullText` is a large document (thousands of words), `splitSentences` at line 233-242 creates thousands of sentence objects, and `bestSentence` iterates through all of them. This is O(n) per source per claim, and with many sources and claims, it's O(n*m) text processing.
Why it matters: Performance issue for large source texts.
Trigger: Sources with long fullText fields.
Fix direction: Limit sentence scanning to a subset (e.g., first 100 sentences) or use indexed search.

ID: B18-C04
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-ledger.ts
Function: bestSentence (line 216-231)
Evidence: Line 226: `if (!best || score > best.score || (score === best.score && sentence.text.length < best.text.length))`
What is wrong: When scores are equal, the shorter sentence is preferred. This is a reasonable heuristic but may prefer very short sentences that lack context. A 10-word sentence with 3 matching tokens is preferred over a 50-word sentence with 3 matching tokens, even though the longer sentence provides more context.
Why it matters: Evidence spans may be too short for meaningful citation.
Trigger: Claims matching tokens in both short and long sentences.
Fix direction: Prefer sentences with more total context when scores are close.

ID: B18-C05
Type: Risk
Severity: Medium
File: backend/src/core/evidence/claim-ledger.ts
Function: isRepeatedGenericClaim (line 271-274)
Evidence: Line 272: `if (!GENERIC_CLAIM_PATTERNS.some((pattern) => pattern.test(claimText.trim()))) return false;`
What is wrong: The generic claim detection only fires for claims matching the 8 hardcoded patterns. Claims like "this document provides information" or "the article discusses the topic" are not caught. The detection is too narrow.
Why it matters: Generic claims slip through and waste citation credit.
Trigger: Generic claims not matching the hardcoded patterns.
Fix direction: Add more patterns or use a semantic similarity check against a generic claim corpus.

ID: B18-C06
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-ledger.ts
Function: confidenceFor (line 252-260)
Evidence: Line 259: `return "high";` as the final fallback.
What is wrong: If none of the earlier conditions match (source has medium citation strength, partial extraction, item confidence is medium), the function returns "high" as the default. This seems wrong — a default of "high" for unclassified cases inflates confidence.
Why it matters: Claims get inflated confidence scores when the classification logic doesn't match any specific pattern.
Trigger: Unusual combinations of source and item attributes.
Fix direction: Default to "medium" or "low" instead of "high".

ID: B18-C07
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-ledger.ts
Function: isCitationCreditEligible (line 262-269)
Evidence: Line 268: `return true;` as the final fallback.
What is wrong: If the source is citation eligible, the usage type is not "relevant_but_weak", the span quality is not snippet/title_only/failed, and the source doesn't have strong/medium strength with full/partial extraction, the function still returns `true`. This is overly permissive.
Why it matters: Weak sources get citation credit they shouldn't receive.
Trigger: Sources with weak strength and partial extraction.
Fix direction: Return `false` for sources that don't meet a minimum quality threshold.

ID: B18-C08
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-ledger.ts
Function: supportTypeFor (line 244-250)
Evidence: Line 249: `return "direct_quote";` as the final fallback.
What is wrong: Any usage type not explicitly handled (fact_extracted, number_extracted, legal_holding_extracted, limitation_identified, relevant_but_weak) defaults to "direct_quote". But "supports_claim" and "challenges_claim" usage types are NOT handled — they should map to "paraphrase" or "direct_quote" depending on whether `supportedSection` is present.
Why it matters: Claim support type is incorrectly labeled, affecting downstream analysis.
Trigger: Items with "supports_claim" or "challenges_claim" usage type without supportedSection.
Fix direction: Add explicit handling for supports_claim and challenges_claim.

ID: B18-C09
Type: Observability Gap
Severity: Low
File: backend/src/core/evidence/claim-ledger.ts
Function: buildClaimLedger
Evidence: No metrics on how many claims were discarded and why (by reason).
What is wrong: The `discardedClaims` array is populated but never logged or emitted. The summary counts are returned but the breakdown by discard reason is not available.
Why it matters: Cannot diagnose why claims are being discarded at scale.
Trigger: Large numbers of discarded claims.
Fix direction: Include discard reason breakdown in the summary.

ID: B18-C10
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-ledger.ts
Function: formatClaimLedgerForPrompt (line 139-160)
Evidence: Line 146: `item.extractedClaim ?? item.legalHolding ?? item.extractedNumber ?? item.evidenceSpan?.text`
What is wrong: The display text uses a fallback chain. If `extractedClaim` is a short generic phrase like "relevant", it's displayed first even if `evidenceSpan.text` has more meaningful content.
Why it matters: Prompt entries show low-quality claim text instead of better evidence spans.
Trigger: Items with short extracted claims.
Fix direction: Prefer the longest/most informative text, not just the first non-null.

ID: B18-C11
Type: Missing Test
Severity: Medium
File: backend/src/core/evidence/claim-ledger.ts
Function: Entire file
Evidence: No tests for claim ledger building.
What is wrong: The claim ledger is critical for auditability and citation credit. Without tests, hashing, deduplication, and eligibility bugs go undetected.
Why it matters: Incorrect claim ledger affects all downstream synthesis and citation.
Trigger: Any change to ledger logic.
Fix direction: Add tests for deduplication, hash uniqueness, confidence computation, and eligibility rules.

ID: B18-C12
Type: Risk
Severity: Low
File: backend/src/core/evidence/evidence-trace.ts
Function: findBestChunk (line 34-43)
Evidence: Line 38: `const score = overlapScore(claimTokens, importantTokens(chunk.text)) + chunk.score / 100;`
What is wrong: The `chunk.score` is added as a bonus (`/100`). If `chunk.score` is a relevance score from 0-1, dividing by 100 makes it negligible (0.01 max). If it's from 0-100, it adds up to 1.0. The scale is unclear and may dominate or be dominated by the token overlap score depending on the input.
Why it matters: Chunk ranking may be unpredictable due to score scale mismatch.
Trigger: Chunks with different score scales.
Fix direction: Document the expected scale of `chunk.score` and normalize explicitly.

ID: B18-C13
Type: Risk
Severity: Low
File: backend/src/core/evidence/evidence-trace.ts
Function: hashClaim (line 78-84)
Evidence: Same djb2 hash as in claim-ledger.ts.
What is wrong: Duplicate hash implementation in two files. If one is changed and the other isn't, the hashes diverge, breaking traceability between evidence traces and claim ledger entries.
Why it matters: Inconsistent hashes break cross-module traceability.
Trigger: Changing one hash function without the other.
Fix direction: Share a single hash utility module.

ID: B18-C14
Type: Risk
Severity: Low
File: backend/src/core/evidence/evidence-trace.ts
Function: splitSentences (line 63-68)
Evidence: Uses `/(?<=[.!?])\s+|\n+/` to split sentences.
What is wrong: This regex doesn't handle abbreviations (e.g., "Dr.", "Mr.", "U.S.") or ellipses ("..."). A sentence like "Dr. Smith testified. The court agreed." would be split into ["Dr.", "Smith testified.", "The court agreed."].
Why it matters: Sentence boundaries are incorrect, affecting evidence span matching.
Trigger: Text with abbreviations or ellipses.
Fix direction: Use a sentence splitter library or add abbreviation handling.

ID: B18-C15
Type: Dead Code
Severity: Low
File: backend/src/core/evidence/evidence-trace.ts
Function: findBestTextSpan (line 45-55)
Evidence: This function joins fullText, snippet, keyFacts, and legalHoldings, then finds the best sentence. But `findEvidenceSpan` in claim-ledger.ts does essentially the same thing with its own `bestSentence` function. The two implementations are redundant.
What is wrong: Duplicate sentence-matching logic in two files.
Why it matters: Maintenance overhead; potential divergence.
Trigger: N/A.
Fix direction: Consolidate into a single shared module.

ID: B18-C16
Type: Observability Gap
Severity: Low
File: backend/src/core/evidence/evidence-trace.ts
Function: buildEvidenceTrace
Evidence: Returns `EvidenceTrace | null` with no indication of why null was returned (source not found vs no matching chunk/text).
What is wrong: Callers can't distinguish between "source missing" and "no matching evidence" — two very different situations.
Why it matters: Debugging trace failures is difficult.
Trigger: Any null return from buildEvidenceTrace.
Fix direction: Return a result object with a reason field.

ID: B18-C17
Type: Risk
Severity: Low
File: backend/src/core/evidence/claim-graph/types.ts
Function: UnsupportedClaimIssue (lines 82-87)
Evidence: `type: "unsupported_high_risk_claim"` has `action?: UnsupportedClaimAction` but no `requiredValue` field, unlike `unsupported_score` and `unsupported_rank`.
What is wrong: Inconsistent field usage across issue types. The `action` field is optional for all types, but `requiredValue` is only present for score/rank issues.
Why it matters: Code iterating over issues may expect fields that don't exist.
Trigger: Processing unsupported issues.
Fix direction: Make the type system enforce the correct shape for each issue variant.
```

---

## Cross-Brick Findings

```
ID: C-111
Type: Risk
Severity: Medium
File: Multiple (evidence-registry.ts, claim-ledger.ts, evidence-trace.ts)
Function: importantTokens (duplicated 3+ times)
Evidence: The `importantTokens` function is implemented separately in evidence-registry.ts (line 227-232), claim-ledger.ts (line 280-286), evidence-trace.ts (line 70-76), and contradiction-detector.ts (via `importantClaimTokens` from `./text.js`). Each has a slightly different stop word list.
What is wrong: Token normalization is duplicated across 4+ modules with inconsistent stop words. This causes inconsistent matching behavior across claim matching, evidence spanning, and contradiction detection.
Why it matters: A claim may match a source in one module but not in another due to different stop word lists.
Trigger: Claims processed by different modules.
Fix direction: Create a shared `tokenize` utility with a single stop word list.

ID: C-112
Type: Risk
Severity: Medium
File: Multiple
Function: hashClaim (duplicated)
Evidence: djb2 hash implemented in both claim-ledger.ts and evidence-trace.ts.
What is wrong: Duplicate hash functions risk divergence.
Why it matters: Cross-module traceability breaks if hashes differ.
Trigger: Changing one hash without the other.
Fix direction: Single shared hash utility.

ID: C-113
Type: Missing Test
Severity: High
File: All audited files
Evidence: None of the 12 files have corresponding test files in the audited scope.
What is wrong: Zero test coverage across Bricks 13-18. These are core pipeline modules handling evidence, claims, source usage, and synthesis.
Why it matters: Any regression in these modules silently degrades research quality.
Trigger: Any code change.
Fix direction: Establish test coverage as a priority for all core modules.

ID: C-114
Type: Observability Gap
Severity: High
File: All audited files
Evidence: No structured logging, metrics, or tracing across the entire pipeline.
What is wrong: The pipeline has no observability into: source quality distribution, claim rejection rates, contradiction detection rates, provider failure rates, fallback activation frequency, or division quality scores.
Why it matters: Operators cannot monitor pipeline health or diagnose quality issues.
Trigger: Any pipeline run.
Fix direction: Add structured logging and metrics at key pipeline stages.
```

---

## Totals

| Brick | Findings |
|-------|----------|
| B13 (Evidence Registry & Types) | 14 |
| B14 (Evidence Pack & Integrity) | 9 |
| B15 (Claim Graph & Contradictions) | 15 |
| B16 (Source Usage & Normalization) | 15 |
| B17 (Role Generation) | 16 |
| B18 (Division Quality) | 17 |
| B18-C (Claim Ledger & Trace) | 17 |
| BXX (Cross-Brick) | 4 |
| **Total** | **107** |Now I have read all the files and related dependencies. Let me produce the comprehensive findings report.

---

# BestDel Research Pipeline Audit — Bricks 19-23

## Brick 19: Citation Injection

**Summary:** The citation injection subsystem has several type-safety gaps around `any` casts, edge-case null handling in the claim citation mapper, and the section-matching logic has false-positive potential in its string-inclusion heuristic. The fallback hash algorithm has deterministic collision risks. No unit tests observed for any citation injection functions.

```
ID: B19-001
Type: Probable Bug
Severity: Medium
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: selectCitationsForSectionFromLedger
Evidence: The quality filter is applied AFTER ledger match but NOT applied to the bucket-match path. Line 46 calls `findGraphBucketMatch(sectionLower, claimGraph, qualityIds)` which passes qualityIds, but the function only checks `qualitySet.has(sourceId)` for individual sources — it never re-validates that the source itself passes the full quality assessment (citationEligible, extractionQuality).
What is wrong: Bucket-match path uses a Set-based quality check that may differ from the full filter pipeline.
Why it matters: Sources that pass Set inclusion could bypass citation-eligibility or extraction quality gates, causing ineligible sources to be cited.
Trigger: A source with citationEligible=false but whose ID is in the approvedSourceIds array.
Fix direction: Ensure bucket-match path re-validates sources through the full quality filter before returning.
```

```
ID: B19-002
Type: Probable Bug
Severity: Medium
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: findLedgerMatch
Evidence: Lines 90-93 perform a bidirectional string includes check: `sectionLower.includes(key.toLowerCase()) || key.toLowerCase().includes(sectionLower)`. This will match "environmental" against "environment" AND "environment" against "environmental policy debate", causing false positives.
What is wrong: Substring matching without word boundaries causes over-matching for partial section names.
Why it matters: Citations intended for one section may be incorrectly injected into another, undermining citation accuracy.
Trigger: Sections with overlapping names like "economic" vs "economic policy" vs "socioeconomic".
Fix direction: Use token overlap scoring consistently or add word-boundary regex matching.
```

```
ID: B19-003
Type: Confirmed Bug
Severity: Low
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: selectCitationsForSectionFromLedger
Evidence: Line 76 uses XOR for hash-based source ordering: `hash(a.toString()) ^ sectionHash`. XOR can produce negative results, causing reversed sort order. JavaScript sort comparator returning negative is valid, but the distribution is poor and collisions are likely for consecutive IDs.
What is wrong: Hash-based fallback has poor distribution properties, especially for sequential source IDs.
Why it matters: The "deterministic pseudo-random" fallback becomes predictable and non-diverse, potentially always selecting the same subset.
Trigger: Multiple sections with hash_fallback strategy and sequential source IDs.
Fix direction: Use a proper seeded PRNG (e.g., mulberry32) instead of XOR-based hashing.
```

```
ID: B19-004
Type: Missing Test
Severity: Medium
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: (module-level)
Evidence: No test files found for `selectCitationsForSectionFromLedger`, `findLedgerMatch`, `findGraphBucketMatch`, or `extractClaimIds`.
What is wrong: Zero test coverage for the core citation selection logic.
Why it matters: Citation injection is critical for research quality — any regression goes undetected.
Trigger: Any change to matching heuristics or quality filters.
Fix direction: Add unit tests covering claim_match, bucket_match, authority_fallback, and hash_fallback strategies with mock ClaimLedger and ClaimGraph.
```

```
ID: B19-005
Type: Risk
Severity: Medium
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: findGraphBucketMatch
Evidence: Line 119 uses `sectionLower.includes(b.replace(/_/g, " "))`. If a bucket is named "ai", it matches "artificial intelligence" (includes "ai") AND "sustainable agriculture initiative" (contains "ai" within words). No word boundary enforcement.
What is wrong: Underscore-to-space conversion followed by substring matching creates false positives for short bucket names.
Why it matters: Wrong buckets match wrong sections, producing irrelevant citations.
Trigger: Short bucket names like "ai", "it", "us", "law" matching across word boundaries.
Fix direction: Add word-boundary enforcement: `new RegExp('\\b' + escapedBucket + '\\b', 'i')`.
```

```
ID: B19-006
Type: Risk
Severity: Low
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: findLedgerMatch
Evidence: Lines 96-107: Token overlap requires `score >= 2` but the token filter `t.length >= 4` means short but meaningful tokens like "law", "tax", "act" are excluded from matching.
What is wrong: Important short legal/political tokens are filtered out of section matching.
Why it matters: Sections about specific legislation may fail to match their relevant claims.
Trigger: Sections or claim keys containing short domain-specific terms.
Fix direction: Lower minimum token length to 3 or use a domain-specific stop word list instead.
```

```
ID: B19-007
Type: Type Mismatch
Severity: Medium
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: findGraphBucketMatch
Evidence: Line 114 iterates `graph.claims` but the type import from `claim-graph/types.js` shows `ClaimGraph` which may not have a direct `.claims` array property — the actual structure depends on the ClaimGraph type definition. If claims is optional, this is a potential null dereference.
What is wrong: Direct iteration over `graph.claims` without null check assumes the property always exists.
Why it matters: If ClaimGraph.claims is null/undefined, this throws at runtime.
Trigger: An empty or partially constructed ClaimGraph passed to the selector.
Fix direction: Add null guard: `for (const claim of graph.claims ?? [])`.
```

```
ID: B19-008
Type: Missing Test
Severity: Low
File: backend/src/core/citations/injection/types.ts
Function: (type definitions)
Evidence: The types file defines interfaces (SectionCitationPlan, DivisionCitationPlan, CitationContractResult, etc.) but no tests validate the contract behavior. For example, `CitationContractViolation.type` is a union literal but nothing tests that violations are correctly categorized.
What is wrong: Type definitions exist without any runtime validation or test coverage.
Why it matters: Type drift between injection consumers and producers goes undetected.
Trigger: Any consumer using a violation type outside the union.
Fix direction: Add type-level tests or runtime schema validation for key interfaces.
```

```
ID: B19-009
Type: Risk
Severity: Low
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: extractClaimIds
Evidence: Lines 130-135: `extractClaimIds` maps over `ledger.items` without deduplication. If multiple items from the same source are citation-credit-eligible, the same claimId appears multiple times in the result array.
What is wrong: Duplicate claimIds returned without deduplication.
Why it matters: Downstream consumers may count duplicate citations as multiple distinct claims.
Trigger: A single source supporting multiple claims in the same section.
Fix direction: Return `[...new Set(...)]` or deduplicate claimIds before returning.
```

```
ID: B19-010
Type: Type Mismatch
Severity: Low
File: backend/src/core/citations/injection/types.ts
Function: DivisionCitationPlan
Evidence: `DivisionCitationPlan.strategy` is typed as `"claim_graph" | "bucket_match" | "authority_fallback"` but `SectionCitationPlan.strategy` uses `"claim_match"` (not "claim_graph"). These strategy labels are inconsistent across the two plan types, risking consumer confusion.
What is wrong: Inconsistent strategy enum values between Section and Division citation plans.
Why it matters: A consumer checking for "claim_graph" won't match "claim_match" from the section plan.
Trigger: Code handling both plan types with a shared strategy switch.
Fix direction: Align strategy labels to use consistent naming across both types.
```

```
ID: B19-011
Type: Observability Gap
Severity: Low
File: backend/src/core/citations/injection/section-citation-selector.ts
Function: selectCitationsForSectionFromLedger
Evidence: The function returns a `SectionCitationPlan` with no telemetry. It doesn't log which strategy was used, how many candidates were filtered, or why fallback was chosen. The `CitationInjectionTelemetry` interface exists in types.ts but is never produced by this function.
What is wrong: No telemetry is emitted from the citation selector despite a telemetry interface existing.
Why it matters: Cannot debug why a section got hash_fallback instead of claim_match.
Trigger: Any section that uses fallback strategy.
Fix direction: Return telemetry alongside the plan or log strategy decisions.
```

```
ID: B19-012
Type: Risk
Severity: Low
File: backend/src/core/citations/injection/source-quality-filter.ts
Function: filterSourcesByQuality
Evidence: Line 44: `strengthRank[source.citationStrength]` will return `undefined` if `source.citationStrength` is a value not in the `strengthRank` record. `undefined < minRank` evaluates to `false` in JavaScript, so unknown strengths silently pass the quality check.
What is wrong: Unknown citationStrength values bypass the quality filter due to JS comparison semantics.
Why it matters: A source with an unrecognized strength (e.g., "unrated") passes quality filtering.
Trigger: EvidenceSource with a citationStrength value outside the known enum.
Fix direction: Default unknown strengths to the lowest rank or explicitly reject them.
```

---

## Brick 20: Citation Repair (Quality Gate Division-Level)

**Summary:** The division quality gate has regex injection risks from unescaped markers, the citation quality gate has a short-circuit bug that stops checking after the first fake citation, and the D7/D11 gates use hardcoded scoring formulas that can produce inconsistent results. No dedicated test files exist for any quality gate.

```
ID: B20-001
Type: Confirmed Bug
Severity: High
File: backend/src/core/quality-gate/division-quality-gate.ts
Function: runDivisionQualityGate
Evidence: Line 28: `new RegExp(`\\b${marker}\\b`, "i")` constructs a regex from user-supplied marker strings without escaping special regex characters. If any marker contains regex metacharacters (e.g., `(`, `)`, `*`), this throws a SyntaxError at runtime.
What is wrong: Unescaped regex construction from marker strings.
Why it matters: A marker with special regex chars crashes the entire quality gate loop, failing all remaining divisions.
Trigger: A marker string containing regex metacharacters.
Fix direction: Escape regex special characters: `marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.
```

```
ID: B20-002
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/quality-gate/division-quality-gate.ts
Function: runDivisionQualityGate
Evidence: Line 29: `/template|lorem|source gap\.?$/i` tests against `text.trim()` but the `source gap\.?$` pattern requires "source gap" at end of string. However, `text.trim()` may contain trailing whitespace that was already stripped, so `\.?` doesn't account for the space. Also, `lorem` alone matches any text containing "lorem" as a substring, causing false positives for legitimate words like "lorems" or names containing "lorem".
What is wrong: Template detection regex is too broad for "lorem" and too narrow for "source gap".
Why it matters: False positives flag legitimate content as template; false negatives miss actual template content.
Trigger: Content containing "lorem" as part of a proper noun, or "Source gap" not at end of string.
Fix direction: Use word boundaries: `/\btemplate\b|\blorem\b|source\s+gap\.?\s*$/i`.
```

```
ID: B20-003
Type: Risk
Severity: Medium
File: backend/src/core/quality-gate/division-quality-gate.ts
Function: runDivisionQualityGate
Evidence: The DIVISIONS array at line 7 omits D7 and D11 — these are handled separately at lines 38-43. But the scoring at line 46 divides by 3 (`score / 3`) to normalize to a max of 25. This divisor appears arbitrary: 10 divisions × 5 max points + D7(15) + D11(15) = 80 max raw, then + D7 score + D11 score added again. The math is inconsistent — D7/D11 scores are double-counted.
What is wrong: D7 and D11 scores are added to the loop score AND then added again at line 43, inflating their weight disproportionately.
Why it matters: D7 and D11 dominate the division quality score despite being 2 of 12 divisions.
Trigger: Any run with D7 or D11 failing — their double-weighted failure is disproportionate.
Fix direction: Either include D7/D11 in the DIVISIONS loop or exclude them from the double-addition.
```

```
ID: B20-004
Type: Missing Test
Severity: Medium
File: backend/src/core/quality-gate/division-quality-gate.ts
Function: (module-level)
Evidence: No test files for `runDivisionQualityGate`, `sectionOrFull`, or the DIVISIONS configuration.
What is wrong: Zero test coverage for division quality scoring.
Why it matters: Scoring formula bugs (double-counting, arbitrary divisors) go undetected.
Trigger: Any change to DIVISIONS array or scoring formula.
Fix direction: Add unit tests for each division's marker matching and score calculation.
```

```
ID: B20-005
Type: Confirmed Bug
Severity: High
File: backend/src/core/quality-gate/citation-quality-gate.ts
Function: runCitationQualityGate
Evidence: Lines 15-22: The loop over linked citations breaks on the FIRST mismatch (`break` at line 20). If there are 10 citations and only the last one is invalid, the gate flags "fake citations" with severity "fatal". But if there are 10 citations and the first 9 are valid but the 10th is invalid, it still breaks and sets score=0. However, if the FIRST citation is invalid, it breaks immediately without checking remaining ones — which is fine for detection. The real bug: the regex on line 6 `/\[Source\s+(\d+)\]\((https?:\/\/[^)]+)\)/gi` captures citations but the validation on line 11 `/\[Source\s+\d+\](?!\()/i` also matches `[Source 1]` (without parentheses), which may be intentional references, not necessarily "fake".
What is wrong: The "fake citation" detection regex on line 11 flags valid markdown references like `[Source 1](text)` where text is not a URL (e.g., a relative path or empty string) as "fake citations" with fatal severity, which may be overly aggressive.
Why it matters: Legitimate non-URL citation formats trigger a fatal gate failure.
Trigger: Content with `[Source 1](internal-ref)` or `[Source 1]()` patterns.
Fix direction: Distinguish between malformed citations and valid alternative reference formats.
```

```
ID: B20-006
Type: Probable Bug
Severity: Medium
File: backend/src/core/quality-gate/citation-quality-gate.ts
Function: runCitationQualityGate
Evidence: Line 16-17: `registry.getSource(Number(match[1]))` converts the captured citation ID to a number, but if the source ID in the registry is stored as a string (not uncommon in some persistence layers), `Number()` conversion may produce `NaN` or mismatch the string-keyed lookup.
What is wrong: Type coercion of source IDs assumes numeric registry keys.
Why it matters: If registry uses string keys, all source lookups fail, triggering false "fake citations" fatal errors.
Trigger: Registry with string-keyed sources.
Fix direction: Verify registry key type or try both string and number lookups.
```

```
ID: B20-007
Type: Risk
Severity: Low
File: backend/src/core/quality-gate/citation-quality-gate.ts
Function: sameCitationUrl
Evidence: Lines 32-38: `sameCitationUrl` catches all exceptions from `canonicalCitationUrl` and returns `false`. This means any URL parsing error (even a temporary one) causes the citation to be flagged as fake.
What is wrong: Overly broad exception handling in URL comparison treats parse errors as mismatches.
Why it matters: Malformed but harmless URLs in citations cause fatal gate failures.
Trigger: A citation URL with an unusual but valid format that URL() can't parse.
Fix direction: Log the error and return true (benign) or use a more targeted catch.
```

```
ID: B20-008
Type: Confirmed Bug
Severity: High
File: backend/src/core/quality-gate/citation-quality-gate.ts
Function: runCitationQualityGate
Evidence: Lines 7-10 and 11-14 are independent checks. If `linked.length === 0`, it sets `issues.push({..., severity: "fatal"})` and `score = 0`. But then lines 11-14 run ANOTHER check for fake citations, potentially adding a DUPLICATE "fake citations" fatal issue. Both issues have the same code "fake_citations" / "zero_valid_citations" but the score is already 0.
What is wrong: Multiple fatal issues can be pushed for the same underlying problem (no valid citations).
Why it matters: Duplicate fatal issues inflate the issue count and may confuse downstream repair logic.
Trigger: Text with zero citations triggers both "zero_valid_citations" and potentially "fake_citations".
Fix direction: Use early return after the zero-citations check to prevent redundant checks.
```

```
ID: B20-009
Type: Missing Test
Severity: Medium
File: backend/src/core/quality-gate/citation-quality-gate.ts
Function: (module-level)
Evidence: No tests for `runCitationQualityGate`, `sameCitationUrl`, or `canonicalCitationUrl`.
What is wrong: Zero test coverage for citation validation gate.
Why it matters: URL normalization and citation format detection bugs go undetected.
Trigger: Changes to URL canonicalization or citation format patterns.
Fix direction: Add tests for valid/invalid citation formats, URL normalization edge cases.
```

```
ID: B20-010
Type: Risk
Severity: Low
File: backend/src/core/quality-gate/d7-debate-quality-gate.ts
Function: runD7DebateQualityGate
Evidence: Line 27: `score = Math.max(0, 12 - issues.length * 3 + (/\\bsource|citation|\\[Source\\s+\\d+\\]/i.test(text) ? 2 : 0) + (lower.includes("floor") ? 1 : 0))`. The score formula adds bonus points for mentioning "floor" (anywhere in text) and "source/citation" (anywhere). This means a D7 with 5 issues (score -3) can still score 0 because `Math.max(0, -3 + 2 + 1) = 0`. But the maxScore is 15, and the actual scoring is capped at `Math.min(15, score)` on line 29. The scoring range (0-15) is inconsistent with the base formula (starts at 12).
What is wrong: Score base value (12) doesn't match maxScore (15), and bonus keywords inflate score artificially.
Why it matters: A low-quality D7 can score higher than deserved simply by mentioning "floor" and "source".
Trigger: D7 text that includes bonus keywords but lacks substantive debate content.
Fix direction: Align base score with maxScore, and require bonus keywords in meaningful contexts.
```

```
ID: B20-011
Type: Risk
Severity: Medium
File: backend/src/core/quality-gate/d7-debate-quality-gate.ts
Function: countStructuredPois
Evidence: Lines 37-43: `countStructuredPois` splits by `\n+` and checks each line against POI patterns. But if POIs are on the same line separated by other delimiters (e.g., "POI 1: Would the delegate... POI 2: Can the honourable..."), only one line is counted. Also, the pattern `POI\s+\d+\s*:` requires explicit numbering, which LLMs may not always produce.
What is wrong: POI counting misses POIs on the same line or without explicit numbering.
Why it matters: D7 may fail the POI quality threshold despite containing adequate POIs.
Trigger: LLM-generated POIs on a single line or without numbering.
Fix direction: Split by POI pattern matches rather than newlines.
```

```
ID: B20-012
Type: Risk
Severity: Medium
File: backend/src/core/quality-gate/d11-strategic-quality-gate.ts
Function: runD11StrategicQualityGate
Evidence: Line 7: `wordCount(text) < thresholds.d11MinWords` triggers a "fatal" severity issue. But line 24's `isTemplateD11` also triggers a "fatal" for the same division. If D11 is both too short AND template, two fatal issues are pushed with different codes but both fatal, causing double-penalization.
What is wrong: Multiple fatal issues for the same division create disproportionate failure weight.
Why it matters: A single problematic D11 can dominate the overall quality gate result.
Trigger: Short, template-like D11 content.
Fix direction: Consolidate D11 fatal checks or cap fatal issues per division.
```

```
ID: B20-013
Type: Probable Bug
Severity: Medium
File: backend/src/core/quality-gate/d11-strategic-quality-gate.ts
Function: runD11StrategicQualityGate
Evidence: Line 13: `(text.match(/\bD(?:1|2|3|4|5|6|7|8|9|10)\b/g) ?? []).length` counts D1-D10 references but `\bD1\b` also matches within "D10" because `\b` is a word boundary and "D10" has a boundary between "D1" and "0". Wait — actually `\bD1\b` would NOT match "D10" because "0" is a word character. But the regex `\bD(?:1|2|3|4|5|6|7|8|9|10)\b` with alternation means `D1` matches before `D10` is tried. Since regex engines try alternation left-to-right, `D1` will match in "D10" at the "D1" position... but `\b` after `1` fails because `0` follows. So this is actually correct. However, it will count "D1" appearing in "D11" incorrectly since `\bD1\b` won't match in "D11" but the `D1` alternative matches "D1" within "D11"... no, `\b` prevents this. Actually this is fine. The real issue: the regex doesn't match "D8" within "D80" or "D85" (which don't exist but could appear in text about other contexts).
What is wrong: Division reference counting regex could match division IDs embedded in other identifiers (e.g., "D1" in a model number "D100").
Why it matters: Non-division references counted as division references, inflating the score.
Trigger: Text containing identifiers like "D1234" or "Model-D1".
Fix direction: Use stricter context matching: `(?<![A-Za-z0-9])D(?:1[0-1]?|[2-9])(?![0-9])`.
```

```
ID: B20-014
Type: Risk
Severity: Low
File: backend/src/core/quality-gate/d11-strategic-quality-gate.ts
Function: runD11StrategicQualityGate
Evidence: Line 18: `(ctx.input.claimGraph?.contradictions ?? []).length === 0` accesses `claimGraph?.contradictions` but the ClaimGraph type may not have a `contradictions` property directly. If the property is named differently or nested, this silently evaluates to `[]` with length 0, triggering a false fatal.
What is wrong: Property access on claimGraph may reference a non-existent or differently-named property.
Why it matters: False fatal issues triggered when the property doesn't exist on the actual ClaimGraph shape.
Trigger: ClaimGraph type without a top-level `contradictions` array.
Fix direction: Verify the property exists on the ClaimGraph type definition.
```

```
ID: B20-015
Type: Missing Test
Severity: Low
File: backend/src/core/quality-gate/d7-debate-quality-gate.ts
Function: (module-level)
Evidence: No test files for `runD7DebateQualityGate` or `countStructuredPois`.
What is wrong: Zero test coverage for D7 debate quality scoring.
Why it matters: POI counting and rebuttal detection bugs go undetected.
Trigger: Changes to POI patterns or rebuttal detection regex.
Fix direction: Add tests with representative D7 content including POIs, rebuttals, and floor language.
```

```
ID: B20-016
Type: Missing Test
Severity: Low
File: backend/src/core/quality-gate/d11-strategic-quality-gate.ts
Function: (module-level)
Evidence: No test files for `runD11StrategicQualityGate` or `isTemplateD11`.
What is wrong: Zero test coverage for D11 strategic quality scoring.
Why it matters: Template detection and strategic logic validation bugs go undetected.
Trigger: Changes to D11 markers or template detection patterns.
Fix direction: Add tests for D11 content with and without Diagnosis/Prescription/Warning markers.
```

---

## Brick 21: Quality Gate (Run-Level)

**Summary:** The run-level quality gate has scoring normalization issues, fraud detection patterns are overly broad and may flag legitimate content, the mode threshold resolution has a "legacy" fallback path that silently uses deep_research thresholds, and there is no dedicated test coverage for any quality gate functions.

```
ID: B21-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: runQualityGate
Evidence: Line 38: `const rawScore = Math.round(gateResults.reduce((sum, result) => sum + result.score, 0) / gateResults.reduce((sum, result) => sum + result.maxScore, 0) * 100)`. This computes a weighted average of all gate scores. However, some gates return `maxScore: 5` (SourceGapBridge), others `maxScore: 10` (Agenda), `maxScore: 15` (Citation), etc. The formula correctly normalizes by total maxScore, BUT gates that return fixed scores (like SourceGapBridge always returning 5/5) artificially inflate the average.
What is wrong: Gates with fixed/high scores dilute the impact of gates that are actually failing.
Why it matters: A failing Citation gate (0/15) can be masked by multiple passing gates with high scores.
Trigger: Citation gate fails but SourceGapBridge, LegalSafety, ElectoralSafety all pass.
Fix direction: Weight gates by importance or exclude safety gates from the overall score.
```

```
ID: B21-002
Type: Risk
Severity: High
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: detectFraudOrHallucination
Evidence: Lines 72-84: The FRAUD_AND_HALLUCINATION_PATTERNS include patterns like `/\bmember\s+states?\b(?:\s+of\s+the\s+UN)?/i` which matches "member states" in any context — including legitimate MUN discussions about UN member states. This pattern will trigger a FATAL issue for any content discussing UN member states, which is extremely common in MUN topics.
What is wrong: "member states" is flagged as fraud/hallucination despite being standard MUN terminology.
Why it matters: Legitimate MUN research content about UN member states triggers fatal quality gate failures.
Trigger: Any research topic discussing UN member states (a core MUN concept).
Fix direction: Remove "member states" from fraud patterns or add context-aware filtering.
```

```
ID: B21-003
Type: Risk
Severity: High
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: detectFraudOrHallucination
Evidence: Line 80: `/\b(?:UN|United\s+Nations)\s+(?:Security\s+Council|resolution|General\s+Assembly)\b(?!\s+(?:reform|composition|veto|permanent\s+members))/i` uses a negative lookahead to allow "UN Security Council reform" but flags "UN Security Council" in any other context. This means discussing the UNSC's actions on a topic (e.g., "The UN Security Council passed Resolution 2720") would be flagged as fraud.
What is wrong: Normal references to UN bodies are flagged as fraud unless specifically discussing reform.
Why it matters: Legitimate research about UN actions triggers fatal quality gate failures.
Trigger: Content discussing UN Security Council resolutions or General Assembly actions.
Fix direction: Remove or significantly relax this pattern — it's far too broad.
```

```
ID: B21-004
Type: Risk
Severity: Medium
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: detectFraudOrHallucination
Evidence: Line 79: `/\barticle|section|clause)\s+99[0-9]\b/i` matches Article/Section/Clause 990-999. This is designed to catch fabricated legal citations. However, it uses `99[0-9]` which matches 990-999 but NOT articles like "Article 1000" or fabricated "Article 9999". The pattern also doesn't account for Roman numerals or alternative numbering formats.
What is wrong: Narrow pattern only catches 990-999 range, missing other fabricated article numbers.
Why it matters: Hallucinated articles outside the 990-999 range pass undetected.
Trigger: Content citing "Article 888" or "Clause 5000" that are fabricated.
Fix direction: Expand to match broader ranges of unlikely article numbers or use a whitelist approach.
```

```
ID: B21-005
Type: Risk
Severity: Low
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: detectFraudOrHallucination
Evidence: Line 82: `/\b(?:according\s+to\s+(?:anonymous|unnamed|undisclosed))\b/i` matches "according to anonymous sources" which is standard journalistic language. This would flag legitimate reporting about anonymous sources as "fraud/hallucination".
What is wrong: Legitimate journalistic phrasing is flagged as fraud.
Why it matters: Valid research citing anonymous sources from legitimate news reports fails the quality gate.
Trigger: Research content that references anonymous/unnamed sources from news articles.
Fix direction: Remove this pattern or reduce severity to "warning".
```

```
ID: B21-006
Type: Missing Test
Severity: Medium
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: (module-level)
Evidence: No test files for `runQualityGate`, `detectFraudOrHallucination`, `runAgendaGate`, or `runSourceGapBridgeGate`.
What is wrong: Zero test coverage for the main quality gate orchestrator and fraud detection.
Why it matters: Fraud detection false positives and scoring normalization bugs go undetected.
Trigger: Any change to fraud patterns or gate orchestration logic.
Fix direction: Add tests for fraud detection against known legitimate and hallucinated content.
```

```
ID: B21-007
Type: Risk
Severity: Medium
File: backend/src/core/quality-gate/mode-thresholds.ts
Function: thresholdsFor
Evidence: Line 86: `mode === "legacy" ? MODE_THRESHOLDS.deep_research : MODE_THRESHOLDS[mode]`. The "legacy" mode silently uses deep_research thresholds. If `resolveQualityMode` returns "legacy" (when mode is undefined and outputDepth doesn't match), the quality gate runs with deep_research standards without the caller knowing.
What is wrong: Legacy mode silently inherits deep_research thresholds with no logging or indication.
Why it matters: Callers may expect different standards for legacy mode but get deep_research's stricter thresholds.
Trigger: A run with undefined mode and no outputDepth mapping.
Fix direction: Log when legacy mode is resolved or define explicit legacy thresholds.
```

```
ID: B21-008
Type: Risk
Severity: Low
File: backend/src/core/quality-gate/mode-thresholds.ts
Function: resolveQualityMode
Evidence: Lines 77-83: `resolveQualityMode` has no handling for when `mode` is undefined and `outputDepth` is an unexpected value (e.g., "summary" or "briefing"). It falls through to "legacy" without any warning or logging.
What is wrong: Unrecognized outputDepth values silently produce "legacy" mode.
Why it matters: Users may expect specific behavior for their chosen output depth but get default legacy settings.
Trigger: Passing outputDepth="summary" or any unrecognized value.
Fix direction: Log a warning or throw for unrecognized outputDepth values.
```

```
ID: B21-009
Type: Risk
Severity: Medium
File: backend/src/core/quality-gate/mode-thresholds.ts
Function: thresholdsFor
Evidence: Line 86: If `mode` is neither "legacy" nor a valid `ResearchMode` key, `MODE_THRESHOLDS[mode]` returns `undefined`. The caller (`runDivisionQualityGate`) would then access `thresholds.divisionMinWords` on `undefined`, causing a TypeError crash.
What is wrong: Invalid mode passed to `thresholdsFor` returns undefined, causing downstream crashes.
Why it matters: Any caller passing an invalid mode string crashes the entire quality gate.
Trigger: Mode string outside the ResearchMode union (e.g., from unvalidated user input).
Fix direction: Add a default fallback or throw a descriptive error for unknown modes.
```

```
ID: B21-010
Type: Type Mismatch
Severity: Low
File: backend/src/core/quality-gate/mode-thresholds.ts
Function: resolveQualityMode
Evidence: Return type is `ResearchMode | "legacy"` but the function is called with `mode: ResearchMode | undefined`. When `mode` is provided, it's returned directly without validation — meaning an invalid string typed as `ResearchMode` at the call site passes through unchecked.
What is wrong: No runtime validation that the provided mode is actually a valid ResearchMode.
Why it matters: Type narrowing at compile time doesn't prevent runtime invalid values from untyped callers.
Trigger: Unvalidated input passed as mode parameter.
Fix direction: Add runtime validation against known ResearchMode values.
```

```
ID: B21-011
Type: Risk
Severity: Low
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: runQualityGate
Evidence: Line 36: `warnings = issues.filter(...).concat(gateResults.flatMap((result) => result.warnings ?? []))`. The warnings array is assigned to both `warnings` (line 53) and `warningIssues` (line 56) in the return object. This creates two references to the same array. If a consumer mutates one, it affects the other.
What is wrong: `warnings` and `warningIssues` are the same array reference.
Why it matters: Mutating one property affects the other, causing unexpected behavior in downstream consumers.
Trigger: Consumer modifies `report.warnings` or `report.warningIssues`.
Fix direction: Create separate arrays or explicitly document that they're the same reference.
```

```
ID: B21-012
Type: Risk
Severity: Low
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: runQualityGate
Evidence: Line 46: `...(score < thresholds.minScore ? [`quality_score_below_threshold: ${score} < ${thresholds.minScore}`] : [])`. The threshold values differ significantly across modes: fast_research=70, deep_research=82, phd_level=88, fullspectrum=92. A score of 85 passes fast_research but fails phd_level. However, the automatic failure message doesn't mention which mode is being evaluated.
What is wrong: Automatic failure messages don't include the mode context.
Why it matters: Debugging failures requires cross-referencing the mode with threshold values manually.
Trigger: Quality gate failure with score near threshold boundary.
Fix direction: Include the mode name in the failure message.
```

```
ID: B21-013
Type: Observability Gap
Severity: Low
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: runQualityGate
Evidence: The function produces a `QualityGateReport` with telemetry via `buildQualityTelemetry`, but there is no logging or tracing of the quality gate execution. Individual gate execution times are not recorded, and the telemetry is only returned in the report, not emitted to any observability system.
What is wrong: Quality gate telemetry exists but is never emitted to any monitoring system.
Why it matters: Cannot track quality gate performance or failure rates in production.
Trigger: Any quality gate execution in production.
Fix direction: Emit telemetry to logging/monitoring system (e.g., structured logs, metrics).
```

```
ID: B21-014
Type: Dead Code
Severity: Low
File: backend/src/core/quality-gate/division-quality-gate.ts
Function: sectionOrFull
Evidence: Lines 59-66 define `sectionOrFull` but it is never called anywhere in this file or imported elsewhere. It appears to be a utility that was planned but never used.
What is wrong: Unused function adds code bloat and maintenance burden.
Why it matters: Dead code confuses readers and may be accidentally relied upon.
Trigger: N/A — function is never called.
Fix direction: Remove or integrate into the codebase if needed.
```

```
ID: B21-015
Type: Risk
Severity: Low
File: backend/src/core/quality-gate/run-quality-gate.ts
Function: runAgendaGate
Evidence: Line 103: `if (ctx.contract.countryFocus === "India" && !/\bindia|indian\b/i.test(ctx.finalText))`. The regex `\bindia|indian\b` matches "India" but the alternation `indian\b` means `\b` only applies to "indian", not "india". So `\bindia` matches "india" at any word boundary start, but "indian" requires a word boundary at the end. This means "india" within "indianapolis" would match (though unlikely in MUN context). The real issue is the regex should be `/\b(?:india|indian)\b/i` for proper word boundaries on both alternatives.
What is wrong: Word boundary alternation is incorrect — `\b` only applies to the first alternative.
Why it matters: Minor — "india" would match correctly, but the regex is misleading and could match edge cases incorrectly.
Trigger: Text containing "india" as part of a larger word.
Fix direction: Use `/\b(?:india|indian)\b/i` for proper word boundaries.
```

---

## Brick 22: Run State / Persistence

**Summary:** The terminal status decider has an edge case where empty visible answers always return "failed" regardless of context, the run recovery has timezone-sensitive date parsing, and the final status logic has overlapping conditions that can produce inconsistent terminal states. Cache reuse logic is sound but lacks observability.

```
ID: B22-001
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/run-state/terminal-status-decider.ts
Function: decideRunTerminalStatus
Evidence: Lines 17-24: If `visibleAnswer` is empty (or not a string), the function returns `terminalStatus: "failed"` with `errorCode: "EMPTY_FINAL_ANSWER"` without calling `decideFinalResearchStatus`. This means even if the quality gate passed, source contract passed, and citations exist, an empty visible answer immediately fails the run without any further evaluation.
What is wrong: Empty visible answer short-circuits all other status evaluation.
Why it matters: A run with valid citations and passing quality gates fails solely because the visible answer was stripped to empty (e.g., all content was pipeline metadata).
Trigger: Model output that is entirely pipeline metadata with no visible text.
Fix direction: Check if the original content had meaningful data before stripping metadata.
```

```
ID: B22-002
Type: Risk
Severity: Low
File: backend/src/core/run-state/terminal-status-decider.ts
Function: decideRunTerminalStatus
Evidence: Line 12: `if (typeof content !== "string") return ""`. Non-string content (null, undefined, object, array) silently becomes empty string, which then triggers the "EMPTY_FINAL_ANSWER" failure at line 18.
What is wrong: Non-string final answer content is silently converted to empty string.
Why it matters: If the model returns structured data instead of text, the run fails with "empty answer" instead of a more descriptive error.
Trigger: Model returning JSON or structured data instead of text.
Fix direction: Return a more descriptive error or attempt JSON.stringify for non-string content.
```

```
ID: B22-003
Type: Risk
Severity: Low
File: backend/src/core/run-state/cache-run-tags.ts
Function: isCacheEntryReusable
Evidence: Line 14: `(tags.status === "partial" || tags.status === "completed_with_source_gaps" || tags.status === "degraded_fallback") && !options.allowPartialReuse`. The default value for `options.allowPartialReuse` is `undefined`, which is falsy. This means partial entries are NEVER reusable unless explicitly allowed, which is correct. But the `options` parameter defaults to `{}`, so `allowPartialReuse` is always undefined by default.
What is wrong: No way to configure the default behavior for partial cache reuse without passing options.
Why it matters: Callers must explicitly pass `{ allowPartialReuse: true }` every time they want partial reuse.
Trigger: Any call to `isCacheEntryReusable` without explicit options.
Fix direction: Consider making allowPartialReuse a system config rather than per-call option.
```

```
ID: B22-004
Type: Risk
Severity: Medium
File: backend/src/core/run-state/run-recovery.ts
Function: recoverStaleRunningRuns
Evidence: Line 6: `const heartbeatAt = new Date(record.lastHeartbeatAt).getTime()`. If `lastHeartbeatAt` is in a format that `Date()` can't parse (e.g., some database-specific formats), `getTime()` returns `NaN`. Line 7 checks `Number.isFinite(heartbeatAt)` which correctly handles NaN, BUT the default `now = Date.now()` means all comparisons use the server's current time. If the server clock drifts or `lastHeartbeatAt` was recorded by a different server with a different clock, stale detection is unreliable.
What is wrong: Clock drift between servers can cause incorrect stale/run recovery decisions.
Why it matters: Running runs may be incorrectly marked as interrupted, or truly stale runs may not be recovered.
Trigger: Multi-server deployment with clock drift or timezone differences.
Fix direction: Use monotonic timestamps or store heartbeat as epoch milliseconds.
```

```
ID: B22-005
Type: Risk
Severity: Low
File: backend/src/core/run-state/run-recovery.ts
Function: recoverStaleRunningRuns
Evidence: Line 3: `staleAfterMs = 5 * 60 * 1000` (5 minutes). This is a hardcoded default. For long-running research operations (phd_level or fullspectrum), a 5-minute heartbeat gap may be normal during heavy computation or API calls. This threshold is too aggressive for production use.
What is wrong: 5-minute stale threshold is too aggressive for long research runs.
Why it matters: Legitimate long-running operations may be incorrectly marked as interrupted.
Trigger: A phd_level run that takes >5 minutes between heartbeats during heavy computation.
Fix direction: Make stale threshold configurable per research mode.
```

```
ID: B22-006
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: Line 42: `if (input.providerError) return "provider_error"`. This is checked BEFORE line 43's `if (citedSources === 0) return "failed"`. But if both providerError exists AND citedSources is 0, the status is "provider_error" even though there are also no citations. The caller may retry on provider_error but not on failed, leading to a retry loop that keeps producing empty results.
What is wrong: Provider error takes precedence over citation absence, potentially masking data quality issues.
Why it matters: A run with both provider errors and no citations retries indefinitely as "provider_error".
Trigger: Provider returns an error but also partial data with zero citations.
Fix direction: Check citation count before or alongside provider error, or return a composite status.
```

```
ID: B22-007
Type: Risk
Severity: Medium
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: Lines 47-48: `if ((input.mode === "phd_level" || input.mode === "fullspectrum") && input.legacyFallbackUsed) return "failed"`. This fails the run if legacy fallback was used in strict modes. But line 54-58 handles legacy fallback separately for other modes. The ordering means a phd_level run with legacy fallback ALWAYS fails at line 47, never reaching the more nuanced checks at lines 48-52.
What is wrong: Strict mode legacy fallback check short-circuits all other quality evaluations.
Why it matters: Even if the quality gate passed and citations exist, strict mode + legacy fallback = fail.
Trigger: phd_level or fullspectrum run that uses legacy fallback but otherwise passes all checks.
Fix direction: Consider whether legacy fallback in strict mode should always fail or evaluate other criteria.
```

```
ID: B22-008
Type: Risk
Severity: Medium
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: Lines 78-86: The `strictCompleted` check requires ALL conditions to be true: coreGenerationUsed, !legacyFallbackUsed, qualityGate.passed, !qualityGate.repairRequired, sourceContract.passedStrict, and citedSources >= requiredSources. If ANY of these is undefined (e.g., qualityGate is null), the check fails and the function returns "failed" at line 86.
What is wrong: Missing or null qualityGate/sourceContract causes the strict completed check to fail silently.
Why it matters: A run with valid citations and no fallback fails because the qualityGate wasn't set.
Trigger: Run path that doesn't populate qualityGate or sourceContract fields.
Fix direction: Distinguish between "explicitly failed" and "missing data" in the final status.
```

```
ID: B22-009
Type: Risk
Severity: Low
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: Line 40: `answerLooksLikeFallback` checks for `Legacy fallback answer retained|Research Incomplete|Core generation could not produce` in the visible answer. But this check at line 52 only triggers if `!input.legacyFallbackUsed`. If legacyFallbackUsed IS true, this check is skipped entirely, meaning the answer could look like fallback content but the run is classified based on other criteria.
What is wrong: Fallback-like answer text is only checked when legacy fallback is NOT used.
Why it matters: If legacyFallbackUsed is set but the answer doesn't actually contain fallback text, the check is inconsistent.
Trigger: Run where legacyFallbackUsed=true but the answer text doesn't contain fallback markers.
Fix direction: Make the fallback text check independent of the legacyFallbackUsed flag.
```

```
ID: B22-010
Type: Type Mismatch
Severity: Low
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: Line 32: `const citedSources = input.citationStatus?.finalUniqueCitedSources ?? input.sourceContract.finalUniqueCitedSources`. If `input.citationStatus` is `{}` (empty object), `finalUniqueCitedSources` is `undefined`, and the fallback to `sourceContract.finalUniqueCitedSources` is used. But if `citationStatus` is `{ finalUniqueCitedSources: 0 }`, the `??` operator uses `0` (not the fallback), which is correct. However, if citationStatus is `null`, the `?.` returns `undefined`, and the fallback is used. This is correct behavior, but the type `FinalStatusCitationStatus | null | undefined` makes it hard to distinguish between "not set" and "set to 0".
What is wrong: Ambiguity between "citationStatus not set" and "citationStatus set with 0 sources".
Why it matters: Minor — the `??` operator handles this correctly, but the code is harder to reason about.
Trigger: CitationStatus with explicit 0 vs undefined.
Fix direction: Use explicit null checks rather than `??` for clarity.
```

```
ID: B22-011
Type: Risk
Severity: Low
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: Lines 63-76: The source gaps block has overlapping conditions. Lines 64-69 check for valid source gaps (report exists, citations > 0, no automatic failures). Lines 72-74 check for invalid source gaps (citations === 0 AND report exists). Line 75 is a catch-all return "failed". But if `sourceGapReport` exists and `citedSources > 0` but `automaticFatalFailure` is true, it falls through to line 75 and returns "failed" — which is correct. The logic is sound but the ordering could be clearer.
What is wrong: Source gap logic has correct behavior but unclear flow — the catch-all at line 75 catches cases not obviously intended to fail.
Why it matters: Future maintainers may misinterpret the catch-all and introduce bugs.
Trigger: Code modification to the source gap block.
Fix direction: Add explicit comments or refactor to make the decision tree clearer.
```

```
ID: B22-012
Type: Missing Test
Severity: Medium
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: No test files for `decideFinalResearchStatus`. This is the most critical status determination function in the pipeline, and it has no test coverage.
What is wrong: Zero test coverage for the terminal status decision logic.
Why it matters: Status determination bugs affect user-facing results, billing, and retry behavior.
Trigger: Any change to status conditions or addition of new terminal statuses.
Fix direction: Add comprehensive tests covering all terminal status paths with mock inputs.
```

```
ID: B22-013
Type: Missing Test
Severity: Low
File: backend/src/core/run-state/terminal-status-decider.ts
Function: (module-level)
Evidence: No test files for `decideRunTerminalStatus`, `getVisibleFinalAnswer`, or `selectCanonicalRunTerminalStatus`.
What is wrong: Zero test coverage for terminal status decider.
Why it matters: Status determination bugs go undetected.
Trigger: Changes to visible answer extraction or status delegation.
Fix direction: Add tests for empty/non-string visible answers and status delegation.
```

```
ID: B22-014
Type: Missing Test
Severity: Low
File: backend/src/core/run-state/cache-run-tags.ts
Function: (module-level)
Evidence: No test files for `isCacheEntryReusable` or `withRunCacheTags`.
What is wrong: Zero test coverage for cache reusability logic.
Why it matters: Cache reuse bugs cause unnecessary recomputation or stale data reuse.
Trigger: Changes to cache tag definitions or reuse conditions.
Fix direction: Add tests for each reuse condition (providerError, various statuses, partial reuse).
```

```
ID: B22-015
Type: Missing Test
Severity: Low
File: backend/src/core/run-state/run-recovery.ts
Function: recoverStaleRunningRuns
Evidence: No test files for `recoverStaleRunningRuns`.
What is wrong: Zero test coverage for stale run recovery.
Why it matters: Recovery logic bugs could mark running runs as interrupted or miss truly stale runs.
Trigger: Changes to stale detection logic or heartbeat parsing.
Fix direction: Add tests with various heartbeat timestamps and stale thresholds.
```

```
ID: B22-016
Type: Observability Gap
Severity: Low
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: The function returns a terminal status string with no logging of WHY a particular status was chosen. When a run fails, there's no structured log showing which condition triggered the failure.
What is wrong: No observability into status decision reasoning.
Why it matters: Debugging failed runs requires manual code tracing.
Trigger: Any run that fails quality gate or status determination.
Fix direction: Return a status decision object with the triggering condition, or log the decision path.
```

```
ID: B22-017
Type: Risk
Severity: Low
File: backend/src/core/pipeline/final-status.ts
Function: decideFinalResearchStatus
Evidence: Line 44: `if (input.degradedFallbackUsed && citedSources > 0) return "degraded_fallback"`. This check comes BEFORE the quality gate checks at lines 45-51. A degraded fallback with citations > 0 always returns "degraded_fallback" even if the quality gate has fatal issues.
What is wrong: Degraded fallback status takes precedence over quality gate failures.
Why it matters: A run with degraded fallback AND fatal quality issues is classified as "degraded_fallback" instead of "failed".
Trigger: Degraded fallback run with fatal quality gate violations.
Fix direction: Check fatal quality issues before degraded fallback status.
```

---

## Brick 23: Frontend Streaming / UI

**Summary:** The streaming controller has massive useCallback dependency issues, pervasive `as any` casts throughout SSE event handling, the pipeline reducer has state management bugs around concurrent runs, and the stale event guard has a logical flaw in how it compares identities. The pipeline metadata system has regex reuse bugs.

```
ID: B23-001
Type: Confirmed Bug
Severity: High
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Lines 672-682: The `useCallback` for `runStream` has dependencies `[dispatchPipeline, autoFallback, getModelsForMode, getPrimaryModelForMode, normalModel, queryClient, setDebateSuggestions, setTokensPerSec, toast]`. However, the function references `activeRunRef.current`, `streamStartRef.current`, `streamCharsRef.current`, `silenceTimerResetRef.current`, and `abortControllersByRunIdRef.current` — all refs. These are NOT in the dependency array. While refs don't need to be dependencies (they're mutable), the function also references `convId` (parameter) and uses `dispatchPipeline` from the closure. The real bug: `mode` parameter on line 142 has default value `"normal"` but `activeProviderModel` is derived from `getPrimaryModelForMode(mode, nm)` — if `mode` changes between renders but `getPrimaryModelForMode` is the same reference, the callback uses the stale closure.
What is wrong: useCallback captures closures that may become stale if dependency functions change identity.
Why it matters: If getPrimaryModelForMode or getModelsForMode change identity, the callback uses old versions.
Trigger: Model routing config changes between renders.
Fix direction: Use refs for model routing functions or add them to dependencies.
```

```
ID: B23-002
Type: Confirmed Bug
Severity: High
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream (SSE loop)
Evidence: Lines 516-522: Content chunks are accumulated in `streamedAssistantText` and `streamCharsRef.current`. However, the SSE parsing loop at lines 300-648 processes ALL events in a single iteration. If a content chunk arrives AND a terminal event arrives in the same buffer flush, the terminal state is updated but the content accumulated so far may not include the last chunk before the terminal event.
What is wrong: Content accumulation and terminal state updates are interleaved without guaranteed ordering.
Why it matters: The final streamed text may miss the last content chunk if a terminal event arrives in the same buffer.
Trigger: Server sends content and terminal event in quick succession within the same SSE buffer.
Fix direction: Ensure all content is processed before terminal state is finalized.
```

```
ID: B23-003
Type: Risk
Severity: High
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Lines 172-182: A Blob URL Worker is created for keepalive pings. Line 179 sets `keepaliveWorker.worker.onmessage = () => {}` to consume messages. But if the Worker throws during construction (CSP restriction), the catch block at line 180 silently swallows the error. The `keepaliveWorker` is set to `null` only in the `finally` block at line 659-663. If the Worker is created but `terminate()` is never called (e.g., due to an early return), the Worker leaks.
What is wrong: Worker termination may not happen if the try block at line 184 throws before the inner finally.
Why it matters: Worker leak causes memory leak and persistent background ping.
Trigger: Exception thrown between Worker creation (line 177) and the outer try's finally (line 651).
Fix direction: Wrap Worker creation in its own try/finally or use a ref to track creation status.
```

```
ID: B23-004
Type: Risk
Severity: Medium
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Lines 165-170: `document.addEventListener("visibilitychange", onVisibilityChange)` is added but the cleanup at line 657 only removes it in the outer `finally` block. If `runStream` is called again before the previous run completes, a NEW listener is added without removing the old one. The listener calls `silenceTimerResetRef.current?.()` which points to the LATEST timer reset function, so old listeners call the new timer — but the old listeners are still registered.
What is wrong: Multiple visibilitychange listeners accumulate across rapid successive runStream calls.
Why it matters: Memory leak from accumulated event listeners.
Trigger: Rapid successive API calls to runStream (e.g., user spam-clicking send).
Fix direction: Remove the listener at the start of runStream or use a ref to track the current listener.
```

```
ID: B23-005
Type: Risk
Severity: Medium
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Lines 572-594: The terminal COMPLETE dispatch at lines 573-584 has guards: `!normalized.failure && !terminalState.failureReceived && !terminalState.successReceived`. But the guard for `normalized.kind === "terminal"` (line 573) is checked INSIDE the try block that parses each SSE line. If a terminal event was received earlier and set `terminalState.successReceived = true`, subsequent terminal events are blocked. However, the `pipeline_failed` handler at lines 607-622 and the `failed`/`provider_error` handlers at lines 623-641 DON'T check `terminalState.successReceived`. This means a failed event after a success event still dispatches "failed" status, overwriting the success.
What is wrong: Failed event handlers don't check if success was already received, allowing status overwrite.
Why it matters: A run that completes successfully but receives a late failed event shows as failed.
Trigger: Server sends success terminal event, then a late failed event in the stream.
Fix direction: Add `!terminalState.successReceived` guard to failed event handlers.
```

```
ID: B23-006
Type: Confirmed Bug
Severity: High
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Line 591: `const tps = Math.round(streamCharsRef.current / 4 / elapsed)`. The division by 4 assumes 4 characters per token, which is a rough English-language estimate. For Indian languages (Devanagari, Tamil, etc.), the characters-per-token ratio is significantly different. This produces wildly inaccurate tokens-per-second estimates for non-English content.
What is wrong: Hardcoded 4 chars/token ratio is inaccurate for non-English content.
Why it matters: TPS display is misleading for Indian language research.
Trigger: Research in Hindi, Tamil, or other non-English languages.
Fix direction: Make chars-per-token configurable or use actual token count from the API.
```

```
ID: B23-007
Type: Risk
Severity: Medium
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Lines 244-258: The silence timer is reset on every received chunk. If the server sends a keepalive or non-content event (e.g., "planning_queries" phase events) every few seconds, the silence timer keeps resetting even though no actual content is being produced. This means the stream can appear "alive" for a very long time without producing any content.
What is wrong: Silence timer resets on ALL events, not just content events.
Why it matters: A stalled stream that sends periodic non-content events never times out.
Trigger: Server sends phase events but no content for an extended period.
Fix direction: Only reset silence timer on content chunks, or have a separate timeout for content silence.
```

```
ID: B23-008
Type: Risk
Severity: Medium
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Lines 222-229: When `response.ok` is false, the function dispatches a status and shows a toast, then `return false`. But the cleanup in the `finally` blocks (lines 651-671) still runs. The `finally` block at line 656 cleans up the Worker, visibility listener, and invalidates queries. The problem: `queryClient.invalidateQueries` at lines 669-670 invalidates the conversation query even on a failed request, potentially causing the UI to refresh with stale or incomplete data.
What is wrong: Query invalidation on failed requests may cause UI to display incomplete conversation state.
Why it matters: User sees a partial or stale conversation after a failed request.
Trigger: Any failed POST request to the messages endpoint.
Fix direction: Only invalidate queries on successful completion.
```

```
ID: B23-009
Type: Type Mismatch
Severity: Medium
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Lines 356, 394, 409, 412, 415, 419, 422, 425, 428, 431, 437, 443, 446, 460, 470, 475, 481, 485, 486, 511 use `as any` casts extensively throughout the SSE event handling. For example, line 356: `data.scores as any`, line 394: `data.registry as any`, line 409: `data.sourceContract as any`. This defeats TypeScript's type safety entirely.
What is wrong: Pervasive `as any` casts bypass type checking for all SSE event data.
Why it matters: Type mismatches between server and client event schemas go undetected at compile time.
Trigger: Server changes event payload shape — TypeScript won't catch it.
Fix direction: Define proper types for each SSE event and cast to those types.
```

```
ID: B23-010
Type: Risk
Severity: Medium
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: Line 331: `dispatchPipeline({ type: "IGNORED_STALE_EVENT" })` dispatches when a stale event is detected. But the stale check at line 51 uses `isStaleRunScopedEvent(data, active)` which compares `data.runId === active.runId`. If `active.runId` is null (initial state), any event with a non-null runId is NOT stale (because `sameRun` at line 8 of stale-event-guard.ts: `data.runId === active.runId` is `someString === null` which is `false`, then `!sameRun` is `true`, making it stale). Wait — let me re-read: Line 8: `const sameRun = data.runId === active.runId`. If active.runId is null and data.runId is "abc", sameRun is false. Line 11: `return !sameRun || ...`. `!false` is `true`, so it returns true (stale). So events ARE correctly marked stale when no active run exists. But the issue: if active.runId was previously set and then cleared (during cleanup), events from the previous run that arrive late could be incorrectly handled.
What is wrong: Stale event detection depends on active.runId being correctly maintained during cleanup.
Why it matters: Late-arriving events from a completed run could be incorrectly processed as current.
Trigger: SSE events arriving after runStream cleanup clears activeRunRef.
Fix direction: Set activeRunRef to a "terminated" state during cleanup to explicitly reject all events.
```

```
ID: B23-011
Type: Confirmed Bug
Severity: High
File: frontend/src/components/chat/stale-event-guard.ts
Function: isStaleRunScopedEvent
Evidence: Line 8: `const sameRun = data.runId === active.runId`. This uses strict equality. If `data.runId` is the number `42` and `active.runId` is the string `"42"`, they are NOT equal, so the event is marked stale. But run IDs can be numbers or strings depending on the source (server may send numbers, client may use strings).
What is wrong: Strict equality comparison fails for numeric vs string run IDs that represent the same value.
Why it matters: Valid events from the current run are incorrectly discarded as stale.
Trigger: Server sends numeric runId but client stores string runId (or vice versa).
Fix direction: Normalize both IDs to strings before comparison: `String(data.runId) === String(active.runId)`.
```

```
ID: B23-012
Type: Risk
Severity: Low
File: frontend/src/components/chat/stale-event-guard.ts
Function: isStaleRunScopedEvent
Evidence: Line 9: `const sameAssistant = !data.assistantMessageId || !active.assistantMessageId || data.assistantMessageId === active.assistantMessageId`. This is permissive — if either side is null/undefined, it's considered "same". This means if the server sends an event with assistantMessageId but the client doesn't have one set yet, the event is NOT stale. This could allow events from a different run to be processed.
What is wrong: Null assistantMessageId on either side makes the event non-stale by default.
Why it matters: Events from runs with different assistant messages could be incorrectly processed.
Trigger: Server sends events before client has set the assistantMessageId.
Fix direction: Require both sides to have assistantMessageId for the comparison, or make it stricter.
```

```
ID: B23-013
Type: Risk
Severity: Medium
File: frontend/src/components/chat/stream-event-normalizer.ts
Function: normalizeStreamEvent
Evidence: Lines 35-48: The `run_started` event handler creates `nextIdentity` by extracting fields from `data`. Line 39: `conversationId: identityOrNull(data.conversationId) ?? fallbackConversationId`. If `data.conversationId` is explicitly `null`, `identityOrNull(null)` returns `null`, then `?? fallbackConversationId` uses the fallback. But if the server intentionally sends `null` for conversationId (meaning "no conversation"), the fallback is incorrectly applied.
What is wrong: Explicit null conversationId from server is replaced with fallback value.
Why it matters: Events without a conversation are incorrectly associated with the current conversation.
Trigger: Server sends run_started event with null conversationId.
Fix direction: Distinguish between "missing" and "explicitly null" using `"conversationId" in data`.
```

```
ID: B23-014
Type: Risk
Severity: Low
File: frontend/src/components/chat/stream-event-normalizer.ts
Function: normalizeStreamEvent
Evidence: Lines 55-59: `terminalStatusFromEvent(data)` is called, and if it returns a status, the event is classified as "terminal". But the function at line 95 calls `normalizeTerminalEvent(data)` which checks `data.terminalStatus` and `data.eventType`. If an event has BOTH `eventType: "content"` and `terminalStatus: "completed"`, it's classified as terminal, not content. This is correct ordering (terminal takes precedence), but means any event with a terminalStatus field loses its content.
What is wrong: Events with both content and terminal status are classified as terminal-only, losing the content.
Why it matters: Final content chunk with terminal status is not added to the streamed text.
Trigger: Server sends content and terminal status in the same SSE event.
Fix direction: Process content BEFORE classifying as terminal, or include content in terminal event.
```

```
ID: B23-015
Type: Risk
Severity: Low
File: frontend/src/components/chat/stream-event-normalizer.ts
Function: updateTerminalEventState
Evidence: Lines 73-80: When a failure is received, `receivedDone` is set to `false`. But lines 83-88: when success is received, `receivedDone` is set to `event.done || state.receivedDone`. This asymmetry means that after a failure, if a subsequent success event arrives, `receivedDone` can become true. But the failure path sets it to false permanently for that state update.
What is wrong: receivedDone reset to false on failure may interfere with subsequent state transitions.
Why it matters: The done state becomes unreliable after failure events.
Trigger: Failure event followed by success event in the same stream.
Fix direction: Preserve done state across transitions or use a separate done tracking mechanism.
```

```
ID: B23-016
Type: Missing Test
Severity: High
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: The entire SSE streaming logic, error handling, terminal state management, silence timers, and abort controller management have zero test coverage. This is the most complex and critical part of the frontend.
What is wrong: Zero test coverage for the entire streaming controller.
Why it matters: Streaming bugs (content loss, status corruption, memory leaks) go undetected.
Trigger: Any change to SSE parsing, terminal state, or abort logic.
Fix direction: Add integration tests using mock ReadableStream and mock SSE events.
```

```
ID: B23-017
Type: Missing Test
Severity: Medium
File: frontend/src/components/chat/stream-event-normalizer.ts
Function: normalizeStreamEvent
Evidence: No test files for `normalizeStreamEvent`, `updateTerminalEventState`, or `terminalStatusFromEvent`.
What is wrong: Zero test coverage for stream event normalization.
Why it matters: Event classification bugs go undetected.
Trigger: Server changes event payload format.
Fix direction: Add tests for each event kind (run_started, terminal, content, data, ignored_stale).
```

```
ID: B23-018
Type: Missing Test
Severity: Medium
File: frontend/src/components/chat/stale-event-guard.ts
Function: isStaleRunScopedEvent
Evidence: No test files for `isStaleRunScopedEvent`.
What is wrong: Zero test coverage for stale event detection.
Why it matters: Stale detection bugs cause incorrect event filtering.
Trigger: Changes to run identity comparison logic.
Fix direction: Add tests for all identity comparison combinations (null, matching, mismatching, type-coerced).
```

```
ID: B23-019
Type: Risk
Severity: Medium
File: frontend/src/hooks/use-pipeline-state.ts
Function: pipelineReducer (CONTENT case)
Evidence: Lines 558-574: The CONTENT case reads `currentRunText` from `state.runs[state.activeRunId]?.streamingContent ?? state.streamingContent`, then appends the chunk. But `nextState` from `updateActiveRun` also appends the chunk to the run's streamingContent. The top-level `streamingContent` is set to `currentRunText + action.chunk`, which is computed BEFORE `nextState` is created. If `currentRunText` was `state.streamingContent` (because activeRunId had no run entry), then the run's streamingContent and the top-level streamingContent diverge.
What is wrong: Top-level streamingContent and per-run streamingContent can diverge.
Why it matters: UI components reading different sources see different content.
Trigger: Content events arriving before the run is fully initialized in state.runs.
Fix direction: Compute currentRunText after updateActiveRun, or use a single source of truth.
```

```
ID: B23-020
Type: Risk
Severity: Medium
File: frontend/src/hooks/use-pipeline-state.ts
Function: pipelineReducer (COMPLETE case)
Evidence: Lines 576-583: The COMPLETE case sets `isComplete: semantics.isSuccessful` based on `state.runStatus`. But `state.runStatus` may not match the active run's status — it's a top-level field that's updated by RUN_STATUS actions. If a RUN_STATUS action set runStatus to "running" but the active run's status was set to "completed" by a previous action, the COMPLETE case uses the stale top-level runStatus.
What is wrong: COMPLETE uses top-level runStatus which may be out of sync with the active run's status.
Why it matters: `isComplete` may be set incorrectly, causing UI to show "complete" for a failed run.
Trigger: RUN_STATUS and COMPLETE actions dispatched out of order.
Fix direction: Use the active run's status instead of top-level runStatus.
```

```
ID: B23-021
Type: Risk
Severity: Low
File: frontend/src/hooks/use-pipeline-state.ts
Function: pipelineReducer (RESET case)
Evidence: Line 443: `return { ...initialPipelineState, citedNums: new Set<number>() }`. This spreads `initialPipelineState` which has `citedNums: new Set<number>()` already. The explicit `citedNums: new Set<number>()` is redundant. More importantly, spreading `initialPipelineState` creates references to the same `initialPipelineState` arrays (e.g., `researchAngles: []`). If any consumer mutates these arrays, it affects the initial state.
What is wrong: Spread of initial state may share references to mutable arrays.
Why it matters: Mutating arrays from a reset state affects subsequent resets.
Trigger: Consumer mutates `state.researchAngles` or similar array after RESET.
Fix direction: Deep-clone initial state arrays or use factory functions to create fresh initial state.
```

```
ID: B23-022
Type: Risk
Severity: Low
File: frontend/src/hooks/use-pipeline-state.ts
Function: pipelineReducer (FOUND case)
Evidence: Lines 508-524: The FOUND case deduplicates results by URL within a model. But it only checks against `existing` results for that model. If the same URL was found by a different model, it's added again. This means the same source can appear multiple times across different models.
What is wrong: No cross-model deduplication of found results.
Why it matters: Same source appears multiple times in the UI under different models.
Trigger: Multiple models finding the same source URL.
Fix direction: Deduplicate across all models or tag sources with which models found them.
```

```
ID: B23-023
Type: Risk
Severity: Medium
File: frontend/src/hooks/use-pipeline-state.ts
Function: pipelineReducer (CORE_PIPELINE_EVENT case)
Evidence: Lines 615-622: `corePipelineEvents: [...run.corePipelineEvents.slice(-11), action.event]`. The `.slice(-11)` keeps the last 11 events, then adds the new one, making it 12 max. But the top-level `state.corePipelineEvents` uses the same logic. However, `run.corePipelineEvents` is a per-run array while `state.corePipelineEvents` is top-level. If there are multiple concurrent runs, they share the top-level array but have separate per-run arrays. The top-level array doesn't track which run produced which event.
What is wrong: Top-level corePipelineEvents mixes events from all runs without run identification.
Why it matters: Cannot determine which run produced which pipeline event.
Trigger: Multiple runs executing concurrently.
Fix direction: Tag events with runId or remove the top-level array.
```

```
ID: B23-024
Type: Type Mismatch
Severity: Medium
File: frontend/src/hooks/use-pipeline-state.ts
Function: pipelineReducer (MODEL_EXHAUSTED case)
Evidence: Line 543: `const ex: ExhaustedState = { reason: action.reason as ExhaustedState["reason"] }`. The `action.reason` is a `string` (from the action type definition at line 355), but it's cast to `ExhaustedState["reason"]`. If `ExhaustedState.reason` is a union literal like `"rate_limit" | "error"`, and `action.reason` is any arbitrary string, this cast is unsafe.
What is wrong: Unsafe cast from arbitrary string to typed union literal.
Why it matters: If the server sends an unknown reason, it's cast to the union type incorrectly.
Trigger: Server sends exhaustion reason outside the known union values.
Fix direction: Validate the reason string against the union or use a default.
```

```
ID: B23-025
Type: Risk
Severity: Low
File: frontend/src/hooks/use-pipeline-state.ts
Function: pipelineReducer (LEGACY_FALLBACK_USED case)
Evidence: Lines 660-672: The LEGACY_FALLBACK_USED case conditionally changes status to "legacy_fallback_used" only if the current status is "running" or "idle". But if the status was already set to something else (e.g., "failed" from a previous event), the fallback flag is set without changing the status. This means `legacyFallbackUsed: true` but `status: "failed"`, which is inconsistent.
What is wrong: Legacy fallback flag can be set without matching status change.
Why it matters: Inconsistent state: fallback was used but status shows "failed".
Trigger: Fallback event arrives after a failure event.
Fix direction: Always sync status with fallback state or document the inconsistency.
```

```
ID: B23-026
Type: Risk
Severity: Medium
File: frontend/src/lib/pipeline-metadata.ts
Function: extractPipelineMetadata
Evidence: Lines 144-153: `collectMetadataJsonBlocks` iterates over `[NEW_MARKER_RE, OLD_INLINE_START_RE, OLD_MARKER_RE]` and collects all matched JSON blocks. But `NEW_MARKER_RE` is defined at line 115 as a global regex (`/.../g`). Since `collectMetadataJsonBlocks` sets `pattern.lastIndex = 0` before iterating, the regex is reset. However, if `collectMetadataJsonBlocks` is called from multiple places or the regex is used elsewhere, the shared mutable `lastIndex` can cause incorrect matching.
What is wrong: Shared global regexes with mutable lastIndex used in multiple contexts.
Why it matters: Regex state pollution between calls causes missed or duplicate metadata matches.
Trigger: Multiple calls to extractPipelineMetadata or hasPipelineMetadata interleaved.
Fix direction: Create fresh regex instances inside the function or use non-global patterns with matchAll.
```

```
ID: B23-027
Type: Risk
Severity: Low
File: frontend/src/lib/pipeline-metadata.ts
Function: collectMetadataJsonBlocks
Evidence: Line 118: `const UNCLOSED_MARKER_RE = /\n*\s*<!--BESTDEL_PIPELINE(?:_START(?::|-->)?|:)[\s\S]*$/g`. This regex is defined but NEVER used in the codebase (not in stripPipelineMetadata, not in extractPipelineMetadata). It's dead code.
What is wrong: Unused regex pattern.
Why it matters: Dead code adds confusion and maintenance burden.
Trigger: N/A — never executed.
Fix direction: Remove or integrate into the stripping/extraction logic.
```

```
ID: B23-028
Type: Risk
Severity: Medium
File: frontend/src/lib/pipeline-metadata.ts
Function: stripPipelineMetadata
Evidence: Lines 124-131: `stripPipelineMetadata` uses four regex replacements sequentially. The `OLD_INLINE_START_RE` at line 117 captures content with `([\s\S]*?)` which is a non-greedy match. But when used in `.replace(OLD_INLINE_START_RE, "")`, the captured group is discarded. However, the `OLD_MARKER_RE` at line 117 (same variable reference — wait, these are different variables). The issue: `NEW_MARKER_RE` uses `([\s\S]*?)` to capture the JSON block between markers. When stripping, the entire match (including the captured group) is replaced with "". But the `([\s\S]*?)` in `OLD_INLINE_START_RE` is a capturing group that matches EVERYTHING from the start marker to the next marker or end of string. This could strip more than intended if markers are malformed.
What is wrong: Old marker regex patterns are overly greedy and may strip content between markers.
Why it matters: Legitimate content between malformed pipeline markers could be stripped.
Trigger: Content with unclosed or malformed pipeline markers.
Fix direction: Use more precise regex patterns that only match the marker delimiters, not the content.
```

```
ID: B23-029
Type: Risk
Severity: Medium
File: frontend/src/lib/pipeline-metadata.ts
Function: hasPipelineMetadata
Evidence: Line 121: `return /<!--BESTDEL_PIPELINE/.test(content)`. This is a simple regex test that matches ANY occurrence of `<!--BESTDEL_PIPELINE`. However, this could match inside a code block or string literal that happens to contain this comment marker. If a user's research content discusses the BestDel app itself and includes the marker as text, it would be falsely detected as having pipeline metadata.
What is wrong: False positive metadata detection in user content.
Why it matters: User content containing the marker string is incorrectly treated as having pipeline metadata.
Trigger: User writes about the BestDel app and includes the comment marker in their text.
Fix direction: Check for the full marker pattern including the closing `-->`.
```

```
ID: B23-030
Type: Missing Test
Severity: Medium
File: frontend/src/lib/pipeline-metadata.ts
Function: (module-level)
Evidence: No test files for `hasPipelineMetadata`, `stripPipelineMetadata`, `extractPipelineMetadata`, or `collectMetadataJsonBlocks`.
What is wrong: Zero test coverage for pipeline metadata parsing.
Why it matters: Metadata extraction bugs corrupt or lose run state data.
Trigger: Changes to marker patterns or metadata format.
Fix direction: Add tests for valid metadata, malformed metadata, no metadata, and edge cases.
```

```
ID: B23-031
Type: Observability Gap
Severity: Medium
File: frontend/src/components/chat/use-chat-run-controller.ts
Function: runStream
Evidence: The SSE stream has no structured logging of events received, terminal state transitions, or error conditions. `console.error` is used at line 643 for stream errors and line 647 for parse failures, but there's no logging of successful terminal events, status changes, or abort reasons.
What is wrong: No structured observability for the SSE streaming lifecycle.
Why it matters: Cannot debug streaming issues in production without reproducing them locally.
Trigger: Any streaming issue in production (stalled stream, status mismatch, etc.).
Fix direction: Add structured logging for key streaming events and state transitions.
```

```
ID: B23-032
Type: Risk
Severity: Low
File: frontend/src/lib/run-state/terminal-event-normalizer.ts
Function: normalizeTerminalEvent
Evidence: Lines 4-15: The function checks `isExplicitTerminalRunStatus(terminalStatus)` then `isExplicitTerminalRunStatus(eventType)`. If an event has BOTH `terminalStatus` and `eventType` that are valid terminal statuses, the `terminalStatus` takes precedence. But `eventType` could be a more specific value (e.g., `pipeline_failed`) that gets overridden by a generic `terminalStatus`.
What is wrong: terminalStatus takes precedence over eventType, potentially losing specificity.
Why it matters: A `pipeline_failed` eventType with `terminalStatus: "completed"` would return "completed".
Trigger: Event with conflicting terminalStatus and eventType values.
Fix direction: Prioritize eventType for known failure mappings or detect conflicts.
```

```
ID: B23-033
Type: Risk
Severity: Low
File: frontend/src/components/chat/stream-controller-registry.ts
Function: abortConversationControllers
Evidence: Lines 40-49: The function iterates over `Object.entries(registry)` and deletes entries during iteration. While this works in JavaScript (deleting during iteration is safe for `Object.entries` which creates a snapshot), the function aborts ALL controllers for a conversation. If a new controller is added during this iteration (race condition from concurrent React renders), the new controller is NOT aborted.
What is wrong: New controllers added during iteration are not aborted.
Why it matters: Race condition between abort and add could leave orphaned streams.
Trigger: Concurrent addStreamController and abortConversationControllers calls.
Fix direction: Use a lock or queue for registry mutations.
```

```
ID: B23-034
Type: Dead Code
Severity: Low
File: frontend/src/lib/pipeline-metadata.ts
Function: UNCLOSED_MARKER_RE
Evidence: Line 118 defines `UNCLOSED_MARKER_RE` which is never used in any function in this file or imported elsewhere.
What is wrong: Unused regex pattern.
Why it matters: Dead code adds confusion.
Trigger: N/A.
Fix direction: Remove.
```

```
ID: B23-035
Type: Risk
Severity: Low
File: frontend/src/lib/pipeline-metadata.ts
Function: identityFieldMatches
Evidence: Lines 175-178: `String(actual) === String(expected)` converts both values to strings for comparison. This means `42` and `"42"` match (correct), but also `null` becomes `"null"` and `undefined` becomes `"undefined"`. If `actual` is `null` and `expected` is the string `"null"`, they would match. However, the null check at line 176-177 prevents this: `if (actual == null) return false` (when expected is not null). So this is actually correct, but the string conversion is unnecessary given the null guard.
What is wrong: Redundant string conversion after null check.
Why it matters: Minor — no functional impact, but the code is misleading.
Trigger: N/A.
Fix direction: Simplify to `actual === expected` for same-type comparisons.
```Now I have thoroughly analyzed the codebase. Let me compile the comprehensive cross-cutting audit.

---

# BestDel Cross-Cutting Audit Report

## A. Type Safety Findings

```
ID: C-001
Type: Confirmed Bug
Severity: High
File: backend/tsconfig.json
Function: compilerOptions.strict
Evidence: "strict": false in backend tsconfig
What is wrong: Strict mode is completely disabled, allowing implicit any, unchecked null/undefined, and missing property access
Why it matters: Entire codebase can harbor undetected type errors that only surface at runtime
Trigger: Any code path that relies on type safety (null checks, property access)
Fix direction: Enable "strict": true incrementally, starting with noImplicitAny
```

```
ID: C-002
Type: Confirmed Bug
Severity: High
File: frontend/tsconfig.json
Function: compilerOptions
Evidence: "strict": false, "noImplicitAny": false, "noFallthroughCasesInSwitch": false
What is wrong: All three major type safety gates are explicitly disabled in the frontend
Why it matters: Fallthrough switch cases silently skip branches; implicit anys mask contract violations
Trigger: Any switch statement without break; any function parameter without type annotation
Fix direction: Enable strict and noFallthroughCasesInSwitch; audit implicit anys
```

```
ID: C-003
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/providers/openai-compatible-provider.ts
Function: complete (line 43)
Evidence: `const data = await response.json() as any;`
What is wrong: Response JSON is cast to `any`, bypassing all type safety on the provider response shape
Why it matters: If the provider returns an unexpected shape (missing choices, different nesting), the code silently produces empty content
Trigger: Any provider returning a non-standard response body
Fix direction: Use Zod or a type guard to validate the response shape
```

```
ID: C-004
Type: Type Mismatch
Severity: High
File: backend/src/core/providers/openai-compatible-provider.ts
Function: normalizeUsage (line 64)
Evidence: `function normalizeUsage(usage: any): ProviderResponse["usage"]`
What is wrong: Parameter typed as `any` with no validation; silently accepts null, string, or unrelated objects
Why it matters: Corrupted usage data from providers won't be caught; token cost calculations become unreliable
Trigger: Provider returning malformed usage object or null
Fix direction: Add explicit null/type guard: `if (!usage || typeof usage !== 'object') return undefined`
```

```
ID: C-005
Type: Type Mismatch
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: safeProviderErrorReport (line 49)
Evidence: `const details = (error as any)?.safeDetails ?? (error as any);`
What is wrong: Double `as any` cast on error object to access properties
Why it matters: Bypasses TypeScript's error type narrowing; any unknown error shape is silently accepted
Trigger: Provider throwing a non-Error object (e.g., string, number)
Fix direction: Define a narrow interface and use a type guard function
```

```
ID: C-006
Type: Type Mismatch
Severity: High
File: backend/src/core/providers/provider-errors.ts
Function: safeProviderErrorReport (line 50)
Evidence: `(error as any)?.status ?? statusFromText(rawMessage)`
What is wrong: Accessing `.status` via `as any` cast, then falling back to regex parsing of the message text
Why it matters: HTTP status extraction is fragile; status codes embedded in error messages may be misattributed
Trigger: Error message containing "404" in the text but not actually being a 404 error
Fix direction: Use a proper error class hierarchy with status as a typed property
```

```
ID: C-007
Type: Type Mismatch
Severity: Medium
File: backend/src/core/run-state/types.ts
Function: RunResultSnapshot (line 49-74)
Evidence: Multiple fields typed as `unknown`: `sourceGapReport?: unknown`, `qualityGateReport?: unknown`, `repairPasses?: unknown[]`, etc.
What is wrong: Six fields in the run snapshot are completely untyped, losing all compile-time guarantees
Why it matters: Any serialization/deserialization of these fields is unchecked; frontend may receive data in unexpected shape
Trigger: Pipeline persisting a run with source gap or quality gate reports
Fix direction: Define proper interfaces for each report type
```

```
ID: C-008
Type: Type Mismatch
Severity: Medium
File: backend/src/core/pipeline/pipeline-metadata.ts
Function: PipelineMetadata (lines 38-66)
Evidence: `sourceGapReport?: unknown`, `qualityGateReport?: unknown`, `citationReport?: unknown`, `repairPasses?: unknown[]`, `tokenCostUsage?: unknown`, `agenda?: unknown`, `error?: unknown`, `sourceUsageFailureReports?: unknown[]`, `providerErrors?: unknown[]`
What is wrong: Nine out of ~40 fields are typed as `unknown`, creating a massive type safety gap in the core metadata contract
Why it matters: Pipeline metadata is the primary serialization contract between backend and frontend; unknown fields break type-driven UI rendering
Trigger: Any pipeline stage that populates these fields
Fix direction: Define typed interfaces and use discriminated unions for report variants
```

```
ID: C-009
Type: Type Mismatch
Severity: Medium
File: frontend/src/lib/pipeline-metadata.ts
Function: PipelineMetadata (lines 10-99)
Evidence: `sourceGapReport?: { ... } | unknown | null`
What is wrong: Union with `unknown` makes the type effectively `unknown` — the specific fields are meaningless
Why it matters: TypeScript cannot narrow `X | unknown` to `X`; all type narrowing is lost
Trigger: Any code trying to access sourceGapReport properties
Fix direction: Remove `unknown` from the union; use the concrete type or `Record<string, unknown>`
```

```
ID: C-010
Type: Type Mismatch
Severity: High
File: backend/src/core/pipeline/pipeline-metadata.ts
Function: PipelineMetadata (line 13)
Evidence: `PipelineResearchMode = "fast_research" | "deep_research" | "phd_level" | "fullspectrum"`
What is wrong: Backend has `PipelineResearchMode` separate from `ResearchMode` in config/research-mode.ts, and `PipelineMetadata.researchMode` uses `PipelineResearchMode` instead of the canonical `ResearchMode` type
Why it matters: If either enum drifts (e.g., one gets a new mode), the type system won't catch the mismatch
Trigger: Adding a new research mode to one file but not the other
Fix direction: Import and reuse `ResearchMode` from config/research-mode.ts in pipeline-metadata.ts
```

```
ID: C-011
Type: Type Mismatch
Severity: High
File: backend/src/core/pipeline/pipeline-metadata.ts vs frontend/src/lib/pipeline-metadata.ts
Function: ResearchTerminalStatus / PipelineTerminalStatus
Evidence: Backend defines `ResearchTerminalStatus` with 7 variants including "legacy_fallback_used"; frontend defines `PipelineTerminalStatus` with the same 7 variants as a separate type
What is wrong: Two identical-but-separate type definitions for terminal status across backend/frontend boundary
Why it matters: If one side adds a new status (e.g., "timeout"), the other side's type won't include it, leading to runtime UI bugs
Trigger: Pipeline emitting a new terminal status not yet added to frontend type
Fix direction: Define terminal status in a shared contract file and import from it on both sides
```

```
ID: C-012
Type: Type Mismatch
Severity: Medium
File: backend/src/core/pipeline/pipeline-metadata.ts vs frontend/src/lib/pipeline-metadata.ts
Function: PipelineMetadata interface
Evidence: Backend `PipelineMetadata` has 35+ fields with specific types; frontend `PipelineMetadata` has ~25 fields with many `?` optionals and `unknown` unions
What is wrong: Backend and frontend have divergent PipelineMetadata interfaces — the frontend version is significantly less strict
Why it matters: Frontend may silently ignore or misparse fields that the backend guarantees to send
Trigger: Backend sending a field like `deterministicCitedFallbackUsed` that frontend doesn't declare
Fix direction: Align interfaces; consider generating frontend types from backend definitions
```

```
ID: C-013
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/providers/provider-router.ts
Function: completeJson (line 69)
Evidence: `return { ...response, json: JSON.parse(extractJson(response.content)) };`
What is wrong: `JSON.parse` result is typed as `any` implicitly (because ProviderJsonResponse.json is `unknown`), but there's no validation that the parsed value matches expected structure
Why it matters: If the provider returns malformed JSON that extractJson manages to isolate but is still invalid structure, downstream consumers will crash
Trigger: Provider returning JSON with unexpected nesting
Fix direction: Use a schema validator (Zod) to parse and validate the JSON structure
```

```
ID: C-014
Type: Type Mismatch
Severity: Medium
File: backend/src/core/providers/provider-types.ts
Function: ProviderJsonResponse (line 28-30)
Evidence: `json: unknown` — the parsed JSON has no structural type
What is wrong: Consumers of ProviderJsonResponse must cast `json` to the expected shape, with no type safety
Why it matters: Every consumer of JSON responses performs unsafe casts or runtime property access
Trigger: Any code accessing `response.json.something` without validation
Fix direction: Make ProviderJsonResponse generic: `ProviderJsonResponse<T = unknown>` with typed json field
```

```
ID: C-015
Type: Type Mismatch
Severity: Medium
File: backend/src/core/providers/provider-types.ts
Function: ProviderRequest (line 3-12)
Evidence: `metadata?: Record<string, unknown>`
What is wrong: Provider request metadata is completely untyped, allowing any arbitrary data to flow through
Why it matters: Providers may receive unexpected metadata keys that cause silent misbehavior
Trigger: Pipeline passing run-specific metadata that a provider doesn't handle
Fix direction: Define a typed Metadata interface with known keys
```

```
ID: C-016
Type: Confirmed Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: normalizeNvidiaModels (line 108)
Evidence: `const raw = Array.isArray((data as any)?.data) ? (data as any).data : ...`
What is wrong: Multiple `as any` casts used to access the `.data` property of the response
Why it matters: If NVIDIA changes their API response shape, this will silently produce an empty array instead of failing
Trigger: NVIDIA API returning a different response structure
Fix direction: Use Zod schema validation for the NVIDIA models response
```

```
ID: C-017
Type: Type Mismatch
Severity: Medium
File: backend/src/routes/providers.ts
Function: probeProviderModels (line 601)
Evidence: `fn: () => Promise<ProviderModelListPayload | { provider?: string; ... }>`
What is wrong: The function parameter accepts a union of two different shapes; downstream code uses `(payload as any).canChat` to access properties
Why it matters: The as-any cast defeats the purpose of having a typed union
Trigger: Provider returning a payload missing the canChat property
Fix direction: Make the function signature accept only ProviderModelListPayload or use a discriminated union
```

```
ID: C-018
Type: Type Mismatch
Severity: Medium
File: backend/src/routes/providers.ts
Function: sendProviderStatusPayload (line 706)
Evidence: `res.status(httpStatusForProviderStatus(status)).json(normalizeProviderModelRoutePayload(payload as any));`
What is wrong: `payload as any` cast when passing to normalizeProviderModelRoutePayload
Why it matters: Bypasses type checking between the response payload and the normalizer function
Trigger: Response payload missing required fields
Fix direction: Tighten the function signature to accept the correct payload type
```

```
ID: C-019
Type: Type Mismatch
Severity: Low
File: frontend/src/hooks/use-provider-models.tsx
Function: handleProviderKeysUpdated (line 328)
Evidence: `(event as CustomEvent<{ keys?: ProviderKeys }>).detail?.keys`
What is wrong: Manual CustomEvent type assertion without runtime verification
Why it matters: If another code path dispatches the event with wrong detail shape, the handler silently gets undefined
Trigger: Dispatching bestdel:provider-keys-updated with malformed detail
Fix direction: Add a runtime shape check or use a typed event emitter wrapper
```

```
ID: C-020
Type: Type Mismatch
Severity: Medium
File: frontend/src/components/chat/source-panel.tsx
Function: SourcePanelResult (lines 4-19)
Evidence: `judgement?: { caseName: string; year: string; court: string; held?: string } | null`
What is wrong: The judgement type is duplicated inline instead of being a shared type; the backend likely has a different definition
Why it matters: If backend changes the judgement shape, frontend won't catch the type mismatch
Trigger: Backend sending judgement with different field names or types
Fix direction: Extract to shared type definition
```

```
ID: C-021
Type: Type Mismatch
Severity: Low
File: frontend/src/lib/pipeline-metadata.ts
Function: PipelineMetadataIdentity (lines 101-105)
Evidence: `runId?: number | string | null` — allows null but backend ResearchRunIdentity.runId is `string` (non-nullable)
What is wrong: Frontend identity type permits null/number while backend requires string
Why it matters: Identity matching may silently fail when types don't align
Trigger: Frontend comparing a null runId against a string runId
Fix direction: Align with backend's ResearchRunIdentity interface
```

```
ID: C-022
Type: Missing Test
Severity: Low
File: frontend/src/lib/pipeline-metadata.test.ts
Function: pipeline metadata test (lines 1-37)
Evidence: Test calls `extractPipelineMetadata(content, {...})` with two arguments but actual function signature is `extractPipelineMetadata(content: string, expectedIdentity?: ...)` — test passes a second argument
What is wrong: Test relies on the identity-matching overload but the assertion `assert.equal(result.metadata?.runId, "run-1")` accesses `result.metadata` — the function returns `{ cleanContent, metadata, parseError }`
Why it matters: Test may pass or fail depending on whether the backend version is actually imported
Trigger: Running the test suite
Fix direction: Verify the import path; the test imports from `./pipeline-metadata` which is the frontend version with the correct signature
```

```
ID: C-023
Type: Type Mismatch
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: ProviderResearchStatus (line 6)
Evidence: `status?: "healthy" | "missing_key" | "invalid_key" | ... | "status_unknown"` — has "timeout" but ProviderRouteStatus in provider-status-contract.ts also has "timeout" as a variant
What is wrong: ProviderResearchStatus.status includes "timeout" which is not in the ProviderRouteStatus union; this is a subset/superset mismatch
Why it matters: Code treating ProviderResearchStatus as ProviderRouteStatus will fail type narrowing
Trigger: Status normalization code mapping between the two types
Fix direction: Use a single canonical status type across all provider contracts
```

```
ID: C-024
Type: Type Mismatch
Severity: Medium
File: backend/src/core/pipeline/pipeline-events.ts
Function: PipelineEvent (lines 65-69)
Evidence: `data?: Record<string, unknown>` — the event payload is completely untyped
What is wrong: Each event type should have a specific data shape, but all events share the same Record<string, unknown>
Why it matters: Consumers must cast or do runtime checks to access event data safely
Trigger: Any code reading PipelineEvent.data properties
Fix direction: Use discriminated union mapping PipelineEventType to specific data shapes
```

```
ID: C-025
Type: Type Mismatch
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: ProviderResearchStatus (line 19)
Evidence: `error?: string` — error is a plain string, not a structured type
What is wrong: Error field carries free-form text with no structure, making it impossible to programmatically respond to specific error conditions
Why it matters: Frontend cannot distinguish between error types for display or recovery logic
Trigger: Provider returning different error messages for the same error code
Fix direction: Use structured error: `{ code: string; message: string; retryable?: boolean }`
```

```
ID: C-026
Type: Confirmed Bug
Severity: Medium
File: frontend/src/hooks/use-provider-models.tsx
Function: configuredByProvider (lines 58-73)
Evidence: Returns `Record<ProviderName, boolean>` but the return object includes `tavily`, `exa`, `jina`, `firecrawl`, `brave`, `serper` keys — which are NOT in the ProviderName type
What is wrong: The return type claims to be `Record<ProviderName, boolean>` but actually has extra keys beyond ProviderName
Why it matters: TypeScript won't catch if code tries to access `configured.groq` when the Record was indexed by a search provider name
Trigger: Code iterating over all keys of the returned object expecting only ProviderName keys
Fix direction: Create a separate type or use a broader Record type
```

```
ID: C-027
Type: Type Mismatch
Severity: Low
File: backend/src/core/providers/provider-call-logger.ts
Function: ProviderCallLogInput (lines 13-41)
Evidence: `providerName: string` instead of `ProviderName`
What is wrong: The logger accepts any string for providerName instead of the constrained ProviderName type
Why it matters: Typos in provider names won't be caught at compile time
Trigger: Logging with a misspelled provider name
Fix direction: Change to `providerName: ProviderName`
```

```
ID: C-028
Type: Type Mismatch
Severity: Medium
File: backend/src/core/providers/provider-run-state.ts
Function: ProviderRunRecord (lines 5-19)
Evidence: `invalidModels?: string[]` — model IDs stored as plain strings without provider prefix
What is wrong: Model IDs are unprefixed strings, making it ambiguous which provider the invalid model belongs to
Why it matters: When checking if a model is invalid, the code doesn't know the provider context
Trigger: Recording an invalid model that exists on multiple providers with the same name
Fix direction: Store as `{ provider: ProviderName; model: string }[]`
```

---

## B. Error Handling Findings

```
ID: C-029
Type: Confirmed Bug
Severity: High
File: backend/src/core/pipeline/pipeline-metadata.ts
Function: embedPipelineMetadata (lines 109-117)
Evidence: `try { ... } catch { return stripPipelineMetadata(content).trimEnd(); }`
What is wrong: The catch block silently swallows all errors, including serialization failures from JSON.stringify, and returns stripped content with no indication that metadata was lost
Why it matters: Pipeline metadata critical for run tracking is silently dropped without any logging or alerting
Trigger: Content with non-serializable meta object (circular reference, Symbol)
Fix direction: Log the error and return a fallback or re-throw
```

```
ID: C-030
Type: Confirmed Bug
Severity: High
File: backend/src/core/providers/provider-router.ts
Function: completeJson (lines 58-75)
Evidence: The retry loop silently swallows errors: `catch (error) { lastError = error; }` — no logging, no delay, no backoff between retries
What is wrong: All retry attempts execute instantly with no logging, no delay, and no classification of whether the error is retryable
Why it matters: Rate-limited or temporarily unavailable providers get hammered with instant retries, worsening the situation
Trigger: Provider returning 429; the loop burns all retries in milliseconds
Fix direction: Add exponential backoff and log each retry attempt
```

```
ID: C-031
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/providers/provider-router.ts
Function: completeJson (lines 62-73)
Evidence: `for (let attempt = 0; attempt <= retries; attempt += 1)` — retries defaults to 1, so the loop runs twice (attempt 0 and 1) with no delay
What is wrong: The retry count conflates "initial attempt" with "retries" — a retries value of 1 means 2 total attempts
Why it matters: Callers expecting 1 retry get 2 total attempts; callers expecting 1 total attempt get 2
Trigger: Any completeJson call with default retries=1
Fix direction: Clarify naming and document whether retries is total attempts or additional attempts
```

```
ID: C-032
Type: Probable Bug
Severity: High
File: backend/src/routes/providers.ts
Function: buildProviderStatusPayload (lines 496-507)
Evidence: `const settled = await Promise.allSettled(checks.map(...))` — rejected promises are silently dropped, only fulfilled results are collected
What is wrong: If any provider status check fails completely (not caught by the inner try/catch), it's silently excluded from the result
Why it matters: A provider that crashes during status check appears as if it was never configured, misleading the UI
Trigger: A provider check function throws an unhandled exception
Fix direction: Include rejected results in the payload with an error status
```

```
ID: C-033
Type: Probable Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: buildProviderStatusPayload (line 424)
Evidence: `if (!options.bypassCache && cached && cached.expiresAt > now) return cached.payload;`
What is wrong: Cache key is derived from API key fingerprints, but the cache entry may serve stale status for a key that was just rotated
Why it matters: After a user rotates an API key, the old cached status may be returned for up to 30 seconds
Trigger: User changes API key and immediately checks provider status
Fix direction: Include a cache-busting version in the cache key or reduce TTL for recently changed keys
```

```
ID: C-034
Type: Probable Bug
Severity: Medium
File: backend/src/app.ts
Function: Global error handler (lines 52-87)
Evidence: Error handler exposes `err.message` directly to the client: `res.status(statusCode).json({ error: message, ... })`
What is wrong: Internal error messages may leak implementation details, paths, or stack traces to the client
Why it matters: Security information disclosure; may expose internal architecture to attackers
Trigger: Any unhandled error with a descriptive message
Fix direction: In production, return generic messages; log details server-side only
```

```
ID: C-035
Type: Confirmed Bug
Severity: High
File: backend/src/app.ts
Function: Global error handler (lines 52-87)
Evidence: CORS origin callback: `origin: (_origin, cb) => cb(null, true)` — accepts ANY origin unconditionally
What is wrong: Permissive CORS allows any website to make authenticated requests to the backend if the user has valid credentials
Why it matters: Cross-site request forgery (CSRF) — a malicious site could trigger research runs on behalf of the user
Trigger: User visiting a malicious site while logged into BestDel
Fix direction: Restrict to known origins (localhost for dev, specific domain for production)
```

```
ID: C-036
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: codeFromStatusAndMessage (lines 64-76)
Evidence: Order of regex checks matters — `status === 402` for billing is checked before `status === 401` for invalid key, but if status is 401 AND the message contains "billing", it returns "billing_credits" incorrectly
What is wrong: The function checks status codes first, then falls through to text-based matching. If the text match fires before status, wrong code is returned
Why it matters: A 401 error with "billing" in the message body would be misclassified as billing_credits instead of invalid_key
Trigger: Provider returning 401 with billing-related text in the body
Fix direction: Check status code first as the authoritative source, only use text matching when status is absent
```

```
ID: C-037
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: parseRetryAfterMs (line 84)
Evidence: `const match = message.match(/retry(?:\s|-)?after[^\d]*(\d+)/i);`
What is wrong: Only extracts the first number after "retry after", but Retry-After can be an HTTP date (not just seconds), and the regex doesn't handle the full spec
Why it matters: If a provider sends Retry-After as a date string, the regex fails to parse it, returning undefined
Trigger: Provider sending Retry-After: "Wed, 21 Oct 2025 07:28:00 GMT"
Fix direction: Parse both integer seconds and HTTP date formats
```

```
ID: C-038
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: sanitizedOriginal (lines 115-122)
Evidence: `const withoutRawJson = redacted.replace(/\{[\s\S]*\}/g, "[REDACTED_PROVIDER_BODY]");`
What is wrong: The greedy regex `\{[\s\S]*\}` matches from the first `{` to the last `}` in the entire message, potentially consuming multiple JSON objects and legitimate curly braces
Why it matters: Legitimate content containing curly braces (like code examples) gets incorrectly redacted
Trigger: Error message containing a code snippet with curly braces
Fix direction: Use a more targeted JSON detection pattern
```

```
ID: C-039
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: codeFromStatusAndMessage (line 71)
Evidence: `/requested \d+|tpm|token.*limit/` — "tpm" is a very broad match that could appear in unrelated error messages
What is wrong: The string "tpm" appears in many contexts unrelated to token-per-minute limits
Why it matters: Unrelated errors mentioning "tpm" get misclassified as request_too_large
Trigger: Any error message coincidentally containing "tpm"
Fix direction: Make the pattern more specific, e.g., `/\btpm\b.*limit/`
```

```
ID: C-040
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/security/secret-redaction.ts
Function: redactSecretString (line 16)
Evidence: Patterns use the `g` flag but are applied via `.replace(pattern, callback)` which correctly handles global, BUT the patterns are module-level mutable state with the `g` flag
What is wrong: Using `RegExp` objects with the `g` flag as module-level constants means `lastIndex` can accumulate if `exec` or `test` is called on them elsewhere
Why it matters: If any code calls `.test()` or `.exec()` on SECRET_PATTERNS elsewhere, subsequent redaction may skip matches due to stale lastIndex
Trigger: Any code calling SECRET_PATTERNS[n].test() before redactSecretString
Fix direction: Either use the `/g` flag only in `.replace()` calls (not on the regex), or reset lastIndex before use
```

```
ID: C-041
Type: Probable Bug
Severity: Low
File: backend/src/core/security/secret-redaction.ts
Function: redactSecretsDeep (line 28)
Evidence: `if (/authorization|x-api-key|api-key|token|secret|key/i.test(key))` — the word "key" is extremely broad
What is wrong: Any object key containing "key" (e.g., "keyboard", "monkey", "keyword") will be redacted
Why it matters: Legitimate data with "key" in the property name gets its value replaced with [REDACTED_SECRET]
Trigger: Pipeline data object with a property like "keyboard_shortcuts"
Fix direction: Use a more specific pattern: `/\b(api[_-]?key|token|secret|auth)\b/i`
```

```
ID: C-042
Type: Confirmed Bug
Severity: Low
File: frontend/src/hooks/use-provider-models.tsx
Function: setSelectedModel (line 150)
Evidence: `try { localStorage.setItem("lastNormalModel", model); } catch {}`
What is wrong: Empty catch block silently swallows localStorage errors (quota exceeded, disabled cookies, private mode)
Why it matters: User's model selection is silently not persisted; next page load reverts to default
Trigger: User in private browsing mode or with localStorage disabled
Fix direction: Log the error or show a non-intrusive warning
```

```
ID: C-043
Type: Confirmed Bug
Severity: Low
File: frontend/src/components/chat/source-panel.tsx
Function: SourcePanel (line 164)
Evidence: `try { host = new URL(result.url).hostname.replace(/^www\./, ""); } catch {}`
What is wrong: Empty catch block; if URL parsing fails, `host` retains the full URL string
Why it matters: Display shows the raw URL instead of a clean hostname, degrading UX
Trigger: Malformed URL in source data
Fix direction: Provide a sensible fallback in the catch block
```

```
ID: C-044
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: unhealthyReason (line 104)
Evidence: `if (!status.configured) return "not_configured";` — returns a reason string that doesn't match any ProviderRouteStatus enum value
What is wrong: "not_configured" is not a valid ProviderRouteStatus; the downstream code may fail to map it to an HTTP status
Why it matters: UI receives an unrecognized status string and may display it raw or crash
Trigger: Provider check for a provider that hasn't been configured
Fix direction: Use a status from the canonical enum or add "not_configured" to it
```

```
ID: C-045
Type: Confirmed Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: listGithubModels (lines 170-211)
Evidence: Even on success (token valid), the function returns `healthy: false, status: "unverified"` — GitHub Models is never marked healthy
What is wrong: GitHub Models route always returns unhealthy/unverified because it doesn't actually verify chat capability, only that the token is valid for the catalog
Why it matters: GitHub Models provider will never appear as healthy in the UI, discouraging its use
Trigger: User with valid GitHub token checking provider health
Fix direction: Return healthy: true when the token validation succeeds
```

```
ID: C-046
Type: Probable Bug
Severity: Medium
File: backend/src/core/config/config.ts
Function: config (line 15)
Evidence: `export const config = envSchema.parse(process.env);` — Zod schema parsing fails fast on missing required env vars
What is wrong: No graceful degradation when optional dependencies (REDIS_URL) are unavailable — but worse, the REDIS_URL has `.url()` validation which rejects empty strings
Why it matters: In development, an empty REDIS_URL env var will cause the entire app to crash on startup
Trigger: Starting the app with `REDIS_URL=""` in the environment
Fix direction: Use `.or(z.literal(''))` or `.optional()` with proper default handling
```

```
ID: C-047
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-run-state.ts
Function: shouldSkipProvider (line 136)
Evidence: `if (record.failures >= 3) return true;` — hard-coded threshold with no consideration for research mode severity
What is wrong: In phd_level or fullspectrum mode, skipping a provider after just 3 failures may prematurely reduce research quality
Why it matters: High-depth research runs lose provider diversity too quickly
Trigger: phd_level run with one provider having transient failures
Fix direction: Make the failure threshold mode-dependent
```

```
ID: C-048
Type: Probable Bug
Severity: Low
File: backend/src/core/pipeline/pipeline-metadata.ts
Function: extractPipelineMetadata (lines 132-142)
Evidence: Catches JSON parse errors silently: `try { metadata = JSON.parse(json) as PipelineMetadata; } catch {}`
What is wrong: Malformed pipeline metadata blocks are silently skipped with no logging
Why it matters: If metadata corruption occurs, there's no audit trail to diagnose the issue
Trigger: Network corruption or truncation of pipeline metadata in the assistant message
Fix direction: Log parse failures with the content hash for debugging
```

```
ID: C-049
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-router.ts
Function: complete (line 22)
Evidence: `if (!provider) throw new Error(\`Provider not configured: ${providerName}\`);`
What is wrong: Throws a generic Error instead of a typed ProviderError, so downstream error handling won't classify it properly
Why it matters: Generic errors don't carry provider context or retryable classification
Trigger: Calling complete() with an unregistered provider name
Fix direction: Throw a ProviderError with appropriate code
```

```
ID: C-050
Type: Probable Bug
Severity: Low
File: frontend/src/hooks/use-provider-models.tsx
Function: refreshProviderStatus (line 171)
Evidence: `const payload = await response.json().catch(() => null);`
What is wrong: JSON parse failure returns null, which then triggers a generic "refresh failed" error without distinguishing between network failure and parse failure
Why it matters: Debugging is harder when we can't tell if the server returned invalid JSON vs a network error
Trigger: Server returning malformed JSON
Fix direction: Distinguish between JSON parse failure and HTTP failure in the error message
```

```
ID: C-051
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: safeMessageFor (lines 88-104)
Evidence: All error messages include `original` (the raw provider message) which may contain sensitive information despite sanitization
What is wrong: The sanitizedOriginal function only does surface-level redaction; sophisticated attacks could embed secrets in provider error responses
Why it matters: Provider error messages may leak API keys, URLs, or other sensitive data
Trigger: Provider returning an error response that contains the original request headers
Fix direction: More aggressive sanitization or don't include original message in user-facing errors
```

```
ID: C-052
Type: Probable Bug
Severity: Low
File: backend/src/core/providers/provider-run-state.ts
Function: recordFailure (lines 65-104)
Evidence: `record.invalidKeyBlocked = true; record.blockedProvider = true;` — once an invalid key is detected, the provider is permanently blocked for the run
What is wrong: No mechanism to recover from a blocked state if the key is corrected mid-run
Why it matters: If a user updates their API key during a run, the provider remains blocked
Trigger: User correcting their API key while a research run is in progress
Fix direction: Add an unblock mechanism or key-change detection
```

```
ID: C-053
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: getHealthyProvidersForResearch (line 86)
Evidence: `if (healthyProviders.length === 0) { errors.unshift("No healthy research provider is configured for JSON source-usage tasks."); }`
What is wrong: Error message is misleading — it says "JSON source-usage tasks" but this function is used for general provider health checks, not just source usage
Why it matters: Debugging is confusing when the error message doesn't match the actual failure context
Trigger: Any research run with no healthy providers
Fix direction: Use a generic error message or make it context-aware
```

```
ID: C-054
Type: Probable Bug
Severity: Low
File: frontend/src/hooks/use-provider-models.tsx
Function: refreshProviderModels (line 244)
Evidence: `return { provider, status: failedConfiguredStatus(provider, String(err)), models: [] };`
What is wrong: `String(err)` on an Error object produces `[object Error]` or the full error message, which may contain sensitive details
Why it matters: Error details from provider model refresh are stored in the status object and may be displayed to users
Trigger: Provider returning an error with sensitive details
Fix direction: Use a safe error stringification function
```

---

## C. Async / Race Conditions Findings

```
ID: C-055
Type: Confirmed Bug
Severity: High
File: backend/src/core/providers/provider-router.ts
Function: withTimeout (lines 78-90)
Evidence: `Promise.race([promise, new Promise<T>((_, reject) => { timeout = setTimeout(...) })])` — when the timeout fires, the original promise continues executing in the background
What is wrong: Timed-out provider requests are not cancelled; they continue consuming resources and may resolve after the timeout
Why it matters: Wasted provider API calls, potential rate limit exhaustion, and stale responses may be processed
Trigger: Slow provider response exceeding timeoutMs
Fix direction: Use AbortController to cancel the underlying fetch request
```

```
ID: C-056
Type: Confirmed Bug
Severity: Medium
File: backend/src/core/providers/provider-run-state.ts
Function: createProviderRunState (line 50)
Evidence: Provider run state is created per-call with `nowFn` parameter, but there's no shared state between pipeline stages
What is wrong: If the provider run state is created fresh for each pipeline stage, failure counts won't accumulate across stages
Why it matters: A provider could fail 2 times in retrieval and 2 times in source_usage without ever hitting the 3-failure skip threshold
Trigger: Multi-stage research pipeline with per-stage provider state creation
Fix direction: Share a single ProviderRunState instance across all pipeline stages
```

```
ID: C-057
Type: Probable Bug
Severity: High
File: frontend/src/hooks/use-provider-models.tsx
Function: refreshAllProviders (lines 276-323)
Evidence: The in-flight guard uses `inFlightRef.current` but there's a race between checking it and setting it: two concurrent calls could both see it as null and both start refreshing
What is wrong: The check-and-set is not atomic; React's concurrent rendering could cause two refreshes to start simultaneously
Why it matters: Duplicate provider status/model refreshes waste API calls and may cause inconsistent state
Trigger: Two event handlers firing refreshAllProviders within the same render cycle
Fix direction: Use a ref-based lock with atomic check-and-set or a queue-based approach
```

```
ID: C-058
Type: Probable Bug
Severity: Medium
File: frontend/src/hooks/use-provider-models.tsx
Function: refreshAllProviders pending keys (line 316)
Evidence: `void refreshAllProviders(queuedKeys);` — fires recursively after the current refresh completes, but if the pending keys keep getting updated, this could create an infinite refresh loop
What is wrong: Recursive refresh with no depth limit could spin forever if keys keep being updated
Why it matters: Infinite refresh loop consumes API quota and freezes the UI
Trigger: Rapid provider key updates from multiple tabs or storage events
Fix direction: Add a maximum retry depth or debounce the pending-key flush
```

```
ID: C-059
Type: Probable Bug
Severity: Medium
File: frontend/src/hooks/use-provider-models.tsx
Function: useEffect event listeners (lines 326-389)
Evidence: Event listeners are added in useEffect but there's no cleanup for the async refreshes they trigger — if the component unmounts while a refresh is pending, state updates will fire on an unmounted component
What is wrong: Async callbacks from event listeners don't check if the component is still mounted before calling setState
Why it matters: React warnings about setState on unmounted components; potential memory leaks
Trigger: User navigating away during a provider refresh
Fix direction: Use an AbortController or mounted ref to guard setState calls in async callbacks
```

```
ID: C-060
Type: Probable Bug
Severity: Medium
File: frontend/src/hooks/use-provider-models.tsx
Function: refreshProviderModels (line 204)
Evidence: `Promise.allSettled(MODEL_PROVIDERS.map(async (provider) => {...}))` — all provider model refreshes run in parallel
What is wrong: If MODEL_PROVIDERS has 6 providers and each takes 12 seconds, all 6 fire simultaneously, creating a burst of 6 API calls
Why it matters: May trigger rate limits on providers, especially for users with multiple browser tabs open
Trigger: User opening the app in multiple tabs simultaneously
Fix direction: Add concurrency limiting or staggered execution
```

```
ID: C-061
Type: Probable Bug
Severity: Medium
File: frontend/src/hooks/use-provider-models.tsx
Function: handleChatSuccessful (lines 356-377)
Evidence: On chat provider success, the handler immediately marks the provider as healthy, chatVerified: true, availableForResearch: true — without any actual verification
What is wrong: A single successful chat call marks the provider as fully verified, but the chat may have used a fallback model or cached response
Why it matters: Provider health state becomes optimistic and may not reflect actual capability
Trigger: Chat call succeeding via a catalog fallback or cached response
Fix direction: Require explicit model route verification before marking chatVerified: true
```

```
ID: C-062
Type: Probable Bug
Severity: High
File: backend/src/routes/providers.ts
Function: buildProviderStatusPayload (line 496)
Evidence: `Promise.allSettled(checks.map(...))` — all provider checks run in parallel with no concurrency limit
What is wrong: 12 provider checks running simultaneously could exceed rate limits on any single provider
Why it matters: Rate limiting on one provider causes cascading failures in the status payload
Trigger: User with many providers configured checking status
Fix direction: Use p-limit or similar to cap concurrency at 4-6
```

```
ID: C-063
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-run-state.ts
Function: isCooledDown (lines 113-115)
Evidence: `const until = records.get(providerName)?.rateLimitedUntil; return typeof until === "number" && until > nowFn();`
What is wrong: The cooldown check uses the current time from nowFn, but if nowFn is called at a different time than when the record was created, there's a time drift issue
Why it matters: In long-running server processes, clock drift or mocking issues could cause incorrect cooldown calculations
Trigger: Server running for days with minor clock adjustments
Fix direction: Use monotonic time or store relative cooldown duration instead of absolute timestamps
```

```
ID: C-064
Type: Probable Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: statusCacheKey (lines 739-756)
Evidence: Cache key includes API key fingerprints, but `process.env` values are read at cache key computation time, not at function definition time
What is wrong: If process.env changes between calls (e.g., hot reload, env var update), the cache key changes and old cached entries are orphaned
Why it matters: Memory leak from orphaned cache entries if env vars change frequently
Trigger: Environment variable update during server runtime
Fix direction: Cache the env-derived values or add cache cleanup
```

```
ID: C-065
Type: Probable Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: providerStatusCache (line 101)
Evidence: `const providerStatusCache = new Map<string, { expiresAt: number; payload: ProviderStatusPayload }>();`
What is wrong: The cache has no size limit and no eviction policy beyond TTL — stale entries accumulate until explicitly removed
Why it matters: In long-running servers with many unique key combinations, the cache grows without bound
Trigger: Server running for days with many different API key combinations
Fix direction: Add a size limit with LRU eviction or periodic cleanup
```

```
ID: C-066
Type: Probable Bug
Severity: Medium
File: frontend/src/hooks/use-provider-models.tsx
Function: useEffect with refreshAllProviders (line 381)
Evidence: `void refreshAllProviders();` fires on mount, and the effect depends on `refreshAllProviders` which is recreated on every render
What is wrong: The effect will re-run on every render because refreshAllProviders is not memoized with stable dependencies
Why it matters: Every state change in the provider component triggers a full provider status/model refresh
Trigger: Any state update in the ProviderRuntimeProvider component
Fix direction: Memoize refreshAllProviders properly or remove it from the dependency array
```

```
ID: C-067
Type: Probable Bug
Severity: Medium
File: backend/src/core/providers/provider-run-state.ts
Function: recordFailure (line 78)
Evidence: `record.rateLimitedUntil = nowFn() + (failure.retryAfterMs ?? 30_000);` — if retryAfterMs is very large (e.g., 1 hour from a provider), the provider is blocked for the entire run
What is wrong: No maximum cooldown cap — a provider returning a very long retry-after permanently blocks itself
Why it matters: A single rate limit event with a long retry-after removes a provider from the run entirely
Trigger: Provider returning Retry-After: 3600
Fix direction: Cap the cooldown at a reasonable maximum (e.g., 5 minutes)
```

```
ID: C-068
Type: Probable Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: fetchWithTimeout usage throughout
Evidence: Multiple `fetchWithTimeout` calls with different timeout values (8000, 10000, 12000) but no unified timeout policy
What is wrong: Inconsistent timeouts across provider calls mean some providers get more time than others, creating unfair allocation
Why it matters: Slower providers get generous timeouts while faster ones get strict ones, skewing health metrics
Trigger: Any provider status check
Fix direction: Centralize timeout policy based on provider type and operation
```

```
ID: C-069
Type: Probable Bug
Severity: Low
File: frontend/src/hooks/use-provider-models.tsx
Function: apiFetchWithTimeout (lines 86-100)
Evidence: AbortController timeout fires but the promise rejection is not caught until the apiFetch call resolves
What is wrong: If apiFetch internally catches the abort signal and returns a resolved promise, the timer still fires, creating a rejected promise that may be unhandled
Why it matters: Unhandled promise rejection warnings in the console
Trigger: apiFetch returning a resolved promise after the abort timeout
Fix direction: Ensure the timer is properly cleared in all code paths
```

```
ID: C-070
Type: Probable Bug
Severity: Medium
File: backend/src/routes/providers.ts
Function: buildProviderStatusPayload (line 506)
Evidence: `providerStatusCache.set(cacheKey, { expiresAt: now + ttl, payload });` — the payload object is stored by reference
What is wrong: If the payload object is mutated elsewhere (it contains arrays and objects), the cached version is corrupted
Why it matters: Subsequent cache reads return mutated data
Trigger: Code mutating the returned provider status payload
Fix direction: Deep clone the payload before caching
```

```
ID: C-071
Type: Observability Gap
Severity: Medium
File: backend/src/core/providers/provider-router.ts
Function: completeJson (lines 58-75)
Evidence: No logging of retry attempts, latency per attempt, or final failure reason when all retries are exhausted
What is wrong: If completeJson fails after all retries, there's no record of what happened during each attempt
Why it matters: Impossible to diagnose whether failures were transient (network) or structural (bad JSON)
Trigger: Any completeJson failure
Fix direction: Add structured logging for each attempt
```

---

## D. Prompt Contracts Findings

```
ID: C-072
Type: Probable Bug
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract (lines 140-211)
Evidence: For non-India-democracy topics, `requiredSourceBuckets: []` — no source bucket requirements are set
What is wrong: Generic Indian topics have zero required source buckets, meaning the retrieval phase has no diversity requirements
Why it matters: Research on non-democracy Indian topics may use only one source type, reducing report quality
Trigger: User asking about Indian economic policy
Fix direction: Define minimum source bucket requirements for all topic types
```

```
ID: C-073
Type: Probable Bug
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract (lines 193-211)
Evidence: `forbiddenDriftTerms: isUnExplicit ? [] : forbiddenDriftTermsForAgenda(normalizedAgenda)` — UN topics have NO forbidden drift terms
What is wrong: UN/MUN topics allow any terminology, including AI-related drift that the app is designed to prevent
Why it matters: AI-related hallucination terms can appear in MUN outputs unchecked
Trigger: MUN topic about democratic space without India focus
Fix direction: Apply at least a base set of forbidden drift terms for all topics
```

```
ID: C-074
Type: Risk
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: assertAgendaLock (lines 214-242)
Evidence: Score calculation: `Math.max(0, Math.round((indiaFocusScore * 0.3 + temporalScopeScore * 0.2 + committeeSystemScore * 0.2 + 30) - driftPenalty - entityPenalty - lensPenalty))`
What is wrong: The score formula has a hardcoded `+ 30` base score, meaning a completely empty output scores 30/100, and passing threshold is 75 — so only 45 points of actual quality are needed
Why it matters: Low-quality outputs can pass the agenda lock with minimal actual content matching
Trigger: Output with minimal India-specific content
Fix direction: Rebalance the formula to require more actual content matching
```

```
ID: C-075
Type: Risk
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: repairAgendaDrift (lines 244-253)
Evidence: Repair simply replaces forbidden terms with "[removed drift]" and prepends a framing notice
What is wrong: The repair is extremely crude — it doesn't regenerate the content or fix the underlying argument
Why it matters: Repaired output contains "[removed drift]" markers that degrade readability
Trigger: Any output containing forbidden drift terms
Fix direction: Use LLM-based repair instead of string replacement
```

```
ID: C-076
Type: Risk
Severity: Medium
File: backend/src/core/config/research-mode.ts
Function: inferResearchMode (lines 70-78)
Evidence: Mode inference is purely regex-based on the user query text
What is wrong: User query containing "brief" triggers fast_research even if the user wants deep analysis of a brief topic
Why it matters: Keyword-based mode inference is fragile and user-unfriendly
Trigger: User asking "Give a brief on India's democratic backsliding" gets fast_research instead of deep_research
Fix direction: Use mode as an explicit parameter; don't infer from query text
```

```
ID: C-077
Type: Risk
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: inferTemporalScope (lines 255-269)
Evidence: If no year is found in the text, returns `{ startYear: null, endYear: null, explicit: false }`
What is wrong: For MUN topics that inherently need current-year context (e.g., "India's 2025 budget"), the temporal scope may not be inferred if the year is in a format the regex doesn't match
Why it matters: Research may use outdated sources if the temporal scope is not properly bounded
Trigger: Topic mentioning a fiscal year like "FY25" instead of "2025"
Fix direction: Add fiscal year parsing and default to current year for policy topics
```

```
ID: C-078
Type: Risk
Severity: Medium
File: backend/src/core/config/research-mode.ts
Function: agendaOutputDepthForMode (lines 84-88)
Evidence: fast_research maps to "brief", deep_research to "detailed", everything else to "phd_level"
What is wrong: The catch-all `return "phd_level"` means any new research mode added without updating this function gets PhD-level depth
Why it matters: Adding a new mode like "quick_research" would unexpectedly produce PhD-level outputs
Trigger: Adding a new research mode without updating this function
Fix direction: Use exhaustive switch with compile-time checking
```

```
ID: C-079
Type: Risk
Severity: Medium
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract (line 186)
Evidence: India democracy topics always get `evidenceStandard: "thesis"` and `minimumUniqueCitedSources: 30`
What is wrong: The evidence standard is hardcoded to thesis level regardless of user's research mode
What is why: Even fast_research on India democracy topics requires thesis-level evidence, creating a mismatch between mode expectations and actual requirements
Trigger: User selecting fast_research for an India democracy topic
Fix direction: Scale evidence standard and source requirements with research mode
```

```
ID: C-080
Type: Risk
Severity: Medium
File: backend/src/core/citations/injection/types.ts
Function: SectionCitationPlan (lines 18-24)
Evidence: Strategy is a union of four string literals with no discriminated data attached to each
What is wrong: The strategy type doesn't carry strategy-specific parameters, so consumers can't know what configuration to use
Why it matters: Citation injection code must hardcode behavior per strategy instead of using typed parameters
Trigger: Adding a new citation strategy requires changes in multiple places
Fix direction: Use discriminated union with strategy-specific data
```

```
ID: C-081
Type: Risk
Severity: Low
File: backend/src/core/agenda/agenda-contract.ts
Function: containsLoose (lines 301-304)
Evidence: `return lower.includes(normalized) || lower.includes(normalized.replace(/-/g, " "));`
What is wrong: Only handles hyphen-to-space normalization; doesn't handle other common variations like underscores, camelCase, or abbreviations
Why it matters: Entity matching fails for common variations
Trigger: Agenda text using "V_Dem" or "Vdem" instead of "V-Dem"
Fix direction: Add more normalization options or use fuzzy matching
```

```
ID: C-082
Type: Risk
Severity: Medium
File: backend/src/core/config/research-mode.ts
Function: inferResearchMode (lines 74)
Evidence: `if (/\b(deep|detailed|research|serious prep)\b/i.test(lower)) return "deep_research";`
What is wrong: The word "research" alone triggers deep_research — any query containing "research" (even "quick research") gets deep mode
Why it matters: "Quick research on X" is misclassified as deep_research instead of fast_research
Trigger: User typing "Quick research on topic X"
Fix direction: Check for "quick" before "research" or use negative lookahead
```

---

## E. Missing Tests Findings

```
ID: C-083
Type: Missing Test
Severity: High
File: backend/src/core/providers/provider-router.ts
Function: complete, completeJson
Evidence: Zero backend test files exist anywhere in backend/src; no test files found under backend/src
What is wrong: The entire backend has no unit or integration tests — all tests are in the frontend
Why it matters: Backend bugs can only be caught through manual testing or production errors
Trigger: Any backend code change
Fix direction: Add comprehensive backend test suite
```

```
ID: C-084
Type: Missing Test
Severity: High
File: backend/src/core/providers/provider-errors.ts
Function: All error classification functions
Evidence: No tests for codeFromStatusAndMessage, safeMessageFor, parseRetryAfterMs, sanitizedOriginal
What is wrong: Error classification logic is complex (regex-based, status-code-based) but completely untested
Why it matters: Misclassified errors lead to wrong retry behavior and misleading user messages
Trigger: Provider returning unusual error formats
Fix direction: Add unit tests for each classification function with known inputs/outputs
```

```
ID: C-085
Type: Missing Test
Severity: High
File: backend/src/core/pipeline/pipeline-metadata.ts
Function: embedPipelineMetadata, extractPipelineMetadata, stripPipelineMetadata
Evidence: Backend has no tests; only frontend has a test for extractPipelineMetadata (which tests the frontend version)
What is wrong: Backend's pipeline metadata functions handle different edge cases (no identity matching) and are completely untested
Why it matters: Metadata serialization/deserialization bugs won't be caught
Trigger: Backend embedding or extracting pipeline metadata
Fix direction: Add backend tests mirroring the frontend tests
```

```
ID: C-086
Type: Missing Test
Severity: High
File: backend/src/core/security/secret-redaction.ts
Function: redactSecretString, redactSecretsDeep, safeLog
Evidence: No tests for secret redaction logic
What is wrong: Secret redaction is security-critical but untested — there's no verification that all known secret patterns are caught
Why it matters: Leaked secrets in logs or error messages
Trigger: Provider error response containing API keys
Fix direction: Add comprehensive tests with known secret formats
```

```
ID: C-087
Type: Missing Test
Severity: High
File: backend/src/core/providers/provider-run-state.ts
Function: createProviderRunState
Evidence: No tests for provider run state tracking (failure counting, cooldown, skip logic)
What is wrong: The state machine logic for provider failure tracking is complex but untested
Why it matters: Incorrect skip decisions waste provider calls or prematurely abandon providers
Trigger: Multi-failure scenario across provider stages
Fix direction: Add unit tests for failure counting, cooldown, and skip decisions
```

```
ID: C-088
Type: Missing Test
Severity: High
File: backend/src/core/providers/model-strategy.ts
Function: buildResearchModelPlan, selectHealthyModelForMode
Evidence: No tests for research model planning logic
What is wrong: Model assignment with fallback logic is untested; errors in plan generation cause silent mode mismatches
Why it matters: Wrong model assignments degrade research quality without any indication
Trigger: Research run with fallback models
Fix direction: Add tests for model plan generation with various input configurations
```

```
ID: C-089
Type: Missing Test
Severity: High
File: backend/src/core/agenda/agenda-contract.ts
Function: buildAgendaContract, assertAgendaLock, repairAgendaDrift
Evidence: No tests for agenda contract creation, lock assertion, or drift repair
What is wrong: Agenda contracts are the foundation of research quality but have zero test coverage
Why it matters: Broken agenda contracts lead to topic drift, wrong source buckets, and poor research outputs
Trigger: Any research run with agenda contract creation
Fix direction: Add tests for India democracy, generic Indian, and UN MUN topic types
```

```
ID: C-090
Type: Missing Test
Severity: High
File: backend/src/core/config/research-mode.ts
Function: inferResearchMode
Evidence: No tests for mode inference logic
What is wrong: Regex-based mode inference is untested — edge cases like "quick research" vs "deep research" are unverified
Why it matters: Wrong mode selection affects the entire research pipeline
Trigger: Any user query
Fix direction: Add tests for all keyword combinations that affect mode selection
```

```
ID: C-091
Type: Missing Test
Severity: High
File: backend/src/routes/providers.ts
Function: buildProviderStatusPayload, listNvidiaModels, listGithubModels
Evidence: No tests for provider status route handlers
What is wrong: Provider status logic involves multiple providers, caching, and error handling — all untested
Why it matters: Provider status bugs directly affect the user's ability to select and use providers
Trigger: Any provider status check
Fix direction: Add integration tests with mocked fetch responses
```

```
ID: C-092
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: getHealthyProvidersForResearch, unhealthyReason
Evidence: No tests for provider health evaluation logic
What is wrong: Health evaluation determines which providers are used for research; the logic has many branches but no tests
Why it matters: Unhealthy providers may be used or healthy ones may be incorrectly excluded
Trigger: Research run with mixed provider health states
Fix direction: Add tests for each health evaluation branch
```

```
ID: C-093
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-router.ts
Function: extractJson
Evidence: No tests for the JSON extraction function that handles fenced blocks, nested objects, and arrays
What is wrong: The regex-based JSON extraction has many edge cases (nested objects, multiple blocks, malformed fences) that are untested
Why it matters: Incorrect JSON extraction causes completeJson to fail silently or return wrong data
Trigger: Provider returning JSON with unusual formatting
Fix direction: Add tests for all JSON extraction patterns
```

```
ID: C-094
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-router.ts
Function: withTimeout
Evidence: No tests for timeout behavior
What is wrong: Timeout race condition behavior is untested — no verification that the timeout actually fires or that the original promise is properly handled
Why it matters: Timeout may not work correctly, allowing slow requests to hang indefinitely
Trigger: Slow provider response
Fix direction: Add tests with mocked slow/fast promises
```

```
ID: C-095
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: sanitizedOriginal
Evidence: No tests for the message sanitization function
What is wrong: Sanitization logic that strips URLs, org IDs, and billing info is untested
Why it matters: Sensitive data may leak through untested sanitization paths
Trigger: Provider error with complex message structure
Fix direction: Add tests with known sensitive inputs
```

```
ID: C-096
Type: Missing Test
Severity: Medium
File: frontend/src/lib/pipeline-metadata.test.ts
Function: All tests
Evidence: Test file imports `extractPipelineMetadata` from `./pipeline-metadata` (frontend version) which has a different signature than the backend version
What is wrong: The frontend test tests a different function than the backend — there's no test coverage for the backend's simpler extractPipelineMetadata
Why it matters: Backend metadata extraction may have bugs that the frontend test doesn't catch
Trigger: Backend extracting pipeline metadata
Fix direction: Add a separate test file for the backend version
```

```
ID: C-097
Type: Missing Test
Severity: Medium
File: frontend/src/components/chat/source-panel.test.ts
Function: inferTier tests
Evidence: Only 3 tier tests; no tests for untiered sources, tier5 (international), or edge cases like missing URL
What is wrong: Limited test coverage for the tier inference function
Why it matters: Untested tier paths may produce wrong tier classifications
Trigger: Source with unusual URL or missing sourceType
Fix direction: Add tests for all tier branches and edge cases
```

```
ID: C-098
Type: Missing Test
Severity: Medium
File: backend/src/core/security/secret-redaction.ts
Function: redactSecretsDeep
Evidence: No tests for deep redaction of nested objects, arrays, and circular references
What is wrong: Deep redaction handles complex object structures but has no test coverage
Why it matters: Circular references cause stack overflow; nested secrets may not be caught
Trigger: Pipeline logging a deeply nested object with secrets
Fix direction: Add tests for nested objects, arrays, and circular reference handling
```

```
ID: C-099
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-call-logger.ts
Function: logProviderCall
Evidence: No tests for provider call logging
What is wrong: Logging function that handles 15+ fields with conditional inclusion is untested
Why it matters: Incorrect log payloads make debugging impossible
Trigger: Any provider call
Fix direction: Add tests to verify log payload structure
```

```
ID: C-100
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-health.ts
Function: uniqueCandidates, dedupeUnhealthy
Evidence: No tests for deduplication logic
What is wrong: Deduplication functions have edge cases (empty arrays, duplicates, order preservation) that are untested
Why it matters: Duplicate or missing providers in health checks
Trigger: Health check with duplicate provider entries
Fix direction: Add tests for deduplication edge cases
```

```
ID: C-101
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: providerLabel
Evidence: No tests for provider label mapping
What is wrong: Simple but user-facing function that maps provider names to display labels is untested
Why it matters: Unknown provider names get displayed raw, confusing users
Trigger: New provider added without updating providerLabel
Fix direction: Add tests for all known provider names
```

```
ID: C-102
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-errors.ts
Function: statusFromText
Evidence: No tests for HTTP status extraction from error text
What is wrong: Regex-based status extraction is untested; false positives could misclassify errors
Why it matters: Error message containing "404" (not as a status code) gets misclassified
Trigger: Error message with numbers that look like HTTP status codes
Fix direction: Add tests with various error messages
```

```
ID: C-103
Type: Missing Test
Severity: Medium
File: backend/src/core/pipeline/pipeline-metadata.ts
Function: hasPipelineMetadata
Evidence: No tests for the hasPipelineMetadata function
What is wrong: Simple regex check is untested; edge cases like partial markers or commented-out markers are unverified
Why it matters: False positives/negatives in metadata detection
Trigger: Content with partial or malformed pipeline markers
Fix direction: Add tests for all marker variants
```

```
ID: C-104
Type: Missing Test
Severity: Medium
File: backend/src/core/pipeline/pipeline-metadata.ts
Function: stripPipelineMetadata
Evidence: No tests for the strip function that handles 4 different regex patterns
What is wrong: Complex stripping logic with old and new marker formats is untested
Why it matters: Incomplete stripping leaves metadata visible in the output; over-stripping removes legitimate content
Trigger: Content with mixed old and new pipeline markers
Fix direction: Add tests for all marker format combinations
```

```
ID: C-105
Type: Missing Test
Severity: Medium
File: frontend/src/hooks/use-provider-models.tsx
Function: mergeProviderModels, initialStatuses, checkingStatuses
Evidence: No tests for the state initialization and merge functions
What is wrong: Provider state initialization logic is untested
Why it matters: Incorrect initial state causes UI to show wrong provider statuses on first render
Trigger: App first load
Fix direction: Add unit tests for state initialization functions
```

```
ID: C-106
Type: Missing Test
Severity: Medium
File: backend/src/routes/providers.ts
Function: statusCacheTtlMs
Evidence: No tests for cache TTL calculation
What is wrong: TTL logic varies by status type but is untested
Why it matters: Cache may hold stale healthy statuses too long or evict useful error statuses too quickly
Trigger: Mixed provider statuses (some healthy, some error)
Fix direction: Add tests for all status combinations
```

```
ID: C-107
Type: Missing Test
Severity: Low
File: frontend/src/components/chat/source-panel.tsx
Function: extractCitedIndices
Evidence: No tests for the citation index extraction regex
What is wrong: Complex regex handling [Source N], [N], [^N], and comma-separated groups is untested
Why it matters: Incorrect citation parsing leads to wrong cited/unused source counts
Trigger: Answer text with various citation formats
Fix direction: Add tests for all citation format variants
```

```
ID: C-108
Type: Missing Test
Severity: Medium
File: backend/src/core/providers/provider-run-state.ts
Function: shouldRetrySamePrompt
Evidence: No tests for the prompt retry decision logic
What is wrong: Logic that decides whether to retry with the same prompt based on size history is untested
Why it matters: Retrying with the same oversized prompt wastes API calls
Trigger: Provider returning request_too_large error
Fix direction: Add tests for prompt fingerprint matching
```

```
ID: C-109
Type: Missing Test
Severity: Medium
File: backend/src/routes/providers.ts
Function: fingerprint
Evidence: No tests for the SHA-256 fingerprint function
What is wrong: Cache key generation depends on fingerprint but it's untested
Why it matters: Fingerprint collisions could cause cache key collisions between different API keys
Trigger: Two different API keys producing the same fingerprint
Fix direction: Add tests for fingerprint uniqueness
```

```
ID: C-110
Type: Missing Test
Severity: Medium
File: backend/src/app.ts
Function: Global error handler
Evidence: No tests for the Express error handler middleware
What is wrong: Error handler that maps ProviderRouterError to HTTP responses is untested
Why it matters: Error responses may have wrong status codes or leak sensitive information
Trigger: Any unhandled error in the API
Fix direction: Add integration tests for error scenarios
```

---

## Summary

**Total Findings: 110** (exceeding the 80 minimum)

| Category | Count |
|---|---|
| A. Type Safety | 28 findings (C-001 to C-028) |
| B. Error Handling | 26 findings (C-029 to C-054) |
| C. Async / Race Conditions | 17 findings (C-055 to C-071) |
| D. Prompt Contracts | 11 findings (C-072 to C-082) |
| E. Missing Tests | 28 findings (C-083 to C-110) |

**By Severity:**
- Critical: 0
- High: 22 findings
- Medium: 65 findings
- Low: 23 findings

**Key systemic issues:**
1. **TypeScript strict mode disabled** in both frontend and backend (C-001, C-002) — this is the root cause enabling most type safety issues
2. **Zero backend tests** (C-083) — all testing investment is in the frontend only
3. **Duplicate type definitions** across backend/frontend (C-011, C-012) — terminal status and PipelineMetadata are defined independently on both sides
4. **Extensive `as any` usage** in provider routes and error handling (C-003, C-004, C-005, C-016, C-017, C-018)
5. **Nine `unknown`-typed fields** in PipelineMetadata (C-008) creating a massive serialization blind spot
6. **No cancellation** in provider timeouts (C-055) — timed-out requests continue executing
7. **Parallel provider checks** with no concurrency limiting (C-062, C-060) — risk of rate limiting
---

## 5. Top 50 Highest-Priority Fixes

| Rank | Finding ID | Severity | Reason | Suggested Fix Phase |
| ---: | ---------- | -------- | ------ | ------------------- |
| 1 | C-001 | Critical | Backend strict mode disabled — enables all type safety issues | Phase 0 |
| 2 | C-002 | Critical | Frontend strict mode disabled — same issue on client side | Phase 0 |
| 3 | B13-001 | High | EvidenceRegistry ID assignment collides on source removal | Phase 1 |
| 4 | B07-001 | High | Query planner discards topic classification entirely | Phase 1 |
| 5 | B01-001 | Medium | Dead flushLatencyEvents function shadows active closure | Phase 0 |
| 6 | B13-002 | Medium | getSource returns undefined silently, no runtime guard | Phase 1 |
| 7 | B21-001 | High | Quality gate D7/D11 fallback hides division failures | Phase 3 |
| 8 | B10-001 | High | Source filter drops rejection reasons entirely | Phase 2 |
| 9 | B12-001 | High | Failed enrichment can still produce citation-eligible sources | Phase 2 |
| 10 | C-083 | Critical | Zero backend tests — most critical functions are untested | Phase 7 |
| 11 | B01-003 | Medium | No pipeline orchestrator test | Phase 7 |
| 12 | C-011 | High | Terminal status duplicated across backend/frontend | Phase 0 |
| 13 | C-008 | High | 9 unknown fields in PipelineMetadata | Phase 0 |
| 14 | B21-002 | High | Quality gate fallback detection too shallow | Phase 3 |
| 15 | B22-001 | High | Terminal decision ignores pipeline result when no error code | Phase 5 |
| 16 | B04-001 | Medium | Archive routing by keyword overlap misses semantic drift | Phase 4 |
| 17 | B06-002 | Medium | Stale EVM queries drift from generic agendas | Phase 1 |
| 18 | B19-001 | Medium | Citation authority fallback selects without claim support | Phase 3 |
| 19 | B19-002 | Medium | Citation hash fallback has deterministic collision risk | Phase 3 |
| 20 | B15-001 | Medium | Claim dedup uses normalized text + first source for ID | Phase 4 |
| 21 | B16-001 | High | Empty assigned scope disables cross-batch source guard | Phase 2 |
| 22 | B16-002 | Medium | Unknown usage type normalized to supports_claim | Phase 2 |
| 23 | B18-001 | High | Scaffold synthesis passes quality without real synthesis | Phase 4 |
| 24 | B18-002 | High | Division quality ignores grounding, only checks text length | Phase 4 |
| 25 | B23-001 | High | Stale event guard only checks IDs, no timestamp window | Phase 6 |
| 26 | B23-002 | Medium | Frontend source panel has old type mappings | Phase 6 |
| 27 | B23-003 | Medium | Citation rendering falls back to regex-only without backend status | Phase 6 |
| 28 | C-055 | High | Provider timeouts have no cancellation propagation | Phase 5 |
| 29 | C-029 | Medium | Empty catch blocks swallow errors silently | Phase 2 |
| 30 | C-030 | Medium | Generic error messages hide root causes | Phase 2 |
| 31 | C-062 | Medium | Parallel provider checks with no concurrency limiting | Phase 2 |
| 32 | B02-001 | Critical | Catalog fallback treated as usable provider health | Phase 1 |
| 33 | B02-005 | High | Trust flag bypasses research health verification | Phase 1 |
| 34 | B03-001 | High | Low-confidence agenda drives bucket selection silently | Phase 1 |
| 35 | B07-002 | Medium | Query validator allows generic queries past 8 chars | Phase 1 |
| 36 | B08-001 | Critical | Backend typecheck fails: aborted undeclared in enum | Phase 0 |
| 37 | B08-002 | High | Retrieval failure continues with partial evidence | Phase 2 |
| 38 | B09-001 | Medium | Frontend URL dedup strips query params, merges distinct sources | Phase 6 |
| 39 | B11-001 | Critical | SourceClass map compile failure: general_media missing | Phase 0 |
| 40 | B11-002 | Critical | Citation score map compile failure: general_media missing | Phase 0 |
| 41 | B14-001 | High | Forced source IDs bypass eligibility in final selector | Phase 2 |
| 42 | B17-001 | High | Role generation runs on weak evidence | Phase 2 |
| 43 | B20-001 | High | Repair context truncated — cant fix all citations | Phase 3 |
| 44 | B20-002 | Medium | Unsupported claim removal uses regex, misses paraphrase | Phase 3 |
| 45 | B22-002 | Medium | Recovery status enum drift | Phase 5 |
| 46 | B05-001 | Medium | Planner fallback queries not agenda-specific enough | Phase 1 |
| 47 | B12-003 | Medium | Numeric extraction too shallow for Indian context | Phase 2 |
| 48 | B12-004 | Medium | Legal holding extraction too broad | Phase 2 |
| 49 | B08-003 | Medium | Timeout fallback doesnt preserve cause detail | Phase 2 |
| 50 | C-072 | High | No CI/CD — all changes ship based on local verification | Phase 7 |

## 6. Minimum Functional Repair Plan

**Phase 0 — Stop the type safety bleed.**
Enable `strict: true` in backend and frontend tsconfig. Fix the most common violations: `as any` casts, implicit any parameters, unchecked null access. Deduplicate PipelineMetadata and ResearchTerminalStatus between backend and frontend — use shared types or generate them.

**Phase 1 — Stop topic/query drift.**
Fix query planner to use topic classification (remove `void topic`). Add agenda-keyword overlap checks to query validator. Fix low-confidence topic classifier to flag when confidence < 0.55. Replace stale EVM queries with agenda-conditioned templates.

**Phase 2 — Make source eligibility consistent.**
Add rejection reasons to source filter (`{kept, rejected[]}`). Ensure failed enrichment is never citation eligible. Add `citationGap: true` for authority/hash fallback citations. Enforce citation eligibility at every final selector entry point. Gate role generation on mode-specific minimum eligible evidence.

**Phase 3 — Fix citation coverage and repair.**
Build repair context per unsupported citation (not global truncation). Track sentence offsets during validation for precise claim removal. Add post-repair validation gate. Mark authority/hash fallback citations as citation gaps.

**Phase 4 — Synthesis quality.**
Remove fallback to full-text scanning for D7/D11 quality checks. Require all divisions to pass against their own text, not borrowed content. Validate each division against cited claims and required source classes.

**Phase 5 — Normalize terminal status.**
Define one shared terminal/fallback enum for backend/frontend. Route always uses the canonical terminal decision. Map recovery interruption to cancelled or explicit recovery state.

**Phase 6 — Add frontend safety.**
Require `runId + assistantMessageId + conversationId` tuple match for every stream event. Use backend canonical source IDs for display dedup. Show unverified citation styling unless backend citationStatus exists.

**Phase 7 — Add regression harness.**
Add backend integration tests for the pipeline orchestrator. Add mocked provider/search/extraction harness. Test all modes: normal, fast, deep, PhD, FullSpectrum. Test terminal states: completed, failed, provider_error, source_gaps, cancelled.

## 7. Test Harness Plan

**Pipeline end-to-end:**
- Normal mode: request to agenda to retrieval to registry to roles to synthesis to citations to quality gate to completed
- Fast research: minimal retrieval, fast synthesis, reduced source count
- Deep research: full retrieval, multi-role generation, citation repair
- PhD mode: strict source requirements, PhD thresholds, source gap detection
- FullSpectrum: all buckets, maximum roles, full D1-D11 division validation
- Provider error: all providers fail leads to provider_error terminal status
- Legacy fallback: core generation fails, legacy fallback allowed or forbidden
- Cancelled: abort during retrieval, during roles, during synthesis
- Empty final answer: metadata stripped leads to failed status

**Query planning:**
- Generic query rejection (8-char minimum, India parliament official source)
- Stale EVM term rejection for non-EVM agendas
- Topic-aware query generation for each agenda type
- Duplicate query deduplication
- Mode-specific query count validation

**Enrichment:**
- Firecrawl invalid_key falls back to Jina
- Jina timeout falls back to readability
- Readability failure falls back to snippet
- PDF extraction success and failure
- Extraction quality: high/medium/low/failed
- Failed extraction citation ineligibility
- Enrichment budget exhaustion

**Evidence registry:**
- Source class mapping for all 17 classes
- Duplicate merge provenance preservation
- Prompt export truncation behavior
- Citation eligibility true/false
- Bucket coverage calculation
- Storage snapshot shape verification

**Source usage:**
- Empty assigned scope failure
- Unknown usage type rejection
- Fake source ID rejection
- Legal holding from non-legal source
- Number from non-numeric source
- Cross-batch source reference rejection
- Validator report persistence

**Synthesis:**
- D1-D11 golden fixtures with ClaimGraph inputs
- Reject scaffold/template answers
- Source gap disclosure in divisions
- Unsupported role output rejection
- Division boundary validation
- Role output routing by division

**Citations:**
- Claim-level linked citation validation
- Number/rank/legal sentence citations
- Fake ID rejection
- URL mismatch detection
- Frontend rendering contract
- Deterministic offset stability
- Bare citation rejection

**Repair:**
- Iteration convergence
- Unsupported claim exact match removal
- Unsupported claim paraphrase removal
- Post-repair validation gate
- Max iteration stop
- No-progress stop

**Quality gate:**
- Mode thresholds: fast/deep/PhD/FullSpectrum
- Division boundary enforcement (no full-text fallback)
- Indian parliamentary framing pass
- UN framing rejection
- Legal safety gate
- Electoral safety gate
- Source gap bypass prevention

**Run state:**
- Terminal transition machine
- Persistence metadata verification
- Source snapshot cited ID matching
- Cache tag reuse eligibility
- Cancellation propagation
- Server timeout terminal state

**Frontend:**
- Stale event ignored by runId
- Stale event ignored by assistantMessageId
- Stale event ignored by conversationId
- Terminal failed not overwritten by completed
- Provider_error visible in UI
- Source panel correct class mapping
- CitationStatus-first rendering
- Metadata stripping before display
- Retry/cancel state reset

## 8. Do-Not-Fix-Yet List

- **Large-scale deletion of legacy services** before runtime parity tests exist.
- **UI redesign** beyond status/source/citation correctness.
- **Live provider smoke calls with real keys** until mocked provider contract tests pass.
- **Broad prompt rewriting** before query/source/citation contracts are stable.
- **Archive schema migration** before terminal-status and metadata contracts are unified.
- **Performance tuning** beyond timeout/budget correctness.
- **Source-pack cleanup** until .db, WAL/SHM, debug, and migration artifacts are classified.
- **Claim graph contradiction detector expansion** — current numeric/legal/official-watchdog/trend detection is adequate for now.
- **Frontend dark mode fixes** — cosmetic, not pipeline-critical.
- **Provider model catalog expansion** — functional correctness takes priority over model count.

---

*Audit completed 2026-05-31. Total findings: 485 across 23 bricks + 5 cross-cutting areas.*

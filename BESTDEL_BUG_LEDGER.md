# BestDel Bug Ledger

## Fast Research Quality-Gate Repair - 2026-06-01

Status: fixed locally.

Brick:
- Brick 21 Quality Gate.
- Brick 18 Final Answer / Repair path.

Bug covered:
- B21-023 fast research with honest source gaps still failed on bucket concentration.
- B18-023 repair/generation text injected unsupported legal phrasing and then tripped legal accuracy.

Root cause:
- Source diversity gate treated low bucket spread as fatal even when `fast_research` or `deep_research` had an explicit `SourceGapReport`.
- Legal safety detection treated generic legal-ish wording too broadly.
- Debate/legal repair templates injected `Article 19/21`, `court`, `legality`, and similar phrasing without checking for legal sources.

Fix:
- Downgraded bucket concentration from fatal to warning for `fast_research` and `deep_research` when source gaps are explicitly disclosed.
- Narrowed legal-claim detection to affirmative legal-claim language instead of broad generic wording.
- Added real `legal_accuracy_repair`.
- Removed hardcoded unsupported legal language from debate-utility repair text.
- Made deterministic/model guidance more legal-source-aware.

Verification:
- PASS `npm.cmd run typecheck --prefix backend`
- PASS `node --import tsx --test --test-concurrency=1 ./tests/quality-gate/fast-source-gap-bucket-warning.test.ts ./tests/quality-gate/brick21-quality-gate-regression.test.ts ./tests/quality-gate/unsupported-claim-degraded.test.ts ./tests/verification/repair-orchestrator-legal-accuracy.test.ts ./tests/verification/repair-orchestrator-specific-prompts.test.ts`

Remaining risk:
- Live provider rerun not executed in this turn, so this is code-path verified, not live-key verified.

## Provider Status Logging Repair - 2026-06-01

Status: fixed locally. This batch targets the backend provider-health logging path used by the real frontend refresh flow.

Brick:
- Brick 3 Provider/Router Layer.

Bug covered:
- B03-001 provider status refresh returned health JSON but did not emit provider-health diagnostics in the normal `GET /api/providers/status` path.

Root cause:
- The frontend refresh path uses `GET /api/providers/status?bypass=true&refresh=...`, but backend provider-health logging only ran in `POST /api/providers/diagnostics` or behind `DEBUG_PROVIDERS=true`.
- As a result, normal settings refreshes and automatic provider refreshes were operationally silent even though status was computed correctly.

Fix:
- Added `emitProviderStatusLogs()` in `backend/src/routes/providers.ts`.
- `GET /api/providers/status` now emits redacted provider diagnostic logs for configured providers when the request explicitly bypasses cache, which is the real frontend refresh path.
- `POST /api/providers/diagnostics` now reuses the same helper instead of duplicating the loop.

Verification:
- PASS `node --import tsx --test --test-concurrency=1 ./tests/providers/provider-status-logging.test.ts ./tests/providers/provider-status.test.ts ./tests/providers/provider-status-health-semantics.test.ts ./tests/providers/provider-status-cache.test.ts`
- FAIL `npm.cmd run typecheck --prefix backend` due pre-existing unrelated errors in `src/core/providers/limits/extraction-cooldown.ts` and `src/core/providers/limits/stage-fallback-router.ts`.

Remaining risk:
- Provider-status logging is still tied to refresh requests; passive cached status reads without `bypass=true` remain intentionally quieter.
- Backend-wide typecheck is not green in this checkout because of unrelated provider-limits files.

## Functional Pipeline Repair Batch - 2026-06-01

Status: fixed locally. This batch targets the minimum source-grounded end-to-end research path from the uploaded census and keeps the broader dirty worktree intact.

Root cause:
- The research path had several split contracts: query normalization happened in multiple places, topic classification was discarded in legacy planning, source filtering returned only accepted sources, provider timeouts did not abort underlying work, citation selection could fall back without claim support, and status could be derived outside the backend terminal decision.
- Evidence identity was unstable because registry source IDs were tied to array length, and downstream packs/citations could receive malformed URLs or weak snippets as if they were strong evidence.
- Quality and synthesis gates expected richer ClaimLedger/ClaimGraph context than several paths supplied, so old tests either overtrusted citation counts or failed for the wrong reason.

Fix:
- Normalized the pipeline query once and reused it for agenda, dimension, archive, query planning, and generation.
- Reconnected topic-specific fallback planning and preserved short Indian acronyms in planner and evidence grounding.
- Added filter rejection diagnostics to `SourceGapReport`.
- Made EvidenceRegistry source IDs monotonic and duplicate-safe.
- Hardened enrichment for malformed URLs, empty extraction text, Firecrawl invalid keys, limited snippet fallback, cache URL preservation, and provider abort signals.
- Made pack and prompt construction safe for malformed URLs and compressed evidence; deterministic source usage now prefers extracted facts/chunks before raw full text.
- Built ClaimLedger/ClaimGraph into the core generation path, removed random/authority/hash citation fallback from credited citations, and emits citation gaps when no claim-supported source exists.
- Let low citation count trigger evidence-only repair and deterministic cited fallback before terminal decision.
- Routed terminal status through backend `decideRunTerminalStatus`; normalized degraded fallback to explicit `legacy_fallback_used`.
- Kept frontend run-state from re-deriving completed status from source gaps.

Bugs covered:
- B01-002 normalized query consistency.
- B07-001 query planner discarded topic classification.
- B07-002 short acronym filtering and stale-topic bleed.
- B10-005 malformed source URL handling.
- B10-006 source filter rejection diagnostics.
- B12-006 canonical/cache URL preservation.
- B12-008 snippet fallback limited, not strong citation evidence.
- B12-017 empty extraction fallback.
- B13-001 monotonic EvidenceRegistry source IDs.
- B14-015 malformed URL safe EvidencePack construction.
- B19-003 no random citation fallback.
- B19-010 explicit citation-gap strategy.
- B21-005 D7 evidence-specific Treasury/Opposition citation split.
- B21-006/B21-017 D11 non-template synthesis validation.
- B22-017 degraded fallback normalized to explicit fallback status.
- C-055 provider timeout abort propagation.

Verification:
- PASS `npm.cmd test --prefix backend`
- PASS `npm.cmd run typecheck --prefix backend`
- PASS `npm.cmd run build --prefix backend`
- PASS `npm.cmd test --prefix frontend`
- PASS `npm.cmd run typecheck --prefix frontend`
- PASS `npm.cmd run build --prefix frontend`
- PASS `npm.cmd run build`
- PASS package-local `npx.cmd tsc -p tsconfig.json --noEmit` from `backend/`
- PASS package-local `npx.cmd tsc -p tsconfig.json --noEmit` from `frontend/`
- NOTE root-level `npx.cmd tsc -p backend/tsconfig.json --noEmit` and frontend equivalent try to fetch the root `tsc` package and fail under restricted network; package-local `npx` and direct local binaries pass.

Remaining risk:
- No live provider/search/extraction calls were made in this pass.
- The uploaded census has hundreds of additional findings outside this minimum functional path.
- Root-level `npx tsc -p backend/...` remains a workspace tooling quirk; package-local checks are green.

## Cross-Brick Bug Census Repair Batch - 2026-05-31

Status: fixed locally for the first high-priority census batch. Backend typecheck and focused backend/frontend regression tests are green. Full backend/frontend/root build suites are still pending for this run.

Bricks touched:
- Brick 2 Provider/Router Layer.
- Brick 6 Source Bucket Planner.
- Brick 7 Query Planner.
- Brick 8 Search Provider Layer.
- Brick 11 Source Scoring.
- Brick 16 SourceUsageMap Validator.
- Brick 18 Synthesis Engine.
- Brick 22 Run State and Persistence.
- Brick 23 Frontend Display.

Root cause:
- Several shared contracts had drifted: `general_media` existed in retrieval scoring but not evidence normalization maps, search budget aborts returned an undeclared status, catalog/unverified model-list states were still treated as provider-usable in one helper, and route finalization could prefer pipeline status over a stricter terminal decision.
- SourceUsageMap normalization converted unknown usage types into positive `supports_claim`, and an explicit empty role source scope disabled assigned-source enforcement.
- Query/source planning still contained stale and generic fallbacks: democratic-space buckets had a hard-coded EVM/paper-ballot query, foreign-policy official buckets duplicated `government_official` and dropped MOD intent, and empty legacy planning could invent generic PhD queries.
- Frontend source badges still used older `government_india` / `court_judgement` mappings, and persisted metadata parsing only accepted `assistantMessageId` rather than the full run identity tuple.

Fix:
- Added `aborted` to the search provider status contract.
- Completed `general_media` bucket and score mappings, and changed unknown evidence domains to `general_media` instead of `policy_research`.
- Made `isUsableProviderStatus()` research-strict: only `healthy` is usable; `catalog_fallback` and `unverified` remain model-list/display states through `canListModels`.
- Made GitHub catalog payloads explicitly non-chat-verified.
- Made unknown SourceUsageMap usage types normalize to `unknown_invalid` and fail validation.
- Made an explicit empty assigned source set reject all usage items as cross-batch references.
- Always uses the canonical route terminal decision instead of falling back to `pipelineResult.terminalStatus`.
- Marked deterministic division scaffolds as not quality-passed.
- Removed stale EVM paper-ballot bucket query and merged MEA/MOD official foreign-policy queries into one bucket.
- Rejected empty legacy planner fallback and filtered topic-free generic official/court queries.
- Updated frontend source badges/tiering for backend source classes and metadata parsing for `runId + conversationId + assistantMessageId`.

Bugs covered:
- B02-001 catalog/unverified research usability.
- B08-001 undeclared `aborted` search status.
- B11-001 and B11-002 missing `general_media` mappings.
- B11-003 unknown domains over-promoted to `policy_research`.
- B16-001 empty assigned source scope disables enforcement.
- B16-002 unknown usage type becomes `supports_claim`.
- B18-001 deterministic scaffold marked quality-passed.
- B22-001 route can ignore stricter terminal decision.
- B23-002 stale frontend source class mapping.
- B01-005 persisted metadata full tuple matching.
- B06-001 duplicate foreign-policy official bucket drops MOD intent.
- B06-002 stale hard-coded EVM query.
- B07-001 empty query generic PhD fallback.
- B07-002 topic-free generic query acceptance.

Verification:
- PASS `node --import tsx --test --test-concurrency=1 tests/providers/provider-status-contract-usage.test.ts tests/providers/provider-health-policy.test.ts tests/providers/github-model-list.test.ts tests/retrieval/source-classification-quality.test.ts tests/evidence/source-usage/cross-batch-source.test.ts tests/evidence/source-usage/usage-type-normalizer.test.ts tests/retrieval/enrichment-capacity.test.ts`
- PASS `npm.cmd run typecheck --prefix backend`
- PASS `node --import tsx --test --test-concurrency=1 tests/run-state/terminal-status-decider.test.ts tests/synthesis/division-synthesis-orchestrator.test.ts`
- PASS `node --import ../backend/node_modules/tsx/dist/loader.mjs --test src/components/chat/source-panel.test.ts src/lib/pipeline-metadata.test.ts src/components/chat/chat-message-list.test.ts` from `frontend/`
- PASS `node --import tsx --test --test-concurrency=1 tests/retrieval/source-buckets.test.ts tests/retrieval/topic-specific-buckets.test.ts tests/retrieval/query-planning/query-plan-integration.test.ts`
- PASS `node --import tsx --test --test-concurrency=1 tests/retrieval/query-planning/legacy-adapters.test.ts tests/retrieval/query-planning/query-plan-validator.test.ts tests/retrieval/query-planner-quality-regression.test.ts tests/retrieval/query-planning/query-plan-integration.test.ts`

Remaining risk:
- This is not the full 645-finding repair. It resolves the first compile/truthfulness batch and adds regression coverage. The next pass should continue with citation injection/repair claim-level grounding, evidence prompt export truncation, enrichment failure eligibility, and archive context routing.

## Brick 7 - Query Planner - 2026-05-28

Status: fixed locally for Brick 7; broad backend suite still has unrelated non-Brick 7 failures.

Root cause:
- Query planning had split sources of truth: the core bucketed planner, legacy role query planner, legacy web-search engineered queries, and static fallback minimums.
- The official planner was static-template dominated, had weak keyword extraction, lacked structured telemetry, and did not apply resolved-query drift filtering consistently.

Fix:
- Added the modular official query planner under `backend/src/core/retrieval/query-planning/`.
- Kept `backend/src/core/retrieval/query-planner.ts` as the public compatibility shim.
- Routed legacy query minimums and web-search engineered queries through official planner adapters.
- Added mode-aware deterministic expansion, explicit mode-specific query text families, optional schema-validated LLM expansion, topic-aware fallbacks, freshness queries, parliamentary targeting, clean top-up queries, archive guarding, drift filtering, and unified dedupe.

Bugs covered:
- BUG-01 single official planner.
- BUG-02 legacy planners do not silently bypass official planning.
- BUG-03 static-only planning replaced by deterministic expansion.
- BUG-04 optional LLM expansion is schema-validated with deterministic fallback.
- BUG-05 no `accountability` keyword fallback; Indian parliamentary terms preserved.
- BUG-06 expanded confidence-scored topic classification.
- BUG-07 generic Indian topics get broad bucket coverage.
- BUG-08 mode-specific query text and bucket distribution: fast uses overview/high-confidence text, deep uses recent-development/key-argument text, PhD uses scholarly/statistical/trend text, and FullSpectrum uses timeline/counterargument/comparative/implementation-gap text.
- BUG-09 clean top-up query patterns.
- BUG-10 archive context cannot contaminate base search subject.
- BUG-11 topic-aware fallback queries.
- BUG-12 freshness/current-year queries.
- BUG-13 parliamentary targeting.
- BUG-14 acronym-preserving dedupe.
- BUG-15 drift filtering after template resolution.
- BUG-16 query telemetry for generated/deduped/rejected queries.
- BUG-17 role/lens-aware expansion uses agenda, entities, buckets, and mode.
- BUG-18 duplicate-year and shallow generic regressions blocked.
- BUG-19 legacy web-search fallback query builders routed through official adapters.
- BUG-20 Brick 7 report and audit updates added.

Verification:
- PASS `node --import tsx --test tests/retrieval/query-planning/mode-query-strategy.test.ts`
- PASS `node --import tsx --test tests/retrieval/query-planning/*.test.ts`
- PASS `node --import tsx --test tests/retrieval/query-planner.test.ts tests/retrieval/query-planner-quality-regression.test.ts tests/retrieval/query-planner-fullspectrum-real.test.ts`
- PASS `node --import tsx --test tests/pipeline-validation-helpers.test.ts tests/integration/core-route-replaces-legacy.test.ts`
- PASS `npx.cmd tsc -p tsconfig.json --noEmit` from `backend/`
- FAIL `npm.cmd test --prefix backend`: six failures remain in source-usage fallback and core-generation prompt-budget tests, outside Brick 7.

## Brick 17 - Role Research Generation - 2026-05-29

Status: fixed locally for Brick 17; targeted role-generation/source-usage/pipeline verification is green. Full backend suite still has remaining generation prompt-budget/model-backed answer failures outside the repaired role-generation path.

Root cause:
- Brick 17 used generic role prompts, role-name-only differentiation, circular card assignment, no compact ClaimGraph/SourceGap context, single top chunk serialization, weak retry prompts, and no cross-batch source guard before accumulation.
- Legal/data analysis were absent from role definitions and model strategy, while division synthesis could consume generic claim-ledger slices instead of the correct role outputs.
- Deterministic fallback flattened quality by demoting evidence too aggressively or without preserving usable partial evidence signals.

Fix:
- Added modular `backend/src/core/synthesis/role-generation/**` with role definitions, instructions, mode depth, prompt building, card selection, ClaimGraph/SourceGap context, parsing, validation, retry planning, deterministic fallback, cross-batch guard, division routing, telemetry, and runner.
- Kept `model-role-runner.ts` and `source-usage-role-prompt.ts` as compatibility shims.
- Added `legal_analyst` and `data_analyst` to role/model strategy.
- Routed role-specific card selection, compact ClaimGraph, and provisional SourceGapReport through `research-pipeline.ts`.
- Routed D7/D11 and evidence/legal/data sections through division-aware role output selection.
- Replaced placeholder thesis skeleton behavior with a real claim-spine skeleton.
- Added Brick 17 tests under `backend/tests/synthesis/role-generation/`.

Bugs covered:
- BUG-01 role-specific instructions.
- BUG-02 ClaimGraph context in role prompts.
- BUG-03 multiple topChunks and quality metadata serialization.
- BUG-04 and BUG-14 role-specific card selection with safe unknown-role default.
- BUG-05 legal_analyst and data_analyst roles.
- BUG-06 deterministic confidence from evidence quality.
- BUG-07 mode-specific role depth.
- BUG-08 structured retry planner.
- BUG-09 and BUG-11 division-aware role output routing and supported sections.
- BUG-10 source quality fields visible to roles.
- BUG-12 provisional SourceGapReport context.
- BUG-13 cross-batch contamination guard.
- BUG-15 non-placeholder thesis skeleton.
- BUG-16 hallucinated extraction regression coverage.

Verification:
- PASS `node --import tsx --test --test-concurrency=1 tests/synthesis/role-generation/*.test.ts` - 14 passed, 0 failed.
- PASS `node --import tsx --test --test-concurrency=1 tests/evidence/source-usage-real-role.test.ts tests/evidence/source-usage-live-failure-policy.test.ts tests/synthesis/*.test.ts` - 22 passed, 0 failed.
- PASS `node --import tsx --test --test-concurrency=1 tests/generation/core-answer-generator.test.ts tests/integration/core-division-integration.test.ts tests/integration/core-division-live-integration.test.ts tests/integration/india-democracy-pipeline.integration.test.ts tests/integration/live-core-pipeline-routing.test.ts tests/pipeline/research-pipeline-fallback-truth.test.ts` - 10 passed, 0 failed.
- PASS `npx.cmd tsc -p tsconfig.json --noEmit` from `backend/`.
- FAIL `npm.cmd test --prefix backend`: remaining failures are in `tests/generation/core-answer-generator-model-path.test.ts`, `tests/generation/core-answer-provider-routing.test.ts`, `tests/generation/model-backed-core-answer.test.ts`, and `tests/generation/prompt-budget-compression.test.ts`; failures are prompt-budget/model-backed final-answer behavior after source-usage roles complete.

Remaining risk:
- Full backend suite is not green in this dirty checkout because generation prompt compression/model-output quality tests still fail outside Brick 17.
- Source quality counts in role payload metadata are best-effort summaries; strict pass/fail still comes from `SourceUsageMap` validation.

## Brick 22 - Run State, Persistence, and Final Output Delivery - 2026-05-30

Status: fixed locally for Brick 22; targeted run-state/frontend verification, typecheck, backend build, and frontend build are green. Full backend `npm test` is still not green in this dirty checkout because unrelated citation/generation suites fail or use Vitest APIs under Node's test runner.

Root cause:
- Final run status, source/citation metadata, division outputs, SSE terminal handling, persistence, cache reuse, and frontend completion semantics were split across the pipeline, service route, persistence helper, stream writer, and reducer.
- `final_answer_ready` was interpreted as terminal by the frontend, `COMPLETE` re-derived terminal state from local source-gap data, division outputs were not serialized/persisted/delivered, and successful terminal status could be assigned to empty/metadata-only output.
- Legacy/fallback/cancellation/provider-error paths did not share the same result shape, diagnostics, or terminal write protection as the core path.

Fix:
- Added modular backend run-state helpers under `backend/src/core/run-state/` and streaming guard/envelope helpers under `backend/src/core/streaming/run-stream/`.
- Added modular frontend run-state helpers under `frontend/src/lib/run-state/`.
- Added atomic result snapshots for sources, cited IDs, citation reports, source contract, quality gate, source gaps, repair/source-usage reports, division outputs, and terminal status.
- Added structured message metadata columns (`metadata_json`, `run_id`, `run_status`, `run_phase`, `run_last_heartbeat_at`) while preserving hidden HTML-comment metadata as a compatibility fallback.
- Added explicit terminal write guards, run-aware cache tags, cancellation propagation for superseded runs, stale-run recovery helpers, mode-aware failure titles, and safe provider error visibility.

Bugs covered:
- BUG-01 division outputs are serialized, emitted, persisted in metadata, and restored in frontend state.
- BUG-02 `final_answer_ready` is non-terminal.
- BUG-03 backend pipeline records a single terminal status on `ResearchPipelineResult`.
- BUG-04 frontend `COMPLETE` no longer re-derives or upgrades backend terminal status.
- BUG-05 empty/metadata-only final output fails with `EMPTY_FINAL_ANSWER`.
- BUG-06 result snapshot keeps source metadata and cited IDs atomic.
- BUG-07 structured metadata persistence added with HTML-comment fallback.
- BUG-08 legacy/fallback normalizer exposes core-compatible shape.
- BUG-09 provider errors persist visible provider/model/status/stage details.
- BUG-10 cache entries can be tagged by run/status and failed/partial entries are not reused as success.
- BUG-11 superseded run cancellation aborts and persists cancelled state.
- BUG-12 `PipelineMetadata` includes division outputs, reports, fallback/error/provider fields, usage reports, token/cost placeholder, bucket coverage, and agenda metadata.
- BUG-13 stale running runs can be recovered as interrupted.
- BUG-14 terminal write guard blocks content/progress after terminal.
- BUG-15 failed/exhausted messages use mode-aware titles.
- BUG-16 legacy terminal shape includes diagnostics.

Verification:
- PASS `node --import tsx --test --test-concurrency=1 tests/run-state/*.test.ts` - 12 passed, 0 failed.
- PASS `node run-src-tests.mjs src/lib/run-state/__tests__/*.test.ts src/components/chat/stream-event-normalizer.test.ts src/components/chat/chat-area-modularization.test.tsx` - 78 passed, 0 failed.
- PASS `npm.cmd run typecheck` from `backend/`.
- PASS `npm.cmd run typecheck` from `frontend/`.
- PASS `npx.cmd tsc --noEmit` from `backend/`.
- PASS `npx.cmd tsc --noEmit` from `frontend/`.
- PASS `npm.cmd run build` from `backend/`.
- PASS `npm.cmd run build` from `frontend/` with the existing Vite large chunk warning.
- PASS `npm.cmd test` from `frontend/` - 6 dev-config tests and 78 source tests passed.
- FAIL/TIMEOUT `npm.cmd test` from `backend/`: timed out after 245s after hitting unrelated failures in citation injection/repair tests that use Vitest runner APIs under Node test runner, missing citation exports, and several pre-existing generation/source prompt tests.

Remaining risk:
- Full backend suite remains blocked by unrelated dirty-checkout failures outside Brick 22.
- Live provider-key/manual SSE acceptance was not run in this environment.

## Brick 23 - Frontend Stream Reader Syntax Recovery - 2026-05-30

Status: fixed locally; frontend build is green.

Problem:
- `npm run dev` failed while building the frontend because `frontend/src/components/chat/use-chat-run-controller.ts` contained `await reader.read()` inside a non-async nested callback scope.

Root cause:
- A partial `processSseLine` extraction was left in the file before the real stream reader loop. The helper duplicated the first SSE handlers, was never called, and left the stream loop inside the helper's open `try` block. Removing that dead partial helper also revealed the intended stream-reader `try/finally` had lost its opening `try`.

Files changed:
- `frontend/src/components/chat/use-chat-run-controller.ts`
- `BESTDEL_BUG_LEDGER.md`

Fix:
- Removed the unused, half-extracted `processSseLine` block.
- Restored the `try { while (true) { ... await reader.read() ... } } finally { clearTimeout(...) }` structure around the real SSE reader loop.

Runtime reasoning:
- The hook's actual runtime path is the existing `while (true)` SSE reader inside async `runStream`. Restoring that loop to the async function scope fixes the build error without changing run identity, stale-event handling, terminal status dispatch, citation status handling, or provider error handling.

Verification:
- PASS `npm.cmd run build --prefix frontend`.

Remaining risk:
- I did not run live `npm run dev` or browser SSE checks in this pass; the exact compile failure is covered by the frontend build.

## Bricks 2, 7, 12-14, 23 - Council Mode Restoration - 2026-06-05

Status: fixed locally for Council restoration; backend/frontend typechecks, focused backend Council tests, and frontend tests are green.

Problem:
- The Council implementation files had been removed again, leaving the `council` mode either missing or only partially wired through the route/UI state.
- Restored frontend Council files were also split across two incompatible data contracts: backend SSE emitted snake_case Council payloads, while several restored components/reducer paths expected camelCase fields.

Root cause:
- Council was an additive mode with new backend modules, SSE events, frontend state, and UI components, but the source files were absent from the working tree.
- The frontend restore mixed an older camelCase fixture/component shape with the backend `CouncilSession`, `CouncillorOutput`, `CouncilSeal`, `CouncilDispute`, and `CouncilVerdict` shape.

Files changed:
- `backend/src/core/council/*`
- `backend/tests/council/*`
- `backend/src/core/config/research-mode.ts`
- `backend/src/core/pipeline/pipeline-metadata.ts`
- `backend/src/core/evidence/evidence-pack/pack-budget.ts`
- `backend/src/services/anthropic-service.ts`
- `frontend/src/components/council/*`
- `frontend/src/components/chat/chat-area.tsx`
- `frontend/src/components/chat/chat-model-routing.ts`
- `frontend/src/components/chat/settings-dialog.tsx`
- `frontend/src/components/chat/use-chat-run-controller.ts`
- `frontend/src/hooks/use-pipeline-state.ts`
- `frontend/src/hooks/use-pipeline-state-council.test.ts`
- `frontend/src/hooks/use-provider-models.tsx`
- `frontend/src/hooks/use-provider-models.test.ts`

Fix:
- Restored the backend Council module: types/config/planner, per-councillor enrichment, EvidenceRegistry, EvidencePack wrappers, structured brief generation, deliberation engine, Chief synthesis, orchestrator, and SSE event builders.
- Added additive `council` mode rows and routing without changing existing mode branches.
- Restored the frontend Council component tree, dossier export, and Council mode selection.
- Normalized Council reducer/controller/UI/export/tests to the backend snake_case event contract.
- Added focused backend Council tests for config, deliberation, and stream event builders.
- Completed the already-present Cerebras provider model maps so frontend typecheck remains type-complete.

Runtime reasoning:
- The `anthropic-service.ts` Council branch now resolves a core provider, builds an agenda/query plan, runs bucketed retrieval, runs six councillors through isolated registries/packs, emits multiplexed Council SSE events, synthesizes C7 from C1-C6 outputs only, and persists the final session metadata.
- The frontend controller accepts Council SSE events, normalizes legacy/canonical payloads into the canonical backend-shaped state, and `CouncilChamberPanel` renders that state instead of the D1-D11 research panel.

Verification:
- PASS `npm.cmd run typecheck` from `backend/`.
- PASS `npm.cmd run typecheck` from `frontend/`.
- PASS `node --import tsx --test --test-concurrency=1 .\tests\council\council-config.test.ts .\tests\council\deliberation-engine.test.ts .\tests\council\council-stream-events.test.ts` from `backend/` - 5 passed, 0 failed.
- PASS `npm.cmd test` from `frontend/` - 87 passed, 0 failed.
- TIMEOUT/FAIL `npm.cmd test` from `backend/`: timed out after 241s in the dirty checkout after unrelated generation/source-usage failures. The first isolated diff shows pre-existing `source-usage-policy.ts` threshold changes for fast/deep research, not a Council regression.

Remaining risk:
- I did not run a live Council provider smoke because that would consume provider/search credits and requires live keys.
- Full backend suite is still blocked by unrelated dirty-checkout failures outside the restored Council path.

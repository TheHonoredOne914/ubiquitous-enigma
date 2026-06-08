# Research Contract Proof

**Purpose:** This document provides an end-to-end verification trail for each research mode contract. Any engineer can follow these references to verify the contracts are enforced throughout the system.

**Date Created:** 2026-06-08  
**Last Verified:** 2026-06-08

---

## MODE CONTRACTS

### fast_research
| Requirement | Value | Enforcement Location |
|-------------|-------|---------------------|
| Minimum Sources | ≥40 | `backend/src/core/config/research-mode.ts:22-23` |
| Minimum Words | ≥1000 | `backend/src/core/quality-gate/mode-thresholds.ts:47` |
| Source Usage Policy | 40 required, 12 per role | `backend/src/core/config/source-usage-policy.ts:18-27` |

### deep_research
| Requirement | Value | Enforcement Location |
|-------------|-------|---------------------|
| Minimum Sources | ≥80 | `backend/src/core/config/research-mode.ts:34-35` |
| Word Range | 2000-3000 | `backend/src/core/quality-gate/mode-thresholds.ts:63-64` |
| Source Usage Policy | 80 required, 20 per role | `backend/src/core/config/source-usage-policy.ts:28-37` |
| Claim Grounding | Required | `backend/src/core/quality-gate/mode-thresholds.ts:65` |

### council
| Requirement | Value | Enforcement Location |
|-------------|-------|---------------------|
| Minimum Sources | ≥180 | `backend/src/core/config/research-mode.ts:46-47` |
| Word Range | 3000-5500 | `backend/src/core/quality-gate/mode-thresholds.ts:79-80` |
| Source Usage Policy | 180 required, 30 per role | `backend/src/core/config/source-usage-policy.ts:38-47` |
| Claim Grounding | Required | `backend/src/core/quality-gate/mode-thresholds.ts:81` |
| Contradictions | Required | `backend/src/core/quality-gate/mode-thresholds.ts:82` |

---

## END-TO-END ENFORCEMENT TRAIL

### 1. CONFIGURATION LAYER (Source of Truth)

**File:** `backend/src/core/config/research-mode.ts`
- **Lines 17-54:** `RESEARCH_LIMITS` record defines per-mode limits
- **Key fields:** `minCitationEligibleSources`, `minFinalUniqueCitedSources`
- **Verification:** All downstream code imports from this single source

**File:** `backend/src/core/config/source-usage-policy.ts`
- **Lines 15-48:** `getSourceUsagePolicy()` returns per-mode policies
- **Key fields:** `requiredSources`, `perRoleMinimum`, `minimumToProceed`
- **Verification:** Used by source usage validator

**File:** `backend/src/core/quality-gate/mode-thresholds.ts`
- **Lines 35-83:** `MODE_THRESHOLDS` record defines quality gates
- **Key fields:** `minCitedSources`, `finalAnswerMinWords`, `finalAnswerMaxWords`
- **Verification:** Imported by all quality gate functions

---

### 2. RETRIEVAL LAYER

**File:** `backend/src/core/retrieval/bucketed-retrieval.ts`
- **Function:** `modeRetrievalOptions(mode: ResearchMode)` 
- **Enforcement:** Reads `RESEARCH_LIMITS[mode].minCitationEligibleSources` and `minFinalUniqueCitedSources`
- **Verification:** Retrieval continues until minimums met or SourceGapReport generated

**File:** `backend/src/core/retrieval/early-stopping.ts`
- **Lines 16-20:** `TARGETS` constant defines per-mode minimums
- **Function:** `shouldStopRetrievalEarly()` checks against targets
- **Enforcement:** Returns `stop: false` if sources < target.minEligible

**File:** `backend/src/core/retrieval/query-planning/build-query-plan.ts`
- **Enforcement:** Passes `limits.minCitationEligibleSources` and `limits.minFinalUniqueCitedSources` to plan

---

### 3. EVIDENCE LAYER

**File:** `backend/src/core/evidence/source-usage/source-eligibility.ts`
- **Function:** `canCountForStrictSourceUsage()` validates eligibility
- **Enforcement:** Checks `citationEligible`, `extractionQuality`, snippet status
- **Verification:** Only eligible sources count toward mode floors

**File:** `backend/src/core/evidence/evidence-registry.ts`
- **Function:** Tracks citation-eligible source count
- **Enforcement:** Provides `getCitationEligibleCount()` for validation

---

### 4. GENERATION LAYER

**File:** `backend/src/core/generation/prompt-budget.ts`
- **Line reference:** Uses `RESEARCH_LIMITS[input.mode].minFinalUniqueCitedSources`
- **Enforcement:** Budget calculations preserve source floor

**File:** `backend/src/core/generation/core-answer-generator.ts`
- **Multiple locations:** References `limits.minFinalUniqueCitedSources`
- **Enforcement:** Throws error if fewer sources than required while enough exist
- **Repair logic:** Triggers citation repair if below floor

**File:** `backend/src/core/generation/core-answer-prompt.ts`
- **Enforcement:** Reads `RESEARCH_LIMITS[input.mode].minFinalUniqueCitedSources` as mode floor

---

### 5. VERIFICATION LAYER

**File:** `backend/src/core/verification/citation-validator.ts`
- **Lines 19-93:** `validateCitations()` function
- **Enforcement:** 
  - Rejects bare citations (lines 27-30)
  - Validates source existence and eligibility (lines 34-50)
  - Checks unique source count against contract (lines 64-67)
- **Output:** `CitationValidationReport` with `uniqueCitedSourceCount`

---

### 6. QUALITY GATE LAYER

**File:** `backend/src/core/quality-gate/source-diversity-gate.ts`
- **Lines 24-30:** Checks `citedCount < thresholds.minCitedSources`
- **Enforcement:** Returns fatal issue if below minimum (unless source gap allowed)
- **Scoring:** Line 79 gives 0 points for source contract if below minimum

**File:** `backend/src/core/quality-gate/claim-grounding-gate.ts`
- **Enforcement:** Validates claim grounding for modes requiring it

**File:** `backend/src/core/quality-gate/final-answer-length-gate.ts`
- **Enforcement:** Checks word count against `finalAnswerMinWords` and `finalAnswerMaxWords`

---

### 7. PIPELINE STATUS LAYER

**File:** `backend/src/core/pipeline/final-status.ts`
- **Lines 32-111:** `decideFinalResearchStatus()` function
- **Enforcement:**
  - Line 48: Zero citations = failed
  - Lines 54-63: Strict completed requires core generation + quality gate pass + source contract pass
  - Lines 96-101: completed_with_source_gaps requires citedSources > 0
  - Multiple fail-safes prevent incorrect completion

---

### 8. FRONTEND DISPLAY

**TODO:** Audit frontend components to add specific line references for:
- Pipeline state machine displaying status
- Source panel showing source counts
- Source gap report visibility
- Provider selection display

---

## VERIFICATION CHECKLIST

To verify a mode contract is enforced end-to-end:

1. ✅ **Configuration:** Check `RESEARCH_LIMITS`, `MODE_THRESHOLDS`, `getSourceUsagePolicy` have correct values
2. ✅ **Retrieval:** Verify `bucketed-retrieval.ts` and `early-stopping.ts` use those values
3. ✅ **Evidence:** Confirm `source-eligibility.ts` filters match requirements
4. ✅ **Generation:** Trace `prompt-budget.ts` and `core-answer-generator.ts` preserve floors
5. ✅ **Verification:** Validate `citation-validator.ts` rejects invalid citations
6. ✅ **Quality Gate:** Check `source-diversity-gate.ts` fails below minimums
7. ✅ **Status:** Confirm `final-status.ts` has correct terminal logic
8. ⏳ **Frontend:** Audit UI components (pending)

---

## TEST COVERAGE

**Existing Tests:**
- `backend/tests/mode-thresholds-requirements.test.ts` - Verifies threshold values match spec

**Recommended Additional Tests:**
- `backend/tests/unit/generation/prompt-budget-floor-preservation.test.ts`
- `backend/tests/integration/retrieval/minimum-source-enforcement.test.ts`
- `backend/tests/unit/verification/comprehensive-citation-validation.test.ts`
- `backend/tests/unit/quality-gate/source-gap-threshold.test.ts`
- `backend/tests/unit/pipeline/final-status-decisions.test.ts`

---

## CHANGE HISTORY

| Date | Change | Verified By |
|------|--------|-------------|
| 2026-06-08 | Initial document created | Audit Session |
| 2026-06-08 | Removed phd_level/fullspectrum modes | Code Review |

---

## NOTES

- **Single Source of Truth:** All numeric thresholds come from `RESEARCH_LIMITS`, `MODE_THRESHOLDS`, or `getSourceUsagePolicy`. No inline magic numbers.
- **No Silent Failures:** Any relaxation of floors must generate SourceGapReport and result in `completed_with_source_gaps` status, never silent `completed`.
- **Architectural Invariant:** Data flows retrieval → evidence → claims → synthesis → verification → quality gate → status. No shortcuts.

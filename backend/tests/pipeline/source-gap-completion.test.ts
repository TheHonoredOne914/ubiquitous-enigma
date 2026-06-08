import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSourceContract } from "../../src/core/evidence/source-contract.js";
import { decideFinalResearchStatus } from "../../src/core/pipeline/final-status.js";

test("phd_level with substantial evidence and SourceGapReport becomes completed_with_source_gaps, not empty failure", () => {
  const sourceContract = evaluateSourceContract({
    mode: "phd_level",
    requiredSources: 20,
    citationEligibleSources: 19,
    finalUniqueCitedSources: 19,
    sourceGapReport: { explanation: "19 of 20 strong sources survived filtering." },
  });

  assert.equal(sourceContract.status, "passed_with_source_gaps");
  assert.equal(decideFinalResearchStatus({
    mode: "phd_level",
    coreGenerationUsed: true,
    legacyFallbackUsed: false,
    sourceContract,
    sourceGapReport: { explanation: "19 of 20 strong sources survived filtering." },
    qualityGate: { passed: true, score: 86, repairRequired: false },
    citationStatus: { finalUniqueCitedSources: 19 },
  }), "completed_with_source_gaps");
});

test("zero or near-zero strict evidence remains failed", () => {
  const sourceContract = evaluateSourceContract({
    mode: "fullspectrum",
    requiredSources: 30,
    citationEligibleSources: 1,
    finalUniqueCitedSources: 1,
    sourceGapReport: { explanation: "Only one weak source." },
  });

  assert.equal(sourceContract.status, "failed");
});

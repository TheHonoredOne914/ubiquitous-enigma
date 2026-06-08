import fixtureSources from "../tests/fixtures/india-democracy-sources.json" with { type: "json" };
import { buildAgendaContract } from "../src/core/agenda/agenda-contract.js";
import { buildEvidenceRegistryFromSources } from "../src/core/evidence/evidence-registry.js";
import { buildEvidencePacks } from "../src/core/evidence/evidence-pack-builder.js";
import { buildClaimGraph } from "../src/core/evidence/claim-graph.js";
import { generateCoreResearchAnswer } from "../src/core/generation/core-answer-generator.js";
import { buildSourceUsageMapFromRegistry } from "../src/core/evidence/source-usage-map.js";
import type { ProviderRouter } from "../src/core/providers/provider-router.js";

async function main() {
  const agendaContract = buildAgendaContract({ requestId: "usage-test", originalUserQuery: "India democratic space 2022-2025 Freedom House V-Dem EIU UAPA FCRA ECI Supreme Court press freedom" });
  const evidenceRegistry = buildEvidenceRegistryFromSources(fixtureSources as any, agendaContract);
  const packsById = buildEvidencePacks(evidenceRegistry, agendaContract);
  const evidencePacks = Object.values(packsById);
  const claimGraph = buildClaimGraph(evidenceRegistry, agendaContract);

  const result = await generateCoreResearchAnswer({
    requestId: "strong-citations",
    userQuery: agendaContract.originalUserQuery,
    mode: "deep_research",
    agendaContract,
    evidenceRegistry,
    evidencePacks,
    claimGraph,
    sourceUsageMaps: [buildSourceUsageMapFromRegistry("evidence_extractor", evidenceRegistry, agendaContract, 30)],
    allowSyntheticSourceUsage: true,
    generationMode: "model",
    providerRouter: {
      complete: async () => {
        const citations = Array.from({ length: 30 }, (_, index) => evidenceRegistry.getCitationMarkdown(index + 1)).join(" ");
        const baseParagraph = "The Treasury Bench and Opposition debate the democratic space in contemporary India, focusing on institutional autonomy, civic space, civil liberties, press freedom, and electoral integrity. Detailed arguments are presented on constitutional safeguards, independent judicial review, Union ministry accountability, and Election Commission procedures, backed by official government data, parliamentary records, and watchdog indices. ";
        const longText = baseParagraph.repeat(170); // ~170 * 15 words = ~2550 words
        return `# Executive Thesis\n${longText}\n\nCitations: ${citations}\n\n## Indian Mock Parliament Debate Utility Arsenal\nTreasury Bench arguments and Opposition arguments.\n\n## Methodology and Source Base\nSources are cited properly.\n\n## Indian Mock Parliament Debate Utility Arsenal\nTreasury Bench arguments and Opposition arguments.\nAmendment: Clause: 1.\n\n## Final Strategic Synthesis\nDo not summarize; diagnose strategy.\nDiagnosis: test. Prescription: test. Warning: test.`;
      },
    } as unknown as ProviderRouter,
    providerName: "gemini",
    model: "test-model",
  });

  console.log("Passed:", result.qualityGateReport.passed);
  console.log("Failures:", result.qualityGateReport.automaticFailures);
  console.log("Issues:", result.qualityGateReport.issues);
  console.log("Repair passes:", JSON.stringify(result.repairPasses, null, 2));
  console.log("Prompt Budget Reports:", JSON.stringify(result.promptBudgetReports, null, 2));
}

main().catch(console.error);

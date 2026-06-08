/**
 * Manages per-mode citation budget targets.
 * Controls how many unique sources should be cited per section and division.
 */

export interface CitationBudget {
  minUniqueSources: number;
  maxSourcesPerSection: number;
  maxSourcesPerDivision: number;
  targetUniqueSourcesTotal: number;
}

const BUDGET_BY_MODE: Record<string, CitationBudget> = {
  fast_research: {
    minUniqueSources: 8,
    maxSourcesPerSection: 3,
    maxSourcesPerDivision: 4,
    targetUniqueSourcesTotal: 12,
  },
  deep_research: {
    minUniqueSources: 15,
    maxSourcesPerSection: 4,
    maxSourcesPerDivision: 5,
    targetUniqueSourcesTotal: 20,
  },
  phd_level: {
    minUniqueSources: 20,
    maxSourcesPerSection: 5,
    maxSourcesPerDivision: 6,
    targetUniqueSourcesTotal: 30,
  },
  fullspectrum: {
    minUniqueSources: 20,
    maxSourcesPerSection: 6,
    maxSourcesPerDivision: 6,
    targetUniqueSourcesTotal: 30,
  },
};

export function getCitationBudget(mode: string): CitationBudget {
  return BUDGET_BY_MODE[mode] ?? BUDGET_BY_MODE.standard_research;
}

/**
 * Checks if the total unique sources cited meets the budget requirement.
 */
export function isCitationBudgetMet(
  uniqueSourcesCited: number,
  budget: CitationBudget,
): boolean {
  return uniqueSourcesCited >= budget.minUniqueSources;
}

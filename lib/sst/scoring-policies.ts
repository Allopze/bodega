import type { ChecklistDefinition } from "./types"

export const NORMALIZED_ONLY_SCORING: NonNullable<ChecklistDefinition["scoringPolicy"]> = {
  official: { mode: "none" },
  normalized: { mode: "weighted_applicable", partialWeightBasisPoints: 5_000 },
}

export const OBSERVATION_22_SCORING: NonNullable<ChecklistDefinition["scoringPolicy"]> = {
  official: { mode: "fixed_conforming_denominator", denominator: 22 },
  normalized: { mode: "weighted_applicable", partialWeightBasisPoints: 5_000 },
}

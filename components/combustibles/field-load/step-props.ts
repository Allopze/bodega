import type { TaeEvidenceKind } from "@/lib/validation/fuel-tae"
import type { FieldLoadDraft } from "./types"
import type { StepErrors, ValidationContext } from "./validate"

export interface StepViewProps extends ValidationContext {
  errors: StepErrors
  patch: (changes: Partial<FieldLoadDraft>) => void
  selectPhoto: (kind: TaeEvidenceKind, file: File | undefined) => void
  compressing: Partial<Record<TaeEvidenceKind, boolean>>
}

"use client"

import { PdtpActivityCreator } from "@/components/prevention/pdtp-activity-creator"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import { savePdtpProgramActivityAction } from "../../actions"

type ResponsibleOption = { slug: string; displayName: string }

export function GuidedActivityForm({
  programId,
  responsibleCatalog,
  catalogActivities,
}: {
  programId: string
  responsibleCatalog: ResponsibleOption[]
  catalogActivities: Array<PdtpActivityPickerOption & { executionGuidance: string; currentRevision: number }>
  generalViewCode?: string
}) {
  return (
    <PdtpActivityCreator
      fixedProgramId={programId}
      responsibleCatalog={responsibleCatalog}
      catalogActivities={catalogActivities}
      saveAction={savePdtpProgramActivityAction}
    />
  )
}

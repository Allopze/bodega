"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ResponsibleForm } from "./responsible-form"
import { SheetForm, type ProgramOption } from "./sheet-form"
import { ActivityForm } from "./activity-form"

export function PdtpActions({
  programs,
  roleOptions,
}: {
  programs: ProgramOption[]
  roleOptions: string[]
}) {
  const [respSheetOpen, setRespSheetOpen] = React.useState(false)
  const [sheetSheetOpen, setSheetSheetOpen] = React.useState(false)
  const [activitySheetOpen, setActivitySheetOpen] = React.useState(false)

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setActivitySheetOpen(true)}>
        <Plus size={14} />Nueva actividad
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setRespSheetOpen(true)}>
        <Plus size={14} />Nuevo responsable
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setSheetSheetOpen(true)}>
        <Plus size={14} />Nueva hoja
      </Button>

      <ResponsibleForm
        key="nuevo-responsable"
        open={respSheetOpen}
        onClose={() => setRespSheetOpen(false)}
        editResponsible={null}
      />

      <ActivityForm
        key="nueva-actividad"
        open={activitySheetOpen}
        onClose={() => setActivitySheetOpen(false)}
        activity={null}
      />

      <SheetForm
        key="nueva-hoja"
        open={sheetSheetOpen}
        onClose={() => setSheetSheetOpen(false)}
        editSheet={null}
        programs={programs}
        roleOptions={roleOptions}
      />
    </>
  )
}

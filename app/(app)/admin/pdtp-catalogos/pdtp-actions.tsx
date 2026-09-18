"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ResponsibleForm } from "./responsible-form"
import { SheetForm, type ProgramOption } from "./sheet-form"
import { ActivityForm } from "./activity-form"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PdtpActivityCreator, type PdtpActivityCreatorProgramOption } from "@/components/prevention/pdtp-activity-creator"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

export function PdtpActions({
  programs,
  roleOptions,
  responsibleCatalog,
  catalogActivities,
  canManagePrograms,
}: {
  programs: ProgramOption[]
  roleOptions: string[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  catalogActivities: Array<PdtpActivityPickerOption & { executionGuidance: string; currentRevision: number }>
  canManagePrograms: boolean
}) {
  const [respSheetOpen, setRespSheetOpen] = React.useState(false)
  const [sheetSheetOpen, setSheetSheetOpen] = React.useState(false)
  const [activitySheetOpen, setActivitySheetOpen] = React.useState(false)
  const [catalogSheetOpen, setCatalogSheetOpen] = React.useState(false)
  const draftPrograms = programs.filter((program) => program.status === "draft")

  return (
    <>
      {canManagePrograms && draftPrograms.length > 0 ? (
        <Button size="sm" variant="primary" onClick={() => setActivitySheetOpen(true)}>
          <Plus size={14} />Publicar y agregar
        </Button>
      ) : null}
      <Button size="sm" variant={canManagePrograms && draftPrograms.length > 0 ? "secondary" : "primary"} onClick={() => setCatalogSheetOpen(true)}>
        <Plus size={14} />Nueva identidad de catálogo
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

      <Dialog open={activitySheetOpen} onOpenChange={(open) => { if (!open) setActivitySheetOpen(false) }}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Publicar y agregar actividad</DialogTitle>
            <DialogDescription>Define la identidad de catálogo y su configuración anual en una sola operación.</DialogDescription>
          </DialogHeader>
          <PdtpActivityCreator
            mode="admin_create_and_add"
            programs={draftPrograms.map((program) => ({
              id: program.id,
              title: program.title,
              year: program.year,
              version: program.version,
            })) as PdtpActivityCreatorProgramOption[]}
            responsibleCatalog={responsibleCatalog}
            catalogActivities={catalogActivities}
            canCreateCatalogActivity
            onSaved={() => setActivitySheetOpen(false)}
            onCancel={() => setActivitySheetOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <ActivityForm
        key="nueva-identidad-catalogo"
        open={catalogSheetOpen}
        onClose={() => setCatalogSheetOpen(false)}
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

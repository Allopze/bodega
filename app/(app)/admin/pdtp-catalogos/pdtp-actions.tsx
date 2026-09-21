"use client"

import * as React from "react"
import Link from "next/link"
import { Plus } from "@phosphor-icons/react"
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/admin/sheet"
import { PdtpActivityCreator } from "@/components/prevention/pdtp-activity-creator"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import { Button } from "@/components/ui/button"
import { ResponsibleForm } from "./responsible-form"
import { SheetForm, type ProgramOption } from "./sheet-form"
import { ActivityForm } from "./activity-form"

export function PdtpActions({
  programs,
  sheetPrograms = programs,
  roleOptions,
  responsibleCatalog,
  catalogActivities,
  canManagePrograms,
}: {
  programs: ProgramOption[]
  sheetPrograms?: ProgramOption[]
  roleOptions: string[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  catalogActivities: Array<PdtpActivityPickerOption & { executionGuidance: string; currentRevision: number }>
  canManagePrograms: boolean
}) {
  const [respSheetOpen, setRespSheetOpen] = React.useState(false)
  const [sheetSheetOpen, setSheetSheetOpen] = React.useState(false)
  const [activityCreatorOpen, setActivityCreatorOpen] = React.useState(false)
  const [templateSheetOpen, setTemplateSheetOpen] = React.useState(false)
  const hasEditablePrograms = programs.length > 0

  return (
    <>
      {canManagePrograms && (
        <Button
          size="sm"
          variant="primary"
          disabled={!hasEditablePrograms}
          onClick={() => setActivityCreatorOpen(true)}
        >
          <Plus size={14} />Nueva actividad
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={() => setTemplateSheetOpen(true)}>
        <Plus size={14} />Nueva plantilla
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

      {canManagePrograms && !hasEditablePrograms && (
        <span className="text-xs text-(--color-text-muted)">
          Crea o abre un programa en borrador. <Link className="font-semibold text-(--color-primary-ink) underline" href="/prevencion/pdtp">Ir a Programas PDTP</Link>
        </span>
      )}

      <Sheet open={activityCreatorOpen} onOpenChange={setActivityCreatorOpen}>
        <SheetContent className="sm:max-w-3xl">
          <SheetHeader>
            <div>
              <SheetTitle>Nueva actividad</SheetTitle>
              <SheetDescription>Crea o reutiliza una actividad y déjala programada en un solo flujo.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            <PdtpActivityCreator
              programs={programs}
              initialSourceMode="new"
              responsibleCatalog={responsibleCatalog}
              catalogActivities={catalogActivities}
              onSaved={() => setActivityCreatorOpen(false)}
              surface="plain"
            />
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ActivityForm
        key="nueva-plantilla"
        open={templateSheetOpen}
        onClose={() => setTemplateSheetOpen(false)}
        activity={null}
      />

      <SheetForm
        key="nueva-hoja"
        open={sheetSheetOpen}
        onClose={() => setSheetSheetOpen(false)}
        editSheet={null}
        programs={sheetPrograms}
        roleOptions={roleOptions}
      />
    </>
  )
}

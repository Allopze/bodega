"use client"

import * as React from "react"
import { BookBookmark, CaretRight, ListPlus, Plus, Table, UserPlus } from "@phosphor-icons/react"
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
  const [chooserOpen, setChooserOpen] = React.useState(false)
  const [respSheetOpen, setRespSheetOpen] = React.useState(false)
  const [sheetSheetOpen, setSheetSheetOpen] = React.useState(false)
  const [activitySheetOpen, setActivitySheetOpen] = React.useState(false)
  const [catalogSheetOpen, setCatalogSheetOpen] = React.useState(false)
  const draftPrograms = programs.filter((program) => program.status === "draft")

  /**
   * Reflow 2026-09-27: eran cuatro botones de página que a 1024 px se apilaban
   * en cuatro filas y agrandaban el TopBar a ~150 px. AGENTS.md (layout 5 /
   * densidad A3): varios flujos de alta = un solo botón que pregunta *qué*
   * crear, como `bodega/movement-sheet.tsx` y `admin/productos/product-actions.tsx`.
   * Cada opción abre el mismo formulario de antes; "Publicar y agregar" sigue
   * exigiendo `prevention:pdtp:program:manage` y un programa en borrador.
   */
  type Choice = { key: string; label: string; desc: string; icon: React.ReactNode; open: () => void }
  const choices: Choice[] = [
    ...(canManagePrograms && draftPrograms.length > 0
      ? [{
          key: "publicar",
          label: "Publicar y agregar actividad",
          desc: "Crea la actividad en el catálogo y la agrega a un programa en borrador, en una sola operación.",
          icon: <ListPlus size={18} />,
          open: () => setActivitySheetOpen(true),
        }]
      : []),
    {
      key: "identidad",
      label: "Identidad de catálogo",
      desc: "Actividad preventiva reutilizable, sin agregarla todavía a un programa.",
      icon: <BookBookmark size={18} />,
      open: () => setCatalogSheetOpen(true),
    },
    {
      key: "responsable",
      label: "Responsable",
      desc: "Rol, grupo o persona a quien se asignan actividades.",
      icon: <UserPlus size={18} />,
      open: () => setRespSheetOpen(true),
    },
    {
      key: "hoja",
      label: "Hoja de programa",
      desc: "Agrupación de actividades por área dentro de un programa anual.",
      icon: <Table size={18} />,
      open: () => setSheetSheetOpen(true),
    },
  ]

  return (
    <>
      <Button size="sm" variant="primary" aria-haspopup="dialog" onClick={() => setChooserOpen(true)}>
        <Plus size={14} />Nuevo
      </Button>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Qué quieres crear?</DialogTitle>
            <DialogDescription>Elige qué agregar a los catálogos PDTP.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                data-choice={choice.key}
                onClick={() => { setChooserOpen(false); choice.open() }}
                className="group flex items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
              >
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)">
                  {choice.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-(--color-text)">{choice.label}</span>
                  <span className="block text-xs text-(--color-text-muted)">{choice.desc}</span>
                </span>
                <CaretRight aria-hidden size={16} className="shrink-0 text-(--color-text-faint)" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ResponsibleForm
        key="nuevo-responsable"
        open={respSheetOpen}
        onClose={() => setRespSheetOpen(false)}
        editResponsible={null}
        roleOptions={roleOptions}
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

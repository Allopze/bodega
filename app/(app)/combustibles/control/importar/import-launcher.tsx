"use client"

import * as React from "react"
import { CaretRight, Gauge, GasPump, Upload } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ControlImportKind } from "@/lib/combustibles/control/imports/constants"
import { ImportWizard } from "./import-wizard"
import type { MediumOption } from "./import-types"

interface Choice {
  key: string
  label: string
  description: string
  icon: React.ReactNode
  kind: ControlImportKind
}

const CHOICES: Choice[] = [
  {
    key: "telemetry",
    kind: "telemetry",
    label: "Telemetría diaria",
    description: "Horas de funcionamiento, horas en vacío y litros por equipo y día (VisionLink u otra fuente).",
    icon: <Gauge size={18} />,
  },
  {
    key: "supply_inputs",
    kind: "supply_inputs",
    label: "Entradas de surtidor o tarjeta",
    description: "Despachos de un medio sin integración (surtidor CMPC, tarjetas): fecha, faena, litros y guía.",
    icon: <GasPump size={18} />,
  },
]

const ROW_CLASS = "group flex w-full items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"

function ChoiceBody({ choice }: { choice: Choice }) {
  return (
    <>
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)">
        {choice.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-(--color-text)">{choice.label}</span>
        <span className="block text-xs text-(--color-text-muted)">{choice.description}</span>
      </span>
      <CaretRight aria-hidden size={16} className="shrink-0 text-(--color-text-faint)" />
    </>
  )
}

/**
 * El «Importar» de esta pantalla: pregunta QUÉ se importa aquí (telemetría o
 * entradas de suministro), cada una en un diálogo con tres pasos (archivo,
 * revisión, listo). Los demás importadores de combustible no se listan: su
 * única entrada es el botón «Importar» de Cargas (`fuel-import-button.tsx`).
 */
export function ImportLauncher({ media, label = "Importar" }: { media: MediumOption[]; label?: string }) {
  const [chooserOpen, setChooserOpen] = React.useState(false)
  const [active, setActive] = React.useState<ControlImportKind | null>(null)

  return (
    <>
      <Button size="sm" variant="primary" aria-haspopup="dialog" onClick={() => setChooserOpen(true)}>
        <Upload size={14} aria-hidden />{label}
      </Button>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Qué quieres importar?</DialogTitle>
            <DialogDescription>Todas las importaciones muestran una revisión antes de guardar y se pueden revertir.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {CHOICES.map((choice) => (
              <button
                key={choice.key}
                type="button"
                data-choice={choice.key}
                className={ROW_CLASS}
                onClick={() => { setChooserOpen(false); setActive(choice.kind) }}
              >
                <ChoiceBody choice={choice} />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {(["telemetry", "supply_inputs"] as const).map((kind) => (
        <ImportWizard
          key={kind}
          kind={kind}
          media={media}
          open={active === kind}
          onOpenChange={(open) => setActive(open ? kind : null)}
        />
      ))}
    </>
  )
}

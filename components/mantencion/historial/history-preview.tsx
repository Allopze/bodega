"use client"

import * as React from "react"
import Link from "next/link"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SPECIALTY_LABELS, type Specialty } from "@/lib/mantencion/action-type"
import { formatHours } from "@/lib/mantencion/format"
import { HISTORY_SOURCE_LABELS } from "@/lib/mantencion/history-view"
import type { MaintenanceHistoryRow } from "@/lib/services/mantencion/maintenance-work"
import { formatDate } from "@/lib/utils"
import { ActionTypeBadge } from "./action-type-badge"
import { responsibleText, workshopText } from "./history-format"

const DASH = "—"

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-[var(--color-text)]">{children}</dd>
    </div>
  )
}

/**
 * Vista previa de un trabajo del historial: se abre desde la lista sin salir de ella. Todo lo que muestra ya viene en
 * la fila (`detail`), así que abrirla no consulta nada. «Ver el trabajo» lleva a la fuente del trabajo
 * (respuesta del formulario, orden de trabajo o registro firmado).
 */
export function HistoryPreviewButton({ row, children, className, visibleText }: {
  row: MaintenanceHistoryRow
  children: React.ReactNode
  className?: string
  /** El texto que el botón muestra: el nombre accesible lo contiene (WCAG 2.5.3, control por voz). */
  visibleText?: string
}) {
  const [open, setOpen] = React.useState(false)
  const { detail } = row
  const when = formatDate(row.date)
  const specialties = detail.specialties.map((key) => SPECIALTY_LABELS[key as Specialty] ?? key).join(", ")
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={visibleText ? `${visibleText}. Vista previa del trabajo de ${row.equipmentLabel} del ${when}` : `Vista previa del trabajo de ${row.equipmentLabel} del ${when}`}
        className={className ?? "rounded-sm text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--color-primary)_35%,transparent)]"}
      >
        {children}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <div className="min-w-0">
              <SheetTitle>{row.equipmentLabel}</SheetTitle>
              <SheetDescription>
                {when} · {HISTORY_SOURCE_LABELS[row.source]}{row.reference ? ` ${row.reference}` : ""}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ActionTypeBadge type={row.actionType} />
              {row.inWorkshop && <Badge variant="warning">Sigue en taller</Badge>}
              {detail.unlinkedEquipment && <Badge variant="warning">Equipo sin identificar</Badge>}
              {detail.unlinkedWorksite && <Badge variant="warning">Faena sin identificar</Badge>}
            </div>

            <section aria-labelledby="preview-work-heading">
              <h3 id="preview-work-heading" className="text-xs font-medium text-[var(--color-text-muted)]">Trabajo realizado</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-text)]">{detail.description || "No informado"}</p>
            </section>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Faena">{row.worksiteName ?? "Sin faena"}</Fact>
              <Fact label="Lectura del equipo">{detail.reading ?? DASH}</Fact>
              <Fact label="Ingreso a taller">{detail.entryDate ? formatDate(detail.entryDate) : DASH}</Fact>
              <Fact label="Salida de taller">{detail.exitDate ? formatDate(detail.exitDate) : DASH}</Fact>
              <Fact label="Días en taller">{workshopText(row)}</Fact>
              <Fact label="Horas hombre">{row.laborHours === null ? DASH : formatHours(row.laborHours)}</Fact>
              <Fact label="Hecho por">{responsibleText(row)}</Fact>
              <Fact label="Especialidades">{specialties || DASH}</Fact>
              {detail.orderText && <Fact label="Nº de orden">{detail.orderText}</Fact>}
              {detail.contract && <Fact label="Contrato">{detail.contract}</Fact>}
            </dl>

            {detail.qualityNotes && (
              <p className="text-xs text-[var(--color-warning-ink)]">Observación de calidad: {detail.qualityNotes}</p>
            )}
          </SheetBody>
          <SheetFooter>
            <Button asChild>
              <Link href={detail.href}>Ver el trabajo</Link>
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

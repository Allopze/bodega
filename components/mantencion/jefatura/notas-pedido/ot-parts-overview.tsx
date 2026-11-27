"use client"

import * as React from "react"
import Link from "next/link"
import { releaseAllocationAction } from "@/app/(app)/mantencion/notas-pedido/actions"
import { MetaBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { WorkOrderAvailablePart, WorkOrderPartsOverview } from "@/lib/services/mantencion/parts/types"
import { formatQty } from "@/lib/utils"
import { LineProgress } from "./line-progress"
import { NoteReasonDialog } from "./note-reason-dialog"
import { consumptionMeta, NOTE_STATUS_TEXT, parseQty, qtyInputText } from "./parts-notes-format"
import { isPartsNoteOpen } from "@/lib/mantencion/contracts"

const TEXT_LINK = "font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
const SUBHEADING = "mb-1.5 text-sm font-semibold text-[var(--color-text)]"

/** Una nota sigue esperando mientras esté abierta y tenga una línea sin resolver o sin llegar. */
function noteWaiting(note: WorkOrderPartsOverview["notes"][number]): boolean {
  return isPartsNoteOpen(note.status) && note.lines.some((line) => line.stage === "pedido" || line.stage === "en_compra")
}

function ReleaseButton({ workOrderId, part }: { workOrderId: string; part: WorkOrderAvailablePart }) {
  const [open, setOpen] = React.useState(false)
  const [quantity, setQuantity] = React.useState(qtyInputText(part.remaining))
  const parsed = parseQty(quantity)
  const tooMuch = parsed > part.remaining
  const whole = part.wholeOnly && !Number.isInteger(parsed)
  return (
    <>
      <Button type="button" variant="secondary" size="sm" aria-label={`Liberar ${part.name}`} onClick={() => { setQuantity(qtyInputText(part.remaining)); setOpen(true) }}>Liberar</Button>
      {open && (
        <NoteReasonDialog
          onOpenChange={setOpen}
          title="Liberar repuesto reservado"
          description={`${part.name}: lo reservado sin usar pasa a stock libre de ${part.worksiteName} y deja de estar reservado para esta orden. Si una nota de pedido lo reservó, esa línea vuelve a pendiente.`}
          label="Motivo"
          submitLabel="Liberar"
          extraValid={parsed > 0 && !tooMuch && !whole}
          extra={(
            <Field
              label="Cantidad a liberar"
              htmlFor="np-release-quantity"
              required
              helper={`Reservado: ${formatQty(part.remaining)}.`}
              error={tooMuch ? `Puedes liberar hasta ${formatQty(part.remaining)}.` : whole ? "Este repuesto va en unidades enteras." : undefined}
            >
              <Input id="np-release-quantity" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
          )}
          action={(reason) => releaseAllocationAction({ workOrderId, allocationId: part.allocationId, quantity: parsed, reason })}
          successMessage="Repuesto liberado"
        />
      )}
    </>
  )
}

/**
 * Lo que el resumen de repuestos de la OT agrega a las solicitudes de compra: las notas de pedido con el avance de
 * cada línea (Pedido → En compra → Llegó → Usado) y lo reservado sin usar, con «Liberar» (sólo `mant:np:manage`).
 * No dibuja nada si la OT no tiene notas ni reservas.
 */
export function OtPartsOverview({ workOrderId, overview, canOpenNotes, canManage }: {
  workOrderId: string
  overview: WorkOrderPartsOverview
  canOpenNotes: boolean
  canManage: boolean
}) {
  const reserved = overview.available.filter((part) => part.remaining > 0)
  if (overview.notes.length === 0 && reserved.length === 0) return null
  return (
    <div className="flex flex-col gap-4">
      {overview.notes.length > 0 && (
        <div>
          <h3 className={SUBHEADING}>Notas de pedido</h3>
          <ul aria-label="Notas de pedido de esta orden" className="flex flex-col gap-3">
            {overview.notes.map((note) => (
              <li key={note.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {canOpenNotes
                    ? <Link href={`/mantencion/notas-pedido/${note.id}`} className={TEXT_LINK}>{note.code}</Link>
                    : <span className="font-mono text-sm font-semibold">{note.code}</span>}
                  <span className="text-xs text-[var(--color-text-muted)]">{NOTE_STATUS_TEXT[note.status]}</span>
                  {note.equipmentStopped && noteWaiting(note) && <Badge variant="signal" size="sm">Equipo detenido</Badge>}
                </div>
                <ul aria-label={`Líneas de ${note.code}`} className="mt-2 flex flex-col gap-2">
                  {note.lines.map((line) => (
                    <li key={line.id} className="flex flex-col gap-0.5">
                      <span className="text-sm text-[var(--color-text)]">
                        {line.description} <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">× {formatQty(line.quantity)}</span>
                      </span>
                      {line.stage === "rechazado"
                        ? <span className="text-xs text-[var(--color-text-muted)]">Rechazado: {line.rejectionReason ?? "sin motivo"}</span>
                        : <LineProgress line={line} />}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {reserved.length > 0 && (
        <div>
          <h3 className={SUBHEADING}>Reservados sin usar</h3>
          <ul aria-label="Repuestos reservados sin usar" className="flex flex-col gap-2">
            {reserved.map((part) => (
              <li key={part.allocationId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 text-[var(--color-text)]">
                  <span className="tabular-nums">{formatQty(part.remaining)} × {part.name}</span>
                  <span className="block text-xs text-[var(--color-text-muted)]">
                    En {part.worksiteName}{part.partNumber ? ` · N° de parte ${part.partNumber}` : ""}
                  </span>
                </span>
                {canManage && <ReleaseButton workOrderId={workOrderId} part={part} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * «Declarados en los registros» con su estado de stock: lo que el mecánico declaró usar y qué pasó en la bodega
 * (Descontado, Pendiente de conciliar con su nota, Revertido o Sin movimiento). Un texto libre no lleva insignia.
 */
export function OtConsumptions({ consumptions, openableRecordIds }: {
  consumptions: WorkOrderPartsOverview["consumptions"]
  openableRecordIds: readonly string[]
}) {
  if (consumptions.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">Ningún registro enlazado declara repuestos.</p>
  const openable = new Set(openableRecordIds)
  return (
    <ul aria-label="Repuestos declarados en los registros" className="flex flex-col gap-1.5 text-sm text-[var(--color-text)]">
      {consumptions.map((part) => {
        const meta = consumptionMeta(part.stockStatus)
        return (
          <li key={part.recordPartId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular-nums">{formatQty(part.quantity)} × {part.description}</span>
            <span className="text-[var(--color-text-muted)]"> · </span>
            {openable.has(part.recordId)
              ? <Link href={`/mantencion/registros/${part.recordId}`} className={TEXT_LINK}>{part.recordFolio ?? "Registro"}</Link>
              : <span className="font-mono text-sm text-[var(--color-text-muted)]">{part.recordFolio ?? "Registro"}</span>}
            {meta && (
              <MetaBadge meta={meta} size="sm">
                {meta.label}{part.stockStatus === "pendiente_conciliar" && part.stockNote ? `: ${part.stockNote}` : ""}
              </MetaBadge>
            )}
          </li>
        )
      })}
    </ul>
  )
}

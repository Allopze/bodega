"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { pluralize } from "@/lib/utils"
import { formatLicenseClassList } from "@/lib/validation/driver-licenses"
import { bulkAssignWorkerPositionAction } from "./actions"

/** Un cargo del catálogo tal como lo necesita el diálogo para explicar qué implica. */
export interface AssignablePosition {
  id: string
  name: string
  needsReview: boolean
  /** Otras grafías con que se conoce el cargo (la planilla dice «Peoneta», el catálogo «Auxiliar»). */
  aliases: string[]
  capabilities: Array<{ id: string; name: string }>
  /** Conduce u opera maquinaria: quien lo tenga aparece en Conductores y se le exige licencia. */
  drives: boolean
  requiredLicenseClasses: string[]
}

export interface BulkAssignTarget {
  id: string
  hasDriverLicense: boolean
}

/** Dos grafías alcanzan para reconocer el cargo sin que la fila se desborde. */
function aliasHint(position: AssignablePosition): string | undefined {
  return position.aliases.length > 0 ? position.aliases.slice(0, 2).join(", ") : undefined
}

/**
 * Lo que significa asignar el cargo elegido, antes de hacerlo: qué hace
 * (capacidades), qué licencia exige y qué pasa con la gente seleccionada. Es la
 * razón de que esto sea un diálogo y no un `<select>` en la barra: clasificar a
 * 40 personas como «Conductor» las mete en Conductores y deja a las que no
 * tienen licencia pidiendo atención, y eso conviene saberlo antes de confirmar.
 */
function PositionPreview({ position, withoutLicense }: { position: AssignablePosition | undefined; withoutLicense: number }) {
  if (!position) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Elige un cargo para ver qué implica para quienes seleccionaste.
      </p>
    )
  }

  const required = position.requiredLicenseClasses
  const traits = [
    ...position.capabilities.map((capability) => capability.name),
    ...(required.length > 0 ? [`exige licencia ${formatLicenseClassList(required)}`] : []),
  ]

  return (
    <div className="space-y-2 text-sm">
      <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--color-text)]">
        {position.name}
        {position.needsReview && <Badge variant="warning" size="sm">Por revisar</Badge>}
      </p>
      <p className="text-[var(--color-text-muted)]">
        {traits.length > 0 ? traits.join(" · ") : "Sin capacidades ni exigencia de licencia."}
      </p>
      {position.drives ? (
        <p className="text-[var(--color-text)]">
          Pasarán a Conductores;{" "}
          {withoutLicense === 0
            ? "todos tienen licencia registrada."
            : (
              <span className="font-semibold text-[var(--color-warning-ink)]">
                {withoutLicense} sin licencia registrada.
              </span>
            )}
        </p>
      ) : (
        <p className="text-[var(--color-text-muted)]">
          No conduce ni opera maquinaria: no aparecerán en Conductores.
        </p>
      )}
    </div>
  )
}

/**
 * Elegir el cargo para la selección de «Sin cargo». Un solo paso: buscar el
 * cargo, leer qué implica y confirmar. El motivo es opcional; sin él, el
 * historial queda con «Clasificación masiva desde Trabajadores».
 */
export function BulkAssignDialog({
  open,
  onOpenChange,
  workers,
  positions,
  onAssigned,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workers: BulkAssignTarget[]
  positions: AssignablePosition[]
  /** Con los ids clasificados, para que la lista los retire. */
  onAssigned: (workerIds: string[]) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const operation = useOperation()
  const [positionId, setPositionId] = React.useState("")
  const [reason, setReason] = React.useState("")

  const options = React.useMemo<ComboboxOption[]>(
    () => positions.map((position) => ({ value: position.id, label: position.name, hint: aliasHint(position) })),
    [positions],
  )
  const selected = positions.find((position) => position.id === positionId)
  const withoutLicense = workers.filter((worker) => !worker.hasDriverLicense).length
  const count = workers.length

  function reset() {
    setPositionId("")
    setReason("")
    operation.setMessage("")
  }

  function handleOpenChange(next: boolean) {
    // Cerrar a media operación dejaría al usuario sin saber si se aplicó.
    if (!next && operation.pending) return
    if (!next) reset()
    onOpenChange(next)
  }

  function submit() {
    if (!selected || operation.pending) return
    const workerIds = workers.map((worker) => worker.id)
    operation.run(
      () => bulkAssignWorkerPositionAction({ workerIds, positionId: selected.id, reason }),
      (result) => {
        toast.success(result.message ?? "Cargo asignado")
        onAssigned(workerIds)
        reset()
        onOpenChange(false)
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Asignar cargo</DialogTitle>
          <DialogDescription>
            Se aplicará a {count} {pluralize(count, "trabajador seleccionado", "trabajadores seleccionados")}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Cargo" htmlFor="bulk-assign-position" required>
            <Combobox
              id="bulk-assign-position"
              options={options}
              value={positionId}
              onChange={setPositionId}
              placeholder="Buscar cargo..."
              disabled={operation.pending}
            />
          </Field>

          {/* Altura reservada: la lista del buscador se despliega encima y el
              diálogo no salta al elegir. */}
          <div
            aria-live="polite"
            className="min-h-32 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
          >
            <PositionPreview position={selected} withoutLicense={withoutLicense} />
          </div>

          <Field label="Motivo (opcional)" htmlFor="bulk-assign-reason">
            <Textarea
              id="bulk-assign-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              disabled={operation.pending}
              placeholder="Por ejemplo: clasificación según la planilla de licencias"
            />
          </Field>

          {operation.message && operation.messageTone === "error" && (
            <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{operation.message}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={operation.pending}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={submit} disabled={!selected} loading={operation.pending}>
            {operation.pending ? "Asignando..." : `Asignar a ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

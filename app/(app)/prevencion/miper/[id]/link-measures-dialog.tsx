"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { ProgramActionView } from "@/lib/services/miper/program-queries"
import { linkProgramControlsAction } from "../actions"

/**
 * Vincula y desvincula medidas del MIPER de una actividad del programa.
 *
 * Las casillas son las medidas no retiradas de la matriz, agrupadas por su
 * riesgo; las marcadas al abrir son las que la actividad ya ejecuta. Guardar
 * hace **una llamada por sentido** (`link: true` con lo agregado, `link: false`
 * con lo quitado). Quitar una medida de la actividad no la borra del MIPER.
 */
export function LinkMeasuresDialog({
  matrixId,
  programId,
  action,
  rows,
  open,
  onOpenChange,
  onSaved,
}: {
  matrixId: string
  programId: string
  action: ProgramActionView
  rows: readonly MiperEntrySnapshot[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tras guardar: el detalle lo relee el padre. */
  onSaved?: () => void
}) {
  const initial = React.useMemo(() => new Set(action.controls.map((control) => control.id)), [action.controls])
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(initial)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setSelected(new Set(action.controls.map((control) => control.id)))
    setError(null)
  }, [open, action.controls])

  const groups = React.useMemo(
    () => rows
      .map((row) => ({ row, controls: row.controls.filter((control) => control.status !== "retired") }))
      .filter((group) => group.controls.length > 0),
    [rows],
  )

  const added = [...selected].filter((id) => !initial.has(id))
  const removed = [...initial].filter((id) => !selected.has(id))
  const changed = added.length + removed.length > 0

  function toggle(controlId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(controlId)
      else next.delete(controlId)
      return next
    })
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      for (const [controlIds, link] of [[added, true], [removed, false]] as const) {
        if (controlIds.length === 0) continue
        const result = await linkProgramControlsAction({ matrixId, programId, actionId: action.id, controlIds, link })
        if (!result.ok) {
          setError(result.message ?? "No se pudieron guardar los vínculos.")
          return
        }
      }
      onSaved?.()
      onOpenChange(false)
    } catch {
      setError("No se pudieron guardar los vínculos.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!pending) onOpenChange(value) }}>
      <DialogContent className="max-h-[min(90dvh,60rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Medidas de la actividad N° {action.actionNumber}</DialogTitle>
          <DialogDescription>
            Marca las medidas del MIPER que esta actividad ejecuta. Quitar una medida no la borra del MIPER.
          </DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <p className="text-sm text-[var(--color-text-subtle)]">Esta MIPER todavía no tiene medidas de control que vincular.</p>
        ) : (
          <div className="space-y-4">
            {groups.map(({ row, controls }) => (
              <fieldset key={row.id} className="space-y-1.5">
                <legend className="text-sm font-semibold">Riesgo #{row.rowNumber}: {row.hazard ?? "Sin peligro"}</legend>
                {controls.map((control) => (
                  <Checkbox
                    key={control.id}
                    label={`Fila ${row.rowNumber}: ${control.description}`}
                    checked={selected.has(control.id)}
                    disabled={pending}
                    onChange={(event) => toggle(control.id, event.target.checked)}
                  />
                ))}
              </fieldset>
            ))}
          </div>
        )}

        {error && <Callout tone="danger" role="alert" className="mt-3">{error}</Callout>}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" variant="primary" disabled={pending || !changed} onClick={() => void save()}>
            Guardar vínculos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

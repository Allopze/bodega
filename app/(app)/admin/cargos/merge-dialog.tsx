"use client"

import { useActionState, useState } from "react"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/admin/sheet"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SubmitButton } from "@/components/ui/submit-button"
import { useActionStateToast } from "@/lib/hooks/use-action-watchers"
import { INITIAL_STATE } from "@/lib/form-state"
import { mergeWorkerPositionsAction } from "./actions"
import type { WorkerPositionCatalogRow } from "./types"

/**
 * Fusiona un cargo duplicado en el que se conserva.
 *
 * No es un borrado: el historial de cargos referencia al origen y es inmutable,
 * así que éste queda inactivo y su grafía pasa a ser alias del destino. Eso es
 * lo que impide que la próxima importación vuelva a crear el mismo duplicado.
 */
export function MergeDialog({
  position, positions, open, onClose,
}: {
  position: WorkerPositionCatalogRow | null
  positions: WorkerPositionCatalogRow[]
  open: boolean
  onClose: () => void
}) {
  const [state, action] = useActionState(mergeWorkerPositionsAction, INITIAL_STATE)
  const [targetId, setTargetId] = useState("")
  useActionStateToast([state])

  if (!position) return null
  const candidates = positions.filter((item) => item.id !== position.id && item.isActive && !item.isSystem)

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent>
        <form action={action}>
          <SheetHeader>
            <div>
              <SheetTitle>Fusionar {position.name}</SheetTitle>
              <SheetDescription>
                Sus {position.workerCount} trabajador(es) pasan al cargo que elijas. {position.name} queda
                inactivo y su nombre se registra como alias, para que las próximas importaciones lo reconozcan.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            <input type="hidden" name="sourceId" value={position.id} />
            <input type="hidden" name="targetId" value={targetId} />
            <Field label="Cargo que se conserva" htmlFor="merge-target" required error={state.fieldErrors?.targetId?.[0]}>
              <Select value={targetId} onValueChange={setTargetId} searchable>
                <SelectTrigger id="merge-target" error={Boolean(state.fieldErrors?.targetId)}>
                  <SelectValue placeholder="Selecciona el cargo definitivo" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.code}) · {item.workerCount} trabajador(es)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label="Fusionar cargo" loadingLabel="Fusionando..." disabled={!targetId} />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

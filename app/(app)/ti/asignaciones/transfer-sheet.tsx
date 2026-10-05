"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton, SheetTrigger,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toLocalInputValue } from "@/lib/utils"
import { IT_RETURN_PHYSICAL_STATES, IT_PHYSICAL_STATES } from "@/lib/validation/ti"
import { EvidencePhotos, useEvidencePhotos } from "./evidence-photos"
import { PhysicalStateChoice } from "./physical-state-choice"
import { transferAssignmentAction } from "./actions"

interface TransferSheetProps {
  /** Opcional: la hoja puede abrirse desde fuera con `open`/`onOpenChange` (menú «Más» de la tabla). */
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  assignment: {
    id: string
    assetId: string
    assetCode: string
    workerName: string
    worksiteName: string
  }
  /** `worksiteId` permite filtrar el custodio por la faena elegida (TIUX-48); sin él se lista todo. */
  workers: { id: string; name: string; lastName: string; worksiteId?: string }[]
  worksites: { id: string; name: string }[]
}

export function TransferSheet({ trigger, open: openProp, onOpenChange, assignment, workers, worksites }: TransferSheetProps) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const setOpen = (value: boolean) => {
    if (openProp === undefined) setOpenState(value)
    onOpenChange?.(value)
  }
  const [returnedAt, setReturnedAt] = React.useState(toLocalInputValue(new Date()))
  // TIUX-09: ningún estado físico preseleccionado, ni al cerrar ni al abrir la custodia.
  const [returnPhysicalState, setReturnPhysicalState] = React.useState<string | null>(null)
  const [newDeliveredAt, setNewDeliveredAt] = React.useState(toLocalInputValue(new Date()))
  const [newPhysicalState, setNewPhysicalState] = React.useState<string | null>(null)
  const [newWorksiteId, setNewWorksiteId] = React.useState("")
  const [newWorkerId, setNewWorkerId] = React.useState("")
  const evidence = useEvidencePhotos({ stage: "delivery" })

  // TIUX-48: el custodio se elige entre los de la faena destino, por orden alfabético.
  const eligibleWorkers = React.useMemo(() => workers
    .filter((worker) => !newWorksiteId || !worker.worksiteId || worker.worksiteId === newWorksiteId)
    .map((worker) => ({ id: worker.id, label: `${worker.name} ${worker.lastName}`.trim() }))
    .sort((a, b) => a.label.localeCompare(b.label, "es")), [workers, newWorksiteId])

  function closeSheet() {
    evidence.discardAll()
    setOpen(false)
  }

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await transferAssignmentAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Transferencia registrada")
      evidence.releaseAfterSubmit()
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={(value) => {
      if (!value) return closeSheet()
      // La hora por defecto es la de apertura, no la de montaje de la página.
      setReturnedAt(toLocalInputValue(new Date()))
      setNewDeliveredAt(toLocalInputValue(new Date()))
      setOpen(true)
    }}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="assignmentId" value={assignment.id} />
          <input type="hidden" name="assetId" value={assignment.assetId} />
          <input type="hidden" name="newAccessoriesJson" value="[]" />
          <SheetHeader>
            <div>
              <SheetTitle>Transferir activo</SheetTitle>
              <SheetDescription>
                {assignment.assetCode} deja la custodia de {assignment.workerName} ({assignment.worksiteName}) y genera una nueva acta. Los accesorios vigentes se trasladan con trazabilidad.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}
            <FieldGroup>
              <p className="text-eyebrow text-[var(--color-text-faint)]">Termina la custodia de {assignment.workerName}</p>
              <Field label="Fin de la custodia actual" required error={state.fieldErrors?.returnedAt?.[0]} helper="Fecha y hora en que el equipo deja de estar a cargo de quien lo tiene hoy.">
                <DateTimePicker name="returnedAt" value={returnedAt} onChange={setReturnedAt} />
              </Field>
              <PhysicalStateChoice
                name="returnPhysicalState"
                label="Estado físico al transferir"
                states={IT_RETURN_PHYSICAL_STATES}
                value={returnPhysicalState}
                onChange={setReturnPhysicalState}
                error={state.fieldErrors?.returnPhysicalState?.[0]}
              />
              <Field label="Observaciones de la devolución">
                <Textarea name="returnObservations" maxLength={500} placeholder="Estado o accesorios recibidos" rows={3} />
              </Field>

              <p className="text-eyebrow border-t border-[var(--color-border)] pt-4 text-[var(--color-text-faint)]">Empieza la nueva custodia</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nueva faena" required error={state.fieldErrors?.worksiteId?.[0]}>
                  <Select
                    name="newWorksiteId"
                    value={newWorksiteId}
                    onValueChange={(value) => { setNewWorksiteId(value); setNewWorkerId("") }}
                  >
                    <SelectTrigger aria-label="Nueva faena"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                    <SelectContent>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Nuevo custodio"
                  required
                  error={state.fieldErrors?.workerId?.[0]}
                  helper={!newWorksiteId ? "Elige primero la faena." : eligibleWorkers.length === 0 ? "Esa faena no tiene trabajadores activos." : undefined}
                >
                  <Select name="newWorkerId" value={newWorkerId} onValueChange={setNewWorkerId} disabled={!newWorksiteId || eligibleWorkers.length === 0}>
                    <SelectTrigger aria-label="Nuevo custodio"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                    <SelectContent>{eligibleWorkers.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Inicio de la nueva custodia" required error={state.fieldErrors?.deliveredAt?.[0]} helper="Fecha y hora en que el nuevo custodio recibe el equipo.">
                <DateTimePicker name="newDeliveredAt" value={newDeliveredAt} onChange={setNewDeliveredAt} />
              </Field>
              <PhysicalStateChoice
                name="newPhysicalState"
                label="Estado físico en la nueva entrega"
                states={IT_PHYSICAL_STATES}
                value={newPhysicalState}
                onChange={setNewPhysicalState}
                error={state.fieldErrors?.physicalState?.[0]}
              />
              <Field label="Evidencia fotográfica de la nueva entrega" helper="Quedan asociadas a la nueva acta para siempre.">
                <EvidencePhotos controller={evidence} alt="Evidencia de la nueva entrega" />
              </Field>
              <Field label="Observaciones de la nueva entrega">
                <Textarea name="newObservations" maxLength={500} placeholder="Condiciones de la transferencia" rows={3} />
              </Field>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={closeSheet}>Cancelar</Button>
            <SubmitButton label="Registrar transferencia" loadingLabel="Registrando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

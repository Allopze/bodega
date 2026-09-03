"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toLocalInputValue } from "@/lib/utils"
import { IT_RETURN_PHYSICAL_STATES, IT_PHYSICAL_STATES } from "@/lib/validation/ti"
import { IT_PHYSICAL_STATE_META } from "@/lib/services/ti/constants"
import { transferAssignmentAction } from "./actions"

interface TransferSheetProps {
  trigger: React.ReactNode
  assignment: {
    id: string
    assetId: string
    assetCode: string
    workerName: string
    worksiteName: string
  }
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
}

export function TransferSheet({ trigger, assignment, workers, worksites }: TransferSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [returnedAt, setReturnedAt] = React.useState(toLocalInputValue(new Date()))
  const [returnPhysicalState, setReturnPhysicalState] = React.useState("bueno")
  const [newDeliveredAt, setNewDeliveredAt] = React.useState(toLocalInputValue(new Date()))
  const [newPhysicalState, setNewPhysicalState] = React.useState("bueno")

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await transferAssignmentAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Transferencia registrada")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={(value) => setOpen(value)}>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="assignmentId" value={assignment.id} />
          <input type="hidden" name="assetId" value={assignment.assetId} />
          <input type="hidden" name="newAccessoriesJson" value="[]" />
          <input type="hidden" name="photoIdsJson" value="[]" />
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
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha y hora de entrega anterior" required error={state.fieldErrors?.returnedAt?.[0]}>
                  <Input name="returnedAt" type="datetime-local" value={returnedAt} onChange={(event) => setReturnedAt(event.target.value)} />
                </Field>
                <Field label="Estado físico al transferir" required>
                  <Select name="returnPhysicalState" value={returnPhysicalState} onValueChange={setReturnPhysicalState}>
                    <SelectTrigger aria-label="Estado físico al transferir"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {IT_RETURN_PHYSICAL_STATES.map((status) => (
                        <SelectItem key={status} value={status}>{IT_PHYSICAL_STATE_META[status]?.label ?? status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nueva faena" required error={state.fieldErrors?.worksiteId?.[0]}>
                  <Select name="newWorksiteId">
                    <SelectTrigger aria-label="Nueva faena"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                    <SelectContent>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Nuevo custodio" required error={state.fieldErrors?.workerId?.[0]}>
                  <Select name="newWorkerId">
                    <SelectTrigger aria-label="Nuevo custodio"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                    <SelectContent>{workers.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.name} {worker.lastName}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha y hora de nueva entrega" required error={state.fieldErrors?.deliveredAt?.[0]}>
                  <Input name="newDeliveredAt" type="datetime-local" value={newDeliveredAt} onChange={(event) => setNewDeliveredAt(event.target.value)} />
                </Field>
                <Field label="Estado físico en nueva entrega" required>
                  <Select name="newPhysicalState" value={newPhysicalState} onValueChange={setNewPhysicalState}>
                    <SelectTrigger aria-label="Estado físico en nueva entrega"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {IT_PHYSICAL_STATES.map((status) => (
                        <SelectItem key={status} value={status}>{IT_PHYSICAL_STATE_META[status]?.label ?? status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Observaciones de la devolución">
                <Input name="returnObservations" maxLength={500} placeholder="Estado o accesorios recibidos" />
              </Field>
              <Field label="Observaciones de la nueva entrega">
                <Input name="newObservations" maxLength={500} placeholder="Condiciones de la transferencia" />
              </Field>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Registrar transferencia" loadingLabel="Registrando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

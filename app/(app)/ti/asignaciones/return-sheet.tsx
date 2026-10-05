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
import { returnAssignmentAction } from "./actions"
import { IT_RETURN_PHYSICAL_STATES } from "@/lib/validation/ti"
import { EvidencePhotos, useEvidencePhotos } from "./evidence-photos"
import { PhysicalStateChoice } from "./physical-state-choice"
import { AssignmentReference, type DeliveryReference } from "./assignment-reference"

interface ReturnSheetProps {
  /** Opcional: la hoja puede abrirse desde fuera con `open`/`onOpenChange` (menú «Más» de la tabla). */
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** TIUX-48: cómo se entregó el equipo, para compararlo al recibirlo. */
  reference?: DeliveryReference
  assignment: {
    id: string
    code: string
    assetId: string
    assetCode: string
    workerName: string
    accessories?: { id: string; name: string; returnedAt: string | null }[]
  }
}

export function ReturnSheet({ trigger, open: openProp, onOpenChange, reference, assignment }: ReturnSheetProps) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const setOpen = (value: boolean) => {
    if (openProp === undefined) setOpenState(value)
    onOpenChange?.(value)
  }
  const [returnedAt, setReturnedAt] = React.useState(toLocalInputValue(new Date()))
  // TIUX-09: sin «Bueno» preseleccionado; quien recibe el equipo lo evalúa.
  const [returnPhysicalState, setReturnPhysicalState] = React.useState<string | null>(null)
  const [nextStatus, setNextStatus] = React.useState("disponible")
  const [returnedAccessories, setReturnedAccessories] = React.useState<string[]>(
    assignment.accessories?.filter((a) => !a.returnedAt).map((a) => a.name) ?? [],
  )
  const evidence = useEvidencePhotos({ stage: "return", assignmentId: assignment.id })

  function closeSheet() {
    evidence.discardAll()
    setOpen(false)
  }

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await returnAssignmentAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Devolución registrada")
      evidence.releaseAfterSubmit()
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  function openSheet() {
    // La hora por defecto es la de apertura, no la de montaje de la página:
    // las demás filas conservan su hoja montada tras cada devolución.
    setReturnedAt(toLocalInputValue(new Date()))
    setOpen(true)
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) closeSheet(); else openSheet() }}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="assignmentId" value={assignment.id} />
          <input type="hidden" name="assetId" value={assignment.assetId} />
          <input type="hidden" name="returnedAccessoriesJson" value={JSON.stringify(returnedAccessories)} />

          <SheetHeader>
            <div>
              <SheetTitle>Devolución — acta {assignment.code}</SheetTitle>
              <SheetDescription>
                {assignment.assetCode} · {assignment.workerName}. Registra el estado físico al devolver: esas fotos se comparan contra las de la entrega.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            {reference && <AssignmentReference reference={reference} />}

            <FieldGroup>
              <Field label="Fecha y hora de devolución" required error={state.fieldErrors?.returnedAt?.[0]}>
                <DateTimePicker name="returnedAt" value={returnedAt} onChange={setReturnedAt} />
              </Field>

              <PhysicalStateChoice
                name="returnPhysicalState"
                label="Estado físico al devolver"
                states={IT_RETURN_PHYSICAL_STATES}
                value={returnPhysicalState}
                onChange={setReturnPhysicalState}
                error={state.fieldErrors?.returnPhysicalState?.[0]}
              />

              <Field
                label="El activo vuelve a"
                required
                helper={returnPhysicalState === "malo" ? "El equipo vuelve en mal estado: «En reparación» evita ofrecerlo como disponible." : undefined}
              >
                <Select name="nextStatus" value={nextStatus} onValueChange={setNextStatus}>
                  <SelectTrigger aria-label="Estado siguiente del activo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disponible">Disponible</SelectItem>
                    <SelectItem value="en_bodega">En bodega</SelectItem>
                    <SelectItem value="en_reparacion">En reparación</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {(assignment.accessories?.length ?? 0) > 0 && (
                <Field label="Accesorios devueltos" helper="Marca los que el trabajador devuelve.">
                  <div className="flex flex-wrap gap-1.5">
                    {(assignment.accessories ?? []).map((acc) => {
                      const checked = returnedAccessories.includes(acc.name)
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => setReturnedAccessories((prev) =>
                            checked ? prev.filter((a) => a !== acc.name) : [...prev, acc.name],
                          )}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            checked
                              ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold text-[var(--color-primary-ink)]"
                              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                          }`}
                        >
                          {acc.name}
                        </button>
                      )
                    })}
                  </div>
                </Field>
              )}

              <Field
                label="Evidencia fotográfica de la devolución"
                helper="Fotos del estado en que se recibe el equipo. Se comparan con las de entrega en la ficha de custodia."
              >
                <EvidencePhotos controller={evidence} alt="Evidencia de devolución" />
              </Field>

              <Field label="Observaciones de la devolución">
                <Textarea name="returnObservations" maxLength={500} placeholder="Ej. pantalla con rayas en la esquina inferior izquierda" rows={3} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={closeSheet}>Cancelar</Button>
            <SubmitButton label="Registrar devolución" loadingLabel="Registrando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

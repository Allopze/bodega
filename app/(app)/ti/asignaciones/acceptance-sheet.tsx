"use client"

/**
 * TIA-001 / TIA-002 (auditoría 2026-09-14) — el acuse del acta de entrega.
 *
 * Antes esto era una casilla dentro del formulario de entrega, marcada por
 * omisión: el técnico que entregaba el equipo declaraba aceptada su propia
 * acta. Ahora el acuse es un paso aparte, posterior, y el servicio exige que lo
 * registre una persona distinta de quien entregó. Además distingue el acuse de
 * su ausencia: cerrar un acta «sin acuse» obliga a escribir por qué.
 */

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
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { recordAssignmentAcceptanceAction } from "./actions"

interface AcceptanceSheetProps {
  trigger: React.ReactNode
  assignment: { id: string; code: string; assetCode: string; workerName: string }
}

export function AcceptanceSheet({ trigger, assignment }: AcceptanceSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [outcome, setOutcome] = React.useState<"aceptada" | "sin_acuse">("aceptada")

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await recordAssignmentAcceptanceAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Acuse registrado")
      setOpen(false)
    }
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="sm:max-w-lg">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="assignmentId" value={assignment.id} />

          <SheetHeader>
            <div>
              <SheetTitle>Acuse — acta {assignment.code}</SheetTitle>
              <SheetDescription>
                {assignment.assetCode} · {assignment.workerName}. Lo registra alguien distinto de quien entregó el equipo.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            <FieldGroup>
              <Field label="Resultado" required error={state.fieldErrors?.outcome?.[0]}>
                <Select
                  name="outcome"
                  value={outcome}
                  onValueChange={(v) => setOutcome(v as "aceptada" | "sin_acuse")}
                >
                  <SelectTrigger aria-label="Resultado del acuse">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aceptada">El trabajador acusó recibo</SelectItem>
                    <SelectItem value="sin_acuse">No hubo acuse</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={outcome === "sin_acuse" ? "Motivo" : "Constancia (opcional)"}
                required={outcome === "sin_acuse"}
                error={state.fieldErrors?.note?.[0]}
                helper={outcome === "sin_acuse"
                  ? "Por qué el acta queda sin acuse: quedará impreso en el acta."
                  : "Cómo se acusó recibo (firma en papel, correo, presencial)."}
              >
                <Textarea name="note" maxLength={500} rows={3} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Registrar acuse" loadingLabel="Registrando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { verifyRiskControlAction } from "../../actions"

/**
 * Verificación segregada de un control (MIPER-08).
 *
 * `conflicted` lo calcula el servidor con las mismas identidades que valida el
 * servicio: si el actor es quien creó la versión MIPER o responde por el control
 * o por el peligro, el formulario pide la excepción fundamentada en vez de
 * ocultar el botón — el servidor la exige igual, y esconderla dejaba al usuario
 * sin saber por qué no puede verificar.
 */
export function VerifyControlForm({ controlId, expectedVersion, conflicted, canOverride }: {
  controlId: string
  expectedVersion: number
  conflicted: boolean
  canOverride: boolean
}) {
  const [open, setOpen] = useState(false)
  const [effectivenessStatus, setEffectivenessStatus] = useState("effective")
  const operation = useOperation()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    operation.run(() => verifyRiskControlAction({
      controlId,
      expectedVersion,
      effectivenessStatus,
      evidenceReference: values.get("evidenceReference"),
      verificationNote: values.get("verificationNote"),
      segregationExceptionReason: String(values.get("segregationExceptionReason") ?? "") || undefined,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Verificar control</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Verificar control</DialogTitle>
            <DialogDescription>Exige evidencia y la hace una persona distinta de quien creó la versión o responde por el control.</DialogDescription>
          </DialogHeader>
          <Field label="Resultado" htmlFor="control-effectiveness">
            <OptionSelect
              id="control-effectiveness"
              value={effectivenessStatus}
              onValueChange={setEffectivenessStatus}
              options={[
                { value: "effective", label: "Eficaz: el control opera según su estándar" },
                { value: "ineffective", label: "Ineficaz: abre una revisión de la MIPER" },
              ]}
            />
          </Field>
          <Field label="Evidencia" htmlFor="control-evidence" hint="Referencia del registro que respalda la verificación (acta, foto, checklist).">
            <Input id="control-evidence" name="evidenceReference" required minLength={5} maxLength={3000} />
          </Field>
          <Field label="Qué se verificó" htmlFor="control-note">
            <Textarea id="control-note" name="verificationNote" required minLength={5} maxLength={3000} />
          </Field>
          {conflicted && (
            <Field
              label="Excepción a la segregación"
              htmlFor="control-exception"
              hint={canOverride
                ? "Creaste esta versión o respondes por el control: fundamenta por qué la verificas igual (mínimo 10 caracteres)."
                : "Creaste esta versión o respondes por el control, y no tienes el permiso de excepción: la verificación la debe hacer otra persona."}
            >
              <Textarea id="control-exception" name="segregationExceptionReason" minLength={10} maxLength={2000} disabled={!canOverride} />
            </Field>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || (conflicted && !canOverride)}>Registrar verificación</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { generateCapaFromRisksAction } from "../../actions"

/**
 * "Agregar al Programa de Trabajo" (§33 de la ficha) desde un único riesgo:
 * prellena la descripción con la primera medida de control cuando existe —
 * el usuario sólo confirma la fecha y puede ajustar el texto.
 */
export function GenerateCapaForm({ riskEntryId, suggestedActionDescription }: { riskEntryId: string; suggestedActionDescription: string | null }) {
  const [open, setOpen] = useState(false)
  const operation = useOperation()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const actionDescription = String(values.get("actionDescription") ?? "").trim()
    operation.run(() => generateCapaFromRisksAction({
      riskEntryIds: [riskEntryId],
      defaults: {
        targetDate: values.get("targetDate"),
        ...(actionDescription ? { actionDescription } : {}),
      },
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Agregar al Programa de Trabajo</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar al Programa de Trabajo</DialogTitle>
            <DialogDescription>Crea una acción preventiva (CAPA) desde este riesgo. Completa responsable y evidencia después, desde el Programa de Trabajo.</DialogDescription>
          </DialogHeader>
          <Field label="Descripción de la acción" htmlFor="capa-action-description" hint={suggestedActionDescription ? "Prellenada con la primera medida de control del riesgo." : "Este riesgo no tiene medidas de control registradas: describe la acción."}>
            <Textarea id="capa-action-description" name="actionDescription" defaultValue={suggestedActionDescription ?? ""} required minLength={3} maxLength={3000} />
          </Field>
          <Field label="Fecha objetivo" htmlFor="capa-target-date">
            <DatePicker id="capa-target-date" name="targetDate" />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear acción</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

"use client"

/**
 * E2E-006 (auditoría 2026-09-14) — Abrir una acción correctiva sin origen del
 * sistema.
 *
 * La pantalla de CAPA no tenía creación: sus acciones eran transitar, agregar
 * evidencia, agregar seguimiento, actualizar y conciliar, y toda acción nacía
 * en su módulo de origen. Una observación de un recorrido, un compromiso de una
 * reunión o un hallazgo de una auditoría externa obligaban a inventarles antes
 * un registro en otro módulo.
 *
 * El origen sigue siendo obligatorio —«toda acción responde a un hecho
 * trazable»—: lo que cambia es que puede describirlo una persona en el campo
 * "Origen del hallazgo".
 */

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { todayInChile } from "@/lib/utils"
import { createManualCapaActionAction } from "./actions"

export function ManualCapaDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false)
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [priority, setPriority] = useState("medium")
  // CAPA-002: la exención de evidencia deja de ser una casilla suelta — al
  // desmarcarla aparece el motivo, que el servidor exige.
  const [evidenceRequired, setEvidenceRequired] = useState(true)
  const operation = useOperation()
  const router = useRouter()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const v = new FormData(event.currentTarget)
    operation.run(
      () => createManualCapaActionAction({
        worksiteId,
        manualOrigin: v.get("manualOrigin"),
        finding: v.get("finding"),
        actionDescription: v.get("actionDescription"),
        priority,
        targetDate: v.get("targetDate"),
        evidenceRequired,
        evidenceExemptionReason: evidenceRequired ? null : v.get("evidenceExemptionReason"),
      }),
      () => { setOpen(false); router.refresh() },
    )
  }

  if (worksites.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Nueva acción</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva acción correctiva</DialogTitle>
            <DialogDescription>
              Para hallazgos sin registro previo en otro módulo: un recorrido, un
              compromiso de reunión, una auditoría externa. Describe de dónde salió.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Faena">
              <Select value={worksiteId} onValueChange={setWorksiteId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Origen del hallazgo">
              <Input name="manualOrigin" required minLength={3} placeholder="Recorrido de terreno del 12-09" />
            </Field>
            <Field label="Prioridad">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baja</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="critical">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha objetivo"><DatePicker name="targetDate" defaultValue={todayInChile()} /></Field>
          </div>
          <Field label="Hallazgo"><Textarea name="finding" required minLength={3} /></Field>
          <Field label="Acción comprometida"><Textarea name="actionDescription" required minLength={3} /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={evidenceRequired}
              onChange={(event) => setEvidenceRequired(event.currentTarget.checked)}
            />
            Exigir evidencia para verificar y cerrar
          </label>
          {!evidenceRequired && (
            <Field label="Por qué no se exigirá evidencia">
              <Textarea name="evidenceExemptionReason" required minLength={10} />
            </Field>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear acción</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

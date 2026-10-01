"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { createMiperAction } from "./actions"

export type CreationWorksite = { id: string; name: string; vigenteId: string | null; vigentePeriod: number | null; vigenteIsLegacy: boolean; vigenteHasUnsentChanges: boolean }

/**
 * Alta de una MIPER borrador. El punto de partida se elige explícitamente:
 * copiar la MIPER vigente (sólo si no es de la metodología anterior, que no es
 * trasladable) o partir de una matriz vacía. Una MIPER por faena y período; el
 * servicio es quien lo exige.
 */
export function NewMiperDialog({ worksites, currentYear }: { worksites: CreationWorksite[]; currentYear: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [source, setSource] = useState<"vigente" | "vacia">("vigente")
  const operation = useOperation()
  const worksite = worksites.find((item) => item.id === worksiteId)
  const canCopy = Boolean(worksite?.vigenteId && !worksite.vigenteIsLegacy)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createMiperAction({
      worksiteId,
      period: Number(form.get("period")),
      revisionReason: String(form.get("revisionReason") ?? ""),
      sourceMatrixId: canCopy && source === "vigente" ? worksite!.vigenteId : null,
    }), (result) => {
      setOpen(false)
      const id = result.data?.id
      if (typeof id === "string") router.push(`/prevencion/miper/${id}?tab=antecedentes`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={worksites.length === 0}
          title={worksites.length === 0 ? "No hay faenas activas a tu alcance" : undefined}
        >
          Nueva MIPER
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva MIPER</DialogTitle>
            <DialogDescription>Una MIPER por faena y período. Los antecedentes se completan con los datos de la faena y la empresa.</DialogDescription>
          </DialogHeader>
          <Field label="Faena" required>
            <Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setSource("vigente") }}>
              <SelectTrigger><SelectValue placeholder="Selecciona la faena" /></SelectTrigger>
              <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Período" required><Input name="period" type="number" min={2000} max={2100} defaultValue={currentYear} required /></Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Punto de partida</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" checked={canCopy && source === "vigente"} disabled={!canCopy} onChange={() => setSource("vigente")} />
              {canCopy ? `Copiar la MIPER vigente (${worksite!.vigentePeriod ?? "sin período"})` : worksite?.vigenteIsLegacy ? "La MIPER vigente usa la metodología anterior y no se puede copiar" : "La faena no tiene MIPER vigente"}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" checked={!canCopy || source === "vacia"} onChange={() => setSource("vacia")} />
              Matriz vacía
            </label>
          </fieldset>
          <Field label="Motivo" required helper="Por ejemplo: elaboración inicial, renovación anual, cambio de proceso.">
            <Textarea name="revisionReason" required minLength={10} />
          </Field>
          {canCopy && source === "vigente" && worksite?.vigenteHasUnsentChanges && (
            <p role="status" className="rounded-lg bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
              La MIPER vigente tiene cambios sin enviar a revisión. Al sellarse el período {currentYear} deja de ser el documento
              vigente y esos cambios no quedarán en ninguna versión: si los necesitas, envíalos a revisión o corrígelos en la
              vigente antes de crear el período nuevo.
            </p>
          )}
          {operation.message && <p role="status" className="text-sm text-[var(--color-danger-ink)]">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !worksiteId}>Crear borrador</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

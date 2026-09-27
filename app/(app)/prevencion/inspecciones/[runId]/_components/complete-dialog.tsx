"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { completeInspectionRunAction } from "../../actions"
import { useOperation } from "@/lib/hooks/use-operation"
import { clearInspectionDraft } from "@/lib/prevention/inspection-draft-storage"
import type { RunInfo } from "./types"

/* ── Declarar ejecutada ───────────────────────────────────────────────────── */

/**
 * B-01: el envío incluye el conjunto de respuestas en pantalla, y el servicio
 * lo persiste y completa en la misma transacción.
 *
 * Antes, este diálogo sólo llamaba a completar: el gate se evaluaba contra el
 * borrador en memoria mientras el servidor puntuaba lo último guardado. Un
 * inspector que corregía tres ítems y pulsaba "Declarar ejecutada" sin volver a
 * guardar firmaba cumplimiento y hallazgos con los valores viejos, sin aviso.
 */
export function CompleteDialog({ run, completion, rowProblems, payload, onSaved, saving = false }: {
  run: RunInfo
  completion: { allowed: boolean; blockers: { kind: string; detail: string }[] }
  rowProblems: string[]
  payload: () => Record<string, unknown>
  onSaved: (result: { data?: Record<string, unknown> }) => void
  /** Autoguardado en vuelo: cerrar ahora mandaría un `expectedVersion` viejo. */
  saving?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const blocked = !completion.allowed || rowProblems.length > 0 || saving

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Declarar ejecutada</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(() => completeInspectionRunAction(payload()), (result) => {
              onSaved(result)
              // Declarada ejecutada: el borrador del dispositivo ya no aplica.
              clearInspectionDraft(run.id)
              setOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Declarar ejecutada {run.code}</DialogTitle>
            <DialogDescription>
              Guarda las respuestas en pantalla, calcula el cumplimiento y materializa un hallazgo por cada incumplimiento.
            </DialogDescription>
          </DialogHeader>
          {rowProblems.length > 0 && (
            <div className="space-y-1 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">Respuestas inválidas:</p>
              <ul className="list-disc space-y-1 pl-4">
                {rowProblems.slice(0, 10).map((problem) => <li key={problem}>{problem}</li>)}
                {rowProblems.length > 10 && <li>y {rowProblems.length - 10} más…</li>}
              </ul>
            </div>
          )}
          {!completion.allowed && (
            <div className="space-y-1 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">No se puede completar:</p>
              <ul className="list-disc space-y-1 pl-4">
                {completion.blockers.slice(0, 10).map((item) => <li key={item.detail}>{item.detail}</li>)}
                {completion.blockers.length > 10 && <li>y {completion.blockers.length - 10} más…</li>}
              </ul>
            </div>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          {saving && <p className="text-sm text-[var(--color-text-subtle)]">Guardando las últimas respuestas…</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || blocked}>Declarar ejecutada</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

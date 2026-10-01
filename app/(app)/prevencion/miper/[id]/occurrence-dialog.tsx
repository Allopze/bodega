"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { formatDate, todayInChile } from "@/lib/utils"
import { recordOccurrenceAction } from "../actions"
import { EvidenceUploadField } from "./evidence-sheet"

/** «Se hizo» / «No se hizo»: el enum del servicio nunca llega a pantalla. */
const OUTCOME_OPTIONS = [
  { value: "done", label: "Se hizo" },
  { value: "not_done", label: "No se hizo" },
]

/**
 * Registro de ejecución de una ocurrencia (§7.4).
 *
 * - «Se hizo» exige fecha efectiva (no futura) y **al menos una evidencia**.
 * - «No se hizo» exige motivo de al menos 10 caracteres.
 *
 * Nunca corrige un registro anterior: volver a registrar agrega un registro
 * nuevo y el anterior queda en el historial —anular con motivo es lo único que
 * lo saca de vigencia—.
 */
export function OccurrenceDialog({
  open,
  onOpenChange,
  occurrence,
  alreadyRecorded,
  onRecorded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** La ocurrencia que se registra: su vencimiento es el que decide si es fuera de plazo. */
  occurrence: { id: string; dueOn: string }
  /** Si ya tiene un registro vigente, se avisa que esto agrega uno nuevo. */
  alreadyRecorded: boolean
  onRecorded: () => void
}) {
  const [outcome, setOutcome] = React.useState<string>("done")
  const [effectiveOn, setEffectiveOn] = React.useState("")
  const [evidencePath, setEvidencePath] = React.useState("")
  const [evidenceName, setEvidenceName] = React.useState("")
  const operation = useOperation()
  const today = todayInChile()

  function handleOpenChange(value: boolean) {
    if (value) {
      setOutcome("done")
      setEffectiveOn(today)
      setEvidencePath("")
      setEvidenceName("")
      operation.setMessage("")
    }
    onOpenChange(value)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const notes = String(form.get("notes") ?? "").trim()
    const done = outcome === "done"
    operation.run(() => recordOccurrenceAction({
      occurrenceId: occurrence.id,
      outcome,
      effectiveOn: done ? effectiveOn : null,
      reason: done ? null : String(form.get("reason") ?? "").trim(),
      notes: notes === "" ? null : notes,
      evidence: done && evidencePath
        ? [{ evidenceUploadId: evidencePath, description: evidenceName || null }]
        : [],
    }), () => { onOpenChange(false); onRecorded() })
  }

  const done = outcome === "done"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registrar la ocurrencia del {formatDate(occurrence.dueOn)}</DialogTitle>
            <DialogDescription>
              {alreadyRecorded
                ? "Esta ocurrencia ya tiene un registro vigente. Volver a registrar agrega uno nuevo: el anterior queda en el historial."
                : "El registro es la constancia de que la actividad se hizo —o de por qué no—. Queda en el historial del programa y alimenta el avance."}
            </DialogDescription>
          </DialogHeader>

          <Field label="Resultado" hint="Qué pasó con la actividad en esta ocurrencia.">
            <OptionSelect
              aria-label="Resultado de la ocurrencia"
              value={outcome}
              onValueChange={setOutcome}
              options={OUTCOME_OPTIONS}
            />
          </Field>

          {done ? (
            <>
              <Field label="Fecha efectiva" hint="Cuándo se ejecutó. No puede ser futura.">
                <DatePicker
                  ariaLabel="Fecha efectiva de la ejecución"
                  value={effectiveOn}
                  onChange={setEffectiveOn}
                  max={today}
                  placeholder="Seleccionar fecha efectiva"
                />
              </Field>
              <EvidenceUploadField
                label="Evidencia de la ejecución"
                helper="Obligatoria para «Se hizo»: PDF, JPEG, PNG, Word o Excel, hasta 25 MB."
                value={evidencePath}
                onChange={(path, fileName) => { setEvidencePath(path); setEvidenceName(fileName) }}
                disabled={operation.pending}
              />
            </>
          ) : (
            <Field label="Motivo" hint="Por qué no se hizo. Al menos 10 caracteres.">
              <Textarea name="reason" required minLength={10} maxLength={3000} rows={3} />
            </Field>
          )}

          <Field label="Notas" hint="Opcional. Cómo se ejecutó o qué quedó pendiente.">
            <Textarea name="notes" maxLength={3000} rows={2} />
          </Field>

          {operation.message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending || (done && (!effectiveOn || !evidencePath))}>
              Registrar ocurrencia
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

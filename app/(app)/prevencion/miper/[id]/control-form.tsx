"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { toast } from "@/lib/toast"
import { saveMiperControlAction } from "../actions"
import { ControlFields, draftOf, isDraftReady, valuesOf, type ControlDraft } from "./control-fields"

/**
 * Alta y edición de una medida (spec §6.2). Sale de la ficha antigua
 * (`entry-sheet.tsx`) conservando los nombres accesibles que usan las E2E:
 * «Tipo de control», «Descripción de la medida», «Nombre o cargo
 * responsable», «Plazo de la medida».
 *
 * Fase C: «¿Ya está implementada?». Una medida nueva nace «Por implementar»
 * (la regla de siempre). Una existente pide la frecuencia de verificación en vez
 * del plazo, y el formulario envía `null` en lo que no aplica.
 *
 * Fase D: los campos viven en `ControlFields`, que comparte con «Agregar medida
 * a N»; aquí quedan el guardado, el error del servidor y los botones.
 */
export function ControlForm({ matrixId, entryId, control, controlVersion, responsibleOptions, measureSuggestions, onDone, onCancel }: {
  matrixId: string
  entryId: string
  control: MiperControlSnapshot | null
  controlVersion: number | undefined
  responsibleOptions: ReadonlyArray<{ id: string; name: string }>
  measureSuggestions: readonly string[]
  onDone: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<ControlDraft>(() => draftOf(control))
  const update = (patch: Partial<ControlDraft>) => setDraft((current) => ({ ...current, ...patch }))
  // Modo «message»: el rechazo del servidor queda escrito en el formulario
  // (role=alert) en vez de un toast que se va; el éxito sigue avisando y cierra.
  const operation = useOperation()
  // Mientras guarda, nada se edita: lo enviado es lo que se ve.
  const locked = operation.pending
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? controlVersion : undefined, values: valuesOf(draft),
  }), (result) => { toast.success(result.message ?? "Medida guardada"); onDone() })
  // El responsable actual puede ya no estar en la faena (`responsibleOptions`
  // son sus usuarios activos): sin esta opción el select mostraba «Selecciona…»
  // y parecía sin responsable.
  const currentResponsible = control?.responsibleUserId && !responsibleOptions.some((option) => option.id === control.responsibleUserId)
    ? { id: control.responsibleUserId, name: control.responsibleName ?? "Responsable actual" }
    : null
  return (
    <div role="group" aria-label={control ? "Editar medida de control" : "Nueva medida de control"} className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
      <ControlFields draft={draft} onChange={update} disabled={locked} responsibleOptions={responsibleOptions} currentResponsible={currentResponsible} measureSuggestions={measureSuggestions} />
      {operation.message && <p role="alert" className="text-sm text-[var(--color-danger-ink)] md:col-span-2">{operation.message}</p>}
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" loading={operation.pending} disabled={!isDraftReady(draft)} onClick={save}>{control ? "Guardar medida" : "Agregar medida"}</Button>
        <Button size="sm" variant="secondary" disabled={operation.pending} onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}

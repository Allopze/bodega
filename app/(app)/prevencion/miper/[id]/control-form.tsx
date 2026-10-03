"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { toast } from "@/lib/toast"
import { saveMiperControlAction } from "../actions"

const HIERARCHY_OPTIONS = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>).map(([value, label]) => ({ value, label }))
const OTHER = "__otra__"

/**
 * Alta y edición de una medida (spec §6.2). Sale de la ficha antigua
 * (`entry-sheet.tsx`) conservando los nombres accesibles que usan las E2E:
 * «Tipo de control», «Descripción de la medida», «Nombre o cargo
 * responsable», «Plazo de la medida».
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
  const [hierarchy, setHierarchy] = useState<ControlHierarchy>(control?.hierarchy ?? "administrative")
  const [description, setDescription] = useState(control?.description ?? "")
  const [responsibleUserId, setResponsibleUserId] = useState(control?.responsibleUserId ?? "")
  const [responsibleName, setResponsibleName] = useState(control?.responsibleUserId ? "" : control?.responsibleName ?? "")
  const [dueDate, setDueDate] = useState(control?.dueDate ?? "")
  // Modo «message»: el rechazo del servidor queda escrito en el formulario
  // (role=alert) en vez de un toast que se va; el éxito sigue avisando y cierra.
  const operation = useOperation()
  // Mientras guarda, nada se edita: lo enviado es lo que se ve.
  const locked = operation.pending
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? controlVersion : undefined,
    values: {
      hierarchy, description: description.trim(),
      responsibleUserId: responsibleUserId || null,
      responsibleName: responsibleUserId ? null : responsibleName.trim() || null,
      dueDate: dueDate || null,
    },
  }), (result) => { toast.success(result.message ?? "Medida guardada"); onDone() })
  // El responsable actual puede ya no estar en la faena (`responsibleOptions`
  // son sus usuarios activos): sin esta opción el select mostraba «Selecciona…»
  // y parecía sin responsable.
  const currentResponsible = control?.responsibleUserId && !responsibleOptions.some((option) => option.id === control.responsibleUserId)
    ? [{ value: control.responsibleUserId, label: control.responsibleName ?? "Responsable actual" }]
    : []
  return (
    <div role="group" aria-label={control ? "Editar medida de control" : "Nueva medida de control"} className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
      <Field label="Tipo de control (jerarquía)" required>
        <OptionSelect aria-label="Tipo de control" options={HIERARCHY_OPTIONS} value={hierarchy} disabled={locked} onValueChange={(value) => setHierarchy(value as ControlHierarchy)} />
      </Field>
      <Field label="Plazo" required helper="Fecha en que la medida debe estar implementada.">
        <DatePicker ariaLabel="Plazo de la medida" value={dueDate || undefined} disabled={locked} onChange={setDueDate} />
      </Field>
      {/* El rótulo visible es el nombre accesible (WCAG 2.5.3, «label in name»). */}
      <Field label="Descripción de la medida" required className="md:col-span-2" helper="Mínimo 3 caracteres.">
        <Textarea aria-label="Descripción de la medida" value={description} disabled={locked} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={3000} />
      </Field>
      {measureSuggestions.length > 0 && (
        <Field label="Usar una medida ya escrita en esta MIPER" className="md:col-span-2">
          <Combobox aria-label="Usar una medida ya escrita" options={measureSuggestions.map((value) => ({ value, label: value }))} value="" disabled={locked} onChange={(value) => { if (value) setDescription(value) }} placeholder="Buscar medida…" />
        </Field>
      )}
      <Field label="Responsable">
        <OptionSelect
          aria-label="Responsable de la medida"
          options={[...responsibleOptions.map((option) => ({ value: option.id, label: option.name })), ...currentResponsible, { value: OTHER, label: "Otra persona o cargo…" }]}
          value={responsibleUserId || OTHER}
          disabled={locked}
          onValueChange={(value) => setResponsibleUserId(value === OTHER ? "" : value)}
        />
      </Field>
      {!responsibleUserId && (
        <Field label="Nombre o cargo responsable">
          <Input aria-label="Nombre o cargo responsable" value={responsibleName} disabled={locked} onChange={(event) => setResponsibleName(event.target.value)} placeholder="Supervisor de turno" maxLength={300} />
        </Field>
      )}
      {operation.message && <p role="alert" className="text-sm text-[var(--color-danger-ink)] md:col-span-2">{operation.message}</p>}
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" loading={operation.pending} disabled={description.trim().length < 3} onClick={save}>{control ? "Guardar medida" : "Agregar medida"}</Button>
        <Button size="sm" variant="secondary" disabled={operation.pending} onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}

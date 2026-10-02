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
  const operation = useOperation({ feedback: "toast", onSuccess: onDone })
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? controlVersion : undefined,
    values: {
      hierarchy, description: description.trim(),
      responsibleUserId: responsibleUserId || null,
      responsibleName: responsibleUserId ? null : responsibleName.trim() || null,
      dueDate: dueDate || null,
    },
  }))
  return (
    <div role="group" aria-label={control ? "Editar medida de control" : "Nueva medida de control"} className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
      <Field label="Tipo de control (jerarquía)" required>
        <OptionSelect aria-label="Tipo de control" options={HIERARCHY_OPTIONS} value={hierarchy} onValueChange={(value) => setHierarchy(value as ControlHierarchy)} />
      </Field>
      <Field label="Plazo" required helper="Fecha en que la medida debe estar implementada.">
        <DatePicker ariaLabel="Plazo de la medida" value={dueDate || undefined} onChange={setDueDate} />
      </Field>
      {/* El rótulo visible es el nombre accesible (WCAG 2.5.3, «label in name»). */}
      <Field label="Descripción de la medida" required className="md:col-span-2">
        <Textarea aria-label="Descripción de la medida" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={3000} />
      </Field>
      {measureSuggestions.length > 0 && (
        <Field label="Usar una medida ya escrita en esta MIPER" className="md:col-span-2">
          <Combobox aria-label="Usar una medida ya escrita" options={measureSuggestions.map((value) => ({ value, label: value }))} value="" onChange={(value) => { if (value) setDescription(value) }} placeholder="Buscar medida…" />
        </Field>
      )}
      <Field label="Responsable">
        <OptionSelect
          aria-label="Responsable de la medida"
          options={[...responsibleOptions.map((option) => ({ value: option.id, label: option.name })), { value: OTHER, label: "Otra persona o cargo…" }]}
          value={responsibleUserId || OTHER}
          onValueChange={(value) => setResponsibleUserId(value === OTHER ? "" : value)}
        />
      </Field>
      {!responsibleUserId && (
        <Field label="Nombre o cargo responsable">
          <Input aria-label="Nombre o cargo responsable" value={responsibleName} onChange={(event) => setResponsibleName(event.target.value)} placeholder="Supervisor de turno" maxLength={300} />
        </Field>
      )}
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" loading={operation.pending} disabled={description.trim().length < 3} onClick={save}>{control ? "Guardar medida" : "Agregar medida"}</Button>
        <Button size="sm" variant="secondary" disabled={operation.pending} onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}

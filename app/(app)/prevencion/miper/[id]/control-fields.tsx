"use client"

import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import type { ControlValues } from "@/lib/prevention/miper/control-values"
import { FREQUENCY_MAX_LENGTH, MEASURE_MAX_LENGTH, RESPONSIBLE_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"

export const HIERARCHY_OPTIONS = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>).map(([value, label]) => ({ value, label }))
const OTHER = "__otra__"
/** Sólo en lote (Fase D): el responsable de cada medida se conserva. */
export const KEEP_RESPONSIBLE = "__sin_cambio__"
/** D5 (Fase C): una medida existente se verifica con una frecuencia; una por implementar lleva plazo. */
export const KIND_OPTIONS = [
  { value: "existing", title: "Ya está implementada", description: "Se verifica cada cierto tiempo; no lleva plazo." },
  { value: "pending", title: "Por implementar", description: "Lleva responsable y la fecha en que debe estar lista." },
] as const

/** Lo que una persona está escribiendo en el formulario de una medida. `responsibleUserId` vacío = nombre o cargo escrito. */
export type ControlDraft = {
  hierarchy: ControlHierarchy; isExisting: boolean; frequency: string; description: string
  responsibleUserId: string; responsibleName: string; dueDate: string
}

/** El borrador de una medida existente, o el de una nueva: «Por implementar», tipo IV, sin responsable. */
export function draftOf(control: MiperControlSnapshot | null): ControlDraft {
  return {
    hierarchy: control?.hierarchy ?? "administrative",
    isExisting: control?.isExisting ?? false,
    frequency: control?.verificationFrequency ?? "",
    description: control?.description ?? "",
    responsibleUserId: control?.responsibleUserId ?? "",
    responsibleName: control?.responsibleUserId ? "" : control?.responsibleName ?? "",
    dueDate: control?.dueDate ?? "",
  }
}

/** Mínimo de la descripción, el del esquema: el botón de guardar no se habilita antes. */
export const isDraftReady = (draft: ControlDraft) => draft.description.trim().length >= 3

/** Lo que se envía: `null` en lo que no aplica (D5), igual en el editor y en «Agregar medida a N». */
export function valuesOf(draft: ControlDraft): ControlValues {
  return {
    hierarchy: draft.hierarchy, description: draft.description.trim(),
    responsibleUserId: draft.responsibleUserId || null,
    responsibleName: draft.responsibleUserId ? null : draft.responsibleName.trim() || null,
    isExisting: draft.isExisting,
    verificationFrequency: draft.isExisting ? draft.frequency.trim() || null : null,
    dueDate: draft.isExisting ? null : draft.dueDate || null,
  }
}

/**
 * Responsable de una medida: una persona de la faena o «Otra persona o cargo…»,
 * que pide el nombre. El responsable actual que ya no está en la faena sigue
 * siendo la opción elegida (A2, fila 9). En lote, `keepLabel` agrega «No
 * cambiar» (`KEEP_RESPONSIBLE`) como primera opción.
 */
export function ResponsibleField({ userId, name, onChange, options, current = null, disabled = false, keepLabel }: {
  userId: string
  name: string
  onChange: (next: { userId: string; name: string }) => void
  options: ReadonlyArray<{ id: string; name: string }>
  current?: { id: string; name: string } | null
  disabled?: boolean
  keepLabel?: string
}) {
  const value = userId || OTHER
  return (
    <>
      <Field label="Responsable">
        <OptionSelect
          aria-label="Responsable de la medida"
          options={[
            ...(keepLabel ? [{ value: KEEP_RESPONSIBLE, label: keepLabel }] : []),
            ...options.map((option) => ({ value: option.id, label: option.name })),
            ...(current ? [{ value: current.id, label: current.name }] : []),
            { value: OTHER, label: "Otra persona o cargo…" },
          ]}
          value={value}
          disabled={disabled}
          onValueChange={(next) => onChange({ userId: next === OTHER ? "" : next, name })}
        />
      </Field>
      {value === OTHER && (
        <Field label="Nombre o cargo responsable">
          <Input aria-label="Nombre o cargo responsable" value={name} disabled={disabled} onChange={(event) => onChange({ userId: "", name: event.target.value })} placeholder="Supervisor de turno" maxLength={RESPONSIBLE_MAX_LENGTH} />
        </Field>
      )}
    </>
  )
}

/**
 * Los campos de una medida (spec §6.2), sin guardar nada: los usan el editor de
 * la medida (`ControlForm`) y «Agregar medida a N» (Fase D). Se pintan dentro de
 * una grilla de dos columnas. Conservan los nombres accesibles que usan las E2E:
 * «¿Ya está implementada?», «Tipo de control», «Plazo de la medida»,
 * «Frecuencia de verificación», «Descripción de la medida», «Responsable de la
 * medida» y «Nombre o cargo responsable».
 */
export function ControlFields({ draft, onChange, disabled, responsibleOptions, currentResponsible = null, measureSuggestions }: {
  draft: ControlDraft
  onChange: (patch: Partial<ControlDraft>) => void
  disabled: boolean
  responsibleOptions: ReadonlyArray<{ id: string; name: string }>
  currentResponsible?: { id: string; name: string } | null
  measureSuggestions: readonly string[]
}) {
  return (
    <>
      <div className="space-y-2 md:col-span-2">
        <p className="text-sm font-medium text-[var(--color-text)]">¿Ya está implementada?</p>
        <ChoiceCardGroup label="¿Ya está implementada?" className="sm:grid-cols-2" options={KIND_OPTIONS} value={draft.isExisting ? "existing" : "pending"}
          disabled={disabled} onChange={(value) => onChange({ isExisting: value === "existing" })} />
      </div>
      <Field label="Tipo de control (jerarquía)" required>
        <OptionSelect aria-label="Tipo de control" options={HIERARCHY_OPTIONS} value={draft.hierarchy} disabled={disabled} onValueChange={(value) => onChange({ hierarchy: value as ControlHierarchy })} />
      </Field>
      {draft.isExisting ? (
        <Field label="Frecuencia de verificación" helper="Cada cuánto se comprueba que sigue funcionando (por ejemplo, trimestral).">
          <Input aria-label="Frecuencia de verificación" value={draft.frequency} disabled={disabled} onChange={(event) => onChange({ frequency: event.target.value })} placeholder="Trimestral" maxLength={FREQUENCY_MAX_LENGTH} />
        </Field>
      ) : (
        <Field label="Plazo" required helper="Fecha en que la medida debe estar implementada.">
          <DatePicker ariaLabel="Plazo de la medida" value={draft.dueDate || undefined} disabled={disabled} onChange={(dueDate) => onChange({ dueDate })} />
        </Field>
      )}
      {/* El rótulo visible es el nombre accesible (WCAG 2.5.3, «label in name»). */}
      <Field label="Descripción de la medida" required className="md:col-span-2" helper="Mínimo 3 caracteres.">
        <Textarea aria-label="Descripción de la medida" value={draft.description} disabled={disabled} onChange={(event) => onChange({ description: event.target.value })} rows={3} maxLength={MEASURE_MAX_LENGTH} />
      </Field>
      {measureSuggestions.length > 0 && (
        <Field label="Usar una medida ya escrita en esta MIPER" className="md:col-span-2">
          <Combobox aria-label="Usar una medida ya escrita" options={measureSuggestions.map((value) => ({ value, label: value }))} value="" disabled={disabled} onChange={(value) => { if (value) onChange({ description: value }) }} placeholder="Buscar medida…" />
        </Field>
      )}
      <ResponsibleField userId={draft.responsibleUserId} name={draft.responsibleName} options={responsibleOptions} current={currentResponsible} disabled={disabled}
        onChange={(next) => onChange({ responsibleUserId: next.userId, responsibleName: next.name })} />
    </>
  )
}

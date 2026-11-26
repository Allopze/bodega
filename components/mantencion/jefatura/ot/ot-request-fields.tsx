"use client"

import * as React from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { ACTION_TYPES, ACTION_TYPE_LABELS, SPECIALTIES, SPECIALTY_LABELS, type ActionType, type Specialty } from "@/lib/mantencion/action-type"
import { OtItemListEditor } from "./ot-item-list-editor"

/**
 * Los campos de la solicitud de una OT, compartidos por «Nueva orden» (`new-ot-sheet.tsx`) y «Editar
 * orden» (`edit-ot-sheet.tsx`): el mismo formulario, con lo guardado precargado al editar. Lo que sólo
 * existe al crear (equipo y mecánico) queda en cada hoja.
 */

export interface FormValues {
  vehicleId: string
  repair: boolean
  maintenance: boolean
  requestDate: string
  requesterName: string
  repairDescription: string
  observations: string
  annexItems: string[]
  maintenanceItems: string[]
  assignedToUserId: string
  actionType: ActionType | ""
  specialties: Specialty[]
  executionWorksiteId: string
}

/**
 * Al elegir el tipo de acción se prellenan las casillas del papel de forma coherente: correctiva es
 * reparación; preventiva y predictiva son mantención. Siguen editables (una OT puede ser las dos).
 */
export function checksForActionType(type: ActionType): { repair: boolean; maintenance: boolean } {
  return type === "correctiva" ? { repair: true, maintenance: false } : { repair: false, maintenance: true }
}

/** Líneas sin texto fuera: la lista guarda también las que se están escribiendo. */
function cleanItems(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean)
}

export interface DiscardNotices {
  /** Qué se borra al guardar porque Reparación quedó desmarcada; `null` si no hay nada que perder. */
  repair: string | null
  /** Idem para Mantención. */
  maintenance: string | null
}

/**
 * Lo que `requestPayload` descarta al guardar y el formulario ya no muestra: la descripción y los trabajos anexos
 * de una Reparación desmarcada, las mantenciones solicitadas de una Mantención desmarcada (OT4-6). Se dice junto
 * a la casilla, antes de guardar: quien la desmarca a mano sabe qué pierde, sin un diálogo de confirmación.
 */
export function discardNotices(values: Pick<FormValues, "repair" | "maintenance" | "repairDescription" | "annexItems" | "maintenanceItems">): DiscardNotices {
  let repair: string | null = null
  if (!values.repair) {
    const annex = cleanItems(values.annexItems).length
    const parts = [
      values.repairDescription.trim() ? "la descripción" : null,
      annex === 1 ? "1 trabajo anexo" : annex > 1 ? `${annex} trabajos anexos` : null,
    ].filter((part): part is string => part !== null)
    if (parts.length > 0) repair = `Al guardar se ${parts.length > 1 || annex > 1 ? "borran" : "borra"} ${parts.join(" y ")}.`
  }
  let maintenance: string | null = null
  if (!values.maintenance) {
    const lines = cleanItems(values.maintenanceItems).length
    if (lines > 0) maintenance = `Al guardar se ${lines > 1 ? "borran" : "borra"} ${lines === 1 ? "1 mantención solicitada" : `${lines} mantenciones solicitadas`}.`
  }
  return { repair, maintenance }
}

/**
 * Lo que comparten el alta y la edición. Los ítems de un tipo desmarcado NO viajan (OT-5): su lista
 * queda oculta en el formulario, y mandarla dejaba ítems que nadie ve (y errores de un campo invisible).
 */
function requestPayload(values: FormValues) {
  return {
    repair: values.repair,
    maintenance: values.maintenance,
    requestDate: values.requestDate,
    requesterName: values.requesterName.trim(),
    repairDescription: values.repair ? values.repairDescription.trim() || null : null,
    observations: values.observations.trim() || null,
    annexItems: values.repair ? cleanItems(values.annexItems) : [],
    maintenanceItems: values.maintenance ? cleanItems(values.maintenanceItems) : [],
    actionType: values.actionType || null,
    specialties: values.specialties,
    executionWorksiteId: values.executionWorksiteId || null,
  }
}

/** Lo que viaja en el campo `payload` del alta: el `createWorkOrderSchema`. */
export function buildCreatePayload(values: FormValues, clientRequestId: string) {
  return {
    clientRequestId,
    vehicleId: values.vehicleId,
    ...requestPayload(values),
    assignedToUserId: values.assignedToUserId || null,
  }
}

/** Lo que recibe `editWorkOrderAction`: el `editWorkOrderSchema`, con la versión que el formulario vio al abrirse. */
export function buildEditPayload(values: FormValues, base: { workOrderId: string; expectedVersion: number }) {
  return { ...base, ...requestPayload(values) }
}

/** Los campos que el formulario dibuja ahora: un error de otro campo no se vería (OT-5). */
export function visibleFieldKeys(values: Pick<FormValues, "repair" | "maintenance">, options: { create: boolean; executionWorksite: boolean; mechanic: boolean }): Set<string> {
  const keys = ["actionType", "specialties", "repair", "maintenance", "requestDate", "requesterName", "observations"]
  if (values.repair) keys.push("repairDescription", "annexItems")
  if (values.maintenance) keys.push("maintenanceItems")
  if (options.executionWorksite) keys.push("executionWorksiteId")
  if (options.create) keys.push("vehicleId")
  if (options.create && options.mechanic) keys.push("assignedToUserId")
  return new Set(keys)
}

/**
 * Mensaje de un error por campo que apunta a un campo que NO se ve (una lista oculta, un campo que este
 * formulario no tiene): si sólo se pintara «bajo su campo» el envío fallaría sin una sola pista. `undefined`
 * si todos los errores caen en campos visibles.
 */
export function hiddenFieldMessage(errors: Record<string, string[]> | undefined, visible: ReadonlySet<string>): string | undefined {
  if (!errors) return undefined
  for (const [key, messages] of Object.entries(errors)) {
    if (!visible.has(key) && messages[0]) return messages[0]
  }
  return undefined
}

export interface OtRequestFieldsProps {
  values: FormValues
  setValues: React.Dispatch<React.SetStateAction<FormValues>>
  /** Primer mensaje de error de alguno de esos campos. */
  fieldError: (...keys: string[]) => string | undefined
  /** `ops.mantencion.ot_action_type_required` encendido: sólo marca el campo; lo exige el servidor. */
  actionTypeRequired?: boolean
  /** Faenas elegibles como «Faena de ejecución» (sin la del equipo). Sin ellas, el campo no se ofrece. */
  executionOptions: Array<{ value: string; label: string }>
  /**
   * «Editar orden»: elegir el tipo de acción NO toca Reparación ni Mantención (hacerlo borraba, al guardar, la
   * descripción y los trabajos anexos de una OT ya pedida: OT4-6) y desmarcar un tipo con contenido avisa qué se
   * pierde. En el alta, el tipo sigue prellenando las casillas.
   */
  editing?: boolean
}

/** De «Tipo de acción» a «Observaciones», en el orden del talonario. */
export function OtRequestFields({ values, setValues, fieldError, actionTypeRequired, executionOptions, editing = false }: OtRequestFieldsProps) {
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((current) => ({ ...current, [key]: value }))
  const toggleSpecialty = (specialty: Specialty, checked: boolean) => setValues((current) => ({
    ...current,
    specialties: SPECIALTIES.filter((value) => (value === specialty ? checked : current.specialties.includes(value))),
  }))

  const notices = editing ? discardNotices(values) : { repair: null, maintenance: null }
  const discardText = [notices.repair, notices.maintenance].filter((text): text is string => text !== null)

  return (
    <>
      <Field
        label="Tipo de acción"
        htmlFor="ot-tipo-accion"
        required={actionTypeRequired}
        error={fieldError("actionType")}
        helper={editing
          ? "Elegirlo no cambia lo marcado en «Tipo de trabajo»."
          : "Al elegirla se marca Reparación (correctiva) o Mantención (preventiva y predictiva); puedes ajustarlas."}
      >
        <OptionSelect
          id="ot-tipo-accion"
          emptyLabel={actionTypeRequired ? undefined : "Sin definir"}
          placeholder="Elige el tipo de acción"
          options={ACTION_TYPES.map((type) => ({ value: type, label: ACTION_TYPE_LABELS[type] }))}
          value={values.actionType}
          onValueChange={(value) => setValues((current) => {
            const type = (ACTION_TYPES as readonly string[]).includes(value) ? (value as ActionType) : ""
            if (!type) return { ...current, actionType: "" }
            return editing ? { ...current, actionType: type } : { ...current, actionType: type, ...checksForActionType(type) }
          })}
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-[var(--color-text)]">Especialidades</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {SPECIALTIES.map((specialty) => (
            <Checkbox
              key={specialty}
              id={`ot-esp-${specialty}`}
              label={SPECIALTY_LABELS[specialty]}
              checked={values.specialties.includes(specialty)}
              onChange={(event) => toggleSpecialty(specialty, event.target.checked)}
            />
          ))}
        </div>
        {fieldError("specialties") && <p role="alert" className="text-xs text-[var(--color-danger)]">{fieldError("specialties")}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-[var(--color-text)]">Tipo de trabajo <span aria-hidden className="text-[var(--color-danger)]">*</span></legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox id="ot-reparacion" label="Reparación" checked={values.repair} onChange={(event) => set("repair", event.target.checked)} />
          <Checkbox id="ot-mantencion" label="Mantención" checked={values.maintenance} onChange={(event) => set("maintenance", event.target.checked)} />
        </div>
        {fieldError("repair", "maintenance") && <p role="alert" className="text-xs text-[var(--color-danger)]">{fieldError("repair", "maintenance")}</p>}
        {/* Región viva siempre presente: el aviso aparece al desmarcar y un lector de pantalla lo anuncia. */}
        <div role="status" className="flex flex-col gap-1 empty:hidden">
          {discardText.map((text) => <p key={text} className="text-xs text-[var(--color-warning-ink)]">{text}</p>)}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha de la orden" htmlFor="ot-fecha" required error={fieldError("requestDate")}>
          <DatePicker id="ot-fecha" value={values.requestDate} onChange={(iso) => set("requestDate", iso)} ariaLabel="Fecha de la orden" />
        </Field>
        <Field label="Solicitante" htmlFor="ot-solicitante" required error={fieldError("requesterName")}>
          <Input id="ot-solicitante" value={values.requesterName} maxLength={120} onChange={(event) => set("requesterName", event.target.value)} />
        </Field>
      </div>

      {values.repair && (
        <Field label="Reparación" htmlFor="ot-reparacion-desc" required error={fieldError("repairDescription")}>
          <Textarea
            id="ot-reparacion-desc"
            value={values.repairDescription}
            maxLength={2000}
            rows={3}
            placeholder="Ej. Pierde aceite por el cárter y hace ruido al frenar."
            onChange={(event) => set("repairDescription", event.target.value)}
          />
        </Field>
      )}

      {values.repair && (
        <OtItemListEditor
          idPrefix="ot-anexo"
          legend="Trabajos anexos (reparación)"
          helper="Opcional."
          placeholder="Ej. Cambiar pastillas de freno"
          items={values.annexItems}
          onChange={(next) => set("annexItems", next)}
          error={fieldError("annexItems")}
        />
      )}

      {values.maintenance && (
        <OtItemListEditor
          idPrefix="ot-mant"
          legend="Mantenciones solicitadas o asignadas en taller"
          helper="El mecánico marca Sí o No al terminar."
          placeholder="Ej. Cambio de aceite y filtros"
          items={values.maintenanceItems}
          onChange={(next) => set("maintenanceItems", next)}
          error={fieldError("maintenanceItems")}
        />
      )}

      {executionOptions.length > 0 && (
        <Field label="Faena de ejecución (opcional)" htmlFor="ot-faena-ejecucion" error={fieldError("executionWorksiteId")} helper="Sólo si el trabajo se hará en el taller de otra faena. Si lo dejas vacío, se hace en la del equipo.">
          <OptionSelect
            id="ot-faena-ejecucion"
            emptyLabel="La misma del equipo"
            options={executionOptions}
            value={values.executionWorksiteId}
            onValueChange={(value) => set("executionWorksiteId", value)}
          />
        </Field>
      )}

      <Field label="Observaciones" htmlFor="ot-observaciones" error={fieldError("observations")}>
        <Textarea id="ot-observaciones" value={values.observations} maxLength={2000} rows={2} onChange={(event) => set("observations", event.target.value)} />
      </Field>
    </>
  )
}

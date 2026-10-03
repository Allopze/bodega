"use client"

import { useMemo, useState } from "react"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useOperation } from "@/lib/hooks/use-operation"
import { impactSummary, newlyIncomplete, withAddedControl, withControlPatch } from "@/lib/prevention/miper/bulk-impact"
import type { ControlPatch } from "@/lib/prevention/miper/control-values"
import { applyEntryValues } from "@/lib/prevention/miper/entry-values"
import { FREQUENCY_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import { CONTROLLED_STATUS_LABEL, type ControlledStatus, type MiperControlSnapshot, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { toast } from "@/lib/toast"
import { countOf } from "@/lib/utils"
import { MIPER_BULK_LIMIT } from "@/lib/validation/prevention-module/miper"
import { bulkAddMiperControlAction, bulkPatchMiperEntriesAction, bulkUpdateMiperControlsAction } from "../actions"
import { BulkDialog, type BulkContext, entryItems, MISSING_VERSION, settlePatchedEntries } from "./bulk-shared"
import { ControlFields, draftOf, isDraftReady, KEEP_RESPONSIBLE, ResponsibleField, valuesOf, type ControlDraft } from "./control-fields"

type DialogProps = { entries: readonly MiperEntrySnapshot[]; context: BulkContext; onOpenChange: (open: boolean) => void; onDone: () => void }

const nameIn = (options: BulkContext["responsibleOptions"]) => (userId: string) => options.find((option) => option.id === userId)?.name ?? null

/** «Agregar medida a N»: la misma medida en cada riesgo, con los campos del editor. */
export function BulkAddControlDialog({ entries, context, onOpenChange, onDone }: DialogProps) {
  const [draft, setDraft] = useState<ControlDraft>(() => draftOf(null))
  const operation = useOperation()
  const values = valuesOf(draft)
  // Sin descripción todavía no hay medida que evaluar: el aviso hablaría de lo que falta escribir.
  const impact = isDraftReady(draft) ? impactSummary(newlyIncomplete(entries, entries.map((entry) => withAddedControl(entry, values, nameIn(context.responsibleOptions))))) : null
  const apply = () => operation.run(async () => {
    const items = await entryItems(context.sync, entries)
    if (!items) return MISSING_VERSION
    return bulkAddMiperControlAction({ matrixId: context.matrixId, items, values })
  }, (result) => {
    if (result.data?.created === 0) toast.info(result.message ?? "No había nada que cambiar.")
    else toast.success(result.message ?? "Medida agregada")
    onDone()
  })
  return (
    <BulkDialog open onOpenChange={onOpenChange} title={`Agregar una medida a ${countOf(entries.length, "riesgo", "riesgos")}`}
      description="La misma medida se agrega a cada riesgo seleccionado y queda «Propuesta», como toda medida nueva."
      impact={impact} error={operation.message} busy={operation.pending}
      confirmLabel={`Agregar a ${entries.length}`} confirmDisabled={!isDraftReady(draft)} onConfirm={apply}>
      <div className="grid gap-3 md:grid-cols-2">
        <ControlFields draft={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} disabled={operation.pending}
          responsibleOptions={context.responsibleOptions} measureSuggestions={context.measureSuggestions} />
      </div>
    </BulkDialog>
  )
}

const CONTROLLED = (["yes", "partial", "no"] as const).map((value) => ({ value, title: CONTROLLED_STATUS_LABEL[value] }))

/** «Cambiar ¿controlado?»: el mismo «¿Está controlado?» en cada riesgo (un cambio de riesgos en lote). */
export function BulkControlledDialog({ entries, context, onOpenChange, onDone }: DialogProps) {
  const [status, setStatus] = useState<ControlledStatus | null>(null)
  const operation = useOperation()
  const impact = status ? impactSummary(newlyIncomplete(entries, entries.map((entry) => applyEntryValues(entry, { controlledStatus: status }, context.riskFactors)))) : null
  const apply = () => {
    if (!status) return
    const values = { controlledStatus: status }
    operation.run(async () => {
      const items = await entryItems(context.sync, entries)
      if (!items) return MISSING_VERSION
      return bulkPatchMiperEntriesAction({ matrixId: context.matrixId, items, values })
    }, (result) => {
      settlePatchedEntries(context, result.data, values)
      // Con cero escritos el servicio avisa que ya estaba así: es información, no un éxito.
      if (Array.isArray(result.data?.entries) && result.data.entries.length === 0) toast.info(result.message ?? "No había nada que cambiar.")
      else toast.success(result.message ?? "Riesgos actualizados")
      onDone()
    })
  }
  return (
    <BulkDialog open onOpenChange={onOpenChange} title={`¿Está controlado? en ${countOf(entries.length, "riesgo", "riesgos")}`}
      description="Lo que elijas reemplaza la respuesta de cada riesgo seleccionado."
      impact={impact} error={operation.message} busy={operation.pending}
      confirmLabel={`Aplicar a ${entries.length}`} confirmDisabled={status === null} onConfirm={apply}>
      <ChoiceCardGroup label="¿Está controlado el riesgo?" options={CONTROLLED} value={status} disabled={operation.pending} onChange={setStatus} />
    </BulkDialog>
  )
}

type Scope = "all" | "unassigned" | "undated"
const SCOPE_TEST: Record<Scope, (control: MiperControlSnapshot) => boolean> = {
  all: () => true,
  unassigned: (control) => !control.responsibleUserId && !control.responsibleName,
  undated: (control) => !(control.isExisting ?? false) && !control.dueDate,
}
type Kind = "keep" | "existing" | "pending"
const KIND: ReadonlyArray<{ value: Kind; title: string; description: string }> = [
  { value: "keep", title: "No cambiar", description: "Cada medida queda como está." },
  { value: "existing", title: "Ya está implementada", description: "Se verifica con una frecuencia; pierde el plazo." },
  { value: "pending", title: "Por implementar", description: "Lleva plazo; pierde la frecuencia." },
]

/**
 * «Asignar responsable / plazo» de las medidas de los riesgos seleccionados.
 * Cada campo parte en «no cambiar». D5 rige como en el editor: el plazo sólo
 * entra a las medidas por implementar y la frecuencia sólo a las existentes.
 */
export function BulkControlPatchDialog({ entries, context, onOpenChange, onDone }: DialogProps) {
  const [scope, setScope] = useState<Scope>("all")
  const [kind, setKind] = useState<Kind>("keep")
  const [responsible, setResponsible] = useState({ userId: KEEP_RESPONSIBLE, name: "" })
  const [dueDate, setDueDate] = useState("")
  const [frequency, setFrequency] = useState("")
  const operation = useOperation()
  const all = useMemo(() => entries.flatMap((entry) => entry.controls), [entries])
  const counts = { all: all.length, unassigned: all.filter(SCOPE_TEST.unassigned).length, undated: all.filter(SCOPE_TEST.undated).length }
  const controls = all.filter(SCOPE_TEST[scope])
  const textResponsibleMissing = responsible.userId === "" && responsible.name.trim() === ""
  const patch: ControlPatch = {
    ...(responsible.userId === KEEP_RESPONSIBLE || textResponsibleMissing ? {}
      : { responsible: responsible.userId ? { kind: "user", userId: responsible.userId } : { kind: "text", name: responsible.name.trim() } }),
    ...(kind === "keep" ? {} : { isExisting: kind === "existing" }),
    ...(kind !== "existing" && dueDate ? { dueDate } : {}),
    ...(kind !== "pending" && frequency.trim() ? { verificationFrequency: frequency.trim() } : {}),
  }
  const ids = new Set(controls.map((control) => control.id))
  const nothing = Object.keys(patch).length === 0
  const impact = nothing ? null : impactSummary(newlyIncomplete(entries, entries.map((entry) => withControlPatch(entry, ids, patch, nameIn(context.responsibleOptions)))))
  const over = controls.length > MIPER_BULK_LIMIT
  const apply = () => operation.run(async () => {
    const items = controls.map((control) => ({ controlId: control.id, expectedVersion: context.controlVersions[control.id] }))
    if (items.some((item) => item.expectedVersion === undefined)) return { ok: false, message: "Falta la versión de una medida; recarga la matriz." }
    return bulkUpdateMiperControlsAction({ matrixId: context.matrixId, items, patch })
  }, (result) => {
    if (result.data?.updated === 0) toast.info(result.message ?? "No había nada que cambiar.")
    else toast.success(result.message ?? "Medidas actualizadas")
    onDone()
  })
  return (
    <BulkDialog open onOpenChange={onOpenChange} title={`Responsable y plazo de las medidas de ${countOf(entries.length, "riesgo", "riesgos")}`}
      description="Elige a qué medidas se aplica y qué cambia. Lo que dejes en «No cambiar» o vacío se conserva en cada medida."
      impact={impact} error={operation.message} busy={operation.pending}
      confirmLabel={`Aplicar a ${countOf(controls.length, "medida", "medidas")}`}
      confirmDisabled={nothing || textResponsibleMissing || controls.length === 0 || over} onConfirm={apply}>
      {all.length === 0 ? (
        <p className="text-sm text-[var(--color-text-subtle)]">Los riesgos seleccionados todavía no tienen medidas: agrégalas primero con «Agregar medida».</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <p className="text-sm font-medium">¿A qué medidas?</p>
            <ChoiceCardGroup label="¿A qué medidas?" value={scope} onChange={setScope} disabled={operation.pending}
              options={[
                { value: "all", title: `Todas (${counts.all})` },
                { value: "unassigned", title: `Sin responsable (${counts.unassigned})` },
                { value: "undated", title: `Por implementar sin plazo (${counts.undated})` },
              ]} />
            {over && <p role="status" className="text-sm text-[var(--color-warning-ink)]">Son {controls.length} medidas: se pueden cambiar hasta {MIPER_BULK_LIMIT} a la vez. Elige un grupo más chico o selecciona menos riesgos.</p>}
          </div>
          <div className="space-y-2 md:col-span-2">
            <p className="text-sm font-medium">¿Ya está implementada?</p>
            <ChoiceCardGroup label="¿Ya está implementada?" options={KIND} value={kind} onChange={setKind} disabled={operation.pending} />
          </div>
          <ResponsibleField userId={responsible.userId} name={responsible.name} onChange={setResponsible} options={context.responsibleOptions} disabled={operation.pending} keepLabel="No cambiar" />
          {kind !== "existing" && (
            <Field label="Plazo" helper="Sólo para las medidas por implementar. Vacío: no cambia.">
              <DatePicker ariaLabel="Plazo de la medida" value={dueDate || undefined} disabled={operation.pending} onChange={setDueDate} />
            </Field>
          )}
          {kind !== "pending" && (
            <Field label="Frecuencia de verificación" helper="Sólo para las medidas ya implementadas. Vacío: no cambia.">
              <Input aria-label="Frecuencia de verificación" value={frequency} disabled={operation.pending} onChange={(event) => setFrequency(event.target.value)} placeholder="Trimestral" maxLength={FREQUENCY_MAX_LENGTH} />
            </Field>
          )}
        </div>
      )}
    </BulkDialog>
  )
}

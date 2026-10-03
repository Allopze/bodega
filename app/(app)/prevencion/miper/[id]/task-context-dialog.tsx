"use client"

import { useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Combobox } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { impactSummary, newlyIncomplete } from "@/lib/prevention/miper/bulk-impact"
import { applyEntryValues } from "@/lib/prevention/miper/entry-values"
import { taskKeyOf, type TaskNode } from "@/lib/prevention/miper/matrix-tree"
import { normalizeMiperName } from "@/lib/prevention/miper/names"
import { hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { toast } from "@/lib/toast"
import { countOf } from "@/lib/utils"
import { MIPER_BULK_LIMIT, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { bulkPatchMiperEntriesAction } from "../actions"
import { BulkDialog, type BulkContext, entryItems, MISSING_VERSION, settlePatchedEntries } from "./bulk-shared"
import { navigateWorkspace } from "./workspace-nav"

type ContextField = "activity" | "task" | "position" | "location"
/** Cómo se nombra cada campo opcional en su ayuda («conserva su puesto»). */
const NOUN: Partial<Record<ContextField, [singular: string, plural: string]>> = { position: ["puesto", "puestos"], location: ["lugar", "lugares"] }
const same = (a: string | null, b: string | null) => normalizeMiperName(a ?? "") === normalizeMiperName(b ?? "")

/** El valor común de los riesgos de la tarea, o `null` si difieren: en el RE-04 una tarea puede tener varios puestos (spec §2.2, D3). */
function shared(task: TaskNode, field: ContextField): string | null {
  const first = task.entries[0]?.[field] ?? null
  return task.entries.every((entry) => same(entry[field], first)) ? first ?? "" : null
}

/**
 * Lo que cambia, y nada más. Actividad y tarea se comparan por nombre
 * normalizado: el diccionario de la faena ya trata «carga» y «Carga» como el
 * mismo nombre. Puesto y lugar vacíos se conservan en cada riesgo.
 */
export function contextChanges(task: TaskNode, draft: Record<ContextField, string>): MiperEntryValues {
  const values: MiperEntryValues = {}
  if (!same(draft.activity, task.activity)) values.activity = draft.activity.trim()
  if (!same(draft.task, task.task)) values.task = draft.task.trim()
  for (const field of ["position", "location"] as const) {
    const common = shared(task, field)
    if (draft[field].trim() && (common === null || !same(draft[field], common))) values[field] = draft[field].trim()
  }
  return values
}

/**
 * «Editar tarea» (spec §9; el mockup lo llamaba «Editar contexto», palabra que
 * no decía qué se editaba): actividad, tarea, puesto y lugar de TODOS sus
 * riesgos en una operación (`bulkPatchMiperEntries`). Es el par de «Nueva tarea». Si
 * cambia el nombre, la tarea cambia de clave (`taskKeyOf`): al terminar se
 * navega con REPLACE a la nueva, porque la vieja ya no existe y «atrás» no debe
 * llevar a «Esta tarea ya no existe». Las filas se actualizan en pantalla antes
 * de navegar: la promesa de la acción se resuelve antes de que llegue la foto.
 */
export function TaskContextDialog({ task, context, onOpenChange }: { task: TaskNode; context: BulkContext; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const [draft, setDraft] = useState<Record<ContextField, string>>(() => ({
    activity: task.activity ?? "", task: task.task ?? "", position: shared(task, "position") ?? "", location: shared(task, "location") ?? "",
  }))
  const operation = useOperation()
  const values = contextChanges(task, draft)
  const changed = Object.keys(values).length > 0
  const over = task.entries.length > MIPER_BULK_LIMIT
  const ready = changed && draft.activity.trim() !== "" && draft.task.trim() !== "" && !over
  const impact = changed ? impactSummary(newlyIncomplete(task.entries, task.entries.map((entry) => applyEntryValues(entry, values, context.riskFactors)))) : null
  const apply = () => operation.run(async () => {
    const items = await entryItems(context.sync, task.entries)
    if (!items) return MISSING_VERSION
    return bulkPatchMiperEntriesAction({ matrixId: context.matrixId, items, values })
  }, (result) => {
    settlePatchedEntries(context, result.data, values)
    toast.success(`Tarea actualizada (${countOf(task.entries.length, "riesgo", "riesgos")})`)
    onOpenChange(false)
    const nextKey = taskKeyOf({ activity: values.activity ?? task.activity, task: values.task ?? task.task })
    if (nextKey !== task.key) navigateWorkspace(hrefToTask(pathname, params, nextKey), "replace")
  })
  const helper = (key: ContextField) => {
    const noun = NOUN[key]
    if (!noun) return undefined
    return shared(task, key) === null
      ? `Hoy los riesgos tienen distintos ${noun[1]}. Si lo dejas vacío, cada uno conserva el suyo.`
      : `Si lo dejas vacío, cada riesgo conserva su ${noun[0]} actual.`
  }
  const field = (key: ContextField, label: string, list: keyof BulkContext["dictionaries"], required: boolean) => (
    <Field label={label} htmlFor={`miper-context-${key}`} required={required} helper={helper(key)}>
      <Combobox id={`miper-context-${key}`} allowCustomValue options={context.dictionaries[list].map((value) => ({ value, label: value }))} value={draft[key]}
        disabled={operation.pending} placeholder={shared(task, key) === null ? "Varios" : "Escribe o elige…"} onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} />
    </Field>
  )
  return (
    <BulkDialog open onOpenChange={onOpenChange} title="Editar tarea"
      description={`Cambia el nombre o la actividad de «${task.label}», o el puesto y el lugar de ${task.entries.length === 1 ? "su riesgo" : `sus ${countOf(task.entries.length, "riesgo", "riesgos")}`}. La evaluación y las medidas de cada riesgo no cambian.`}
      impact={impact} error={operation.message} busy={operation.pending} confirmLabel="Guardar cambios" confirmDisabled={!ready} onConfirm={apply}>
      <div className="grid gap-3 md:grid-cols-2">
        {field("activity", "Actividad", "activities", true)}
        {field("task", "Tarea", "tasks", true)}
        {field("position", "Puesto de trabajo", "positions", false)}
        {field("location", "Lugar específico", "locations", false)}
      </div>
      {over && <p role="status" className="text-sm text-[var(--color-warning-ink)]">Esta tarea tiene {task.entries.length} riesgos y se editan de a {MIPER_BULK_LIMIT} como máximo. Muévelos por partes desde la matriz filtrada.</p>}
    </BulkDialog>
  )
}

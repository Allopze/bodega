"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { useOperation } from "@/lib/hooks/use-operation"
import { CONTROLLED_STATUS_LABEL, type ControlledStatus } from "@/lib/prevention/miper/snapshot"
import { deleteMiperControlAction } from "../../actions"
import { ControlCard } from "../control-card"
import { ControlForm } from "../control-form"
import type { StepProps } from "./types"

const CONTROLLED = (["yes", "partial", "no"] as const).map((value) => ({ value, title: CONTROLLED_STATUS_LABEL[value] }))

export function MeasuresStep({ entry, data, editable, autosave, issues }: StepProps) {
  const [editing, setEditing] = useState<string | "new" | null>(null)
  // Guardar y borrar una medida ya revalidan la página desde la acción
  // (`saveMiperControlAction`, `deleteMiperControlAction`): la foto nueva llega
  // con su respuesta. Un `router.refresh()` encima era un segundo viaje RSC.
  const deletion = useOperation({ feedback: "toast" })
  const done = () => setEditing(null)
  const controlMessages = issues.filter((issue) => issue.severity === "error" && ["controlledStatus", "controls", "dueDate", "responsible", "description"].includes(issue.field))
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-labelledby={`${entry.id}-h-controlado`}>
        <h3 id={`${entry.id}-h-controlado`} className="text-sm font-semibold">¿Está controlado el riesgo?</h3>
        <ChoiceCardGroup label="¿Está controlado el riesgo?" options={CONTROLLED} value={entry.controlledStatus} disabled={!editable}
          onChange={(value: ControlledStatus) => { void autosave.commit(entry, { controlledStatus: value }) }} />
        {autosave.fieldError(entry.id, "controlledStatus") && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{autosave.fieldError(entry.id, "controlledStatus")}</p>}
      </section>
      <section className="space-y-2" aria-labelledby={`${entry.id}-h-medidas`}>
        <h3 id={`${entry.id}-h-medidas`} className="text-sm font-semibold">Medidas de control ({entry.controls.length})</h3>
        {controlMessages.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
            {[...new Set(controlMessages.map((issue) => issue.message))].map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}
        {entry.controls.map((control) => editing === control.id ? (
          <ControlForm key={control.id} matrixId={data.matrixId} entryId={entry.id} control={control} controlVersion={data.controlVersions[control.id]} responsibleOptions={data.responsibleOptions} measureSuggestions={data.dictionaries.measures} onDone={done} onCancel={() => setEditing(null)} />
        ) : (
          <ControlCard key={control.id} control={control} editable={editable} deleting={deletion.pending}
            linkedActionNumbers={data.controlActionLinks.filter((link) => link.controlId === control.id).map((link) => link.actionNumber)}
            verifyHref={data.published ? `/prevencion/miper/controles/${control.id}` : null}
            onEdit={() => setEditing(control.id)}
            onDelete={() => deletion.run(() => deleteMiperControlAction({ matrixId: data.matrixId, controlId: control.id, expectedVersion: data.controlVersions[control.id]! }))} />
        ))}
        {editable && (editing === "new"
          ? <ControlForm matrixId={data.matrixId} entryId={entry.id} control={null} controlVersion={undefined} responsibleOptions={data.responsibleOptions} measureSuggestions={data.dictionaries.measures} onDone={done} onCancel={() => setEditing(null)} />
          : <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>Agregar medida</Button>)}
        {!editable && entry.controls.length === 0 && <p className="text-sm text-[var(--color-text-subtle)]">Sin medidas de control.</p>}
      </section>
    </div>
  )
}

"use client"

import { useState } from "react"
import Link from "next/link"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { CLASSIFICATION_CRITERIA } from "@/lib/prevention/miper/methodology"
import {
  CONTROL_HIERARCHY_LABEL,
  CONTROLLED_STATUS_LABEL,
  ENTRY_FIELD_LABEL,
  type ControlHierarchy,
  type EntryChange,
  type MiperControlSnapshot,
  type MiperEntrySnapshot,
  type MiperSnapshot,
} from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { formatDate } from "@/lib/utils"
import { addMiperObservationAction, deleteMiperControlAction, saveMiperControlAction } from "../actions"
import { ObservationItem } from "./observation-item"

export type EntrySheetProps = {
  workspace: MiperWorkspace
  entry: MiperEntrySnapshot | null
  baseline: MiperSnapshot | null
  change: EntryChange | null
  mode: WorkspaceMode
  userId: string
  onClose: () => void
  onChanged: () => void
}

/** El `<select>` nativo conserva el contrato visual de un `Input` de la casa. */
const SELECT_CLASS = "h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-control)] bg-[var(--color-surface)] px-[10px] py-1.5 font-sans text-base text-[var(--color-text)] sm:h-[34px] sm:text-xs"

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Rutinaria" : "No rutinaria"
  if (value === "yes" || value === "partial" || value === "no") return CONTROLLED_STATUS_LABEL[value]
  return String(value)
}

function ControlEditor({ workspace, entryId, control, onDone }: { workspace: MiperWorkspace; entryId: string; control: MiperControlSnapshot | null; onDone: () => void }) {
  const [hierarchy, setHierarchy] = useState<ControlHierarchy>(control?.hierarchy ?? "administrative")
  const [description, setDescription] = useState(control?.description ?? "")
  const [responsibleUserId, setResponsibleUserId] = useState(control?.responsibleUserId ?? "")
  const [responsibleName, setResponsibleName] = useState(control?.responsibleUserId ? "" : control?.responsibleName ?? "")
  const [dueDate, setDueDate] = useState(control?.dueDate ?? "")
  const operation = useOperation({ feedback: "toast", onSuccess: onDone })
  const matrixId = workspace.matrix.id
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? workspace.controlVersions[control.id] : undefined,
    values: { hierarchy, description, responsibleUserId: responsibleUserId || null, responsibleName: responsibleUserId ? null : responsibleName || null, dueDate: dueDate || null },
  }))
  return (
    <div className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:grid-cols-2">
      <Field label="Tipo de control (jerarquía)" required>
        <select aria-label="Tipo de control" className={SELECT_CLASS} value={hierarchy} onChange={(event) => setHierarchy(event.target.value as ControlHierarchy)}>
          {Object.entries(CONTROL_HIERARCHY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Plazo" required><DatePicker ariaLabel="Plazo de la medida" value={dueDate || undefined} onChange={setDueDate} /></Field>
      <Field label="Medida de control" required className="md:col-span-2">
        <Input aria-label="Descripción de la medida" list="miper-list-measures" value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label="Responsable (persona de la faena)">
        <select aria-label="Responsable de la medida" className={SELECT_CLASS} value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)}>
          <option value="">Otra persona o cargo…</option>
          {workspace.responsibleOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </Field>
      {!responsibleUserId && <Field label="Responsable (nombre o cargo)"><Input aria-label="Nombre o cargo responsable" value={responsibleName} onChange={(event) => setResponsibleName(event.target.value)} placeholder="Supervisor de turno" /></Field>}
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" disabled={operation.pending || description.trim().length < 3} onClick={save}>{control ? "Guardar medida" : "Agregar medida"}</Button>
        {control && <Button size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => deleteMiperControlAction({ matrixId, controlId: control.id, expectedVersion: workspace.controlVersions[control.id] }))}>Eliminar medida</Button>}
      </div>
    </div>
  )
}

export function EntrySheet({ workspace, entry, baseline, change, mode, userId: _userId, onClose, onChanged }: EntrySheetProps) {
  const [observation, setObservation] = useState("")
  const [editingControl, setEditingControl] = useState<string | "new" | null>(null)
  const operation = useOperation({ feedback: "toast", onSuccess: onChanged })
  const editable = mode.canEdit && !(mode.canReviewTechnical || mode.canApproveLegal)
  // Radix no necesita montaje previo para animar su salida: sin fila, no hay ficha.
  if (!entry) return null
  const before = baseline?.entries.find((item) => item.id === entry.id) ?? null
  const observations = workspace.observations.filter((item) => item.entryId === entry.id)
  const fields: Array<[string, unknown]> = [
    ["activity", entry.activity], ["task", entry.task], ["position", entry.position], ["location", entry.location],
    ["exposedFemale", entry.exposedFemale], ["exposedMale", entry.exposedMale], ["exposedOther", entry.exposedOther],
    ["riskFactor", entry.riskFactor], ["isRoutine", entry.isRoutine], ["hazard", entry.hazard], ["risk", entry.risk],
    ["probableDamage", entry.probableDamage], ["probability", entry.probability], ["consequence", entry.consequence], ["controlledStatus", entry.controlledStatus],
  ]
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <div className="min-w-0">
            <SheetTitle>Riesgo #{entry.rowNumber}</SheetTitle>
            <SheetDescription>{entry.hazard ?? "Peligro sin describir"} → {entry.risk ?? "riesgo sin describir"}</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody className="space-y-6">
          <div className="flex flex-wrap items-center gap-2"><RiskClassificationBadge classification={entry.classification} magnitude={entry.magnitude} /></div>
          {entry.classification && (entry.classification === "important" || entry.classification === "intolerable") && (
            <p role="note" className="rounded-lg bg-[var(--color-danger-tint)] p-3 text-sm text-[var(--color-danger-ink)]">{CLASSIFICATION_CRITERIA[entry.classification]}</p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {fields.map(([key, value]) => <div key={key}><dt className="text-xs text-[var(--color-text-subtle)]">{ENTRY_FIELD_LABEL[key]}</dt><dd>{display(value)}</dd></div>)}
          </dl>

          {change && change.kind !== "removed" && (
            <section aria-label="Cambios respecto de la revisión anterior">
              <h3 className="text-sm font-semibold">{change.kind === "added" ? "Riesgo nuevo en esta ronda" : "Cambios respecto de la revisión anterior"}</h3>
              {change.kind === "modified" && (
                <ul className="mt-2 space-y-1 text-sm">
                  {change.fields.filter((field) => field !== "controls").map((field) => (
                    <li key={field}><span className="font-medium">{ENTRY_FIELD_LABEL[field]}:</span> <del className="text-[var(--color-text-subtle)]">{display(before?.[field as keyof MiperEntrySnapshot])}</del> → <ins className="no-underline">{display(entry[field as keyof MiperEntrySnapshot])}</ins></li>
                  ))}
                  {change.fields.includes("controls") && (
                    <li><span className="font-medium">Medidas de control:</span> antes {before?.controls.map((control) => control.description).join("; ") || "ninguna"} → ahora {entry.controls.map((control) => control.description).join("; ") || "ninguna"}</li>
                  )}
                </ul>
              )}
            </section>
          )}

          <section aria-label="Medidas de control" className="space-y-2">
            <h3 className="text-sm font-semibold">Medidas de control ({entry.controls.length})</h3>
            {entry.controls.length === 0 && <p className="text-sm text-[var(--color-text-subtle)]">Sin medidas. {entry.classification === "important" || entry.classification === "intolerable" ? "Este riesgo exige al menos una, con responsable y plazo." : ""}</p>}
            {entry.controls.map((control) => editingControl === control.id
              ? <ControlEditor key={control.id} workspace={workspace} entryId={entry.id} control={control} onDone={() => { setEditingControl(null); onChanged() }} />
              : (
                <div key={control.id} className="flex items-start justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
                  <div>
                    <p className="font-medium">{CONTROL_HIERARCHY_LABEL[control.hierarchy]}</p>
                    <p>{control.description}</p>
                    <p className="text-xs text-[var(--color-text-subtle)]">Responsable: {control.responsibleName ?? "sin asignar"} · Plazo: {control.dueDate ? formatDate(control.dueDate) : "sin plazo"}</p>
                    {workspace.matrix.status === "published" && <Link className="text-xs underline" href={`/prevencion/miper/controles/${control.id}`}>Verificar eficacia del control</Link>}
                  </div>
                  {editable && <Button size="sm" variant="secondary" onClick={() => setEditingControl(control.id)}>Editar</Button>}
                </div>
              ))}
            {editable && (editingControl === "new"
              ? <ControlEditor workspace={workspace} entryId={entry.id} control={null} onDone={() => { setEditingControl(null); onChanged() }} />
              : <Button size="sm" onClick={() => setEditingControl("new")}>Agregar medida</Button>)}
            <datalist id="miper-list-measures">{workspace.dictionaries.measures.map((value) => <option key={value} value={value} />)}</datalist>
          </section>

          <section aria-label="Observaciones del riesgo" className="space-y-2">
            <h3 className="text-sm font-semibold">Observaciones ({observations.length})</h3>
            {observations.map((item) => <ObservationItem key={item.id} observation={item} mode={mode} onChanged={onChanged} />)}
            {mode.canObserve && (
              <div className="space-y-2">
                <Textarea aria-label="Nueva observación" value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Ej.: Revisar consecuencia. De acuerdo con el daño probable indicado debería evaluarse nuevamente la severidad." />
                <Button size="sm" disabled={operation.pending || observation.trim().length < 5} onClick={() => operation.run(() => addMiperObservationAction({ matrixId: workspace.matrix.id, entryId: entry.id, body: observation }), () => setObservation(""))}>Registrar observación</Button>
              </div>
            )}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

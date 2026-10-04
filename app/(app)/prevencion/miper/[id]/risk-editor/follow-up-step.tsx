"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { CONTROLLED_STATUS_LABEL, ENTRY_FIELD_LABEL, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { CLASSIFICATION_LABEL, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { hrefToActivity } from "@/lib/prevention/miper/workspace-url"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import { addMiperObservationAction } from "../../actions"
import { ObservationItem } from "../observation-item"
import { WorkspaceLink } from "../workspace-nav"
import type { RiskEditorData } from "./types"

function display(value: unknown, field?: string) {
  if (value === null || value === undefined || value === "") return "—"
  if (field === "classification" && typeof value === "string" && value in CLASSIFICATION_LABEL) return CLASSIFICATION_LABEL[value as RiskClassification]
  if (typeof value === "boolean") return value ? "Rutinaria" : "No rutinaria"
  if (value === "yes" || value === "partial" || value === "no") return CONTROLLED_STATUS_LABEL[value]
  return String(value)
}

export function FollowUpStep({ entry, data, mode, change, baselineEntry, issues }: { issues: CompletenessIssue[]; entry: MiperEntrySnapshot; data: RiskEditorData; mode: WorkspaceMode; change: EntryChange | null; baselineEntry: MiperEntrySnapshot | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [observation, setObservation] = useState("")
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const controlIds = new Set(entry.controls.map((control) => control.id))
  const activities = data.controlActionLinks.filter((link) => controlIds.has(link.controlId)).filter((link, index, all) => all.findIndex((other) => other.actionId === link.actionId) === index)
  const programMessage = issues.find((issue) => issue.severity === "error" && issue.field === "programLink")?.message
  const observations = data.observations.filter((item) => item.entryId === entry.id)
  return (
    <div className="space-y-6">
      <section aria-label="Programa de Trabajo del riesgo" className="space-y-2">
        <h3 className="text-sm font-semibold">Actividades del plan de medidas ({activities.length})</h3>
        <p className="text-sm text-[var(--color-text-subtle)]">Abre una actividad para consultar sus ejecuciones programadas y registrar lo realizado.</p>
        {programMessage && <p className="rounded-lg bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">{programMessage}</p>}
        {activities.length === 0
          ? <p className="text-sm text-[var(--color-text-subtle)]">Ninguna medida de este riesgo está programada todavía. <WorkspaceLink className="underline" href={`/prevencion/miper/${data.matrixId}?tab=programa`}>Ir al plan de medidas</WorkspaceLink></p>
          : <ul className="space-y-1 text-sm">{activities.map((activity) => <li key={activity.actionId}><WorkspaceLink className="text-[var(--color-primary-ink)] underline" href={hrefToActivity(pathname, params, activity.actionId)}>Actividad #{activity.actionNumber}: {activity.description}</WorkspaceLink></li>)}</ul>}
      </section>
      <section aria-label="Observaciones del riesgo" className="space-y-2">
        <h3 className="text-sm font-semibold">Observaciones de revisión ({observations.length})</h3>
        <p className="text-sm text-[var(--color-text-subtle)]">Aquí se registran y responden las correcciones solicitadas durante la revisión del documento.</p>
        {observations.map((item) => <ObservationItem key={item.id} observation={item} mode={mode} onChanged={() => router.refresh()} />)}
        {mode.canObserve && (
          <div className="space-y-2">
            {/* El mínimo que exige el botón, a la vista (A2, fila 10). El rótulo visible es el nombre accesible. */}
            <Field label="Nueva observación" htmlFor={`${entry.id}-observacion`} helper="Mínimo 5 caracteres.">
              <Textarea id={`${entry.id}-observacion`} value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Ej.: Revisar consecuencia. De acuerdo con el daño probable debería evaluarse nuevamente la severidad." />
            </Field>
            <Button size="sm" disabled={operation.pending || observation.trim().length < 5} onClick={() => operation.run(() => addMiperObservationAction({ matrixId: data.matrixId, entryId: entry.id, body: observation }), () => setObservation(""))}>Registrar observación</Button>
          </div>
        )}
      </section>
      {change && change.kind !== "removed" && (
        <section aria-labelledby={`${entry.id}-h-cambios`} className="space-y-2">
          <h3 id={`${entry.id}-h-cambios`} className="text-sm font-semibold">{change.kind === "added" ? "Riesgo nuevo en esta ronda" : "Cambios respecto de la revisión anterior"}</h3>
          {change.kind === "modified" && (
            <ul className="space-y-1 text-sm">
              {change.fields.filter((field) => field !== "controls").map((field) => (
                <li key={field}><span className="font-medium">{ENTRY_FIELD_LABEL[field]}:</span> <del className="text-[var(--color-text-subtle)]">{display(baselineEntry?.[field as keyof MiperEntrySnapshot], field)}</del> → <ins className="no-underline">{display(entry[field as keyof MiperEntrySnapshot], field)}</ins></li>
              ))}
              {change.fields.includes("controls") && <li><span className="font-medium">Medidas de control:</span> antes {baselineEntry?.controls.map((control) => control.description).join("; ") || "ninguna"} → ahora {entry.controls.map((control) => control.description).join("; ") || "ninguna"}</li>}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

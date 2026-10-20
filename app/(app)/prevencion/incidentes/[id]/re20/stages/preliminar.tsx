"use client"

import { RE20_ATTACHMENT_LIMITS } from "@/lib/prevention/re20-attachment-limits"
import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { INCIDENT_EVENT_LABELS } from "@/lib/prevention/incidents"
import { RE20_IMMEDIATE_ACTIONS, RE20_POTENTIAL_VALUES } from "@/lib/services/prevention-incident-re20-schema"
import { formatDateTime, todayInChile } from "@/lib/utils"
import type { Re20StageModule, Re20StageProgress, Re20StageProps } from "../stages"
import type { Re20WorkspaceApi } from "../use-re20-workspace"
import { newRe20Id, withRe20TaskStatus } from "../workspace-data"
import {
  Re20AttachmentList,
  Re20AttachmentPicker,
  Re20Block,
  Re20CatalogSelect,
  Re20Date,
  Re20Fact,
  Re20Text,
  Re20TextArea,
} from "../fields"

/* Etapa 1 — Aviso y preliminar (RE-20-02, hoja INV.PRE.ACC).
 *
 * EJEMPLO DE REFERENCIA para las demás etapas:
 * - Los campos se agrupan en `Re20Block` plegables con un resumen.
 * - Cada campo usa una primitiva de `../fields` con un id `re20-preliminar-<campo>`.
 * - `progress()` enumera lo obligatorio con el MISMO id, para que «Falta…» salte al campo.
 * - Lo que viene del reporte inicial (lugar, fecha, tipo) se muestra, no se vuelve a pedir.
 * - Cerrar la etapa marca sus tareas del protocolo y guarda.
 */

const ID = (field: string) => `re20-preliminar-${field}`

type ImmediateActionKey = (typeof RE20_IMMEDIATE_ACTIONS)[number]

const IMMEDIATE_ACTION_LABELS: Record<ImmediateActionKey, string> = {
  firstAid: "Primeros auxilios o derivación asistencial",
  isolation: "Aislamiento del área",
  suspension: "Suspensión de la tarea o faena",
  evidencePreservation: "Preservación de evidencias",
  supervisorNotice: "Aviso a jefatura y Prevención de Riesgos",
  committeeNotice: "Aviso al Comité Paritario",
  administratorNotice: "Aviso al organismo administrador",
  authorityNotice: "Aviso a la autoridad (accidente grave o fatal)",
}

const PHOTO_ORIGIN = "Informe preliminar"

/** Hubo persona lesionada: la zona del cuerpo y el elemento pasan a ser obligatorios. */
function hasInjury(ws: Pick<Re20WorkspaceApi, "incident">) {
  return ["work_accident", "commute_accident"].includes(ws.incident.eventType)
    || !["none", "low", ""].includes(ws.incident.actualSeverity ?? "")
}

const filled = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined

function progress(ws: Re20WorkspaceApi): Re20StageProgress {
  const p = ws.data.preliminary
  const actions = p.immediateActions ?? {}
  const marked = RE20_IMMEDIATE_ACTIONS.filter((key) => actions[key]?.marked)
  const checks: Array<{ ok: boolean; label: string; fieldId: string }> = [
    { ok: filled(p.managerName), label: "Jefatura a cargo", fieldId: ID("managerName") },
    { ok: filled(p.reportDate), label: "Fecha del informe", fieldId: ID("reportDate") },
    { ok: filled(ws.data.nearMiss.potential), label: "Potencial del evento", fieldId: ID("potential") },
    { ok: filled(p.eventDescription), label: "Descripción de lo ocurrido", fieldId: ID("eventDescription") },
    ...(hasInjury(ws) ? [
      { ok: filled(p.bodyZone), label: "Parte del cuerpo lesionada", fieldId: ID("bodyZone") },
      { ok: filled(p.injuryElement), label: "Elemento que provocó la lesión", fieldId: ID("injuryElement") },
    ] : []),
    { ok: filled(p.hazardSource), label: "Peligro o fuente", fieldId: ID("hazardSource") },
    { ok: filled(p.temperature), label: "Temperatura", fieldId: ID("temperature") },
    { ok: filled(p.weather), label: "Clima", fieldId: ID("weather") },
    { ok: filled(p.shiftSystem), label: "Sistema de turnos", fieldId: ID("shiftSystem") },
    { ok: filled(p.deviation), label: "Desviaciones que generaron el evento", fieldId: ID("deviation") },
    { ok: marked.length > 0, label: "Al menos una acción inmediata", fieldId: ID("immediateActions") },
    ...marked.filter((key) => !filled(actions[key]?.responsible)).map((key) => ({
      ok: false, label: `Responsable de «${IMMEDIATE_ACTION_LABELS[key]}»`, fieldId: ID(`action-${key}-responsible`),
    })),
    { ok: filled(p.proposedMeasures?.[0]), label: "Una medida para que no se repita", fieldId: ID("proposedMeasure-0") },
  ]
  return {
    done: checks.filter((check) => check.ok).length,
    total: checks.length,
    missing: checks.filter((check) => !check.ok).map(({ label, fieldId }) => ({ label, fieldId })),
  }
}

/** «2 de 4» o el primer dato ya escrito: lo que se ve con el bloque cerrado. */
function countSummary(values: unknown[]) {
  const count = values.filter(filled).length
  return count === values.length ? "Completo" : `${count} de ${values.length}`
}

function PreliminarStage({ ws, stage }: Re20StageProps) {
  const p = ws.data.preliminary
  const actions = p.immediateActions ?? {}
  const injury = hasInjury(ws)
  const preliminaryTask = ws.task("preliminary_report")
  const done = preliminaryTask.status === "completed"
  const photos = ws.data.evidences.filter((item) => item.origin === PHOTO_ORIGIN && item.attachmentId)
  const markedCount = RE20_IMMEDIATE_ACTIONS.filter((key) => actions[key]?.marked).length
  const set = (field: string) => (value: unknown) => ws.patch(["preliminary", field], value)

  function finish() {
    // Marca las tareas del protocolo y guarda en un solo paso (ver `ws.save(apply)`).
    void ws.save((data) => withRe20TaskStatus(withRe20TaskStatus(data, "notify", "completed"), "preliminary_report", "completed"))
  }

  return (
    <div className="space-y-2">
      {done && (
        <Callout tone="success" icon={<CheckCircle weight="fill" className="size-4" />} title="Informe preliminar terminado">
          <p>
            Se cerró el <span className="font-mono tabular-nums">{preliminaryTask.completedAt ? formatDateTime(preliminaryTask.completedAt) : "—"}</span>.
            Desde ahí corren los plazos de la entrevista y del informe definitivo.
          </p>
          {!ws.readOnly && (
            <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => ws.setTaskStatus("preliminary_report", "in_progress")}>
              Reabrir para corregir
            </Button>
          )}
        </Callout>
      )}

      <div>
        <Re20Block id={ID("block-header")} title="Datos del informe" summary={countSummary([p.managerName, p.reportDate, p.subManagement, p.area])} complete={filled(p.managerName) && filled(p.reportDate)} defaultOpen={!filled(p.managerName)}>
          <div className="grid gap-4 md:grid-cols-2">
            <Re20Text id={ID("managerName")} label="Jefatura a cargo" required value={p.managerName} onChange={set("managerName")} maxLength={300} />
            <Re20Date id={ID("reportDate")} label="Fecha del informe" required value={p.reportDate} onChange={set("reportDate")} max={todayInChile()} />
            <Re20Text id={ID("subManagement")} label="Subgerencia" value={p.subManagement} onChange={set("subManagement")} maxLength={300} />
            <Re20Text id={ID("area")} label="Área o taller" value={p.area} onChange={set("area")} maxLength={300} />
          </div>
        </Re20Block>

        <Re20Block id={ID("block-event")} title="Qué pasó" summary={p.eventDescription?.trim() ? p.eventDescription : "Falta la descripción"} complete={filled(p.eventDescription) && filled(ws.data.nearMiss.potential)} defaultOpen={!filled(p.eventDescription)}>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Re20Fact label="Tipo de evento" value={INCIDENT_EVENT_LABELS[ws.incident.eventType] ?? "Otro evento"} />
            <Re20Fact label="Fecha y hora" value={formatDateTime(ws.incident.occurredAt)} mono />
            <Re20Fact label="Lugar exacto" value={ws.incident.location || "—"} />
          </dl>
          <p className="text-xs text-[var(--color-text-subtle)]">Estos datos vienen del reporte inicial. Si están mal, corrígelos en el reporte.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Potencial del evento" htmlFor={ID("potential")} required helper="Con potencial «Grave o fatal» el árbol de causas es obligatorio.">
              <OptionSelect
                id={ID("potential")}
                options={RE20_POTENTIAL_VALUES.map((value) => ({ value, label: value }))}
                value={ws.data.nearMiss.potential ?? ""}
                onValueChange={(value) => ws.patch("nearMiss.potential", value || null)}
                emptyLabel="Sin indicar"
                placeholder="Elige el potencial"
              />
            </Field>
            <Re20CatalogSelect id={ID("activity")} label="Actividad que se realizaba" category="activity" value={p.activity} onChange={set("activity")} />
          </div>
          <Re20TextArea id={ID("eventDescription")} label="Descripción de lo ocurrido" required rows={5} value={p.eventDescription} onChange={set("eventDescription")} maxLength={10000} helper="Cuenta los hechos en orden, sin juicios ni culpables." />
        </Re20Block>

        <Re20Block id={ID("block-people")} title="Personas involucradas" summary={ws.involvedPeople.length === 0 ? "Sin personas en el reporte" : ws.involvedPeople.map((person) => person.displayLabel).join(", ")}>
          {ws.involvedPeople.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">El reporte inicial no registró personas. Si hubo alguien lesionado o involucrado, agrégalo en el reporte del incidente.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {ws.involvedPeople.map((person) => (
                <li key={person.id} className="py-2.5 text-sm">
                  <p className="font-medium text-[var(--color-text)]">{person.displayLabel}</p>
                  {person.employerName && <p className="text-xs text-[var(--color-text-muted)]">{person.employerName}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-[var(--color-text-subtle)]">Nombre completo, RUT y cargo son datos reservados: se registran en la ficha de cada persona, no aquí.</p>
        </Re20Block>

        <Re20Block id={ID("block-injury")} title="Lesión" summary={injury ? countSummary([p.bodyZone, p.injuryElement]) : "Sin persona lesionada"} complete={!injury || (filled(p.bodyZone) && filled(p.injuryElement))}>
          <div className="grid gap-4 md:grid-cols-2">
            <Re20CatalogSelect id={ID("bodyZone")} label="Parte del cuerpo lesionada" category="body_zone" required={injury} value={p.bodyZone} onChange={set("bodyZone")} />
            <Re20Text id={ID("injuryElement")} label="Qué elemento provocó la lesión" required={injury} value={p.injuryElement} onChange={set("injuryElement")} maxLength={500} placeholder="Por ejemplo: borde del contenedor" />
          </div>
          <Re20TextArea id={ID("injuryDescription")} label="Descripción general de la lesión" rows={2} value={p.injuryDescription} onChange={set("injuryDescription")} maxLength={2000} helper="Sin diagnósticos: el detalle clínico va en los datos reservados." />
        </Re20Block>

        <Re20Block id={ID("block-conditions")} title="Turno y condiciones del lugar" summary={countSummary([p.hazardSource, p.temperature, p.weather, p.shiftSystem])} complete={[p.hazardSource, p.temperature, p.weather, p.shiftSystem].every(filled)}>
          <div className="grid gap-4 md:grid-cols-2">
            <Re20Text id={ID("shiftEntryTime")} label="Hora de ingreso al turno" type="time" value={p.shiftEntryTime} onChange={set("shiftEntryTime")} />
            <Re20Text id={ID("shiftExitTime")} label="Hora de salida del turno" type="time" value={p.shiftExitTime} onChange={set("shiftExitTime")} />
            <Re20CatalogSelect id={ID("hazardSource")} label="Peligro o fuente" category="physical_conditions" required value={p.hazardSource} onChange={set("hazardSource")} />
            <Re20Text id={ID("hazardSourceOther")} label="Otro peligro o fuente" value={p.hazardSourceOther} onChange={set("hazardSourceOther")} maxLength={300} helper="Sólo si no está en la lista." />
            <Re20CatalogSelect id={ID("temperature")} label="Temperatura" category="temperature" required value={p.temperature} onChange={set("temperature")} />
            <Re20CatalogSelect id={ID("weather")} label="Clima" category="weather" required value={p.weather} onChange={set("weather")} />
            <Re20CatalogSelect id={ID("shiftSystem")} label="Sistema de turnos" category="shift_system" required value={p.shiftSystem} onChange={set("shiftSystem")} />
          </div>
        </Re20Block>

        <Re20Block id={ID("block-deviation")} title="Desviaciones" summary={p.deviation?.trim() ? p.deviation : "Falta describirlas"} complete={filled(p.deviation)}>
          <Re20TextArea id={ID("deviation")} label="Qué desviaciones en procedimientos, equipos o entorno generaron el evento" required rows={4} value={p.deviation} onChange={set("deviation")} maxLength={5000} />
        </Re20Block>

        <Re20Block id={ID("block-photo")} title="Fotografía" summary={photos.length === 0 ? "Sin fotografías" : `${photos.length} ${photos.length === 1 ? "fotografía" : "fotografías"}`} complete={photos.length > 0}>
          <Re20AttachmentList
            ids={photos.map((item) => item.attachmentId as string)}
            emptyText="Aún no hay fotografías del lugar."
            onRemove={(attachmentId) => {
              ws.update((data) => ({ ...data, evidences: data.evidences.filter((item) => item.attachmentId !== attachmentId) }))
              ws.removeAttachment(attachmentId)
            }}
          />
          <Re20AttachmentPicker
            id={ID("photo")}
            label="Agregar fotografía"
            capture="environment"
            accept={RE20_ATTACHMENT_LIMITS.allowedMimeTypes.filter((type) => type.startsWith("image/"))}
            onAdded={(items) => ws.update((data) => ({
              ...data,
              evidences: [...data.evidences, ...items.map((item) => ({
                id: newRe20Id("evidence"),
                type: "Fotografía o video",
                description: `Fotografía del lugar: ${item.fileName}`,
                origin: PHOTO_ORIGIN,
                date: todayInChile(),
                custody: null,
                attachmentId: item.id,
              }))],
            }))}
          />
        </Re20Block>

        <Re20Block id={ID("block-actions")} title="Acciones inmediatas" summary={markedCount === 0 ? "Ninguna marcada" : `${markedCount} de ${RE20_IMMEDIATE_ACTIONS.length} realizadas`} complete={progress(ws).missing.every((item) => !item.fieldId.startsWith(ID("action")) && item.fieldId !== ID("immediateActions"))} defaultOpen={markedCount === 0}>
          <fieldset id={ID("immediateActions")} className="space-y-1">
            <legend className="mb-2 text-sm font-medium text-[var(--color-text)]">Marca lo que se hizo y quién lo hizo</legend>
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {RE20_IMMEDIATE_ACTIONS.map((key) => {
                const action = actions[key]
                const marked = action?.marked === true
                return (
                  <li key={key} className="grid min-h-11 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:items-center">
                    <Checkbox
                      id={ID(`action-${key}`)}
                      label={IMMEDIATE_ACTION_LABELS[key]}
                      checked={marked}
                      onChange={(event) => ws.patch(["preliminary", "immediateActions", key, "marked"], event.target.checked)}
                      className="size-5"
                    />
                    {marked && (
                      <Re20Text
                        id={ID(`action-${key}-responsible`)}
                        label="Responsable"
                        value={action?.responsible}
                        onChange={(value) => ws.patch(["preliminary", "immediateActions", key, "responsible"], value)}
                        maxLength={300}
                        placeholder="Nombre o cargo"
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </fieldset>
          <Re20TextArea id={ID("immediateActionsDetail")} label="Detalle de las acciones" rows={3} value={p.immediateActionsDetail} onChange={set("immediateActionsDetail")} maxLength={5000} />
        </Re20Block>

        <Re20Block id={ID("block-measures")} title="Medidas propuestas" summary={countSummary([p.proposedMeasures?.[0], p.proposedMeasures?.[1]])} complete={filled(p.proposedMeasures?.[0])}>
          <p className="text-sm text-[var(--color-text-muted)]">¿Qué crees que se debería hacer para que no vuelva a ocurrir?</p>
          {[0, 1].map((index) => (
            <Re20TextArea
              key={index}
              id={ID(`proposedMeasure-${index}`)}
              label={`Medida ${index + 1}`}
              required={index === 0}
              rows={2}
              value={p.proposedMeasures?.[index]}
              maxLength={2000}
              onChange={(value) => ws.update((data) => {
                const measures = [...(data.preliminary.proposedMeasures ?? [])]
                measures[index] = value
                // El esquema no admite huecos: se guardan sólo las medidas escritas, en orden.
                return { ...data, preliminary: { ...data.preliminary, proposedMeasures: [measures[0] ?? "", measures[1] ?? ""].slice(0, measures[1] ? 2 : 1) } }
              })}
            />
          ))}
        </Re20Block>
      </div>

      {!ws.readOnly && !done && (
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <Button type="button" onClick={finish} disabled={stage.progress.missing.length > 0 || ws.saving} loading={ws.saving}>
            Terminar el informe preliminar
          </Button>
          <p className="text-xs text-[var(--color-text-muted)]">
            {stage.progress.missing.length > 0
              ? `Faltan ${stage.progress.missing.length} ${stage.progress.missing.length === 1 ? "dato" : "datos"} para terminarlo.`
              : "Se guardará y empezarán a correr los plazos de la etapa siguiente."}
          </p>
        </div>
      )}
    </div>
  )
}

export const preliminarStage: Re20StageModule = { Component: PreliminarStage, progress }

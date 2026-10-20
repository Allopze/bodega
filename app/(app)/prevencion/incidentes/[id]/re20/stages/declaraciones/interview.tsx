"use client"

import { INCIDENT_EVENT_LABELS } from "@/lib/prevention/incidents"
import { formatDateTime, todayInChile } from "@/lib/utils"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { Re20Block, Re20Date, Re20Fact, Re20PersonPicker, Re20Text, Re20TextArea, Re20YesNo } from "../../fields"
import { filled, interviewId as ID, interviewMissing } from "./model"

/* Cuestionario a la persona accidentada (RE-20-03), en cinco bloques plegables.
 * Los detalles (capacitación, estándar) aparecen sólo cuando la respuesta los pide. */

const answered = (value: unknown) => value !== null && value !== undefined

export function Re20InterviewForm({ ws }: { ws: Re20WorkspaceApi }) {
  const q = ws.sensitive.injuredInterview
  const set = (field: string) => (value: unknown) => ws.patchSensitive(["injuredInterview", field], value)
  const setNested = (path: string[]) => (value: unknown) => ws.patchSensitive(["injuredInterview", ...path], value)
  const missing = interviewMissing(ws.sensitive)
  const has = (fieldId: string) => !missing.some((item) => item.fieldId === ID(fieldId))
  const rest = (...ids: string[]) => ids.filter((id) => !has(id)).length
  const part = (...ids: string[]) => rest(...ids) === 0 ? "Completo" : `Faltan ${rest(...ids)}`
  const interviewer = ws.people.find((person) => person.name === q.interviewer)
  const training = q.trainingDetail ?? {}

  return (
    <div>
      <Re20Block id={ID("block-worker")} title="La persona y lo ocurrido" summary={q.workerName?.trim() ? `${q.workerName}${q.position ? ` · ${q.position}` : ""}` : "Falta el nombre"} complete={has("workerName") && has("summary")} defaultOpen={!filled(q.workerName)}>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Re20Fact label="Tipo de evento" value={INCIDENT_EVENT_LABELS[ws.incident.eventType] ?? "Otro evento"} />
          <Re20Fact label="Día y hora del accidente" value={formatDateTime(ws.incident.occurredAt)} mono />
          <Re20Fact label="Lugar" value={ws.incident.location || "—"} />
        </dl>
        <div className="grid gap-4 md:grid-cols-2">
          <Re20Text id={ID("workerName")} label="Nombre de la persona" required value={q.workerName} onChange={set("workerName")} maxLength={300} autoComplete="off" />
          <Re20Text id={ID("position")} label="Cargo" value={q.position} onChange={set("position")} maxLength={300} />
          <Re20Text id={ID("tenureCompany")} label="Antigüedad en la empresa" value={q.tenureCompany} onChange={set("tenureCompany")} maxLength={120} placeholder="Por ejemplo: 3 años" />
          <Re20Text id={ID("tenurePosition")} label="Antigüedad en el puesto" value={q.tenurePosition} onChange={set("tenurePosition")} maxLength={120} placeholder="Por ejemplo: 8 meses" />
          <Re20Text id={ID("shift")} label="Turno" value={q.shift} onChange={set("shift")} maxLength={120} />
        </div>
        <Re20TextArea id={ID("summary")} label="Cuéntenos brevemente qué ocurrió" required rows={4} value={q.summary} onChange={set("summary")} maxLength={5000} helper="Con sus palabras." />
      </Re20Block>

      <Re20Block id={ID("block-training")} title="La tarea y su capacitación" summary={part("taskWithinScope", "trained")} complete={rest("taskWithinScope", "trained") === 0}>
        <Re20YesNo id={ID("taskWithinScope")} label="¿La tarea que hacía correspondía a sus funciones y a su cargo?" required value={q.taskWithinScope} onChange={set("taskWithinScope")} />
        <Re20YesNo id={ID("trained")} label="¿Estaba capacitado para hacer la tarea?" required value={q.trained} onChange={set("trained")} />
        {q.trained === true && (
          <div className="space-y-4 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] p-4">
            <p className="text-sm font-medium text-[var(--color-text)]">¿Cómo se capacitó?</p>
            <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
              <Re20YesNo id={ID("training-ojt")} label="Capacitación en el puesto (OJT)" value={training.ojt} onChange={setNested(["trainingDetail", "ojt"])} />
              <Re20YesNo id={ID("training-odi")} label="Obligación de informar los riesgos (ODI)" value={training.odi} onChange={setNested(["trainingDetail", "odi"])} />
              <Re20YesNo id={ID("training-pdr")} label="Familiarización en PDR" value={training.pdrFamiliarization} onChange={setNested(["trainingDetail", "pdrFamiliarization"])} />
              <Re20Text id={ID("training-license")} label="Licencia o autorización" value={training.license} onChange={setNested(["trainingDetail", "license"])} maxLength={300} />
              <Re20Text id={ID("training-other")} label="Otra capacitación" value={training.other} onChange={setNested(["trainingDetail", "other"])} maxLength={300} className="md:col-span-2" />
            </div>
          </div>
        )}
      </Re20Block>

      <Re20Block id={ID("block-standard")} title="Estándar y riesgos" summary={part("documentedStandard", "knowsStandard", "canDoAlone", "knowsRisks")} complete={rest("documentedStandard", "knowsStandard", "canDoAlone", "knowsRisks") === 0}>
        <Re20YesNo id={ID("documentedStandard")} label="¿La tarea tenía un estándar escrito (procedimiento, instructivo, cartilla, manual)?" required value={q.documentedStandard?.answer} onChange={setNested(["documentedStandard", "answer"])} />
        {q.documentedStandard?.answer === true && (
          <Re20Text id={ID("documentedStandardDetail")} label="¿Cuál era?" value={q.documentedStandard?.detail} onChange={setNested(["documentedStandard", "detail"])} maxLength={2000} />
        )}
        <Re20YesNo id={ID("knowsStandard")} label="¿Conocía ese estándar?" required value={q.knowsStandard} onChange={set("knowsStandard")} />
        <Re20YesNo id={ID("canDoAlone")} label="¿La tarea puede hacerse solo?" required value={q.canDoAlone} onChange={set("canDoAlone")} />
        <Re20YesNo id={ID("knowsRisks")} label="¿Conocía los riesgos del lugar y de la tarea?" required value={q.knowsRisks} onChange={set("knowsRisks")} />
        <Re20YesNo id={ID("talkedWithSupervisor")} label="¿Habló antes con su jefatura directa sobre los riesgos de la tarea?" required value={q.talkedWithSupervisor} onChange={set("talkedWithSupervisor")} />
      </Re20Block>

      <Re20Block id={ID("block-ppe")} title="Equipo de protección y medidas" summary={part("ppeFitsWell")} complete={has("ppeFitsWell")}>
        <Re20TextArea id={ID("ppeUsedAtEvent")} label="¿Qué equipo de protección personal (EPP) usaba al momento del accidente?" rows={2} value={q.ppeUsedAtEvent} onChange={set("ppeUsedAtEvent")} maxLength={2000} />
        <Re20YesNo id={ID("ppeFitsWell")} label="¿Le quedaba bien (talla y ajuste)?" required value={q.ppeFitsWell} onChange={set("ppeFitsWell")} />
        <Re20TextArea id={ID("safetyMeasuresTaken")} label="¿Qué medidas de seguridad había tomado para hacer su trabajo?" rows={3} value={q.safetyMeasuresTaken} onChange={set("safetyMeasuresTaken")} maxLength={3000} />
      </Re20Block>

      <Re20Block id={ID("block-different")} title="Qué fue distinto y qué faltaba" summary={part("whatWasDifferent", "whatWasMissing")} complete={rest("whatWasDifferent", "whatWasMissing") === 0}>
        <Re20TextArea id={ID("whatWasDifferent")} label="¿Qué fue distinto ese día respecto de cómo se hace habitualmente la tarea?" required rows={4} value={q.whatWasDifferent} onChange={set("whatWasDifferent")} maxLength={3000} helper="Equipo, materiales, personal, horario, instrucciones." />
        <Re20TextArea id={ID("whatWasMissing")} label="¿Qué necesitaba para hacer la tarea de forma segura y no tenía?" required rows={3} value={q.whatWasMissing} onChange={set("whatWasMissing")} maxLength={3000} />
        <Re20TextArea id={ID("whatWouldPrevent")} label="¿Qué haría para que este accidente no se repita?" rows={3} value={q.whatWouldPrevent} onChange={set("whatWouldPrevent")} maxLength={3000} />
      </Re20Block>

      <Re20Block id={ID("block-sign")} title="Quién entrevistó y cuándo" summary={part("interviewDate", "interviewer")} complete={rest("interviewDate", "interviewer") === 0}>
        <div className="grid gap-4 md:grid-cols-2">
          <Re20Date id={ID("interviewDate")} label="Fecha de la entrevista" required value={q.interviewDate} onChange={set("interviewDate")} max={todayInChile()} />
          <Re20PersonPicker id={ID("interviewer")} label="Quién entrevistó" required value={interviewer?.id ?? ""} onChange={(userId) => set("interviewer")(ws.people.find((person) => person.id === userId)?.name ?? null)} />
        </div>
        {answered(q.interviewer) && !interviewer && <p className="text-xs text-[var(--color-text-muted)]">Entrevistó: {q.interviewer}</p>}
      </Re20Block>
    </div>
  )
}

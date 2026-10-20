import type { ComponentType } from "react"
import { re20ApplicableTaskIds } from "@/lib/prevention/incidents"
import { re20DeadlineState, type Re20Deadline, type Re20DeadlineState } from "./deadlines"
import type { Re20WorkspaceApi } from "./use-re20-workspace"
import type { Re20Data, Re20Incident, Re20StageId } from "./types"
import { preliminarStage } from "./stages/preliminar"
import { declaracionesStage } from "./stages/declaraciones"
import { diatStage } from "./stages/diat"
import { investigacionStage } from "./stages/investigacion"
import { calidadStage } from "./stages/calidad"
import { difusionStage } from "./stages/difusion"
import { seguimientoStage } from "./stages/seguimiento"
import { EMPTY_RE20_PROGRESS } from "./stages/placeholder"

/* Registro de las 7 etapas del protocolo (PASO A PASO), en el orden del tiempo
 * real. Cada etapa vive en `stages/<id>.tsx` y exporta un `Re20StageModule`;
 * este archivo sólo los ordena y les calcula aplicabilidad, plazo y estado. */

/** Algo que falta para dar la etapa por completa; `fieldId` es el id del campo al que salta el enlace. */
export interface Re20MissingField {
  label: string
  fieldId: string
}

export interface Re20StageProgress {
  done: number
  total: number
  missing: Re20MissingField[]
}

export { EMPTY_RE20_PROGRESS } from "./stages/placeholder"

export interface Re20StageProps {
  ws: Re20WorkspaceApi
  stage: Re20StageView
}

/** Lo que exporta cada `stages/<id>.tsx`. */
export interface Re20StageModule {
  Component: ComponentType<Re20StageProps>
  /** Avance de la etapa con los datos actuales (sin efectos; se llama en cada render). */
  progress: (ws: Re20WorkspaceApi) => Re20StageProgress
}

export interface Re20StageDefinition {
  id: Re20StageId
  number: number
  title: string
  /** Una línea: qué se hace en la etapa, en palabras de terreno. */
  summary: string
  /** Tareas de `RE20_TASK_DEFINITIONS` que la componen. */
  taskIds: readonly string[]
}

export const RE20_STAGES: readonly Re20StageDefinition[] = [
  { id: "preliminar", number: 1, title: "Aviso y preliminar", summary: "Qué pasó, dónde, a quién y qué se hizo de inmediato.", taskIds: ["notify", "preliminary_report"] },
  { id: "declaraciones", number: 2, title: "Declaraciones", summary: "Lo que cuentan quienes participaron o vieron, y la entrevista a la persona afectada.", taskIds: ["witness_statements", "injured_interview"] },
  { id: "diat", number: 3, title: "DIAT", summary: "La denuncia al organismo administrador y su comprobante.", taskIds: ["diat"] },
  { id: "investigacion", number: 4, title: "Investigación", summary: "Hechos, árbol de causas, medidas y cierre del equipo.", taskIds: ["definitive_report"] },
  { id: "calidad", number: 5, title: "Revisión de calidad", summary: "Una persona fuera del equipo revisa los 13 criterios.", taskIds: ["quality_review"] },
  { id: "difusion", number: 6, title: "Difusión", summary: "Compartir lo aprendido con los turnos.", taskIds: ["diffusion"] },
  { id: "seguimiento", number: 7, title: "Seguimiento y eficacia", summary: "Reunión al reintegro, revisión cada 14 días y verificación de eficacia.", taskIds: ["post_accident_meeting", "accident_followup", "effectiveness_verification"] },
]

export const RE20_STAGE_MODULES: Record<Re20StageId, Re20StageModule> = {
  preliminar: preliminarStage,
  declaraciones: declaracionesStage,
  diat: diatStage,
  investigacion: investigacionStage,
  calidad: calidadStage,
  difusion: difusionStage,
  seguimiento: seguimientoStage,
}

export function re20ApplicableTasks(incident: Pick<Re20Incident, "eventType" | "isFatalOrSerious">, data: Pick<Re20Data, "nearMiss">) {
  return new Set(re20ApplicableTaskIds(incident.eventType, {
    nearMissPotential: data.nearMiss?.potential ?? null,
    isFatalOrSerious: incident.isFatalOrSerious === true,
  }))
}

/** Por qué una etapa no aplica, dicho como lo diría el protocolo. */
function notApplicableReason(stage: Re20StageId, eventType: string) {
  if (eventType === "commute_accident") return "Accidente de trayecto: el protocolo pide solo los pasos 1 a 3."
  if (stage === "diat") return "La DIAT corresponde solo a accidentes del trabajo, de trayecto o eventos graves o fatales."
  return "Este paso no aplica a este tipo de evento."
}

export type Re20StageStatus = "done" | "in_progress" | "pending" | "not_applicable"

export interface Re20StageView extends Re20StageDefinition {
  applicable: boolean
  /** Razón en lenguaje humano cuando no aplica. */
  reason: string | null
  /** Tareas de la etapa que aplican a este evento. */
  applicableTaskIds: string[]
  deadline: Re20Deadline | null
  deadlineState: Re20DeadlineState | null
  progress: Re20StageProgress
  status: Re20StageStatus
}

/** Las 7 etapas con su aplicabilidad, plazo, avance y estado para este expediente. */
export function re20StageViews(ws: Re20WorkspaceApi, now: number): Re20StageView[] {
  const applicable = re20ApplicableTasks(ws.incident, ws.data)
  return RE20_STAGES.map((definition) => {
    const taskIds = definition.taskIds.filter((id) => applicable.has(id))
    const isApplicable = taskIds.length > 0
    const progress = isApplicable ? RE20_STAGE_MODULES[definition.id].progress(ws) : EMPTY_RE20_PROGRESS
    const tasksDone = isApplicable && taskIds.every((id) => ws.task(id).status === "completed")
    const started = progress.done > 0 || taskIds.some((id) => ws.task(id).status !== "pending")
    const status: Re20StageStatus = !isApplicable ? "not_applicable" : tasksDone ? "done" : started ? "in_progress" : "pending"
    const deadline = isApplicable && !tasksDone ? ws.deadlines[definition.id] ?? null : null
    return {
      ...definition,
      applicable: isApplicable,
      reason: isApplicable ? null : notApplicableReason(definition.id, ws.incident.eventType),
      applicableTaskIds: taskIds,
      deadline,
      deadlineState: deadline ? re20DeadlineState(deadline.dueAt, now) : null,
      progress,
      status,
    }
  })
}

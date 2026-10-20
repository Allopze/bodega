import { calculateRe20Deadlines } from "@/lib/prevention/incidents"
import { todayInChile } from "@/lib/utils"
import type { Re20Sensitive } from "../../types"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { newRe20Id } from "../../workspace-data"

/* Modelo puro de la etapa «Declaraciones»: etiquetas, ids de campo y qué falta.
 * Sin React: lo usan tanto los componentes como `progress()` y los tests. */

export type Re20Declaration = Re20Sensitive["declarations"][number]
export type Re20DeclarationKind = Re20Declaration["kind"]

export const DECLARATION_KIND_LABELS: Record<Re20DeclarationKind, string> = {
  involved: "Involucrado",
  witness: "Testigo",
  injured_person: "Persona accidentada",
  cphs: "Comité Paritario (registro anterior)",
}

export const DECLARATION_KIND_OPTIONS = (["involved", "witness", "injured_person"] as const).map((value) => ({
  value,
  label: DECLARATION_KIND_LABELS[value],
}))

/** Las ocho preguntas Sí/No de RE-20-07 (B34 a B41), en el orden del formato. */
export const DECLARATION_QUESTIONS = [
  { key: "directWitness", label: "¿Presenció directamente el evento?" },
  { key: "participatedInTask", label: "¿Participó en la tarea?" },
  { key: "knewProcess", label: "¿Conocía el proceso?" },
  { key: "thirdPartyInformation", label: "¿Recibió información de terceros?" },
  { key: "sketchAttached", label: "¿Adjunta croquis?" },
  { key: "photosAttached", label: "¿Adjunta fotografías?" },
  { key: "contactAuthorized", label: "¿Autoriza contacto para aclaraciones?" },
  { key: "reserveIdentity", label: "¿Pide reserva de su identidad en la difusión interna?" },
] as const

/** RE-20-07!B43, literal. */
export const DECLARATION_CLAUSE =
  "Declaro que la información precedente corresponde a mi conocimiento y recuerdo de los hechos. Se me informó que esta declaración será utilizada solo con fines preventivos y para la gestión del accidente ante el organismo administrador y la autoridad, y que se mantendrá bajo resguardo por su carácter confidencial."

/** RE-20-07!B12, literal. */
export const INTERVIEW_RULES =
  "Entrevista a cada persona por separado, en un lugar tranquilo y sin inducir respuestas. Pide primero un relato libre y luego aclara secuencia, posiciones, comunicaciones, condiciones y cambios. Distingue lo que la persona vio, oyó, hizo o supone."

export const ID = (field: string) => `re20-declaraciones-${field}`
export const declId = (declaration: Pick<Re20Declaration, "id">, field: string) => ID(`${declaration.id}-${field}`)
export const interviewId = (field: string) => ID(`entrevista-${field}`)

export const filled = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined

export function newDeclaration(ws: Pick<Re20WorkspaceApi, "incident">): Re20Declaration {
  return {
    id: newRe20Id("declaration"),
    kind: "witness",
    name: "",
    statement: "",
    investigationNumber: ws.incident.code,
    interviewDate: todayInChile(),
    place: ws.incident.location || null,
    answers: {},
    reserveIdentity: false,
    attachmentReferences: [],
  }
}

export function declarationLabel(declaration: Re20Declaration, index: number) {
  return declaration.name.trim() || `Declaración ${index + 1}`
}

export interface Missing { label: string; fieldId: string }

export function declarationMissing(declaration: Re20Declaration, index: number): Missing[] {
  const who = declarationLabel(declaration, index)
  const checks: Array<[boolean, string, string]> = [
    [filled(declaration.name), `Nombre de quien declara (${who})`, "name"],
    [filled(declaration.statement), `Relato libre (${who})`, "statement"],
    [declaration.clauseAccepted === true, `Aceptación de la cláusula (${who})`, "clause"],
    [filled(declaration.signedAt), `Fecha de la firma (${who})`, "signedAt"],
  ]
  return checks.filter(([ok]) => !ok).map(([, label, field]) => ({ label, fieldId: declId(declaration, field) }))
}

export function declarationsMissing(sensitive: Re20Sensitive): Missing[] {
  if (sensitive.declarations.length === 0) return [{ label: "Al menos una declaración", fieldId: ID("list") }]
  return sensitive.declarations.flatMap(declarationMissing)
}

/** Qué falta del cuestionario al accidentado (RE-20-03). */
export function interviewMissing(sensitive: Re20Sensitive): Missing[] {
  const q = sensitive.injuredInterview
  const checks: Array<[boolean, string, string]> = [
    [filled(q.workerName), "Nombre de la persona entrevistada", "workerName"],
    [filled(q.summary), "Qué ocurrió, según la persona", "summary"],
    [q.taskWithinScope !== null && q.taskWithinScope !== undefined, "Si la tarea correspondía a su cargo", "taskWithinScope"],
    [q.trained !== null && q.trained !== undefined, "Si estaba capacitado para la tarea", "trained"],
    [q.documentedStandard?.answer !== null && q.documentedStandard?.answer !== undefined, "Si la tarea tenía un estándar escrito", "documentedStandard"],
    [q.knowsStandard !== null && q.knowsStandard !== undefined, "Si conocía el estándar", "knowsStandard"],
    [q.canDoAlone !== null && q.canDoAlone !== undefined, "Si la tarea puede hacerse solo", "canDoAlone"],
    [q.knowsRisks !== null && q.knowsRisks !== undefined, "Si conocía los riesgos", "knowsRisks"],
    [q.ppeFitsWell !== null && q.ppeFitsWell !== undefined, "Si el EPP le quedaba bien", "ppeFitsWell"],
    [q.talkedWithSupervisor !== null && q.talkedWithSupervisor !== undefined, "Si habló antes con su jefatura", "talkedWithSupervisor"],
    [filled(q.whatWasDifferent), "Qué fue distinto ese día", "whatWasDifferent"],
    [filled(q.whatWasMissing), "Qué faltaba para hacerlo seguro", "whatWasMissing"],
    [filled(q.interviewDate), "Fecha de la entrevista", "interviewDate"],
    [filled(q.interviewer), "Quién hizo la entrevista", "interviewer"],
  ]
  return checks.filter(([ok]) => !ok).map(([, label, field]) => ({ label, fieldId: interviewId(field) }))
}

export const INTERVIEW_TOTAL = 14

/** Vencimientos de las dos entrevistas, contados como en `deadlines.ts`. */
export function declarationDeadlines(ws: Pick<Re20WorkspaceApi, "incident" | "policy" | "task">) {
  const preliminary = ws.task("preliminary_report")
  const base = calculateRe20Deadlines({
    occurredAt: ws.incident.occurredAt,
    knownAt: ws.incident.knownAt,
    preliminaryAt: preliminary.status === "completed" ? preliminary.completedAt ?? null : null,
    eventType: ws.incident.eventType,
    isFatalOrSerious: ws.incident.isFatalOrSerious === true,
  }, ws.policy)
  return {
    statements: { dueAt: base.witnessStatements.dueAt, rule: `${ws.policy.witnessStatementsHours} h desde el evento` },
    interview: { dueAt: base.injuredInterview.dueAt, rule: `${ws.policy.injuredInterviewHours} h desde el informe preliminar` },
  }
}

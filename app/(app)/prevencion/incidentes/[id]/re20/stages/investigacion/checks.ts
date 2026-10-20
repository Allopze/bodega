import { re20TreeRequired } from "@/lib/prevention/incidents"
import {
  RE20_ANNEX_CODES,
  RE20_INSTRUMENT_IDS,
  RE20_SIGNATURE_ROLES,
  RE20_TEAM_CHECKLIST_KEYS,
} from "@/lib/services/prevention-incident-re20-schema"
import type { Re20StageProgress } from "../../stages"
import type { Re20Data } from "../../types"
import { rootCauses, treeIssues, TREE_FIELD } from "./model"

/* Qué pide la etapa 4, con el MISMO id de campo que pinta cada sección, para que
 * «Falta…» salte al campo. `blocking` marca lo que el servidor exige al completar
 * el informe definitivo (`re20DefinitiveCompletionIssues` + el esquema); lo demás
 * es lo que el protocolo pide pero no impide marcarlo completo. */

export const ID = (field: string) => `re20-investigacion-${field}`

export type StepId = "equipo" | "evidencias" | "reconstruccion" | "arbol" | "medidas" | "cierre"

export const STEPS: ReadonlyArray<{ id: StepId; letter: string; title: string; summary: string }> = [
  { id: "equipo", letter: "A", title: "Equipo y persona afectada", summary: "Quiénes investigan y a quién le ocurrió." },
  { id: "evidencias", letter: "B", title: "Evidencias", summary: "Lo que respalda los hechos." },
  { id: "reconstruccion", letter: "C", title: "Reconstrucción", summary: "El relato y la cronología." },
  { id: "arbol", letter: "D", title: "Árbol de causas", summary: "Hechos, relaciones y causas raíz." },
  { id: "medidas", letter: "E", title: "Medidas", summary: "Qué se hará con cada causa raíz." },
  { id: "cierre", letter: "F", title: "Cierre del informe", summary: "Instrumentos, conclusión, firmas." },
]

export const INSTRUMENT_LABELS: Record<(typeof RE20_INSTRUMENT_IDS)[number], string> = {
  iper: "Matriz IPER / mapa de riesgos",
  work_program: "Programa de trabajo preventivo",
  procedure: "Procedimiento / instructivo",
  odi: "ODI / información de riesgos",
  training: "Capacitación / competencias",
  maintenance: "Mantención / inspecciones",
  emergency_plan: "Plan de emergencia / rescate",
}

/** INV.DEF.ACC!B145:B152, literales. */
export const CHECKLIST_LABELS: Record<(typeof RE20_TEAM_CHECKLIST_KEYS)[number], string> = {
  coherentTree: "El árbol es coherente con el relato y el listado de hechos",
  allRootCausesHaveMeasures: "Todas las causas raíz tienen medidas asociadas",
  controlHierarchyReviewed: "Se revisó la jerarquía de controles",
  ownersDefined: "Se definieron responsables, plazos, evidencia y verificador",
  sensitiveDataProtected: "Se resguardaron los datos sensibles",
  iperUpdatedOrJustified: "Se actualizó la matriz IPER o se justificó no hacerlo",
  effectivenessPlanDefined: "Se definió cómo y cuándo se verificará la eficacia",
  attachmentsIncluded: "Se adjuntaron los antecedentes",
}

/** INV.DEF.ACC!C164:C175. */
export const ANNEX_LABELS: Record<(typeof RE20_ANNEX_CODES)[number], string> = {
  A: "Declaraciones firmadas (RE-20-07)",
  B: "Registro fotográfico y croquis",
  C: "DIAT / atención médica",
  D: "Procedimientos e instructivos",
  E: "Matriz IPER vigente y actualización",
  F: "ODI / capacitación / competencias",
  G: "Inspecciones y mantenciones",
  H: "Permisos de trabajo / AST / checklists",
  I: "Registros de jornada y supervisión",
  J: "Acta del Comité Paritario",
  K: "Evidencia de medidas implementadas",
  L: "Revisión de calidad (RE-20-13)",
}

/** INV.DEF.ACC!B178:K178. */
export const SIGNATURE_LABELS: Record<(typeof RE20_SIGNATURE_ROLES)[number], string> = {
  investigator: "Responsable de la investigación / Prevención de Riesgos",
  cphs: "Representante Comité Paritario",
  contract_admin: "Administrador de Contrato",
  area_manager: "Subgerente del área",
}

export const filled = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined

export interface Re20Check { ok: boolean; label: string; fieldId: string; step: StepId; blocking: boolean }

type Source = { incident: { eventType: string; potentialSeverity?: string | null }; data: Re20Data }

/** Igual que `treeIsRequired` del servidor: basta el potencial del cuasi accidente o el del reporte. */
export function treeRequired(ws: Source) {
  return [ws.data.nearMiss.potential, ws.incident.potentialSeverity]
    .some((potential) => re20TreeRequired(ws.incident.eventType, { nearMissPotential: potential ?? null }))
}

export function buildChecks(ws: Source): Re20Check[] {
  const { data } = ws
  const d = data.definitive
  const checks: Re20Check[] = []
  const add = (step: StepId, ok: boolean, label: string, fieldId: string, blocking = false) => { checks.push({ ok, label, fieldId, step, blocking }) }

  // A. Equipo.
  add("equipo", data.team.length > 0, "Al menos un integrante del equipo investigador", ID("team"))
  data.team.forEach((member, i) => {
    const who = `integrante ${i + 1}`
    if (!member.userId) add("equipo", false, `Nombre del ${who}`, ID(`team-${i}-userId`))
    if (!filled(member.role)) add("equipo", false, `Rol del ${who}`, ID(`team-${i}-role`))
    if (member.impartialityDeclared === null || member.impartialityDeclared === undefined) add("equipo", false, `Declaración de imparcialidad del ${who}`, ID(`team-${i}-impartiality`))
  })

  // B. Evidencias.
  add("evidencias", data.evidences.length > 0, "Al menos una evidencia", ID("evidences"))
  data.evidences.forEach((item, i) => {
    if (!filled(item.type)) add("evidencias", false, `Tipo de la evidencia ${i + 1}`, ID(`evidence-${i}-type`))
    if (!filled(item.description)) add("evidencias", false, `Descripción de la evidencia ${i + 1}`, ID(`evidence-${i}-description`))
  })

  // C. Reconstrucción.
  add("reconstruccion", filled(d.reconstruction), "Relato del evento en tercera persona", ID("reconstruction"))
  add("reconstruccion", d.chronology.length > 0, "Al menos un hecho en la cronología", ID("chronology"))

  // D. Árbol.
  const required = treeRequired(ws)
  const issues = treeIssues(data.causalTree)
  if (required) {
    if (issues.length === 0) add("arbol", true, "Árbol de causas completo", TREE_FIELD.builder, true)
    for (const issue of issues) add("arbol", false, issue.text, issue.fieldId, true)
  }

  // E. Medidas.
  const roots = rootCauses(data.causalTree)
  for (const root of roots) {
    add("medidas", data.measures.some((m) => m.rootCauseId === root), `Una medida para la causa raíz ${root}`, ID(`medida-${root}-agregar`), true)
  }
  data.measures.forEach((measure, i) => {
    const n = i + 1
    add("medidas", filled(measure.description), `Descripción de la medida ${n}`, ID(`measure-${i}-description`))
    add("medidas", filled(measure.controlType), `Tipo de control de la medida ${n}`, ID(`measure-${i}-controlType`))
    add("medidas", filled(measure.responsibleUserId), `Responsable de la medida ${n}`, ID(`measure-${i}-responsible`), true)
    add("medidas", filled(measure.verifierUserId), `Verificador de la medida ${n}`, ID(`measure-${i}-verifier`), true)
    if (measure.responsibleUserId && measure.responsibleUserId === measure.verifierUserId) {
      add("medidas", false, `La medida ${n} tiene la misma persona como responsable y verificador`, ID(`measure-${i}-verifier`), true)
    }
    add("medidas", filled(measure.dueAt), `Fecha compromiso de la medida ${n}`, ID(`measure-${i}-dueAt`))
  })

  // F. Cierre.
  const answered = RE20_INSTRUMENT_IDS.filter((id) => d.instruments.find((row) => row.id === id)?.requiresChange !== undefined && d.instruments.find((row) => row.id === id)?.requiresChange !== null)
  const firstInstrument = RE20_INSTRUMENT_IDS.find((id) => !answered.includes(id))
  add("cierre", answered.length === RE20_INSTRUMENT_IDS.length, `Instrumentos preventivos: faltan ${RE20_INSTRUMENT_IDS.length - answered.length} por responder`, ID(`instrument-${firstInstrument ?? "iper"}-requiresChange`))
  add("cierre", filled(d.closure.informedTo), "A quién se informan los resultados", ID("closure-informedTo"))
  add("cierre", filled(d.closure.executiveSummary), "Resumen ejecutivo", ID("closure-executiveSummary"))
  add("cierre", filled(d.closure.proposedClosureDate), "Fecha propuesta de cierre", ID("closure-proposedClosureDate"))
  add("cierre", (d.conclusion?.trim().length ?? 0) >= 10, "Conclusión del equipo investigador", ID("conclusion"), true)
  const missingChecklist = RE20_TEAM_CHECKLIST_KEYS.filter((key) => d.teamChecklist[key] === null || d.teamChecklist[key] === undefined)
  add("cierre", missingChecklist.length === 0, `Conclusión del equipo: faltan ${missingChecklist.length} respuestas Sí o No`, ID(`checklist-${missingChecklist[0] ?? RE20_TEAM_CHECKLIST_KEYS[0]}`))
  const missingAnnexes = RE20_ANNEX_CODES.filter((code) => !filled(d.annexes.find((row) => row.code === code)?.included))
  add("cierre", missingAnnexes.length === 0, `Control de anexos: faltan ${missingAnnexes.length} por marcar`, ID(`annex-${missingAnnexes[0] ?? "A"}-included`))
  add("cierre", filled(d.signatures.find((row) => row.role === "investigator")?.name), "Firma de quien responde por la investigación", ID("signature-investigator-name"))

  return checks
}

/** Lo que el servidor exigirá al marcar el informe definitivo como completo. */
export function blockingIssues(ws: Source) {
  return buildChecks(ws).filter((check) => check.blocking && !check.ok)
}

export function stepProgress(checks: Re20Check[], step: StepId) {
  const own = checks.filter((check) => check.step === step)
  return { done: own.filter((check) => check.ok).length, total: own.length }
}

export function investigationProgress(ws: Source): Re20StageProgress {
  const checks = buildChecks(ws)
  return {
    done: checks.filter((check) => check.ok).length,
    total: checks.length,
    missing: checks.filter((check) => !check.ok).map(({ label, fieldId }) => ({ label, fieldId })),
  }
}

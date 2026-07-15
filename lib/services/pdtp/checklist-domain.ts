/**
 * Constantes y helpers del dominio Checklist → Plan de Acción del PDTP.
 *
 * Reutiliza `ChecklistDefinition` de `lib/sst/types.ts` y los enums de estado
 * definidos en `db/schema/prevention/pdtp.ts`.
 */

import { nanoid } from "@/lib/id"

export const PDTP_ACTION_ESTADOS = ["pendiente", "en_proceso", "completado", "verificado", "reabierto"] as const
export const PDTP_ACTION_PRIORIDADES = ["alta", "media", "baja"] as const
export const PDTP_CHECKLIST_STATUS = ["pendiente", "en_proceso", "completado"] as const

/** Días de plazo por defecto según prioridad de la acción. */
export const PDTP_PLAZO_DIAS_POR_PRIORIDAD: Record<string, number> = {
  alta: 2,
  media: 7,
  baja: 15,
}

/** Estados que cuentan como "cerrados" para el % de cierre. */
export const PDTP_ESTADOS_CERRADOS = new Set(["completado", "verificado"])

/**
 * Daño potencial de un hallazgo (módulo 04 — Evidencia Objetiva No Planeada).
 * Determina la prioridad y el plazo de cierre automáticos:
 *   leve     → baja   (15 días)  — sin lesión o lesión menor sin tiempo perdido
 *   moderado → media  (7 días)   — posible lesión con tiempo perdido temporal
 *   grave    → alta   (48 h)     — lesión grave con incapacidad parcial o total
 *   fatal    → alta   (inmediato)— riesgo de muerte o incapacidad permanente
 *
 * PLAN_INTEGRACION §5.4: al crear un hallazgo manual, el daño potencial deriva
 * la prioridad (y el plazo vía `plazoFromDañoPotencial`), evitando que el
 * inspector los setee manualmente de forma inconsistente.
 */
export const PDTP_DANO_POTENCIAL = ["leve", "moderado", "grave", "fatal"] as const
export type PdtpDanoPotencial = (typeof PDTP_DANO_POTENCIAL)[number]

/** Mapa daño potencial → prioridad derivada (PLAN_INTEGRACION §5.4). */
export const PDTP_DANO_POTENCIAL_A_PRIORIDAD: Record<PdtpDanoPotencial, "alta" | "media" | "baja"> = {
  leve: "baja",
  moderado: "media",
  grave: "alta",
  fatal: "alta",
}

/** Plazo (ISO YYYY-MM-DD) desde daño potencial. Fatal = hoy (inmediato). */
export function plazoFromDañoPotencial(daño: PdtpDanoPotencial, fromDate = new Date()): string {
  if (daño === "fatal") return fromDate.toISOString().slice(0, 10)
  return plazoFromPrioridad(PDTP_DANO_POTENCIAL_A_PRIORIDAD[daño], fromDate)
}

/** Genera un ID determinista para una plantilla de checklist por actividad. */
export function pdtpActivityChecklistId(activityId: string, version = "01") {
  return `${activityId}-cl-${version}`
}

/**
 * Genera un ID determinista para la instancia de checklist de una ejecución.
 *
 * Multi-sujeto (PLAN_INTEGRACION §4.3): `subjectId=''` (instancia única de
 * faena, patrón B) produce el PK legacy `${executionId}-cli` — así las filas
 * pre-migración se recuperan sin colisión. Un sujeto concreto añade un sufijo
 * estable: `${executionId}-cli-${subjectId}` (idempotente por sujeto).
 */
export function pdtpExecutionChecklistId(executionId: string, subjectId = "") {
  return subjectId ? `${executionId}-cli-${subjectId}` : `${executionId}-cli`
}

/** Genera un ID para una respuesta de checklist. */
export function pdtpChecklistResponseId(instanceId: string, seccionId: string, itemId: string) {
  return `${instanceId}-r-${seccionId}-${itemId}`
}

/** Genera un ID para un ítem del plan de acción. */
export function pdtpActionPlanItemId(executionId: string, n: number) {
  return `${executionId}-ap-${String(n).padStart(3, "0")}`
}

/** Genera un ID para un followup del plan de acción. */
export function pdtpActionPlanFollowupId() {
  return nanoid()
}

/** Suma hoy (ISO date) para calcular plazo desde prioridad. */
export function plazoFromPrioridad(prioridad: string, fromDate = new Date()): string {
  const dias = PDTP_PLAZO_DIAS_POR_PRIORIDAD[prioridad] ?? 7
  const d = new Date(fromDate)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Determina si una acción está vencida (plazo < hoy y no está cerrada). */
export function isActionVencida(estado: string, plazo: string, today = new Date()): boolean {
  if (PDTP_ESTADOS_CERRADOS.has(estado)) return false
  const plazoDate = new Date(plazo + "T00:00:00")
  const todayStr = today.toISOString().slice(0, 10)
  const todayDate = new Date(todayStr + "T00:00:00")
  return plazoDate < todayDate
}

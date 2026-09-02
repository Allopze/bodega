/**
 * lib/services/pdtp/subject-registry.ts
 *
 * De dónde sale el padrón de una actividad que se mide por cobertura.
 *
 * Antes el padrón era un número que alguien tecleaba en
 * `pdtp_activity_worksite_params.expected_subject_count`. Un número guardado es
 * una foto: envejece en cuanto entra o sale gente de un GES, y obligaba a
 * mantener a mano un dato que el sistema ya conoce. El módulo de higiene
 * resolvió esto mismo al revés —deriva la nómina de vigilancia de la pertenencia
 * al GES en vez de pedirla— y este archivo aplica ese criterio al programa
 * anual.
 *
 * Dos clases de fuente, con reglas distintas en el cálculo:
 *
 * - **Stock** — cuántos sujetos existen ahora. `dotacion`, `extintores`,
 *   `expuestos_ges`, `equipos`. El período no las afecta, así que se resuelven
 *   una vez por faena.
 * - **Flujo** — cuántos casos ocurrieron en el mes. `trabajadores_nuevos`. El
 *   denominador son los hechos, no el plan, y por eso debe contar incluso en
 *   meses sin calendario (ver `compliance.ts`).
 *
 * El override manual sigue existiendo y gana sobre lo derivado: es la escotilla
 * para un sujeto que todavía no tiene registro propio.
 */

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelVehicles,
  preventionEmergencyResourceTypes,
  preventionEmergencyResources,
  preventionExposureGroupMembers,
  preventionExposureGroups,
  sstEvaluations,
  workers,
} from "@/db/schema"

/** Las fuentes que `pdtp_activities.subject_source` admite (CHECK en la tabla). */
export const PDTP_SUBJECT_SOURCES = [
  "dotacion",
  "extintores",
  "expuestos_ges",
  "equipos",
  "trabajadores_nuevos",
] as const

export type PdtpSubjectSource = (typeof PDTP_SUBJECT_SOURCES)[number]

/**
 * Las fuentes de flujo cuentan casos del período; las de stock, sujetos que
 * existen hoy. `compliance.ts` lo usa para decidir si una actividad sin
 * calendario en el mes debe contar de todos modos.
 */
const FLOW_SOURCES = new Set<PdtpSubjectSource>(["trabajadores_nuevos"])

export function isFlowSubjectSource(source: string | null): boolean {
  return source !== null && FLOW_SOURCES.has(source as PdtpSubjectSource)
}

export type PdtpSubjectPeriod = { year: number; month: number }

function monthBounds({ year, month }: PdtpSubjectPeriod): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` }
}

async function countOne(query: Promise<Array<{ count: number }>>): Promise<number> {
  const [row] = await query
  return row?.count ?? 0
}

/** Trabajadores activos de la faena. Sujeto de las actividades que barren la dotación. */
function countDotacion(worksiteId: string): Promise<number> {
  return countOne(db.select({ count: sql<number>`count(*)::int` }).from(workers)
    .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true))))
}

/**
 * Extintores de la faena.
 *
 * `prevention_emergency_resources` ya es el inventario por faena —lo dice el
 * propio esquema de inspecciones: "no hace falta tabla nueva"— y la clase sale
 * del tipo. Un recurso fuera de servicio no se inspecciona, así que no es
 * denominador. Los recursos sin tipo tipado (el `kind` de texto libre legado) no
 * cuentan: no se puede afirmar que sean extintores.
 */
function countExtintores(worksiteId: string): Promise<number> {
  return countOne(db.select({ count: sql<number>`count(*)::int` })
    .from(preventionEmergencyResources)
    .innerJoin(preventionEmergencyResourceTypes, eq(preventionEmergencyResourceTypes.id, preventionEmergencyResources.typeId))
    .where(and(
      eq(preventionEmergencyResources.worksiteId, worksiteId),
      eq(preventionEmergencyResourceTypes.resourceClass, "extinguisher"),
      sql`${preventionEmergencyResources.status} <> 'out_of_service'`,
    )))
}

/**
 * Personas que deben estar bajo vigilancia en la faena.
 *
 * Se cuenta distinto por trabajador: una persona en dos GES con vigilancia es un
 * sujeto, no dos. `left_on IS NULL` es la membresía vigente, que es el mismo
 * criterio con que el módulo arma la nómina al matricular.
 */
function countExpuestosGes(worksiteId: string): Promise<number> {
  return countOne(db.select({ count: sql<number>`count(distinct ${preventionExposureGroupMembers.workerId})::int` })
    .from(preventionExposureGroupMembers)
    .innerJoin(preventionExposureGroups, eq(preventionExposureGroups.id, preventionExposureGroupMembers.groupId))
    .where(and(
      eq(preventionExposureGroups.worksiteId, worksiteId),
      eq(preventionExposureGroups.surveillanceRequired, true),
      eq(preventionExposureGroups.isActive, true),
      isNull(preventionExposureGroupMembers.leftOn),
    )))
}

/** Vehículos y equipos activos de la faena. Padrón de las inspecciones de equipos. */
function countEquipos(worksiteId: string): Promise<number> {
  return countOne(db.select({ count: sql<number>`count(*)::int` }).from(fuelVehicles)
    .where(and(eq(fuelVehicles.worksiteId, worksiteId), eq(fuelVehicles.isActive, true))))
}

/**
 * Trabajadores nuevos del mes en la faena — la única fuente de flujo.
 *
 * Un trabajador es nuevo cuando se le hizo la evaluación de trabajador nuevo:
 * `workers` no tiene fecha de contratación y no se puede saber de antemano
 * cuándo entrará alguien, pero el acta sí registra cuándo se lo habilitó. Sólo
 * cuentan las cerradas: un borrador no prueba nada y el acta cerrada es
 * inmutable por DS 44.
 *
 * El acta cubre "personal nuevo, reubicado o con cambio de función", así que el
 * padrón es de habilitaciones y no sólo de contrataciones. Es lo correcto para
 * las actividades que mide: un cambio de puesto exige RIOHS y EPP del cargo
 * nuevo igual que un ingreso.
 */
function countTrabajadoresNuevos(worksiteId: string, period: PdtpSubjectPeriod): Promise<number> {
  const { from, to } = monthBounds(period)
  return countOne(db.select({ count: sql<number>`count(distinct ${sstEvaluations.workerId})::int` })
    .from(sstEvaluations)
    .where(and(
      eq(sstEvaluations.worksiteId, worksiteId),
      eq(sstEvaluations.definicionCode, "trabajador_nuevo"),
      eq(sstEvaluations.estado, "cerrado"),
      gte(sstEvaluations.fechaEvaluacion, from),
      lte(sstEvaluations.fechaEvaluacion, to),
    )))
}

/**
 * Resuelve el padrón de una fuente. Devuelve `0` cuando el registro está vacío,
 * y quien llama decide qué hacer con eso — `compliance.ts` cae a la cantidad
 * planificada, porque un padrón de cero haría desaparecer la actividad del
 * denominador y eso premia el no configurar.
 */
export async function resolvePdtpSubjectCount(
  source: string | null,
  worksiteId: string,
  period: PdtpSubjectPeriod,
): Promise<number | null> {
  switch (source) {
    case "dotacion": return countDotacion(worksiteId)
    case "extintores": return countExtintores(worksiteId)
    case "expuestos_ges": return countExpuestosGes(worksiteId)
    case "equipos": return countEquipos(worksiteId)
    case "trabajadores_nuevos": return countTrabajadoresNuevos(worksiteId, period)
    default: return null
  }
}

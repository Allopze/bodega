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

import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelVehicles,
  preventionEmergencyResourceTypes,
  preventionEmergencyResources,
  preventionExposureGroupMembers,
  preventionExposureGroups,
  sstEvaluations,
  workerCapabilities,
  workerCapabilityOverrides,
  workerPositionCapabilities,
  workerPositions,
  workers,
} from "@/db/schema"
import { WORKER_CAPABILITY_CODE_PATTERN } from "@/lib/services/worker-positions/normalization"

/** Las fuentes que `pdtp_activities.subject_source` admite (CHECK en la tabla). */
export const PDTP_SUBJECT_SOURCES = [
  "dotacion",
  "extintores",
  "expuestos_ges",
  "equipos",
  "trabajadores_nuevos",
  "trabajadores_capacidad",
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

export type PdtpSubjectRosterOptions = {
  /** Códigos estables del catálogo de capacidades. Se usa sólo con
   * `trabajadores_capacidad`; varias capacidades se interpretan como OR. */
  capabilityCodes?: readonly string[] | null
}

export type PdtpSubjectRosterMember = {
  workerId: string
  workerName: string
  positionId: string | null
  positionName: string | null
  matchedCapabilities: Array<{
    code: string
    name: string
    source: "position" | "override"
  }>
}

export type PdtpSubjectRosterResolution = {
  source: PdtpSubjectSource
  status: "resolved" | "pending_classification" | "not_configured"
  count: number
  capabilityCodes: string[]
  members: PdtpSubjectRosterMember[]
  explanation: string
}

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

function normalizeCapabilityCodes(codes: readonly string[] | null | undefined): string[] {
  return [...new Set((codes ?? [])
    .map((code) => code.trim().toLowerCase())
    .filter((code) => WORKER_CAPABILITY_CODE_PATTERN.test(code)))]
    .sort()
}

/**
 * Nómina explicable de trabajadores que poseen al menos una capacidad.
 *
 * La herencia de cargo es la regla general. Un override `exclude` elimina sólo
 * esa capacidad heredada y un `include` incorpora al trabajador aunque su
 * cargo no la tenga. Las dos ramas se consolidan por trabajador y capacidad,
 * por lo que una persona que conduce y además opera equipos sigue siendo un
 * solo sujeto del padrón.
 */
async function resolveCapabilityRoster(
  worksiteId: string,
  capabilityCodes: readonly string[] | null | undefined,
): Promise<PdtpSubjectRosterResolution> {
  const codes = normalizeCapabilityCodes(capabilityCodes)
  if (codes.length === 0) {
    return {
      source: "trabajadores_capacidad",
      status: "not_configured",
      count: 0,
      capabilityCodes: [],
      members: [],
      explanation: "La actividad no tiene capacidades configuradas para construir su padrón.",
    }
  }

  const inheritedRows = await db.select({
    workerId: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    positionId: workers.positionId,
    positionName: workerPositions.name,
    capabilityCode: workerCapabilities.code,
    capabilityName: workerCapabilities.name,
  })
    .from(workers)
    .innerJoin(workerPositions, eq(workerPositions.id, workers.positionId))
    .innerJoin(workerPositionCapabilities, eq(workerPositionCapabilities.positionId, workers.positionId))
    .innerJoin(workerCapabilities, eq(workerCapabilities.id, workerPositionCapabilities.capabilityId))
    .leftJoin(workerCapabilityOverrides, and(
      eq(workerCapabilityOverrides.workerId, workers.id),
      eq(workerCapabilityOverrides.capabilityId, workerCapabilities.id),
    ))
    .where(and(
      eq(workers.worksiteId, worksiteId),
      eq(workers.isActive, true),
      eq(workerCapabilities.isActive, true),
      inArray(workerCapabilities.code, codes),
      // Cualquier override reemplaza la herencia. Los include vuelven a entrar
      // por la segunda consulta y los exclude quedan correctamente fuera.
      isNull(workerCapabilityOverrides.id),
    ))

  const includedRows = await db.select({
    workerId: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    positionId: workers.positionId,
    positionName: workerPositions.name,
    capabilityCode: workerCapabilities.code,
    capabilityName: workerCapabilities.name,
  })
    .from(workerCapabilityOverrides)
    .innerJoin(workers, eq(workers.id, workerCapabilityOverrides.workerId))
    .innerJoin(workerCapabilities, eq(workerCapabilities.id, workerCapabilityOverrides.capabilityId))
    .leftJoin(workerPositions, eq(workerPositions.id, workers.positionId))
    .where(and(
      eq(workers.worksiteId, worksiteId),
      eq(workers.isActive, true),
      eq(workerCapabilities.isActive, true),
      eq(workerCapabilityOverrides.mode, "include"),
      inArray(workerCapabilities.code, codes),
    ))

  const byWorker = new Map<string, PdtpSubjectRosterMember>()
  const addRow = (
    row: (typeof inheritedRows)[number] | (typeof includedRows)[number],
    source: "position" | "override",
  ) => {
    const member = byWorker.get(row.workerId) ?? {
      workerId: row.workerId,
      workerName: `${row.firstName} ${row.lastName}`.trim(),
      positionId: row.positionId,
      positionName: row.positionName,
      matchedCapabilities: [],
    }
    const existing = member.matchedCapabilities.find((capability) => capability.code === row.capabilityCode)
    if (existing) {
      // La inclusión individual es más informativa que la herencia si ambas
      // aparecen por datos anteriores a la restricción única.
      if (source === "override") existing.source = "override"
    } else {
      member.matchedCapabilities.push({
        code: row.capabilityCode,
        name: row.capabilityName,
        source,
      })
    }
    member.matchedCapabilities.sort((left, right) => left.code.localeCompare(right.code))
    byWorker.set(row.workerId, member)
  }
  for (const row of inheritedRows) addRow(row, "position")
  for (const row of includedRows) addRow(row, "override")

  const members = [...byWorker.values()].sort((left, right) =>
    left.workerName.localeCompare(right.workerName) || left.workerId.localeCompare(right.workerId))
  const count = members.length
  return {
    source: "trabajadores_capacidad",
    status: count > 0 ? "resolved" : "pending_classification",
    count,
    capabilityCodes: codes,
    members,
    explanation: count > 0
      ? `${count} trabajador(es) activo(s) de la faena cumplen al menos una capacidad configurada.`
      : "La faena no tiene trabajadores activos clasificados con las capacidades configuradas.",
  }
}

/**
 * Resuelve el padrón junto con evidencia entendible por una pantalla o reporte.
 * Las fuentes históricas conservan su contrato de conteo; la fuente de
 * capacidades añade la nómina nominal y el origen de cada coincidencia.
 */
export async function resolvePdtpSubjectRoster(
  source: string | null,
  worksiteId: string,
  period: PdtpSubjectPeriod,
  options: PdtpSubjectRosterOptions = {},
): Promise<PdtpSubjectRosterResolution | null> {
  if (source === "trabajadores_capacidad") {
    return resolveCapabilityRoster(worksiteId, options.capabilityCodes)
  }

  let count: number | null = null
  switch (source) {
    case "dotacion": count = await countDotacion(worksiteId); break
    case "extintores": count = await countExtintores(worksiteId); break
    case "expuestos_ges": count = await countExpuestosGes(worksiteId); break
    case "equipos": count = await countEquipos(worksiteId); break
    case "trabajadores_nuevos": count = await countTrabajadoresNuevos(worksiteId, period); break
    default: return null
  }
  return {
    source,
    status: count > 0 ? "resolved" : "pending_classification",
    count,
    capabilityCodes: [],
    members: [],
    explanation: `${count} sujeto(s) resuelto(s) desde la fuente ${source}.`,
  }
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
  options: PdtpSubjectRosterOptions = {},
): Promise<number | null> {
  return (await resolvePdtpSubjectRoster(source, worksiteId, period, options))?.count ?? null
}

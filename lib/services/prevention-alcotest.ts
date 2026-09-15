/**
 * Alcotest (G14, DS 44 / DO-48).
 *
 * N°30 y N°31 tienen el mismo texto de catálogo ("Realizar alcotest") y sólo
 * difieren en el responsable declarado: PRF para la N°30, supervisor o jefe
 * de terreno para la N°31. El conector no distingue por un campo propio de la
 * fila — elige el número por el rol de quien registra el control, mismo
 * criterio que la N°64/65 de EPP (dos instrumentos, uno por rol).
 *
 * N°32 ("Envío de registros según DO-48") es un acto sobre el *lote* mensual
 * de controles, no sobre cada control: acreditarla por control repetiría el
 * error que ya documentó la N°28 (cerrar inspecciones una por una en vez de
 * por el conjunto). `alcoholTestDispatches` es la entidad de ese lote.
 */
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm"
import { db } from "@/db"
import { alcoholTestDispatches, alcoholTests, serviceEquipment, workers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { assertWorksiteAccess, type WorksiteScope } from "@/lib/services/pdtp/helpers"
import { recordPdtpFulfillmentEvent } from "@/lib/services/pdtp/fulfillment"
import { pdtpCatalogActivityIdForLegacyNumber } from "@/lib/services/pdtp-adapters/catalog-activities-2026"

/** Familia de `service_equipment` que corresponde a un alcotómetro. */
export const ALCOTEST_EQUIPMENT_KIND = "alcotest"

const ALCOTEST_PRF_ACTIVITY_NUMBER = 30
const ALCOTEST_SUP_JT_ACTIVITY_NUMBER = 31
const ALCOTEST_DISPATCH_ACTIVITY_NUMBER = 32

/** Roles que responden por la N°30 — el propio PRF. */
const PRF_ROLES = new Set(["prevencionista_faena", "prevencionista"])
/** Roles que responden por la N°31 — quien no es PRF pero controla en terreno. */
const SUP_JT_ROLES = new Set(["supervisor_terreno", "jefe_terreno"])

/**
 * Qué actividad cierra un control, según el rol de quien lo registra. `null`
 * si el rol no mapea a ninguna de las dos — el permiso de escritura ya debería
 * haberlo impedido, así que el caller lo trata como un error de datos, no
 * como un caso normal sin acreditación.
 */
export function resolveAlcotestActivityNumber(roles: string[]): number | null {
  if (roles.some((role) => PRF_ROLES.has(role))) return ALCOTEST_PRF_ACTIVITY_NUMBER
  if (roles.some((role) => SUP_JT_ROLES.has(role))) return ALCOTEST_SUP_JT_ACTIVITY_NUMBER
  return null
}

export type RecordAlcoholTestInput = {
  worksiteId: string
  testedWorkerId?: string | null
  testedPersonName?: string | null
  equipmentId?: string | null
  shift: string
  performedAt: string
  result?: "negativo" | "positivo"
  evidenceUrl?: string | null
}

/** Personas de la dotación de una faena, candidatas a ser evaluadas. */
export async function listAlcotestWorkers(scope: WorksiteScope, worksiteId?: string) {
  if (worksiteId) assertWorksiteAccess(worksiteId, scope)
  if (scope !== "all" && scope.length === 0) return []
  return db.select({
    id: workers.id, firstName: workers.firstName, lastName: workers.lastName,
    position: workers.position, worksiteId: workers.worksiteId,
  })
    .from(workers)
    .where(and(
      eq(workers.isActive, true),
      worksiteId ? eq(workers.worksiteId, worksiteId) : undefined,
      !worksiteId && scope !== "all" ? inArray(workers.worksiteId, scope) : undefined,
    ))
    .orderBy(asc(workers.lastName), asc(workers.firstName))
}

/**
 * Alcotómetros dados de alta como equipo de servicio. Su calibración se
 * controla en ese registro, que es la razón de enlazarlos: un control hecho
 * con un equipo descalibrado no prueba nada, y sin el enlace el sistema no
 * puede distinguirlo.
 */
export async function listAlcotestEquipment(scope: WorksiteScope, worksiteId?: string) {
  if (worksiteId) assertWorksiteAccess(worksiteId, scope)
  if (scope !== "all" && scope.length === 0) return []
  return db.select({
    id: serviceEquipment.id, code: serviceEquipment.code, name: serviceEquipment.name,
    brand: serviceEquipment.brand, model: serviceEquipment.model, worksiteId: serviceEquipment.worksiteId,
  })
    .from(serviceEquipment)
    .where(and(
      eq(serviceEquipment.kind, ALCOTEST_EQUIPMENT_KIND),
      eq(serviceEquipment.isActive, true),
      worksiteId ? eq(serviceEquipment.worksiteId, worksiteId) : undefined,
      !worksiteId && scope !== "all" ? inArray(serviceEquipment.worksiteId, scope) : undefined,
    ))
    .orderBy(asc(serviceEquipment.code))
}

/**
 * Registra un control y lo envía al motor de acreditación. Nace `submitted`,
 * no aprobado: `autoApproveByUserId` está reservado a fuentes cuyo cierre ya
 * es la validación completa (`accreditation.ts:169-171`), y un alcotest
 * autoregistrado no lo es.
 */
export async function recordAlcoholTest(
  input: RecordAlcoholTestInput,
  performedByUserId: string,
  performerRoles: string[],
  scope: WorksiteScope,
) {
  assertWorksiteAccess(input.worksiteId, scope)
  const activityNumber = resolveAlcotestActivityNumber(performerRoles)
  if (activityNumber === null) {
    throw new Error("Tu rol no está habilitado para registrar un alcotest en el Programa de Trabajo Preventivo.")
  }
  if (!input.testedWorkerId && !input.testedPersonName?.trim()) {
    throw new Error("Indica a quién se le tomó el control: una persona de la dotación o el nombre de un tercero.")
  }
  if (input.testedWorkerId && input.testedPersonName?.trim()) {
    throw new Error("Es una persona de la dotación o un tercero, no ambos.")
  }

  // Pertenencia a la faena, en las dos FK: un control atribuido a una persona
  // o a un equipo de otra faena es un registro que no se sostiene.
  if (input.testedWorkerId) {
    const [worker] = await db.select().from(workers).where(eq(workers.id, input.testedWorkerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error("La persona evaluada no existe o está inactiva.")
    if (worker.worksiteId !== input.worksiteId) {
      throw new Error("La persona evaluada pertenece a otra faena.")
    }
  }
  if (input.equipmentId) {
    const [equipment] = await db.select().from(serviceEquipment).where(eq(serviceEquipment.id, input.equipmentId)).limit(1)
    if (!equipment || !equipment.isActive) throw new Error("El alcotómetro no existe o está inactivo.")
    if (equipment.kind !== ALCOTEST_EQUIPMENT_KIND) throw new Error("El equipo indicado no es un alcotómetro.")
    if (equipment.worksiteId !== input.worksiteId) throw new Error("El alcotómetro pertenece a otra faena.")
  }

  const now = new Date().toISOString()
  const id = nanoid()
  const [created] = await db.insert(alcoholTests).values({
    id,
    worksiteId: input.worksiteId,
    performedByUserId,
    testedWorkerId: input.testedWorkerId ?? null,
    testedPersonName: input.testedWorkerId ? null : (input.testedPersonName?.trim() ?? null),
    equipmentId: input.equipmentId ?? null,
    shift: input.shift,
    performedAt: input.performedAt,
    result: input.result ?? "negativo",
    evidenceUrl: input.evidenceUrl ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning()

  await recordPdtpFulfillmentEvent({
    sourceType: "alcotest",
    // Sin año/mes: la clave idempotente del motor no los incluye
    // (accreditation.ts:144-151), así que cada control es su propio id.
    sourceId: `alcotest:${id}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(activityNumber)],
    occurredAt: input.performedAt,
    evidenceRef: input.evidenceUrl ?? `Control de alcotest ${id}`,
    metadata: {
      alcoholTestId: id,
      result: input.result ?? "negativo",
      testedWorkerId: input.testedWorkerId ?? null,
      testedPersonName: input.testedWorkerId ? null : (input.testedPersonName?.trim() ?? null),
      equipmentId: input.equipmentId ?? null,
    },
  })

  return created!
}

export async function listAlcoholTests(scope: WorksiteScope, worksiteId?: string) {
  if (worksiteId) assertWorksiteAccess(worksiteId, scope)
  if (scope !== "all" && scope.length === 0) return []
  const rows = await db.select().from(alcoholTests)
  const scoped = worksiteId
    ? rows.filter((row) => row.worksiteId === worksiteId)
    : scope === "all" ? rows : rows.filter((row) => scope.includes(row.worksiteId))
  return scoped.sort((a, b) => b.performedAt.localeCompare(a.performedAt))
}

export type RecordAlcoholTestDispatchInput = {
  worksiteId: string
  year: number
  month: number
  recipient: string
  evidenceUrl?: string | null
  sentAt?: string
}

/**
 * Cierra el envío mensual de un período ya transcurrido: cuenta los controles
 * de esa faena en ese (año, mes) y acredita la N°32 una sola vez por período
 * (índice único worksite+year+month evita reenviar el mismo mes dos veces).
 */
export async function recordAlcoholTestDispatch(
  input: RecordAlcoholTestDispatchInput,
  sentByUserId: string,
  scope: WorksiteScope,
) {
  assertWorksiteAccess(input.worksiteId, scope)
  const [existing] = await db.select({ id: alcoholTestDispatches.id }).from(alcoholTestDispatches).where(and(
    eq(alcoholTestDispatches.worksiteId, input.worksiteId),
    eq(alcoholTestDispatches.year, input.year),
    eq(alcoholTestDispatches.month, input.month),
  )).limit(1)
  if (existing) {
    throw new Error(`Ya se registró el envío de ${input.year}-${String(input.month).padStart(2, "0")} para esta faena.`)
  }
  const sentAt = input.sentAt ?? new Date().toISOString()

  const periodStart = new Date(Date.UTC(input.year, input.month - 1, 1)).toISOString()
  const periodEnd = new Date(Date.UTC(input.year, input.month, 1)).toISOString()
  const testsInPeriod = await db.select().from(alcoholTests).where(and(
    eq(alcoholTests.worksiteId, input.worksiteId),
    gte(alcoholTests.performedAt, periodStart),
    lt(alcoholTests.performedAt, periodEnd),
  ))

  const now = new Date().toISOString()
  const id = nanoid()
  const [created] = await db.insert(alcoholTestDispatches).values({
    id,
    worksiteId: input.worksiteId,
    year: input.year,
    month: input.month,
    sentByUserId,
    sentAt,
    recipient: input.recipient,
    evidenceUrl: input.evidenceUrl ?? null,
    testCount: testsInPeriod.length,
    createdAt: now,
    updatedAt: now,
  }).returning()

  await recordPdtpFulfillmentEvent({
    sourceType: "alcotest",
    sourceId: `alcotest-dispatch:${id}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(ALCOTEST_DISPATCH_ACTIVITY_NUMBER)],
    occurredAt: sentAt,
    evidenceRef: input.evidenceUrl ?? `Envío de registros ${input.year}-${String(input.month).padStart(2, "0")} a ${input.recipient}`,
    metadata: { alcoholTestDispatchId: id, year: input.year, month: input.month, testCount: testsInPeriod.length },
  })

  return created!
}

export async function listAlcoholTestDispatches(scope: WorksiteScope, worksiteId?: string) {
  if (worksiteId) assertWorksiteAccess(worksiteId, scope)
  if (scope !== "all" && scope.length === 0) return []
  const rows = await db.select().from(alcoholTestDispatches)
  const scoped = worksiteId
    ? rows.filter((row) => row.worksiteId === worksiteId)
    : scope === "all" ? rows : rows.filter((row) => scope.includes(row.worksiteId))
  return scoped.sort((a, b) => (b.year - a.year) || (b.month - a.month))
}

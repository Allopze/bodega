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
import { recordPdtpTriggerEventSafe } from "@/lib/services/pdtp/trigger-events"
import { pdtpCatalogActivityIdForLegacyNumber } from "@/lib/services/pdtp-adapters/catalog-activities-2026"
import { fulfillAlcotestSlotTx, resolveAlcotestSlotEvidenceRef } from "@/lib/services/prevention-alcotest-slots"
import { resolveAlcotestActivityNumber } from "@/lib/prevention/program-slots-2026"

/** Familia de `service_equipment` que corresponde a un alcotómetro. */
export const ALCOTEST_EQUIPMENT_KIND = "alcotest"

const ALCOTEST_DISPATCH_ACTIVITY_NUMBER = 32

/**
 * Qué actividad cierra un control, según el rol de quien lo registra (N°30
 * PRF, N°31 supervisor/jefe de terreno). `null` si el rol no mapea a ninguna
 * de las dos — el permiso de escritura ya debería haberlo impedido, así que el
 * caller lo trata como un error de datos, no como un caso normal sin
 * acreditación. Definida junto a la serie de casillas
 * (`program-slots-2026.ts`); se reexporta acá, donde siempre vivió.
 */
export { resolveAlcotestActivityNumber }

export type RecordAlcoholTestInput = {
  worksiteId: string
  testedWorkerId?: string | null
  testedPersonName?: string | null
  equipmentId?: string | null
  shift: string
  performedAt: string
  result?: "negativo" | "positivo"
  evidenceUrl?: string | null
  /**
   * La casilla del programa que este control cumple, si cumple alguna. Opcional
   * a propósito: un control extraordinario —una fiscalización sorpresa, un
   * ingreso fuera de turno— se registra igual y no ocupa una celda del
   * cronograma ni cuenta en el denominador.
   */
  slotId?: string | null
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
  /* El control y la casilla que cumple se escriben en la misma transacción: si
   * el registro se revierte, la casilla no puede quedar en verde sin hecho. La
   * acreditación va después del commit, para no dejar ejecuciones huérfanas. */
  const { created, slotEvidenceRef } = await db.transaction(async (tx) => {
    const [row] = await tx.insert(alcoholTests).values({
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

    if (!input.slotId) return { created: row!, slotEvidenceRef: null as string | null }
    await fulfillAlcotestSlotTx(tx, {
      slotId: input.slotId,
      worksiteId: input.worksiteId,
      userId: performedByUserId,
      testId: id,
    })
    return { created: row!, slotEvidenceRef: await resolveAlcotestSlotEvidenceRef(tx, input.slotId) }
  })

  await recordPdtpTriggerEventSafe({
    connectorKey: "alcotest",
    eventKey: "test_registered",
    sourceType: "alcotest",
    sourceId: `alcotest:${id}`,
    worksiteId: input.worksiteId,
    occurredAt: input.performedAt,
    payload: { alcoholTestId: id, testedWorkerId: input.testedWorkerId ?? null, result: input.result ?? "negativo" },
  })

  await recordPdtpFulfillmentEvent({
    sourceType: "alcotest",
    // Sin año/mes: la clave idempotente del motor no los incluye
    // (accreditation.ts:144-151), así que cada control es su propio id.
    sourceId: `alcotest:${id}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(activityNumber)],
    occurredAt: input.performedAt,
    /* La ruta del archivo de la casilla, no un rótulo inventado: un
     * `evidenceRef` sintético pasa el motor de acreditación pero no sirve ante
     * un fiscalizador, que es el único lector que importa. Un control
     * extraordinario no tiene casilla y conserva el rótulo, porque tampoco
     * acredita una celda del cronograma. */
    evidenceRef: slotEvidenceRef ?? input.evidenceUrl ?? `Control de alcotest ${id}`,
    metadata: {
      alcoholTestId: id,
      result: input.result ?? "negativo",
      testedWorkerId: input.testedWorkerId ?? null,
      testedPersonName: input.testedWorkerId ? null : (input.testedPersonName?.trim() ?? null),
      equipmentId: input.equipmentId ?? null,
    },
  })

  return created
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
  /** La casilla de envío que este registro cumple, si cumple alguna. */
  slotId?: string | null
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
  const { created, slotEvidenceRef } = await db.transaction(async (tx) => {
    const [row] = await tx.insert(alcoholTestDispatches).values({
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

    if (!input.slotId) return { created: row!, slotEvidenceRef: null as string | null }
    await fulfillAlcotestSlotTx(tx, {
      slotId: input.slotId,
      worksiteId: input.worksiteId,
      userId: sentByUserId,
      dispatchId: id,
    })
    return { created: row!, slotEvidenceRef: await resolveAlcotestSlotEvidenceRef(tx, input.slotId) }
  })

  await recordPdtpFulfillmentEvent({
    sourceType: "alcotest",
    sourceId: `alcotest-dispatch:${id}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(ALCOTEST_DISPATCH_ACTIVITY_NUMBER)],
    occurredAt: sentAt,
    evidenceRef: slotEvidenceRef
      ?? input.evidenceUrl
      ?? `Envío de registros ${input.year}-${String(input.month).padStart(2, "0")} a ${input.recipient}`,
    metadata: { alcoholTestDispatchId: id, year: input.year, month: input.month, testCount: testsInPeriod.length },
  })

  return created
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

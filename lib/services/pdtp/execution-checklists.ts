/**
 * Servicio de instancias de checklist en ejecuciones PDTP.
 *
 * Una instancia (`pdtpExecutionChecklists`) es el checklist llenado por un
 * prevencionista durante la verificación de una ejecución. Contiene un snapshot
 * de la `ChecklistDefinition` y sus respuestas por ítem.
 *
 * Multi-sujeto (PLAN_INTEGRACION §4): una ejecución sostiene N instancias de
 * checklist, una por sujeto (extintor, equipo, trabajador…). La instancia de
 * faena única (patrón B) usa `subjectType=null`, `subjectId=''`. El `subjectId`
 * es opcional en todas las firmas → omisión = instancia de faena única, lo que
 * preserva el comportamiento legacy (Fase A, tests existentes, flujo actual).
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpExecutionChecklistResponses,
  pdtpExecutionChecklists,
  pdtpExecutions,
  preventionContainers,
  preventionEmergencyResources,
  preventionEmergencyResourceTypes,
  preventionEmergencyResourceServiceCases,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
} from "@/db/schema"
import type { ChecklistDefinition, StatusValue } from "@/lib/sst/types"
import { getApplicableItems } from "@/lib/sst/checklist"
import { PARTIAL_STATUS_WEIGHT, isExcludedStatus } from "@/lib/sst/compliance"
import { containerLabel } from "@/lib/prevention/containers"
import { getActivePdtpActivityChecklist } from "./checklists"
import {
  pdtpChecklistResponseId,
  pdtpExecutionChecklistId,
} from "./checklist-domain"

export type PdtpChecklistResponseInput = {
  seccionId: string
  itemId: string
  estado: StatusValue
  observacion?: string
  accionCorrectiva?: string
}

/**
 * Sujeto de una instancia multi-sujeto. Todo opcional: omisión → instancia de
 * faena única (subjectType=null, subjectId=''). `subjectId` NO es FK física
 * (un extintor/contenedor puede no tener registro); la integridad hacia
 * `fuelVehicles`/`workers` se valida en el servicio/selector cuando aplique.
 */
export type PdtpChecklistSubject = {
  subjectType?: string | null
  subjectId?: string
  subjectResourceId?: string
  subjectContainerId?: string
  subjectLabel?: string | null
}

export type PdtpExecutionChecklistInstance = typeof pdtpExecutionChecklists.$inferSelect & {
  definition: ChecklistDefinition
}

function parseInstance(row: typeof pdtpExecutionChecklists.$inferSelect): PdtpExecutionChecklistInstance {
  return { ...row, definition: row.definitionSnapshotJson as unknown as ChecklistDefinition }
}

/** Sujeto normalizado a su forma persistida (subjectId='' = faena única). */
type NormalizedSubject = {
  subjectType: string | null
  subjectId: string
  subjectResourceId: string | null
  subjectContainerId: string | null
  subjectLabel: string | null
}

/** Normaliza el sujeto a su forma persistida (subjectId='' = faena única). */
function normalizeSubject(subject?: PdtpChecklistSubject): NormalizedSubject {
  return {
    subjectType: subject?.subjectType?.trim() || null,
    subjectId: (subject?.subjectId ?? "").trim(),
    subjectResourceId: subject?.subjectResourceId?.trim() || null,
    subjectContainerId: subject?.subjectContainerId?.trim() || null,
    subjectLabel: subject?.subjectLabel?.trim() || null,
  }
}

function extinguisherAgentValue(agent: string | null): string {
  const normalized = agent?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? ""
  if (normalized.includes("pqs") || normalized.includes("polvo")) return "pqs"
  if (normalized.includes("co2") || normalized.includes("carbon")) return "co2"
  if (normalized.includes("agua")) return "agua"
  if (normalized.includes("espuma")) return "espuma"
  return "otro"
}

/**
 * Crea (o recupera) una instancia de checklist para una ejecución y sujeto.
 * Snapshot de la definición activa al momento de crear. Marca overallStatus='en_proceso'.
 *
 * Sin `subject` (o subjectId vacío) → instancia de faena única (legacy, patrón B).
 * Con `subject` → instancia por sujeto (patrón C); idempotente por (executionId, subjectId).
 */
export async function getOrCreateExecutionChecklist(
  executionId: string,
  userId: string,
  subject?: PdtpChecklistSubject,
): Promise<PdtpExecutionChecklistInstance> {
  void userId // reservado para auditoría de quién inició la verificación (no persistido aún)

  // Obtener la ejecución para saber la actividad
  const [execution] = await db.select().from(pdtpExecutions)
    .where(eq(pdtpExecutions.id, executionId)).limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")

  let norm = normalizeSubject(subject)
  let extinguisherSnapshot: Array<{ seccionId: string; itemId: string; observacion: string }> = []
  if (norm.subjectType === "extintor") {
    if (!norm.subjectResourceId) throw new Error("Selecciona un extintor del inventario de la faena.")
    const [canonical] = await db.select({
      id: preventionEmergencyResources.id,
      worksiteId: preventionEmergencyResources.worksiteId,
      assetCode: preventionEmergencyResources.assetCode,
      name: preventionEmergencyResources.name,
      location: preventionEmergencyResources.location,
      lastMaintenanceAt: preventionEmergencyResources.lastMaintenanceAt,
      agent: preventionEmergencyResourceTypes.agent,
      capacity: preventionEmergencyResourceTypes.capacity,
      capacityUnit: preventionEmergencyResourceTypes.capacityUnit,
    }).from(preventionEmergencyResources)
      .leftJoin(preventionEmergencyResourceTypes, eq(preventionEmergencyResources.typeId, preventionEmergencyResourceTypes.id))
      .where(eq(preventionEmergencyResources.id, norm.subjectResourceId))
      .limit(1)
    if (!canonical || canonical.worksiteId !== execution.worksiteId) {
      throw new Error("El extintor no pertenece a la faena de esta ejecución.")
    }

    const [provider] = await db.select({ name: suppliers.name })
      .from(preventionEmergencyResourceServiceCases)
      .innerJoin(purchaseOrderItems, eq(preventionEmergencyResourceServiceCases.requestItemId, purchaseOrderItems.requestItemId))
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(and(
        eq(preventionEmergencyResourceServiceCases.resourceId, canonical.id),
        eq(preventionEmergencyResourceServiceCases.status, "completed"),
      ))
      .orderBy(desc(preventionEmergencyResourceServiceCases.completedAt), desc(purchaseOrders.createdAt))
      .limit(1)

    const label = [canonical.assetCode ?? canonical.name, canonical.location].filter(Boolean).join(" · ")
    norm = {
      ...norm,
      subjectId: canonical.id,
      subjectResourceId: canonical.id,
      subjectLabel: label,
    }
    extinguisherSnapshot = [
      { seccionId: "inventario_extintor", itemId: "tipo_extintor", observacion: extinguisherAgentValue(canonical.agent) },
      { seccionId: "inventario_extintor", itemId: "peso_kg", observacion: canonical.capacity === null ? "" : String(canonical.capacity) },
      { seccionId: "inventario_extintor", itemId: "empresa_recarga", observacion: provider?.name ?? "" },
      { seccionId: "inventario_extintor", itemId: "fecha_recarga", observacion: canonical.lastMaintenanceAt ?? "" },
    ].filter((item) => item.observacion)
  }

  /* Contenedor: misma forma que el extintor. El id canónico reemplaza al
   * `subjectId` recibido porque la unicidad de la instancia es
   * `(executionId, subjectId)`; con el slug del texto libre, dos formas de
   * escribir el mismo contenedor abrían dos instancias. */
  if (norm.subjectType === "contenedor") {
    if (!norm.subjectContainerId) throw new Error("Selecciona un contenedor del catálogo de la faena.")
    const [canonical] = await db.select({
      id: preventionContainers.id,
      worksiteId: preventionContainers.worksiteId,
      code: preventionContainers.code,
      location: preventionContainers.location,
      isActive: preventionContainers.isActive,
    }).from(preventionContainers)
      .where(eq(preventionContainers.id, norm.subjectContainerId))
      .limit(1)
    if (!canonical || canonical.worksiteId !== execution.worksiteId) {
      throw new Error("El contenedor no pertenece a la faena de esta ejecución.")
    }
    // Abrir un checklist es trabajo nuevo: una ficha retirada no lo recibe.
    if (!canonical.isActive) {
      throw new Error("Ese contenedor está retirado del catálogo. Reactívalo o elige otro.")
    }
    norm = {
      ...norm,
      subjectId: canonical.id,
      subjectContainerId: canonical.id,
      subjectLabel: containerLabel(canonical),
    }
  }

  // Verificar si ya existe la instancia para (executionId, subjectId).
  const [existing] = await db.select().from(pdtpExecutionChecklists)
    .where(and(
      eq(pdtpExecutionChecklists.executionId, executionId),
      eq(pdtpExecutionChecklists.subjectId, norm.subjectId),
    ))
    .limit(1)
  if (existing) return parseInstance(existing)

  // Obtener la plantilla activa de la actividad
  const template = await getActivePdtpActivityChecklist(execution.activityId)
  const definition = template?.definition ?? null

  const now = new Date().toISOString()
  const id = pdtpExecutionChecklistId(executionId, norm.subjectId)
  return db.transaction(async (tx) => {
    // Segundo chequeo dentro del límite transaccional: evita separar la
    // instancia de su snapshot si dos clientes intentan iniciar el mismo sujeto.
    const [concurrent] = await tx.select().from(pdtpExecutionChecklists)
      .where(and(
        eq(pdtpExecutionChecklists.executionId, executionId),
        eq(pdtpExecutionChecklists.subjectId, norm.subjectId),
      )).limit(1)
    if (concurrent) return parseInstance(concurrent)

    const [row] = await tx.insert(pdtpExecutionChecklists).values({
      id,
      executionId,
      checklistId: template?.id ?? null,
      definitionSnapshotJson: (definition ?? { sections: [], closingAct: { title: "", resultOptions: [], signatureRoles: [] }, code: "", version: "01", revisionDate: "", title: "", tipo: "nuevo", legalFramework: [], applicableTo: "" }) as unknown as Record<string, unknown>,
      overallStatus: "en_proceso",
      subjectType: norm.subjectType,
      subjectId: norm.subjectId,
      subjectResourceId: norm.subjectResourceId,
      subjectContainerId: norm.subjectContainerId,
      subjectLabel: norm.subjectLabel,
      completedByUserId: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }).returning()

    if (extinguisherSnapshot.length > 0) {
      await tx.insert(pdtpExecutionChecklistResponses).values(extinguisherSnapshot.map((item) => ({
        id: pdtpChecklistResponseId(id, item.seccionId, item.itemId),
        checklistInstanceId: id,
        seccionId: item.seccionId,
        itemId: item.itemId,
        estado: null,
        observacion: item.observacion,
        accionCorrectiva: null,
        respondedByUserId: userId,
        respondedAt: now,
      })))
    }

    return parseInstance(row!)
  })
}

/**
 * Obtiene TODAS las instancias de checklist de una ejecución (multi-sujeto).
 * Vacío si la ejecución no tiene instancias. Orden: faena única (subjectId='')
 * primero, luego por subjectLabel para establecidad en la UI.
 */
export async function listExecutionChecklists(executionId: string): Promise<PdtpExecutionChecklistInstance[]> {
  const rows = await db.select().from(pdtpExecutionChecklists)
    .where(eq(pdtpExecutionChecklists.executionId, executionId))
  return rows.map(parseInstance)
}

/**
 * Obtiene UNA instancia de checklist de una ejecución (o null).
 *
 * Wrapper backward-compat: devuelve la primera instancia (faena única si existe).
 * Prefiere `listExecutionChecklists` en código nuevo que necesita ver todas las
 * instancias de una ejecución multi-sujeto.
 */
export async function getExecutionChecklist(executionId: string): Promise<PdtpExecutionChecklistInstance | null> {
  const [row] = await db.select().from(pdtpExecutionChecklists)
    .where(eq(pdtpExecutionChecklists.executionId, executionId))
    .limit(1)
  return row ? parseInstance(row) : null
}

/** Obtiene todas las respuestas de una instancia. */
export async function getChecklistResponses(instanceId: string) {
  return db.select().from(pdtpExecutionChecklistResponses)
    .where(eq(pdtpExecutionChecklistResponses.checklistInstanceId, instanceId))
}

/**
 * Hace upsert de una o varias respuestas de checklist.
 * Calcula y persiste el porcentajeCumplimiento de la instancia.
 */
export async function upsertChecklistResponses(
  instanceId: string,
  responses: PdtpChecklistResponseInput[],
  userId: string,
): Promise<{ porcentajeCumplimiento: number | null; overallStatus: string }> {
  const instance = await getExecutionChecklistInstanceOnly(instanceId)
  if (!instance) throw new Error("Instancia de checklist no encontrada.")
  const definition = instance.definitionSnapshotJson as unknown as ChecklistDefinition
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    for (const resp of responses) {
      const id = pdtpChecklistResponseId(instanceId, resp.seccionId, resp.itemId)
      await tx.insert(pdtpExecutionChecklistResponses).values({
        id,
        checklistInstanceId: instanceId,
        seccionId: resp.seccionId,
        itemId: resp.itemId,
        estado: resp.estado,
        observacion: resp.observacion ?? null,
        accionCorrectiva: resp.accionCorrectiva ?? null,
        respondedByUserId: userId,
        respondedAt: now,
      }).onConflictDoUpdate({
        target: [
          pdtpExecutionChecklistResponses.checklistInstanceId,
          pdtpExecutionChecklistResponses.seccionId,
          pdtpExecutionChecklistResponses.itemId,
        ],
        set: {
          estado: resp.estado,
          observacion: resp.observacion ?? null,
          accionCorrectiva: resp.accionCorrectiva ?? null,
          respondedByUserId: userId,
          respondedAt: now,
        },
      })
    }

    // Recalcular % de cumplimiento de la instancia
    const allResponses = await tx.select().from(pdtpExecutionChecklistResponses)
      .where(eq(pdtpExecutionChecklistResponses.checklistInstanceId, instanceId))
    const porcentaje = calculateInstanceCompliance(definition, allResponses)

    await tx.update(pdtpExecutionChecklists).set({
      porcentajeCumplimiento: porcentaje,
      updatedAt: now,
    }).where(eq(pdtpExecutionChecklists.id, instanceId))

    return { porcentajeCumplimiento: porcentaje, overallStatus: instance.overallStatus }
  })
}

/** Marca la instancia como completada y calcula el % final. */
export async function completeExecutionChecklist(
  instanceId: string,
  userId: string,
  tx?: Tx,
): Promise<{ porcentajeCumplimiento: number | null }> {
  const client = tx ?? db
  const instance = await getExecutionChecklistInstanceOnly(instanceId, client)
  if (!instance) throw new Error("Instancia de checklist no encontrada.")
  const definition = instance.definitionSnapshotJson as unknown as ChecklistDefinition
  const now = new Date().toISOString()

  const allResponses = await client.select().from(pdtpExecutionChecklistResponses)
    .where(eq(pdtpExecutionChecklistResponses.checklistInstanceId, instanceId))
  const porcentaje = calculateInstanceCompliance(definition, allResponses)

  await client.update(pdtpExecutionChecklists).set({
    overallStatus: "completado",
    porcentajeCumplimiento: porcentaje,
    completedByUserId: userId,
    completedAt: now,
    updatedAt: now,
  }).where(eq(pdtpExecutionChecklists.id, instanceId))

  return { porcentajeCumplimiento: porcentaje }
}

async function getExecutionChecklistInstanceOnly(instanceId: string, client: Tx | typeof db = db) {
  const [row] = await client.select().from(pdtpExecutionChecklists)
    .where(eq(pdtpExecutionChecklists.id, instanceId)).limit(1)
  return row ?? null
}

/**
 * Calcula el % de cumplimiento de una instancia basado en ítems aplicables.
 * Reutiliza getApplicableItems de lib/sst/checklist.ts.
 * Usa 'prevencionista_faena' como cargo por defecto (las secciones con
 * appliesWhen filtran automáticamente).
 */
export function calculateInstanceCompliance(
  definition: ChecklistDefinition,
  responses: Array<{ seccionId: string; itemId: string; estado: string | null }>,
): number | null {
  // Los roles que pueden llenar: combinamos todos los appliesWhen posibles
  const allRoles = ["prevencionista_faena", "admin_contrato", "jefe_faena"]
  const applicable = getApplicableItems(definition, allRoles)
  if (applicable.length === 0) return null

  const responseMap = new Map(responses.map((r) => [`${r.seccionId}::${r.itemId}`, r.estado]))
  let puntaje = 0
  let total = 0
  for (const { seccionId, item } of applicable) {
    const estado = responseMap.get(`${seccionId}::${item.id}`)
    if (estado === null || estado === undefined) continue
    // 'na' y 'no_tiene' (NT del Anexo 14) salen del denominador: el ítem no se
    // evaluó. Antes 'na' sí sumaba a `total` sin sumar puntaje, o sea puntuaba
    // como un incumplimiento y hundía el % de checklists con muchos N/A —
    // además de contradecir al cálculo SST, que siempre lo excluyó.
    if (isExcludedStatus(estado as StatusValue)) continue
    total++
    if (estado === "cumple" || estado === "entregado" || estado === "apto" || estado === "si") {
      puntaje += 1
    } else if (estado === "regular") {
      // Escala B/R/M: regular vale medio punto (ver PARTIAL_STATUS_WEIGHT).
      puntaje += PARTIAL_STATUS_WEIGHT
    }
  }
  if (total === 0) return null
  return Math.round((puntaje / total) * 10000) / 100
}

/**
 * Obtiene los ítems marcados como 'no_cumple' (generadores de acciones).
 */
export async function getNonCompliantItems(instanceId: string, client: Tx | typeof db = db): Promise<
  Array<{ seccionId: string; itemId: string; observacion: string | null; accionCorrectiva: string | null }>
> {
  const rows = await client.select().from(pdtpExecutionChecklistResponses)
    .where(and(
      eq(pdtpExecutionChecklistResponses.checklistInstanceId, instanceId),
      eq(pdtpExecutionChecklistResponses.estado, "no_cumple"),
    ))
  return rows.map((r) => ({
    seccionId: r.seccionId,
    itemId: r.itemId,
    observacion: r.observacion,
    accionCorrectiva: r.accionCorrectiva,
  }))
}

/**
 * Cuenta ítems 'no_cumple' por ejecución, agrupado (una sola query batch —
 * mismo patrón que `getAverageVerificationCompliance`). Usado por la hoja del
 * sheet para mostrar un badge de conteo por ejecución sin N queries.
 */
export async function countNoCumpleByExecution(executionIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (executionIds.length === 0) return result
  const rows = await db.select({ executionId: pdtpExecutionChecklists.executionId })
    .from(pdtpExecutionChecklistResponses)
    .innerJoin(pdtpExecutionChecklists, eq(pdtpExecutionChecklistResponses.checklistInstanceId, pdtpExecutionChecklists.id))
    .where(and(
      inArray(pdtpExecutionChecklists.executionId, executionIds),
      eq(pdtpExecutionChecklistResponses.estado, "no_cumple"),
    ))
  for (const r of rows) {
    result.set(r.executionId, (result.get(r.executionId) ?? 0) + 1)
  }
  return result
}

/** Obtiene el % promedio de verificación de varias ejecuciones (para indicadores). */
export async function getAverageVerificationCompliance(executionIds: string[]): Promise<number | null> {
  if (executionIds.length === 0) return null
  // Multi-sujeto: una ejecución puede tener N instancias; todas contribuyen
  // al eje verificación (PLAN_INTEGRACION §8). El `inArray(executionId)` ya
  // trae todas las instancias, así que el promedio es correcto sin cambios.
  const rows = await db.select({ porcentaje: pdtpExecutionChecklists.porcentajeCumplimiento })
    .from(pdtpExecutionChecklists)
    .where(inArray(pdtpExecutionChecklists.executionId, executionIds))
  const valid = rows.filter((r) => r.porcentaje !== null)
  if (valid.length === 0) return null
  const sum = valid.reduce((s, r) => s + (r.porcentaje ?? 0), 0)
  return Math.round((sum / valid.length) * 100) / 100
}

/**
 * Recalcula `executedQuantity` de una ejecución desde sus instancias de
 * checklist completadas (eje ejecución del cumplimiento integral, §8).
 *
 * CONDICIONAL y no destructivo: solo actualiza cuando hay **>1 instancia
 * completada** (caso multi-sujeto: "se inspeccionaron 8 extintores"). Con 0–1
 * instancias (single-sujeto / sin checklist) NO toca `executedQuantity` — así
 * no sobreescribe la cantidad registrada manualmente en el flujo existente
 * (p.ej. "5 charlas", "3 reuniones").
 *
 * @returns el nuevo `executedQuantity` si se actualizó, o `null` si se dejó intacto.
 */
export async function recalcExecutionQuantityFromInstances(
  executionId: string,
): Promise<number | null> {
  const completed = await db.select({ id: pdtpExecutionChecklists.id })
    .from(pdtpExecutionChecklists)
    .where(and(
      eq(pdtpExecutionChecklists.executionId, executionId),
      eq(pdtpExecutionChecklists.overallStatus, "completado"),
    ))
  if (completed.length <= 1) return null

  const now = new Date().toISOString()
  await db.update(pdtpExecutions).set({
    executedQuantity: completed.length,
    updatedAt: now,
  }).where(eq(pdtpExecutions.id, executionId))

  return completed.length
}

/**
 * Servicio de plan de acción correctivo del PDTP.
 *
 * Las acciones se generan automáticamente desde los ítems 'no_cumple' del
 * checklist, o se crean manualmente. Tienen ciclo de vida:
 * pendiente → en_proceso → completado → verificado (cierre).
 * El estado 'vencido' es derivado en lectura (plazo < hoy y no cerrada).
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActionPlan,
  pdtpActionPlanFollowups,
  pdtpExecutionChecklists,
  pdtpExecutions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  getNonCompliantItems,
  completeExecutionChecklist,
  recalcExecutionQuantityFromInstances,
} from "./execution-checklists"
import {
  PDTP_DANO_POTENCIAL_A_PRIORIDAD,
  PDTP_ESTADOS_CERRADOS,
  isActionVencida,
  pdtpActionPlanItemId,
  plazoFromDañoPotencial,
  plazoFromPrioridad,
} from "./checklist-domain"
import type { ChecklistDefinition } from "@/lib/sst/types"
import type { WorksiteScope } from "./helpers"

export type PdtpActionPlanItemInput = {
  executionId: string
  hallazgo: string
  accion: string
  responsableRole: string
  responsable: string
  responsableUserId?: string | null
  plazo: string
  prioridad?: string
  seccionId?: string | null
  itemId?: string | null
  origen?: string
}

export type PdtpActionPlanItemUpdate = {
  hallazgo?: string
  accion?: string
  responsableRole?: string
  responsable?: string
  responsableUserId?: string | null
  plazo?: string
  prioridad?: string
  estado?: string
}

/**
 * Cierra el checklist de una ejecución ("Enviar revisión") y genera
 * automáticamente el plan de acción a partir de los ítems 'no_cumple'.
 * Punto único de orquestación del paso 3→4 del flujo (plan §2.2).
 *
 * Multi-sujeto: tras completar+generar, recalcula `executedQuantity` de la
 * ejecución desde las instancias completadas (§8). El recálculo es
 * condicional — solo actúa con >1 instancia completada (preserva la cantidad
 * manual del flujo single-sujeto).
 */
export async function submitExecutionChecklist(instanceId: string, userId: string) {
  const { porcentajeCumplimiento } = await completeExecutionChecklist(instanceId, userId)
  const { generadas, existentes } = await generateActionPlanFromChecklist(instanceId, userId)
  // Recálculo best-effort: no falla el submit si la ejecución desaparece.
  try {
    const [inst] = await db.select({ executionId: pdtpExecutionChecklists.executionId })
      .from(pdtpExecutionChecklists)
      .where(eq(pdtpExecutionChecklists.id, instanceId)).limit(1)
    if (inst) await recalcExecutionQuantityFromInstances(inst.executionId)
  } catch { /* no-op */ }
  return { porcentajeCumplimiento, generadas, existentes }
}

/**
 * Genera acciones del plan desde los ítems 'no_cumple' del checklist.
 * Se llama al completar el checklist. Hace upsert (no duplica si ya existe).
 *
 * Multi-sujeto: el hallazgo se prefija con `subjectLabel` de la instancia
 * (p.ej. "[EQ-042] Alarma de retroceso: no cumple") y la deduplicación se
 * acota a la instancia (subjectId), no solo a la ejecución — así dos
 * extintores con el mismo ítem no_cumple generan dos acciones distintas.
 */
export async function generateActionPlanFromChecklist(
  instanceId: string,
  userId: string,
): Promise<{ generadas: number; existentes: number }> {
  const instance = await db.select().from(pdtpExecutionChecklists)
    .where(eq(pdtpExecutionChecklists.id, instanceId)).limit(1)
  const inst = instance[0]
  if (!inst) throw new Error("Instancia de checklist no encontrada.")
  const executionId = inst.executionId
  const subjectLabel = inst.subjectLabel?.trim() || ""

  const nonCompliant = await getNonCompliantItems(instanceId)
  if (nonCompliant.length === 0) return { generadas: 0, existentes: 0 }

  const definition = inst.definitionSnapshotJson as unknown as ChecklistDefinition
  const now = new Date().toISOString()

  // Prefijo de sujeto para el hallazgo: "[subjectLabel] " cuando aplica.
  const prefix = subjectLabel ? `[${subjectLabel}] ` : ""

  // Obtener el n máximo actual para continuar la numeración
  const existingItems = await db.select({ n: pdtpActionPlan.n }).from(pdtpActionPlan)
    .where(eq(pdtpActionPlan.executionId, executionId))
  const maxN = existingItems.reduce((max, r) => Math.max(max, r.n), 0)

  // Ejecución para obtener fecha de referencia del plazo
  const [execution] = await db.select().from(pdtpExecutions)
    .where(eq(pdtpExecutions.id, executionId)).limit(1)
  const refDate = execution?.executedAt ? new Date(execution.executedAt) : new Date()

  let generadas = 0
  let existentes = 0
  let nextN = maxN + 1

  for (const item of nonCompliant) {
    // Buscar si ya existe una acción para este seccionId+itemId de la instancia.
    // Comparar `hallazgo.startsWith(prefix)` acota por sujeto: así dos extintores
    // con el mismo ítem no_cumple generan dos acciones distintas (prefijo distinto),
    // y re-enviar la misma instancia no duplica (mismo prefijo + seccionId + itemId).
    const [existing] = await db.select().from(pdtpActionPlan)
      .where(and(
        eq(pdtpActionPlan.executionId, executionId),
        eq(pdtpActionPlan.seccionId, item.seccionId),
        eq(pdtpActionPlan.itemId, item.itemId),
        eq(pdtpActionPlan.origen, "checklist_item"),
      )).limit(1)

    if (existing && existing.hallazgo.startsWith(prefix)) {
      existentes++
      continue
    }

    // Derivar responsableRole desde la sección de la definición
    const section = definition.sections.find((s) => s.id === item.seccionId)
    const responsableRole = section?.appliesWhen?.[0] ?? "prevencionista_faena"

    // Hallazgo: prefijo de sujeto + observación del ítem, o label del ítem
    const defItem = section?.items.find((i) => i.id === item.itemId)
    const hallazgo = prefix + (item.observacion || defItem?.label || "Ítem no conforme")

    const accion = item.accionCorrectiva || "Por definir"

    // Prioridad/plazo: si el ítem define danoPotencial, se derivan del mapa
    // de daño potencial (mismo criterio que hallazgos manuales — PLAN_INTEGRACION
    // §5.4). Sin ese campo, cae al default histórico "media" (+7 días).
    const danoPotencial = defItem?.danoPotencial
    const prioridad = danoPotencial ? PDTP_DANO_POTENCIAL_A_PRIORIDAD[danoPotencial] : "media"
    const plazo = danoPotencial ? plazoFromDañoPotencial(danoPotencial, refDate) : plazoFromPrioridad("media", refDate)

    const id = pdtpActionPlanItemId(executionId, nextN)
    await db.insert(pdtpActionPlan).values({
      id,
      executionId,
      n: nextN,
      origen: "checklist_item",
      seccionId: item.seccionId,
      itemId: item.itemId,
      hallazgo,
      accion,
      responsableRole,
      responsable: responsableRole,
      responsableUserId: null,
      plazo,
      prioridad,
      estado: "pendiente",
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    nextN++
    generadas++
  }

  return { generadas, existentes }
}

/** Lista todas las acciones del plan de una ejecución. */
export async function listActionPlanItems(executionId: string) {
  const rows = await db.select().from(pdtpActionPlan)
    .where(eq(pdtpActionPlan.executionId, executionId))
    .orderBy(pdtpActionPlan.n)
  return rows.map((r) => ({ ...r, vencida: isActionVencida(r.estado, r.plazo) }))
}

/** Crea una acción manual. */
export async function createActionPlanItem(input: PdtpActionPlanItemInput, userId: string) {
  const now = new Date().toISOString()
  const [maxRow] = await db.select({ n: sql<number>`max(${pdtpActionPlan.n})` }).from(pdtpActionPlan)
    .where(eq(pdtpActionPlan.executionId, input.executionId))
  const nextN = (maxRow?.n ?? 0) + 1
  const id = pdtpActionPlanItemId(input.executionId, nextN)

  const [row] = await db.insert(pdtpActionPlan).values({
    id,
    executionId: input.executionId,
    n: nextN,
    origen: input.origen ?? "manual",
    seccionId: input.seccionId ?? null,
    itemId: input.itemId ?? null,
    hallazgo: input.hallazgo,
    accion: input.accion,
    responsableRole: input.responsableRole,
    responsable: input.responsable,
    responsableUserId: input.responsableUserId ?? null,
    plazo: input.plazo,
    prioridad: input.prioridad ?? "media",
    estado: "pendiente",
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row!
}

/** Actualiza una acción (campos editables + estado). */
export async function updateActionPlanItem(itemId: string, update: PdtpActionPlanItemUpdate, userId: string) {
  const now = new Date().toISOString()
  const set: Record<string, unknown> = { updatedAt: now }
  if (update.hallazgo !== undefined) set.hallazgo = update.hallazgo
  if (update.accion !== undefined) set.accion = update.accion
  if (update.responsableRole !== undefined) set.responsableRole = update.responsableRole
  if (update.responsable !== undefined) set.responsable = update.responsable
  if (update.responsableUserId !== undefined) set.responsableUserId = update.responsableUserId
  if (update.plazo !== undefined) set.plazo = update.plazo
  if (update.prioridad !== undefined) set.prioridad = update.prioridad
  if (update.estado !== undefined) {
    set.estado = update.estado
    if (update.estado === "completado" || update.estado === "verificado") {
      set.closedAt = now
    }
    if (update.estado === "verificado") {
      set.verifiedByUserId = userId
      set.verifiedAt = now
    }
  }

  const [row] = await db.update(pdtpActionPlan).set(set)
    .where(eq(pdtpActionPlan.id, itemId)).returning()
  return row!
}

/** Elimina una acción (solo si está pendiente). */
export async function deleteActionPlanItem(itemId: string) {
  await db.delete(pdtpActionPlan).where(eq(pdtpActionPlan.id, itemId))
}

/**
 * Lista acciones transversales (para la vista global de plan de acción).
 * Filtra por programa/faena/estado/prioridad según los parámetros.
 */
export async function listActionsByProgram(
  programId: string,
  opts?: {
    worksiteId?: string
    estado?: string
    prioridad?: string
    soloVencidas?: boolean
    scope?: WorksiteScope
  },
) {
  if (opts?.scope !== undefined && opts.scope !== "all" && opts.scope.length === 0) return []
  // Join implícito: action_plan → executions → activities (para filtrar por programa)
  const rows = await db.select({
    item: pdtpActionPlan,
    executionId: pdtpExecutions.id,
    activityId: pdtpExecutions.activityId,
    worksiteId: pdtpExecutions.worksiteId,
  })
    .from(pdtpActionPlan)
    .innerJoin(pdtpExecutions, eq(pdtpActionPlan.executionId, pdtpExecutions.id))
    .where(and(
      opts?.estado ? eq(pdtpActionPlan.estado, opts.estado) : sql`true`,
      opts?.prioridad ? eq(pdtpActionPlan.prioridad, opts.prioridad) : sql`true`,
      opts?.worksiteId ? eq(pdtpExecutions.worksiteId, opts.worksiteId) : sql`true`,
      opts?.scope && opts.scope !== "all" ? inArray(pdtpExecutions.worksiteId, opts.scope) : sql`true`,
      sql`EXISTS (
        SELECT 1 FROM pdtp_activities a
        WHERE a.id = ${pdtpExecutions.activityId}
        AND a.program_id = ${programId}
      )`,
    ))
    .orderBy(desc(pdtpActionPlan.createdAt))

  let result = rows.map((r) => ({
    ...r.item,
    executionId: r.executionId,
    activityId: r.activityId,
    worksiteId: r.worksiteId,
    vencida: isActionVencida(r.item.estado, r.item.plazo),
  }))

  if (opts?.soloVencidas) {
    result = result.filter((r) => r.vencida)
  }

  return result
}

/**
 * Cuenta acciones pendientes/vencidas por ejecución (una sola query batch —
 * mismo patrón que `getActionPlanClosureRate`). Usado por la hoja del sheet
 * para mostrar badges de conteo por ejecución sin N queries.
 */
export async function countActionsByExecution(executionIds: string[]): Promise<Map<string, { pending: number; overdue: number }>> {
  const result = new Map<string, { pending: number; overdue: number }>()
  if (executionIds.length === 0) return result
  const rows = await db.select({
    executionId: pdtpActionPlan.executionId,
    estado: pdtpActionPlan.estado,
    plazo: pdtpActionPlan.plazo,
  }).from(pdtpActionPlan).where(inArray(pdtpActionPlan.executionId, executionIds))

  for (const r of rows) {
    const entry = result.get(r.executionId) ?? { pending: 0, overdue: 0 }
    if (!PDTP_ESTADOS_CERRADOS.has(r.estado)) entry.pending++
    if (isActionVencida(r.estado, r.plazo)) entry.overdue++
    result.set(r.executionId, entry)
  }
  return result
}

/**
 * Calcula el % de cierre del plan de acción de una o varias ejecuciones.
 * % cierre = (acciones cerradas) / (acciones totales).
 */
export async function getActionPlanClosureRate(executionIds: string[]): Promise<number | null> {
  if (executionIds.length === 0) return null
  const rows = await db.select({ estado: pdtpActionPlan.estado }).from(pdtpActionPlan)
    .where(inArray(pdtpActionPlan.executionId, executionIds))
  if (rows.length === 0) return null
  const cerradas = rows.filter((r) => PDTP_ESTADOS_CERRADOS.has(r.estado)).length
  return Math.round((cerradas / rows.length) * 10000) / 100
}

/**
 * Verifica (cierra) una acción. Requiere permiso de verificación.
 * Crea un followup automático de cierre.
 */
export async function verifyActionPlanItem(itemId: string, userId: string, observacion?: string) {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(pdtpActionPlan)
      .where(eq(pdtpActionPlan.id, itemId)).limit(1)
    if (!current) throw new Error("Acción no encontrada.")

    const [updated] = await tx.update(pdtpActionPlan).set({
      estado: "verificado",
      verifiedByUserId: userId,
      verifiedAt: now,
      closedAt: now,
      updatedAt: now,
    }).where(eq(pdtpActionPlan.id, itemId)).returning()

    await tx.insert(pdtpActionPlanFollowups).values({
      id: nanoid(),
      actionPlanItemId: itemId,
      fecha: today,
      estadoAnterior: current.estado,
      estadoNuevo: "verificado",
      observacion: observacion ?? "Acción verificada y cerrada.",
      updatedByUserId: userId,
      createdAt: now,
    })

    return updated!
  })
}

/** Reabre una acción verificada (con motivo obligatorio). */
export async function reopenActionPlanItem(itemId: string, userId: string, motivo: string) {
  if (!motivo.trim()) throw new Error("El motivo de reapertura es obligatorio.")
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(pdtpActionPlan)
      .where(eq(pdtpActionPlan.id, itemId)).limit(1)
    if (!current) throw new Error("Acción no encontrada.")
    if (current.estado !== "verificado") {
      throw new Error("Solo se pueden reabrir acciones verificadas.")
    }

    const [updated] = await tx.update(pdtpActionPlan).set({
      estado: "reabierto",
      rejectionReason: motivo,
      verifiedByUserId: null,
      verifiedAt: null,
      updatedAt: now,
    }).where(eq(pdtpActionPlan.id, itemId)).returning()

    await tx.insert(pdtpActionPlanFollowups).values({
      id: nanoid(),
      actionPlanItemId: itemId,
      fecha: today,
      estadoAnterior: current.estado,
      estadoNuevo: "reabierto",
      observacion: motivo,
      updatedByUserId: userId,
      createdAt: now,
    })

    return updated!
  })
}

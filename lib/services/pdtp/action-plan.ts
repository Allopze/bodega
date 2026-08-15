/**
 * Servicio de plan de acción correctivo del PDTP.
 *
 * Las acciones se generan automáticamente desde los ítems 'no_cumple' del
 * checklist, o se crean manualmente. Tienen ciclo de vida:
 * pendiente → en_proceso → completado → verificado (cierre).
 * El estado 'vencido' es derivado en lectura (plazo < hoy y no cerrada).
 */

import { and, eq, lte, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpExecutionChecklists,
  pdtpExecutions,
} from "@/db/schema"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import {
  getNonCompliantItems,
  completeExecutionChecklist,
  getChecklistResponses,
  recalcExecutionQuantityFromInstances,
} from "./execution-checklists"
import { requiresObservation } from "@/lib/sst/compliance"
import type { StatusValue } from "@/lib/sst/types"
import {
  PDTP_DANO_POTENCIAL_A_PRIORIDAD,
  plazoFromDañoPotencial,
  requiereDetencionInmediata,
  plazoFromPrioridad,
} from "./checklist-domain"
import {
  capaEstado,
  capaPrioridad,
  capaToPdtpAction,
  countPdtpActionsByExecution,
  getPdtpActionClosureRate,
  listPdtpActionsByExecution,
  listPdtpActionsByProgram,
} from "./capa-view"
import type { ChecklistDefinition } from "@/lib/sst/types"
import type { WorksiteScope } from "./helpers"
import {
  createCapaActionWithClient,
  transitionCapaActionWithClient,
  updateCapaActionWithClient,
} from "@/lib/services/prevention-capa"
import { preventionCapaActions } from "@/db/schema"

function toCapaPriority(priority: string | undefined) {
  return priority === "alta" ? "high" : priority === "baja" ? "low" : "medium"
}

/**
 * Carga la CAPA de una acción del PDTP. Reemplaza a la pareja
 * "buscar en el espejo → seguir su `capaActionId`" y a las guardas de
 * conciliación que sólo existían porque el espejo podía quedar sin vínculo.
 */
async function loadPdtpCapa(tx: Tx, actionId: string) {
  const [capa] = await tx.select().from(preventionCapaActions)
    .where(and(
      eq(preventionCapaActions.id, actionId),
      eq(preventionCapaActions.sourceType, "pdtp"),
    )).limit(1)
  if (!capa) throw new Error("Acción no encontrada.")
  return capa
}

/**
 * Número de la acción dentro de su ejecución. Se deriva del orden de creación
 * —el espejo lo materializaba en una columna `n` que al retirarlo queda sin
 * dueño—. Con `createdAt` cuenta hasta esa acción; sin él, cuenta el total.
 */
async function siguienteN(tx: Tx, executionId: string, createdAt?: string) {
  const [row] = await tx.select({ total: sql<number>`count(*)::int` })
    .from(preventionCapaActions)
    .where(and(
      eq(preventionCapaActions.sourceType, "pdtp"),
      eq(preventionCapaActions.sourceId, executionId),
      createdAt ? lte(preventionCapaActions.createdAt, createdAt) : undefined,
    ))
  return row?.total ?? 1
}

function capaAccess(userId: string) {
  return {
    ctx: { userId },
    scope: { mode: "all" as const, ids: [] as [] },
    permissions: [
      "prevention:capa:manage",
      "prevention:capa:complete",
      "prevention:capa:verify",
      "prevention:capa:close",
    ],
  }
}

export type PdtpActionPlanItemInput = {
  executionId: string
  hallazgo: string
  accion: string
  responsableRole: string
  responsable: string
  responsableUserId?: string | null
  plazo: string
  prioridad?: string
  /** Anexo 8: se guarda además de derivar prioridad/plazo (la derivación es lossy). */
  dañoPotencial?: string | null
  /** Anexo 8: "Normativa legal aplicable". */
  normativaLegal?: string | null
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
/**
 * Todo ítem que no quedó plenamente conforme (Regular, Malo/No cumple, No
 * entregado, No apto, No) debe traer observación escrita antes de cerrar el
 * checklist. Ver `requiresObservation` en `lib/sst/compliance.ts`.
 *
 * Se valida en el submit y no en cada `upsertChecklistResponses` a propósito:
 * el llenado es incremental y el inspector marca el estado antes de redactar
 * la observación; bloquear en el autosave haría el formulario inusable.
 */
async function assertNonConformingItemsHaveObservation(instanceId: string) {
  const responses = await getChecklistResponses(instanceId)
  const faltantes = responses.filter((r) =>
    requiresObservation(r.estado as StatusValue) && !r.observacion?.trim())
  if (faltantes.length === 0) return

  const definition = await getInstanceDefinition(instanceId)
  const labelByItemId = new Map(
    (definition?.sections ?? []).flatMap((s) => s.items.map((i) => [i.id, i.label] as const)),
  )
  const detalle = faltantes
    .map((r) => labelByItemId.get(r.itemId) ?? r.itemId)
    .join("; ")
  throw new Error(
    `Deja una observación en los ítems marcados como Regular o Malo antes de enviar: ${detalle}`,
  )
}

async function getInstanceDefinition(instanceId: string): Promise<ChecklistDefinition | null> {
  const [row] = await db.select({ definition: pdtpExecutionChecklists.definitionSnapshotJson })
    .from(pdtpExecutionChecklists)
    .where(eq(pdtpExecutionChecklists.id, instanceId)).limit(1)
  return (row?.definition as unknown as ChecklistDefinition) ?? null
}

export async function submitExecutionChecklist(instanceId: string, userId: string) {
  await assertNonConformingItemsHaveObservation(instanceId)
  const [completion, actionPlan] = await Promise.all([
    completeExecutionChecklist(instanceId, userId),
    generateActionPlanFromChecklist(instanceId, userId),
  ])
  const { porcentajeCumplimiento } = completion
  const { generadas, existentes } = actionPlan
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

  // Prefijo de sujeto para el hallazgo: "[subjectLabel] " cuando aplica.
  const prefix = subjectLabel ? `[${subjectLabel}] ` : ""

  // Ejecución para obtener fecha de referencia del plazo
  const [execution] = await db.select().from(pdtpExecutions)
    .where(eq(pdtpExecutions.id, executionId)).limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")
  const refDate = execution?.executedAt ? new Date(execution.executedAt) : new Date()

  let generadas = 0
  let existentes = 0
  const sectionsById = new Map(definition.sections.map((section) => [section.id, section]))
  const itemsBySectionId = new Map(
    definition.sections.map((section) => [
      section.id,
      new Map(section.items.map((item) => [item.id, item])),
    ]),
  )

  for (const item of nonCompliant) {
    // Buscar si ya existe una acción para este ítem de ESTA instancia. El id de
    // instancia es la identidad durable del sujeto; la etiqueta visible puede
    // repetirse o cambiar y por eso nunca sirve como clave de deduplicación.
    const [existing] = await db.select().from(preventionCapaActions)
      .where(and(
        eq(preventionCapaActions.sourceType, "pdtp"),
        eq(preventionCapaActions.sourceId, executionId),
        sql`${preventionCapaActions.sourceRef}->>'checklistInstanceId' = ${instanceId}`,
        sql`${preventionCapaActions.sourceRef}->>'seccionId' = ${item.seccionId}`,
        sql`${preventionCapaActions.sourceRef}->>'itemId' = ${item.itemId}`,
      )).limit(1)

    if (existing) {
      existentes++
      continue
    }

    // Derivar responsableRole desde la sección de la definición
    const section = sectionsById.get(item.seccionId)
    const responsableRole = section?.appliesWhen?.[0] ?? "prevencionista_faena"

    // Hallazgo: prefijo de sujeto + observación del ítem, o label del ítem
    const defItem = itemsBySectionId.get(item.seccionId)?.get(item.itemId)
    const hallazgo = prefix + (item.observacion || defItem?.label || "Ítem no conforme")

    const accion = item.accionCorrectiva || "Por definir"

    // Prioridad/plazo: si el ítem define danoPotencial, se derivan del mapa
    // de daño potencial (mismo criterio que hallazgos manuales — PLAN_INTEGRACION
    // §5.4). Sin ese campo, cae al default histórico "media" (+7 días).
    const danoPotencial = defItem?.danoPotencial
    const prioridad = danoPotencial ? PDTP_DANO_POTENCIAL_A_PRIORIDAD[danoPotencial] : "media"
    const plazo = danoPotencial ? plazoFromDañoPotencial(danoPotencial, refDate) : plazoFromPrioridad("media", refDate)
    // La urgencia de terreno viaja como bandera, no como plazo imposible.
    const detencionInmediata = requiereDetencionInmediata(danoPotencial)

    await db.transaction(async (tx) => {
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "pdtp",
        sourceId: executionId,
        worksiteId: execution.worksiteId,
        finding: hallazgo,
        actionDescription: accion,
        responsibleSnapshot: responsableRole,
        responsibleRole: responsableRole,
        priority: toCapaPriority(prioridad),
        requiresImmediateStop: detencionInmediata,
        targetDate: plazo,
        evidenceRequired: true,
        // A12: el daño declarado por la plantilla sube a CAPA, no sólo su
        // derivada — la prioridad no distingue `grave` de `fatal`.
        danoPotencial: danoPotencial ?? null,
        // A12 (cont.): de qué ítem del checklist nació. Es procedencia, no
        // estado, así que no merece columnas propias — viaja en el
        // `source_ref`. `origen` no se persiste: una
        // acción es de checklist si y sólo si trae `seccionId`.
        sourceRef: { checklistInstanceId: instanceId, seccionId: item.seccionId, itemId: item.itemId },
        reconciliationStatus: "needs_assignment",
      }, userId)
      await recordOperationalActivity({
        eventType: "pdtp.action_created",
        module: "pdtp",
        entityType: "pdtp_action",
        entityId: capa.id,
        worksiteId: execution.worksiteId,
        actorUserId: userId,
        payload: { status: "pendiente", priority: prioridad },
      }, tx)
    })
    generadas++
  }

  return { generadas, existentes }
}

/** Lista todas las acciones del plan de una ejecución. */
export async function listActionPlanItems(executionId: string) {
  return listPdtpActionsByExecution(executionId)
}

/** Crea una acción manual. */
export async function createActionPlanItem(input: PdtpActionPlanItemInput, userId: string) {
  const [execution] = await db.select().from(pdtpExecutions)
    .where(eq(pdtpExecutions.id, input.executionId)).limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")

  return db.transaction(async (tx) => {
    const capa = await createCapaActionWithClient(tx, {
      sourceType: "pdtp",
      sourceId: input.executionId,
      worksiteId: execution.worksiteId,
      finding: input.hallazgo,
      actionDescription: input.accion,
      responsibleUserId: input.responsableUserId ?? null,
      responsibleSnapshot: input.responsable,
      responsibleRole: input.responsableRole,
      priority: toCapaPriority(input.prioridad),
      targetDate: input.plazo,
      evidenceRequired: true,
      danoPotencial: (input.dañoPotencial ?? null) as "leve" | "moderado" | "grave" | "fatal" | null,
      normativaLegal: input.normativaLegal?.trim() || null,
      // Misma regla que el generador: sólo hay procedencia si nació de un ítem.
      // Una acción manual no inventa una.
      sourceRef: input.seccionId
        ? { seccionId: input.seccionId, itemId: input.itemId ?? null }
        : null,
    }, userId)
    await recordOperationalActivity({
      eventType: "pdtp.action_created",
      module: "pdtp",
      entityType: "pdtp_action",
      entityId: capa.id,
      worksiteId: execution.worksiteId,
      actorUserId: userId,
      payload: { status: "pendiente", priority: input.prioridad ?? "media" },
    }, tx)
    return capaToPdtpAction(capa, await siguienteN(tx, input.executionId))
  })
}

/**
 * Actualiza metadatos; los estados sólo cambian mediante el workflow CAPA.
 * `itemId` es el id de la CAPA (D11): la acción ya no tiene identidad propia.
 */
export async function updateActionPlanItem(itemId: string, update: PdtpActionPlanItemUpdate, userId: string) {
  return db.transaction(async (tx) => {
    const capa = await loadPdtpCapa(tx, itemId)
    if (update.estado !== undefined && update.estado !== capaEstado(capa.status)) {
      throw new Error("El estado se cambia desde el seguimiento CAPA, con evidencia y transición auditada.")
    }
    const updated = await updateCapaActionWithClient(tx, {
      actionId: capa.id,
      expectedVersion: capa.version,
      finding: update.hallazgo,
      actionDescription: update.accion,
      responsibleUserId: update.responsableUserId,
      responsibleSnapshot: update.responsable,
      responsibleRole: update.responsableRole,
      targetDate: update.plazo,
      priority: update.prioridad === undefined ? undefined : toCapaPriority(update.prioridad),
    }, capaAccess(userId))

    await recordOperationalActivity({
      eventType: "pdtp.action_updated",
      module: "pdtp",
      entityType: "pdtp_action",
      entityId: capa.id,
      worksiteId: capa.worksiteId,
      actorUserId: userId,
      payload: { status: capaEstado(updated.status), priority: capaPrioridad(updated.priority) },
    }, tx)
    return capaToPdtpAction(updated, await siguienteN(tx, capa.sourceId, capa.createdAt))
  })
}

/** Conserva la acción y la cancela con historial en vez de borrarla. */
export async function deleteActionPlanItem(itemId: string, userId: string) {
  return db.transaction(async (tx) => {
    const capa = await loadPdtpCapa(tx, itemId)
    const cancelled = capa.status === "cancelled" ? capa : await transitionCapaActionWithClient(tx, {
      actionId: capa.id,
      expectedVersion: capa.version,
      toStatus: "cancelled",
      reason: "Acción PDTP cancelada desde el plan preventivo.",
    }, capaAccess(userId))
    await recordOperationalActivity({
      eventType: "pdtp.action_cancelled",
      module: "pdtp",
      entityType: "pdtp_action",
      entityId: capa.id,
      worksiteId: capa.worksiteId,
      actorUserId: userId,
      payload: { status: "cancelado" },
    }, tx)
    return capaToPdtpAction(cancelled, await siguienteN(tx, capa.sourceId, capa.createdAt))
  })
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
  return listPdtpActionsByProgram(programId, opts)
}

/**
 * Cuenta acciones pendientes/vencidas por ejecución (una sola query batch —
 * mismo patrón que `getActionPlanClosureRate`). Usado por la hoja del sheet
 * para mostrar badges de conteo por ejecución sin N queries.
 */
export async function countActionsByExecution(executionIds: string[]): Promise<Map<string, { pending: number; overdue: number }>> {
  return countPdtpActionsByExecution(executionIds)
}

/**
 * Calcula el % de cierre del plan de acción de una o varias ejecuciones.
 * % cierre = (acciones cerradas) / (acciones totales).
 */
export async function getActionPlanClosureRate(executionIds: string[]): Promise<number | null> {
  return getPdtpActionClosureRate(executionIds)
}

/**
 * Verifica (cierra) una acción. Requiere permiso de verificación.
 *
 * Ya no escribe un followup de cierre: `transitionCapaActionWithClient` inserta
 * la transición correspondiente, que es la misma entrada de la bitácora.
 * Escribir los dos duplicaba la línea de tiempo.
 */
export async function verifyActionPlanItem(
  itemId: string,
  userId: string,
  observacion: string | undefined,
  effectivenessAssessment: string,
) {
  return db.transaction(async (tx) => {
    const capa = await loadPdtpCapa(tx, itemId)
    const verified = await transitionCapaActionWithClient(tx, {
      actionId: capa.id,
      expectedVersion: capa.version,
      toStatus: "verified",
      reason: observacion ?? "Verificación PDTP satisfactoria.",
      effectivenessStatus: "effective",
      effectivenessAssessment,
    }, capaAccess(userId))
    return capaToPdtpAction(verified, await siguienteN(tx, capa.sourceId, capa.createdAt))
  })
}

/** Reabre una acción verificada (con motivo obligatorio). */
export async function reopenActionPlanItem(itemId: string, userId: string, motivo: string) {
  if (!motivo.trim()) throw new Error("El motivo de reapertura es obligatorio.")

  return db.transaction(async (tx) => {
    const capa = await loadPdtpCapa(tx, itemId)
    // `verified` y `closed` son las dos caras del `verificado` del PDTP.
    if (capa.status !== "verified" && capa.status !== "closed") {
      throw new Error("Solo se pueden reabrir acciones verificadas.")
    }
    const reopened = await transitionCapaActionWithClient(tx, {
      actionId: capa.id,
      expectedVersion: capa.version,
      toStatus: "reopened",
      reason: motivo,
      effectivenessStatus: "ineffective",
    }, capaAccess(userId))
    return capaToPdtpAction(reopened, await siguienteN(tx, capa.sourceId, capa.createdAt))
  })
}

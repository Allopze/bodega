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
  pdtpExecutions,
} from "@/db/schema"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import {
  capaEstado,
  capaPrioridad,
  capaToPdtpAction,
  countPdtpActionsByExecution,
  getPdtpActionClosureRate,
  listPdtpActionsByExecution,
  listPdtpActionsByProgram,
} from "./capa-view"
import { type WorksiteScope } from "./helpers"
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
 *
 * HALLAZGO SEC-002 (S3/P2): `scope` vivía dentro de `opts?`, así que omitirlo
 * compilaba y devolvía las acciones de todas las faenas. Es posicional y
 * obligatorio para que no se pueda olvidar; ver `listPdtpActionsByProgram`.
 */
export async function listActionsByProgram(
  programId: string,
  scope: WorksiteScope,
  opts?: {
    worksiteId?: string
    estado?: string
    prioridad?: string
    soloVencidas?: boolean
  },
) {
  return listPdtpActionsByProgram(programId, scope, opts)
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

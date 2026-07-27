import { eq, and, asc, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { preventionCapaActions, preventionCapaEvidence, users } from "@/db/schema"
import { ppaCorrectiveActions, ppaStatusHistory, ppaSubmissions, type PpaCorrectiveAction, type PpaSubmission } from "@/db/schema/ppa"
import { worksites } from "@/db/schema/worksites"
import {
  ppaAuthorizeRestartSchema,
  ppaCancelSchema,
  ppaCloseSchema,
  ppaCorrectionDeclareSchema,
  ppaReviewSchema,
  ppaVerificationSchema,
  type PpaReviewInput,
} from "@/lib/validation/ppa"
import {
  tipoTrabajoLabel,
  PPA_STOP_REASON_LABELS,
  type EstadoPpa,
  type PpaStopReason,
} from "@/lib/ppa/types"
import { estadoPpaLabel, decisionPpaLabel } from "@/lib/ppa/badges"
import type { ReportData } from "@/lib/reports/export"
import { listPpa, getPpa } from "./calculos"
import { nanoid } from "@/lib/id"
import { createCapaActionWithClient, transitionCapaActionWithClient } from "@/lib/services/prevention-capa"
import type { WorksiteScope } from "@/lib/auth/scope"

interface PpaOperationAccess {
  userId: string
  worksiteIds: string[] | "all"
  permissions: readonly string[]
}

function capaScope(worksiteIds: string[] | "all"): WorksiteScope {
  if (worksiteIds === "all") return { mode: "all", ids: [] }
  return worksiteIds.length > 0 ? { mode: "some", ids: worksiteIds } : { mode: "none", ids: [] }
}

function capaAccess(access: PpaOperationAccess) {
  return {
    ctx: { userId: access.userId },
    scope: capaScope(access.worksiteIds),
    permissions: access.permissions,
  }
}

async function recordPpaHistory(tx: Tx, args: {
  ppaId: string
  capaActionId?: string | null
  fromStatus: string | null
  toStatus: string
  reason?: string | null
  actorUserId: string
  createdAt: string
}) {
  await tx.insert(ppaStatusHistory).values({
    id: `ppah-${nanoid()}`,
    ppaId: args.ppaId,
    capaActionId: args.capaActionId ?? null,
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    reason: args.reason ?? null,
    actorUserId: args.actorUserId,
    createdAt: args.createdAt,
  })
}

export async function reviewPpa(
  input: PpaReviewInput,
  userId: string,
  worksiteIds: string[] | "all",
): Promise<PpaSubmission> {
  const data = ppaReviewSchema.parse(input)

  const current = await getPpa(data.ppaId, worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado === "aprobado_auto") {
    throw new Error("Este PPA fue aprobado automáticamente y no requiere revisión.")
  }
  if (current.estado !== "detenido") {
    throw new Error("Este PPA ya fue resuelto y no puede modificarse.")
  }

  const estado: EstadoPpa =
    // Autorizar la propuesta de corrección no equivale a autorizar el trabajo.
    // El PPA permanece en corrección hasta que la acción sea verificada.
    data.decision === "autorizado" ? "en_correccion" :
    data.decision === "rechazado"  ? "rechazado"  :
    "en_correccion"

  const now = new Date().toISOString()

  const result = await db.transaction(async (tx) => {
    const updated = await tx.update(ppaSubmissions)
      .set({
        reviewedBy:       userId,
        fuiAlLugar:       data.fuiAlLugar,
        accionCorrectiva: data.accionCorrectiva || null,
        reviewNota:       data.reviewNota || null,
        decision:         data.decision,
        estado,
        reviewedAt:       now,
        version:          sql`${ppaSubmissions.version} + 1`,
        updatedAt:        now,
      })
      .where(and(
        eq(ppaSubmissions.id, data.ppaId),
        eq(ppaSubmissions.estado, "detenido"),
      ))
      .returning()

    if (!updated[0]) return null

    let capaActionId: string | null = null
    if (data.decision !== "rechazado") {
      const legacyActionId = nanoid()
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "ppa",
        sourceId: current.id,
        sourceLegacyActionId: legacyActionId,
        worksiteId: current.worksiteId,
        finding: `${current.workerName} · ${current.tipoTrabajo}`,
        immediateMeasure: "Trabajo detenido hasta implementar y verificar controles.",
        actionDescription: data.accionCorrectiva!.trim(),
        responsibleSnapshot: data.responsible!.trim(),
        responsibleRole: data.responsibleRole!,
        priority: data.priority === "alta" ? "high" : data.priority === "baja" ? "low" : "medium",
        targetDate: data.dueDate!,
        evidenceRequired: true,
        reconciliationStatus: "needs_assignment",
      }, userId)
      capaActionId = capa.id
      await tx.insert(ppaCorrectiveActions).values({
        id: legacyActionId,
        ppaId: current.id,
        capaActionId: capa.id,
        worksiteId: current.worksiteId,
        description: data.accionCorrectiva!.trim(),
        responsibleRole: data.responsibleRole!,
        responsible: data.responsible!.trim(),
        dueDate: data.dueDate!,
        priority: data.priority!,
        status: "pendiente",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
    }

    await recordPpaHistory(tx, {
      ppaId: current.id,
      capaActionId,
      fromStatus: current.estado,
      toStatus: estado,
      reason: data.reviewNota || (data.decision === "rechazado" ? "Trabajo rechazado en revisión" : "Controles correctivos solicitados"),
      actorUserId: userId,
      createdAt: now,
    })

    return updated[0]
  })

  if (!result) {
    throw new Error("Este PPA ya fue procesado por otro responsable. Recarga la página.")
  }

  return result
}

function requirePpaPermission(access: PpaOperationAccess, permission: string) {
  if (!access.permissions.includes(permission)) throw new Error("PPA no encontrado o fuera de tu alcance.")
}

async function loadLinkedCapa(tx: Tx, ppaId: string) {
  const [legacy] = await tx.select().from(ppaCorrectiveActions)
    .where(eq(ppaCorrectiveActions.ppaId, ppaId)).limit(1)
  if (!legacy?.capaActionId) throw new Error("El PPA no tiene una acción CAPA vinculada.")
  const [capa] = await tx.select().from(preventionCapaActions)
    .where(eq(preventionCapaActions.id, legacy.capaActionId)).limit(1)
  if (!capa) throw new Error("La acción CAPA vinculada no existe.")
  return { legacy, capa }
}

export async function declarePpaCorrection(input: unknown, access: PpaOperationAccess): Promise<PpaSubmission> {
  requirePpaPermission(access, "ppa:correct")
  const data = ppaCorrectionDeclareSchema.parse(input)
  const current = await getPpa(data.ppaId, access.worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado !== "en_correccion" || current.version !== data.expectedPpaVersion) {
    throw new Error("El PPA cambió o no está en corrección. Recarga antes de continuar.")
  }

  return db.transaction(async (tx) => {
    const { legacy, capa: initialCapa } = await loadLinkedCapa(tx, current.id)
    if (initialCapa.version !== data.expectedCapaVersion) throw new Error("La acción CAPA cambió. Recarga antes de continuar.")
    let capa = initialCapa
    if (capa.status === "pending" || capa.status === "reopened") {
      capa = await transitionCapaActionWithClient(tx, {
        actionId: capa.id,
        expectedVersion: capa.version,
        toStatus: "in_progress",
        reason: "Implementación de controles PPA iniciada.",
      }, capaAccess(access))
    }
    if (capa.status !== "in_progress") throw new Error("La acción CAPA no está disponible para declarar implementación.")
    capa = await transitionCapaActionWithClient(tx, {
      actionId: capa.id,
      expectedVersion: capa.version,
      toStatus: "pending_verification",
      reason: "Controles PPA declarados como implementados.",
    }, capaAccess(access))

    const now = new Date().toISOString()
    const [updated] = await tx.update(ppaSubmissions).set({
      estado: "pendiente_verificacion",
      correctionDeclaredByUserId: access.userId,
      correctionDeclaredAt: now,
      version: sql`${ppaSubmissions.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(ppaSubmissions.id, current.id),
      eq(ppaSubmissions.estado, "en_correccion"),
      eq(ppaSubmissions.version, data.expectedPpaVersion),
    )).returning()
    if (!updated) throw new Error("El PPA fue actualizado concurrentemente. Recarga antes de continuar.")
    await tx.update(ppaCorrectiveActions).set({ status: "completada", updatedAt: now })
      .where(eq(ppaCorrectiveActions.id, legacy.id))
    await recordPpaHistory(tx, {
      ppaId: current.id, capaActionId: capa.id, fromStatus: current.estado,
      toStatus: "pendiente_verificacion", reason: "Controles declarados e ingresados a verificación",
      actorUserId: access.userId, createdAt: now,
    })
    return updated
  })
}

export async function verifyPpaCorrection(input: unknown, access: PpaOperationAccess): Promise<PpaSubmission> {
  requirePpaPermission(access, "ppa:verify")
  const data = ppaVerificationSchema.parse(input)
  const current = await getPpa(data.ppaId, access.worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado !== "pendiente_verificacion" || current.version !== data.expectedPpaVersion || current.verifiedAt) {
    throw new Error("El PPA cambió o no está pendiente de verificación. Recarga antes de continuar.")
  }

  return db.transaction(async (tx) => {
    const { legacy, capa } = await loadLinkedCapa(tx, current.id)
    if (capa.version !== data.expectedCapaVersion || capa.status !== "pending_verification") {
      throw new Error("La acción CAPA cambió o no está pendiente de verificación.")
    }
    const capaUpdated = await transitionCapaActionWithClient(tx, data.accepted ? {
      actionId: capa.id,
      expectedVersion: capa.version,
      toStatus: "verified",
      reason: data.comment,
      effectivenessStatus: data.effectivenessStatus,
      effectivenessAssessment: data.effectivenessAssessment,
      segregationExceptionReason: data.segregationExceptionReason,
    } : {
      actionId: capa.id,
      expectedVersion: capa.version,
      toStatus: "reopened",
      reason: data.comment,
      effectivenessStatus: "ineffective",
    }, capaAccess(access))

    const now = new Date().toISOString()
    const toStatus = data.accepted ? "pendiente_verificacion" : "en_correccion"
    const [updated] = await tx.update(ppaSubmissions).set({
      estado: toStatus,
      verifiedByUserId: data.accepted ? access.userId : null,
      verifiedAt: data.accepted ? now : null,
      verificationComment: data.comment,
      version: sql`${ppaSubmissions.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(ppaSubmissions.id, current.id),
      eq(ppaSubmissions.estado, "pendiente_verificacion"),
      eq(ppaSubmissions.version, data.expectedPpaVersion),
    )).returning()
    if (!updated) throw new Error("El PPA fue actualizado concurrentemente. Recarga antes de continuar.")
    await tx.update(ppaCorrectiveActions).set({
      status: data.accepted ? "verificada" : "en_proceso",
      updatedAt: now,
    }).where(eq(ppaCorrectiveActions.id, legacy.id))
    await recordPpaHistory(tx, {
      ppaId: current.id, capaActionId: capaUpdated.id, fromStatus: current.estado,
      toStatus, reason: data.comment, actorUserId: access.userId, createdAt: now,
    })
    return updated
  })
}

export async function authorizePpaRestart(input: unknown, access: PpaOperationAccess): Promise<PpaSubmission> {
  requirePpaPermission(access, "ppa:authorize_restart")
  const data = ppaAuthorizeRestartSchema.parse(input)
  const current = await getPpa(data.ppaId, access.worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado !== "pendiente_verificacion" || !current.verifiedAt || current.version !== data.expectedPpaVersion) {
    throw new Error("El reinicio sólo puede autorizarse después de una verificación satisfactoria.")
  }
  return db.transaction(async (tx) => {
    const { capa } = await loadLinkedCapa(tx, current.id)
    if (capa.status !== "verified" && capa.status !== "closed") {
      throw new Error("La acción CAPA debe estar verificada antes de autorizar el reinicio.")
    }
    const now = new Date().toISOString()
    const [updated] = await tx.update(ppaSubmissions).set({
      estado: "autorizado",
      authorizedByUserId: access.userId,
      authorizedAt: now,
      version: sql`${ppaSubmissions.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(ppaSubmissions.id, current.id),
      eq(ppaSubmissions.estado, "pendiente_verificacion"),
      eq(ppaSubmissions.version, data.expectedPpaVersion),
    )).returning()
    if (!updated) throw new Error("El PPA fue actualizado concurrentemente. Recarga antes de continuar.")
    await recordPpaHistory(tx, {
      ppaId: current.id, capaActionId: capa.id, fromStatus: current.estado,
      toStatus: "autorizado", reason: data.comment || "Reinicio autorizado después de verificación",
      actorUserId: access.userId, createdAt: now,
    })
    return updated
  })
}

export async function cancelPpa(input: unknown, access: PpaOperationAccess): Promise<PpaSubmission> {
  requirePpaPermission(access, "ppa:cancel")
  const data = ppaCancelSchema.parse(input)
  const current = await getPpa(data.ppaId, access.worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (!["detenido", "en_correccion", "pendiente_verificacion", "rechazado"].includes(current.estado) || current.version !== data.expectedPpaVersion) {
    throw new Error("Este PPA no puede cancelarse en su estado actual o cambió en otra sesión.")
  }
  return db.transaction(async (tx) => {
    const [legacy] = await tx.select().from(ppaCorrectiveActions)
      .where(eq(ppaCorrectiveActions.ppaId, current.id)).limit(1)
    const capaActionId: string | null = legacy?.capaActionId ?? null
    if (legacy?.capaActionId) {
      const [capa] = await tx.select().from(preventionCapaActions)
        .where(eq(preventionCapaActions.id, legacy.capaActionId)).limit(1)
      if (!capa) throw new Error("La acción CAPA vinculada no existe.")
      if (["pending", "in_progress", "pending_verification", "reopened"].includes(capa.status)) {
        if (data.expectedCapaVersion !== capa.version) throw new Error("La acción CAPA cambió. Recarga antes de continuar.")
        await transitionCapaActionWithClient(tx, {
          actionId: capa.id, expectedVersion: capa.version, toStatus: "cancelled", reason: data.reason,
        }, capaAccess(access))
        await tx.update(ppaCorrectiveActions).set({ status: "cerrada", updatedAt: new Date().toISOString() })
          .where(eq(ppaCorrectiveActions.id, legacy.id))
      }
    }
    const now = new Date().toISOString()
    const [updated] = await tx.update(ppaSubmissions).set({
      estado: "cancelado", cancelledByUserId: access.userId, cancelledAt: now,
      cancellationReason: data.reason, version: sql`${ppaSubmissions.version} + 1`, updatedAt: now,
    }).where(and(eq(ppaSubmissions.id, current.id), eq(ppaSubmissions.version, data.expectedPpaVersion))).returning()
    if (!updated) throw new Error("El PPA fue actualizado concurrentemente. Recarga antes de continuar.")
    await recordPpaHistory(tx, {
      ppaId: current.id, capaActionId, fromStatus: current.estado, toStatus: "cancelado",
      reason: data.reason, actorUserId: access.userId, createdAt: now,
    })
    return updated
  })
}

export async function closePpa(input: unknown, access: PpaOperationAccess): Promise<PpaSubmission> {
  requirePpaPermission(access, "ppa:close")
  const data = ppaCloseSchema.parse(input)
  const current = await getPpa(data.ppaId, access.worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado !== "autorizado" || current.version !== data.expectedPpaVersion) {
    throw new Error("Solo se puede cerrar un PPA autorizado después de verificar su acción correctiva.")
  }
  return db.transaction(async (tx) => {
    const { capa } = await loadLinkedCapa(tx, current.id)
    if (capa.status !== "verified" && capa.status !== "closed") {
      throw new Error("La acción correctiva debe estar verificada antes de cerrar el PPA.")
    }
    const now = new Date().toISOString()
    const [updated] = await tx.update(ppaSubmissions).set({
      estado: "cerrado", closedByUserId: access.userId, closedAt: now,
      closeComment: data.comment, version: sql`${ppaSubmissions.version} + 1`, updatedAt: now,
    }).where(and(
      eq(ppaSubmissions.id, current.id), eq(ppaSubmissions.estado, "autorizado"),
      eq(ppaSubmissions.version, data.expectedPpaVersion),
    )).returning()
    if (!updated) throw new Error("Este caso ya fue cerrado por otro responsable. Recarga la página.")
    await recordPpaHistory(tx, {
      ppaId: current.id, capaActionId: capa.id, fromStatus: current.estado, toStatus: "cerrado",
      reason: data.comment, actorUserId: access.userId, createdAt: now,
    })
    return updated
  })
}

/** Obtiene la acción que nació de un PPA dentro del alcance ya validado. */
export async function getPpaCorrectiveAction(
  ppaId: string,
  worksiteIds: string[] | "all",
): Promise<PpaCorrectiveAction | null> {
  const current = await getPpa(ppaId, worksiteIds)
  if (!current) return null
  const [action] = await db
    .select()
    .from(ppaCorrectiveActions)
    .where(eq(ppaCorrectiveActions.ppaId, ppaId))
    .limit(1)
  return action ?? null
}

/** Historial persistido del PPA, incluyendo eventos automáticos sin usuario. */
export async function getPpaStatusHistory(
  ppaId: string,
  worksiteIds: string[] | "all",
) {
  const current = await getPpa(ppaId, worksiteIds)
  if (!current) return []
  return db.select({
    id: ppaStatusHistory.id,
    capaActionId: ppaStatusHistory.capaActionId,
    fromStatus: ppaStatusHistory.fromStatus,
    toStatus: ppaStatusHistory.toStatus,
    reason: ppaStatusHistory.reason,
    actorType: ppaStatusHistory.actorType,
    actorUserId: ppaStatusHistory.actorUserId,
    actorName: users.name,
    createdAt: ppaStatusHistory.createdAt,
  }).from(ppaStatusHistory)
    .leftJoin(users, eq(users.id, ppaStatusHistory.actorUserId))
    .where(eq(ppaStatusHistory.ppaId, ppaId))
    .orderBy(asc(ppaStatusHistory.createdAt), asc(ppaStatusHistory.id))
}

export interface PpaExportFilters {
  estado?: string
  worksiteId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

export async function buildPpaExport(
  worksiteIds: string[] | "all",
  filters: PpaExportFilters = {},
): Promise<ReportData> {
  const maxRows = 10_000
  const rows = await listPpa({ worksiteIds, ...filters }, maxRows + 1, 0)
  const rowLimitApplied = rows.length > maxRows
  const exportRows = rowLimitApplied ? rows.slice(0, maxRows) : rows
  const ppaIds = exportRows.map((row) => row.id)
  const correctiveActions = ppaIds.length > 0
    ? await db.select().from(ppaCorrectiveActions).where(inArray(ppaCorrectiveActions.ppaId, ppaIds))
    : []
  const capaIds = correctiveActions.flatMap((item) => item.capaActionId ? [item.capaActionId] : [])
  const [capaActions, evidence, actorRows] = await Promise.all([
    capaIds.length > 0
      ? db.select().from(preventionCapaActions).where(inArray(preventionCapaActions.id, capaIds))
      : Promise.resolve([]),
    capaIds.length > 0
      ? db.select({ actionId: preventionCapaEvidence.actionId, kind: preventionCapaEvidence.kind })
        .from(preventionCapaEvidence).where(inArray(preventionCapaEvidence.actionId, capaIds))
      : Promise.resolve([]),
    db.select({ id: users.id, name: users.name }).from(users),
  ])
  const correctiveByPpa = new Map(correctiveActions.map((item) => [item.ppaId, item]))
  const capaById = new Map(capaActions.map((item) => [item.id, item]))
  const actorName = new Map(actorRows.map((item) => [item.id, item.name]))
  const evidenceCount = new Map<string, number>()
  for (const item of evidence) {
    if (item.kind !== "note") evidenceCount.set(item.actionId, (evidenceCount.get(item.actionId) ?? 0) + 1)
  }
  return {
    filenameBase: `ppa_digital_${new Date().toISOString().slice(0, 10)}`,
    worksheetName: "PPA Digital",
    headers: [
      "Fecha", "Trabajador", "RUT", "Identificación manual", "Faena", "Tarea",
      "Crítica", "Resultado", "Estado", "Motivos detención", "Decisión",
      "Acción correctiva", "Revisado",
      "Revisado por", "Versión", "Corrección declarada por", "Corrección declarada",
      "Verificada por", "Verificada", "Comentario verificación", "Reinicio autorizado por", "Reinicio autorizado",
      "Cancelado por", "Cancelado", "Motivo cancelación", "Cerrado por", "Cerrado", "Comentario cierre",
      "Código CAPA", "Estado CAPA", "Evidencias CAPA", "Eficacia CAPA", "Evaluación eficacia", "Conciliación CAPA",
    ],
    rows: exportRows.map((r) => {
      const legacy = correctiveByPpa.get(r.id)
      const capa = legacy?.capaActionId ? capaById.get(legacy.capaActionId) : undefined
      const actor = (id: string | null) => id ? actorName.get(id) ?? id : ""
      return [
        new Date(r.createdAt).toLocaleString("es-CL"),
        r.workerName,
        r.workerRut ?? "",
        r.manualIdentificacion ? "Sí" : "No",
        r.worksiteName ?? "",
        tipoTrabajoLabel(r.tipoTrabajo),
        r.esCritica ? "Sí" : "No",
        r.resultado === "detenido" ? "Detenido" : "Autorizado auto.",
        estadoPpaLabel(r.estado),
        ((r.triggeredReasons as PpaStopReason[] | null) ?? [])
          .map((x) => PPA_STOP_REASON_LABELS[x] ?? x).join(" | "),
        decisionPpaLabel(r.decision),
        r.accionCorrectiva ?? "",
        r.reviewedAt ? new Date(r.reviewedAt).toLocaleString("es-CL") : "",
        actor(r.reviewedBy), r.version,
        actor(r.correctionDeclaredByUserId), r.correctionDeclaredAt ?? "",
        actor(r.verifiedByUserId), r.verifiedAt ?? "", r.verificationComment ?? "",
        actor(r.authorizedByUserId), r.authorizedAt ?? "",
        actor(r.cancelledByUserId), r.cancelledAt ?? "", r.cancellationReason ?? "",
        actor(r.closedByUserId), r.closedAt ?? "", r.closeComment ?? "",
        capa?.code ?? "", capa?.status ?? "", capa ? evidenceCount.get(capa.id) ?? 0 : 0,
        capa?.effectivenessStatus ?? "", capa?.effectivenessAssessment ?? "", capa?.reconciliationStatus ?? "",
      ]
    }),
    rowLimitApplied,
  }
}

export async function listScopedWorksites(
  worksiteIds: string[] | "all",
): Promise<{ id: string; name: string; code: string }[]> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return []
  const cond = worksiteIds !== "all"
    ? and(eq(worksites.isActive, true), inArray(worksites.id, worksiteIds))
    : eq(worksites.isActive, true)
  return db
    .select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites)
    .where(cond)
    .orderBy(worksites.name)
}

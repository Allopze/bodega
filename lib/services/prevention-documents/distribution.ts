import { createHash } from "node:crypto"
import { and, eq, inArray, or } from "drizzle-orm"
import { db } from "@/db"
import {
  sstDocumentAcknowledgments,
  sstDocumentAudit,
  sstDocumentDistributionTargets,
  sstDocuments,
  sstDocumentTypes,
  sstDocumentVersions,
  users,
  workers,
  worksiteUsers,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { onDocumentAcknowledged } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { onRiohsRolloutProgress } from "@/lib/services/pdtp-adapters/riohs-rollout-connector"
import { resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import {
  assertConfidentialityAllowed,
  assertScopeAccess,
  type RequestContext,
  type SstDocumentConfidentiality,
} from "./utils"

interface DistributionContext {
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}

async function getPublishedVersionContext(versionId: string) {
  const [version] = await db
    .select()
    .from(sstDocumentVersions)
    .where(eq(sstDocumentVersions.id, versionId))
  if (!version) throw new Error("Versión documental no encontrada.")
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, version.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  if (doc.currentVersionId !== version.id || version.status !== "vigente" || doc.status !== "vigente") {
    throw new Error("Sólo se puede distribuir o acusar la versión vigente publicada.")
  }
  return { doc, version }
}

/**
 * Un documento de faena se opera con alcance sobre esa faena, como siempre.
 * Uno corporativo (sin faena: el RIOHS) es de toda la empresa, y quien opera
 * una faena debe poder distribuirlo y cerrar su entrega en ella; por eso acá
 * sólo se exige algún alcance, y cada operación acota después a los
 * destinatarios de las faenas que la persona ve (`assertTargetInScope`).
 */
function authorizeDistribution(args: DistributionContext, doc: { worksiteId: string | null; confidentiality: string }) {
  if (doc.worksiteId) assertScopeAccess(doc.worksiteId, args.scope)
  else if (args.scope.mode === "none") throw new Error("Documento no encontrado o sin acceso a la faena.")
  assertConfidentialityAllowed(doc.confidentiality as SstDocumentConfidentiality, args.permissions)
}

/** En un documento corporativo, un usuario con alcance de faena sólo opera sus faenas. */
function assertTargetInScope(doc: { worksiteId: string | null }, targetWorksiteId: string | null, scope: WorksiteScope) {
  if (doc.worksiteId || scope.mode === "all") return
  if (scope.mode === "none" || !targetWorksiteId || !scope.ids.includes(targetWorksiteId)) {
    throw new Error("El destinatario pertenece a una faena fuera de tu alcance.")
  }
}

export function buildDocumentAcknowledgmentSignature(args: {
  versionId: string
  checksum: string
  userId: string
  acknowledgedAt: string
  method: string
}) {
  return createHash("sha256")
    .update([args.versionId, args.checksum, args.userId, args.acknowledgedAt, args.method].join("\u001f"))
    .digest("hex")
}

export async function assignDocumentVersionRecipients(args: DistributionContext & {
  versionId: string
  userIds?: string[]
  workerIds?: string[]
  assignmentReason: string
  dueAt?: string | null
}) {
  const userIds = Array.from(new Set(args.userIds?.filter(Boolean) ?? []))
  const workerIds = Array.from(new Set(args.workerIds?.filter(Boolean) ?? []))
  const recipientCount = userIds.length + workerIds.length
  const reason = args.assignmentReason.trim()
  if (recipientCount === 0) throw new Error("Selecciona al menos un destinatario.")
  if (recipientCount > 200) throw new Error("La distribución admite hasta 200 destinatarios por operación.")
  if (reason.length < 3 || reason.length > 500) throw new Error("Registra un motivo de asignación válido.")

  const { doc, version } = await getPublishedVersionContext(args.versionId)
  authorizeDistribution(args, doc)
  if (!doc.requiresAcknowledgment) {
    throw new Error("El documento no está configurado para exigir acuse.")
  }
  if (doc.confidentiality === "sensible" && recipientCount !== 1) {
    throw new Error("Los documentos sensibles sólo admiten distribución nominativa individual.")
  }

  const [userRows, explicitWorkerRows] = await Promise.all([
    userIds.length
      ? db.select({ id: users.id, workerId: users.workerId, isActive: users.isActive })
        .from(users).where(inArray(users.id, userIds))
      : Promise.resolve([]),
    workerIds.length
      ? db.select({
          id: workers.id,
          worksiteId: workers.worksiteId,
          position: workers.position,
          isActive: workers.isActive,
        }).from(workers).where(inArray(workers.id, workerIds))
      : Promise.resolve([]),
  ])
  if (userRows.length !== userIds.length || userRows.some((row) => !row.isActive)) {
    throw new Error("Uno o más usuarios destinatarios no existen o están inactivos.")
  }
  if (explicitWorkerRows.length !== workerIds.length || explicitWorkerRows.some((row) => !row.isActive)) {
    throw new Error("Uno o más trabajadores destinatarios no existen o están inactivos.")
  }

  const linkedWorkerIds = userRows.flatMap((row) => row.workerId ? [row.workerId] : [])
  const allWorkerIds = Array.from(new Set([...linkedWorkerIds, ...workerIds]))
  const [allWorkerRows, userWorksites, linkedUsers] = await Promise.all([
    allWorkerIds.length
      ? db.select({
          id: workers.id,
          worksiteId: workers.worksiteId,
          position: workers.position,
          isActive: workers.isActive,
        }).from(workers).where(inArray(workers.id, allWorkerIds))
      : Promise.resolve([]),
    userIds.length
      ? db.select({ userId: worksiteUsers.userId, worksiteId: worksiteUsers.worksiteId })
        .from(worksiteUsers).where(inArray(worksiteUsers.userId, userIds))
      : Promise.resolve([]),
    workerIds.length
      ? db.select({ id: users.id, workerId: users.workerId, isActive: users.isActive })
        .from(users).where(inArray(users.workerId, workerIds))
      : Promise.resolve([]),
  ])
  const workerMap = new Map(allWorkerRows.map((row) => [row.id, row]))
  const worksiteIdsByUser = new Map<string, Set<string>>()
  for (const row of userWorksites) {
    const ids = worksiteIdsByUser.get(row.userId) ?? new Set<string>()
    ids.add(row.worksiteId)
    worksiteIdsByUser.set(row.userId, ids)
  }
  const userByWorkerId = new Map(linkedUsers
    .filter((row) => row.workerId && row.isActive)
    .map((row) => [row.workerId!, row.id]))

  const now = new Date().toISOString()
  const rows: Array<typeof sstDocumentDistributionTargets.$inferInsert> = []
  for (const recipient of userRows) {
    const worker = recipient.workerId ? workerMap.get(recipient.workerId) : undefined
    if (worker) assertScopeAccess(worker.worksiteId, args.scope)
    // Sin ficha de trabajador, la faena del destinatario sale de sus
    // asignaciones. En un documento corporativo, alguien con alcance de faena
    // sólo puede asignar a personas de sus faenas.
    const recipientWorksite = worker?.worksiteId
      ?? (args.scope.mode === "some"
        ? [...(worksiteIdsByUser.get(recipient.id) ?? [])].find((id) => args.scope.mode === "some" && args.scope.ids.includes(id)) ?? null
        : null)
    assertTargetInScope(doc, recipientWorksite ?? null, args.scope)
    if (doc.worksiteId) {
      const hasDocumentWorksite = worker?.worksiteId === doc.worksiteId
        || worksiteIdsByUser.get(recipient.id)?.has(doc.worksiteId)
      if (!hasDocumentWorksite) throw new Error("Un usuario destinatario no pertenece a la faena del documento.")
    }
    rows.push({
      id: `sdd-${nanoid()}`,
      versionId: version.id,
      userId: recipient.id,
      workerId: recipient.workerId,
      assignmentReason: reason,
      worksiteId: recipientWorksite ?? doc.worksiteId,
      positionSnapshot: worker?.position ?? null,
      companySnapshot: "Chome",
      assignedByUserId: args.ctx.userId,
      assignedAt: now,
      dueAt: args.dueAt || null,
      status: "pendiente",
      createdAt: now,
      updatedAt: now,
    })
  }
  for (const worker of explicitWorkerRows) {
    assertScopeAccess(worker.worksiteId, args.scope)
    if (doc.worksiteId && worker.worksiteId !== doc.worksiteId) {
      throw new Error("Un trabajador destinatario no pertenece a la faena del documento.")
    }
    if (rows.some((row) => row.workerId === worker.id)) continue
    rows.push({
      id: `sdd-${nanoid()}`,
      versionId: version.id,
      userId: userByWorkerId.get(worker.id) ?? null,
      workerId: worker.id,
      assignmentReason: reason,
      worksiteId: worker.worksiteId,
      positionSnapshot: worker.position,
      companySnapshot: "Chome",
      assignedByUserId: args.ctx.userId,
      assignedAt: now,
      dueAt: args.dueAt || null,
      status: "pendiente",
      createdAt: now,
      updatedAt: now,
    })
  }

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(sstDocumentDistributionTargets)
      .values(rows)
      .onConflictDoNothing()
      .returning()
    await tx.insert(sstDocumentAudit).values({
      id: `sda-${nanoid()}`,
      documentId: doc.id,
      versionId: version.id,
      action: "distribute",
      userId: args.ctx.userId,
      metadata: {
        requestedRecipients: recipientCount,
        insertedRecipients: inserted.length,
        dueAt: args.dueAt || null,
        assignmentReason: reason,
      },
      ip: args.ctx.ip ?? null,
      createdAt: now,
    })
    return inserted
  })
}

export async function acknowledgeDocumentVersion(args: DistributionContext & {
  versionId: string
  method?: string
  userAgent?: string | null
}) {
  const method = args.method?.trim() || "digital"
  if (!/^[a-z_]{3,30}$/.test(method)) throw new Error("Método de acuse inválido.")
  const { doc, version } = await getPublishedVersionContext(args.versionId)
  // Acusar es un acto propio: lo autoriza tener una asignación nominativa para
  // esta versión (se verifica abajo), no el alcance sobre la faena del
  // documento. Sin esto, nadie con alcance de faena podía acusar un RIOHS
  // corporativo. La confidencialidad sigue exigiéndose.
  assertConfidentialityAllowed(doc.confidentiality as SstDocumentConfidentiality, args.permissions)

  let accreditation: Parameters<typeof onDocumentAcknowledged>[0] | null = null
  let acknowledgedWorksiteId: string | null = null
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select({ workerId: users.workerId, isActive: users.isActive })
      .from(users).where(eq(users.id, args.ctx.userId))
    if (!user?.isActive) throw new Error("Usuario no disponible para registrar acuse.")

    const recipientWhere = user.workerId
      ? or(
          eq(sstDocumentDistributionTargets.userId, args.ctx.userId),
          eq(sstDocumentDistributionTargets.workerId, user.workerId),
        )
      : eq(sstDocumentDistributionTargets.userId, args.ctx.userId)
    const [target] = await tx.select().from(sstDocumentDistributionTargets)
      .where(and(
        eq(sstDocumentDistributionTargets.versionId, version.id),
        recipientWhere,
      ))
      .for("update")
    if (!target) throw new Error("No tienes una asignación nominativa para esta versión.")
    if (target.status === "exento") throw new Error("La asignación está exenta y no admite acuse.")
    acknowledgedWorksiteId = target.worksiteId

    const [existing] = await tx.select().from(sstDocumentAcknowledgments)
      .where(and(
        eq(sstDocumentAcknowledgments.versionId, version.id),
        eq(sstDocumentAcknowledgments.userId, args.ctx.userId),
      ))
    if (existing) return existing

    const acknowledgedAt = new Date().toISOString()
    const signature = buildDocumentAcknowledgmentSignature({
      versionId: version.id,
      checksum: version.checksum,
      userId: args.ctx.userId,
      acknowledgedAt,
      method,
    })
    const [ack] = await tx.insert(sstDocumentAcknowledgments).values({
      id: `sda-${nanoid()}`,
      versionId: version.id,
      userId: args.ctx.userId,
      method,
      signature,
      ip: args.ctx.ip ?? null,
      userAgent: args.userAgent ?? args.ctx.userAgent ?? null,
      acknowledgedAt,
    }).returning()
    if (!ack) throw new Error("No se pudo registrar el acuse.")

    await tx.update(sstDocumentDistributionTargets)
      .set({ status: "acusado", updatedAt: acknowledgedAt })
      .where(eq(sstDocumentDistributionTargets.id, target.id))
    await tx.insert(sstDocumentAudit).values({
      id: `sda-${nanoid()}`,
      documentId: doc.id,
      versionId: version.id,
      action: "ack",
      userId: args.ctx.userId,
      metadata: { targetId: target.id, checksum: version.checksum, signature, method },
      ip: args.ctx.ip ?? null,
      createdAt: acknowledgedAt,
    })

    // N°36 del PDTP: la difusión se mide por cobertura, una acreditación por
    // acuse. El número lo declara el tipo del documento —en su columna de
    // **acuse**, no en la de publicación: son dos hechos distintos y confundirlos
    // haría que publicar saldara una difusión que nadie recibió—. Un documento
    // corporativo no tiene faena, así que no puede acreditar una actividad que se
    // mide por faena. Se dispara después del commit.
    if (doc.worksiteId && doc.typeId) {
      const [type] = await tx.select({ numbers: sstDocumentTypes.pdtpAcknowledgmentActivityNumbers })
        .from(sstDocumentTypes).where(eq(sstDocumentTypes.id, doc.typeId)).limit(1)
      const activityNumbers = Array.isArray(type?.numbers) ? type.numbers as number[] : []
      const accreditationTarget = await resolvePdtpAccreditationTarget({ sourceType: "documento", sourceId: doc.typeId, eventType: "acknowledge", legacyActivityNumbers: activityNumbers }, tx)
      if (accreditationTarget.catalogActivityIds?.length || accreditationTarget.activityNumbers?.length) {
        accreditation = {
          versionId: version.id,
          targetId: target.id,
          worksiteId: doc.worksiteId,
          acknowledgedAt,
          ...accreditationTarget,
        }
      }
    }
    return ack
  })

  if (accreditation) await onDocumentAcknowledged(accreditation)
  // N°18: este acuse puede completar la entrega de un RIOHS en la faena.
  await onRiohsRolloutProgress({ versionId: version.id, worksiteIds: [acknowledgedWorksiteId], actorUserId: args.ctx.userId })
  return result
}

export async function exemptDocumentDistributionTarget(args: DistributionContext & {
  targetId: string
  reason: string
}) {
  const reason = args.reason.trim()
  if (reason.length < 3 || reason.length > 1000) throw new Error("Registra un motivo de exención válido.")
  const [target] = await db.select().from(sstDocumentDistributionTargets)
    .where(eq(sstDocumentDistributionTargets.id, args.targetId))
  if (!target) throw new Error("Destinatario documental no encontrado.")
  const { doc, version } = await getPublishedVersionContext(target.versionId)
  authorizeDistribution(args, doc)
  assertTargetInScope(doc, target.worksiteId, args.scope)
  if (target.status !== "pendiente") throw new Error("Sólo se puede eximir una asignación pendiente.")

  const exempted = await db.transaction(async (tx) => {
    const now = new Date().toISOString()
    const [updated] = await tx.update(sstDocumentDistributionTargets).set({
      status: "exento",
      exemptedByUserId: args.ctx.userId,
      exemptedAt: now,
      exemptionReason: reason,
      updatedAt: now,
    }).where(and(
      eq(sstDocumentDistributionTargets.id, target.id),
      eq(sstDocumentDistributionTargets.status, "pendiente"),
    )).returning()
    if (!updated) throw new Error("La asignación ya no está pendiente.")
    await tx.insert(sstDocumentAudit).values({
      id: `sda-${nanoid()}`,
      documentId: doc.id,
      versionId: version.id,
      action: "exempt",
      userId: args.ctx.userId,
      comment: reason,
      metadata: { targetId: target.id },
      ip: args.ctx.ip ?? null,
      createdAt: now,
    })
    return updated
  })
  await onRiohsRolloutProgress({ versionId: version.id, worksiteIds: [exempted.worksiteId], actorUserId: args.ctx.userId })
  return exempted
}

export async function listDocumentDistribution(versionId: string, scope: WorksiteScope, permissions: readonly string[]) {
  const { doc } = await getPublishedVersionContext(versionId)
  authorizeDistribution({ ctx: { userId: "read-only" }, scope, permissions }, doc)
  const rows = await db.select().from(sstDocumentDistributionTargets)
    .where(eq(sstDocumentDistributionTargets.versionId, versionId))
  if (doc.worksiteId || scope.mode !== "some") return rows
  return rows.filter((row) => row.worksiteId !== null && scope.ids.includes(row.worksiteId))
}

/**
 * Exime en un solo acto a varios destinatarios pendientes de una versión, con
 * un mismo motivo y una fila de auditoría por destinatario.
 *
 * Existe porque el acuse es propio: sólo lo firma quien tiene cuenta en la
 * plataforma, y la mayor parte de la dotación no la tiene. Cerrar la entrega de
 * un RIOHS nuevo (N°18) exige que cada trabajador activo acuse o quede exento;
 * eximirlos de a uno, en una faena de cien personas, no es operable. Los que
 * ya no están pendientes se informan, no se tocan.
 */
export async function exemptDocumentDistributionTargets(args: DistributionContext & {
  versionId: string
  targetIds: string[]
  reason: string
}) {
  const reason = args.reason.trim()
  if (reason.length < 3 || reason.length > 1000) throw new Error("Registra un motivo de exención válido.")
  const targetIds = Array.from(new Set(args.targetIds.filter(Boolean)))
  if (targetIds.length === 0) throw new Error("Selecciona al menos un destinatario.")
  if (targetIds.length > 200) throw new Error("La exención admite hasta 200 destinatarios por operación.")
  const { doc, version } = await getPublishedVersionContext(args.versionId)
  authorizeDistribution(args, doc)

  const targets = await db.select().from(sstDocumentDistributionTargets)
    .where(and(
      eq(sstDocumentDistributionTargets.versionId, version.id),
      inArray(sstDocumentDistributionTargets.id, targetIds),
    ))
  if (targets.length !== targetIds.length) throw new Error("Uno o más destinatarios no pertenecen a esta versión.")
  for (const target of targets) assertTargetInScope(doc, target.worksiteId, args.scope)
  const pendingIds = targets.filter((target) => target.status === "pendiente").map((target) => target.id)

  const exempted = pendingIds.length === 0 ? [] : await db.transaction(async (tx) => {
    const now = new Date().toISOString()
    const updated = await tx.update(sstDocumentDistributionTargets).set({
      status: "exento",
      exemptedByUserId: args.ctx.userId,
      exemptedAt: now,
      exemptionReason: reason,
      updatedAt: now,
    }).where(and(
      inArray(sstDocumentDistributionTargets.id, pendingIds),
      eq(sstDocumentDistributionTargets.status, "pendiente"),
    )).returning()
    if (updated.length > 0) {
      await tx.insert(sstDocumentAudit).values(updated.map((target) => ({
        id: `sda-${nanoid()}`,
        documentId: doc.id,
        versionId: version.id,
        action: "exempt",
        userId: args.ctx.userId,
        comment: reason,
        metadata: { targetId: target.id, bulk: true },
        ip: args.ctx.ip ?? null,
        createdAt: now,
      })))
    }
    return updated
  })
  const worksiteIds = [...new Set(exempted.flatMap((target) => target.worksiteId ? [target.worksiteId] : []))]
  const rollout = await onRiohsRolloutProgress({ versionId: version.id, worksiteIds, actorUserId: args.ctx.userId })
  return {
    exempted: exempted.length,
    skipped: targetIds.length - exempted.length,
    worksiteIds,
    rolloutsReported: rollout.reported,
  }
}

export type DocumentWorkforceRollout = {
  versionId: string
  worksiteId: string
  /** Trabajadores activos hoy en la faena: el padrón de la entrega. */
  active: number
  acknowledged: number
  exempt: number
  /** Asignados que todavía no acusan ni están exentos. */
  pending: number
  /** Activos sin asignación para esta versión (p. ej. ingresaron después). */
  unassigned: number
  complete: boolean
}

/**
 * ¿Recibió toda la dotación de la faena esta versión? Completa cuando cada
 * trabajador **activo hoy** de la faena tiene su asignación acusada o exenta.
 *
 * El padrón es el de hoy, no el del día de la publicación: quien ingresó
 * después también debe recibir el reglamento vigente (y lo recibe con el acta
 * de trabajador nuevo, que lo exime acá), y quien se fue ya no cuenta. Una
 * faena sin dotación no está "completa": no hay entrega que cerrar.
 */
export async function assessDocumentWorkforceRollout(versionId: string, worksiteId: string): Promise<DocumentWorkforceRollout> {
  const [activeWorkers, targets] = await Promise.all([
    db.select({ id: workers.id }).from(workers)
      .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true))),
    db.select({ workerId: sstDocumentDistributionTargets.workerId, status: sstDocumentDistributionTargets.status })
      .from(sstDocumentDistributionTargets)
      .where(eq(sstDocumentDistributionTargets.versionId, versionId)),
  ])
  const statusByWorker = new Map(targets.flatMap((target) => target.workerId ? [[target.workerId, target.status] as const] : []))
  let acknowledged = 0
  let exempt = 0
  let pending = 0
  let unassigned = 0
  for (const worker of activeWorkers) {
    const status = statusByWorker.get(worker.id)
    if (status === "acusado") acknowledged += 1
    else if (status === "exento") exempt += 1
    else if (status) pending += 1
    else unassigned += 1
  }
  return {
    versionId,
    worksiteId,
    active: activeWorkers.length,
    acknowledged,
    exempt,
    pending,
    unassigned,
    complete: activeWorkers.length > 0 && pending === 0 && unassigned === 0,
  }
}

export async function listDocumentRecipientOptions(scope: WorksiteScope) {
  if (scope.mode === "none") return []
  if (scope.mode === "all") {
    return db.select({ id: users.id, name: users.name, email: users.email, workerId: users.workerId })
      .from(users).where(eq(users.isActive, true))
  }

  const [assignedRows, workerRows] = await Promise.all([
    db.select({ userId: worksiteUsers.userId })
      .from(worksiteUsers)
      .where(inArray(worksiteUsers.worksiteId, scope.ids)),
    db.select({ id: workers.id })
      .from(workers)
      .where(and(inArray(workers.worksiteId, scope.ids), eq(workers.isActive, true))),
  ])
  const workerIds = workerRows.map((row) => row.id)
  const linkedRows = workerIds.length
    ? await db.select({ id: users.id }).from(users).where(inArray(users.workerId, workerIds))
    : []
  const userIds = Array.from(new Set([
    ...assignedRows.map((row) => row.userId),
    ...linkedRows.map((row) => row.id),
  ]))
  if (userIds.length === 0) return []
  return db.select({ id: users.id, name: users.name, email: users.email, workerId: users.workerId })
    .from(users)
    .where(and(inArray(users.id, userIds), eq(users.isActive, true)))
}


/**
 * Asigna la versión vigente a toda la dotación de la faena del documento.
 *
 * El RIOHS (DS 44 art. 56) se entrega a **todas** las personas trabajadoras, y
 * hacerlo de a una es inviable: una faena mediana ya supera el tope de 200 que
 * impone `assignDocumentVersionRecipients` por operación. Este envoltorio
 * resuelve la dotación, descarta a quien ya lo tiene asignado y trocea el resto
 * en lotes que sí caben.
 *
 * Devuelve `{ assigned, alreadyAssigned }` en vez de fallar cuando no queda
 * nadie por asignar: reintentarlo después de incorporar a alguien nuevo es el
 * caso de uso normal, no un error.
 */
export async function assignDocumentVersionToWorkforce(args: DistributionContext & {
  versionId: string
  assignmentReason: string
  dueAt?: string | null
  /** Sólo para un documento corporativo: acota la asignación a una faena. */
  worksiteId?: string | null
}) {
  const { doc } = await getPublishedVersionContext(args.versionId)
  authorizeDistribution(args, doc)
  if (doc.confidentiality === "sensible") {
    throw new Error("Los documentos sensibles sólo admiten distribución nominativa individual.")
  }
  if (args.worksiteId && doc.worksiteId && args.worksiteId !== doc.worksiteId) {
    throw new Error("El documento pertenece a otra faena.")
  }
  if (args.worksiteId) assertTargetInScope(doc, args.worksiteId, args.scope)

  // Un documento sin faena es corporativo: alcanza a toda la dotación visible
  // —la de todas las faenas con alcance global, la de las propias si no—, o a
  // la faena pedida.
  const worksiteFilter = doc.worksiteId
    ? eq(workers.worksiteId, doc.worksiteId)
    : args.worksiteId
      ? eq(workers.worksiteId, args.worksiteId)
      : args.scope.mode === "some"
        ? inArray(workers.worksiteId, args.scope.ids)
        : undefined
  const workerRows = await db.select({ id: workers.id })
    .from(workers)
    .where(worksiteFilter ? and(worksiteFilter, eq(workers.isActive, true)) : eq(workers.isActive, true))

  const existing = await db.select({ workerId: sstDocumentDistributionTargets.workerId })
    .from(sstDocumentDistributionTargets)
    .where(eq(sstDocumentDistributionTargets.versionId, args.versionId))
  const already = new Set(existing.map((row) => row.workerId).filter(Boolean) as string[])

  const pending = workerRows.map((row) => row.id).filter((id) => !already.has(id))
  if (pending.length === 0) {
    return { assigned: 0, alreadyAssigned: already.size }
  }

  // 200 es el tope por operación del servicio subyacente; se respeta troceando,
  // no subiéndolo: el límite protege la transacción, no es un capricho.
  const BATCH = 200
  let assigned = 0
  for (let index = 0; index < pending.length; index += BATCH) {
    const batch = pending.slice(index, index + BATCH)
    await assignDocumentVersionRecipients({ ...args, workerIds: batch })
    assigned += batch.length
  }
  return { assigned, alreadyAssigned: already.size }
}

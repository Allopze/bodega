/**
 * Comité de Gestión de Riesgos de Desastres (G15, DS 44).
 *
 * Molde estructural del CPHS (comité por faena, integrantes, vigencia,
 * actas, bitácora).
 *
 * Dos órganos según dotación, no uno: hasta 25 personas corresponde
 * **designar un Coordinador de Gestión del Riesgo de Desastres**; desde 26,
 * **constituir el Comité**. El umbral vive en `lib/prevention/cgrd.ts`. La
 * N°79 se acredita con el órgano que corresponda — en una faena chica el acto
 * exigible es la designación, no un comité que la norma no pide.
 *
 * Simplificación 2026-09-14 (auditoría de sobreingeniería): la matriz GRD
 * (N°80) tenía la máquina completa de la MIPER —6 estados, 3 firmas
 * segregadas, hash del contenido— para una obligación que el propio Anexo A
 * del PDTP describe como "publicación formal de la matriz". Se colapsó a
 * borrador → publicada, con una evidencia real adjunta en vez de un hash
 * sobre filas de la base. Las actas (N°81) pasaron de convocar→cerrar/
 * cancelar a un solo registro cargado después de la sesión, como el resto de
 * las constancias del módulo. El comité y el coordinador mantienen su
 * estructura — son datos reales (quién integra el órgano, desde cuándo), no
 * flujo de aprobación — pero ahora exigen evidencia del acto que los
 * constituye, que antes no tenían dónde adjuntarse.
 *
 * Diferencias deliberadas con los dos moldes:
 * - **El acta no calcula quórum.** El DS 44 no fija quórum para las reuniones
 *   del CGRD, así que no hay regla que computar: `assessQuorum` del CPHS mide
 *   mayoría de titulares y presencia de ambas representaciones, y eso existe
 *   porque el CPHS es bipartito por DS 54. Quien registra el acta declara si
 *   hubo quórum y queda registrado con autor y fecha en la bitácora.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCapaActions,
  preventionGrdAgreements,
  preventionGrdCommittees,
  preventionGrdCoordinators,
  preventionGrdMatrices,
  preventionGrdMeetings,
  preventionGrdMembers,
  preventionGrdThreats,
  workers,
} from "@/db/schema"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { nanoid } from "@/lib/id"
import { codeYear } from "@/lib/utils"
import {
  GRD_COMMITTEE_MIN_HEADCOUNT,
  grdStructureSatisfies,
  resolveGrdStructure,
  type GrdStructure,
} from "@/lib/prevention/cgrd"
import {
  onGrdStructureEstablished,
  onGrdMatrixPublished,
  onGrdMeetingClosed,
} from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { recordPdtpFulfillmentRevocation } from "@/lib/services/pdtp/fulfillment"
import {
  grdCommitteeConstituteSchema,
  grdCommitteeDissolveSchema,
  grdCoordinatorDesignateSchema,
  grdCoordinatorEndSchema,
  grdMatrixDraftSchema,
  grdMatrixPublishSchema,
  grdMeetingAnnulSchema,
  grdMeetingRecordSchema,
  grdMemberAddSchema,
  grdMemberRemoveSchema,
  grdThreatRemoveSchema,
  grdThreatUpsertSchema,
} from "@/lib/validation/prevention-module/cgrd"
import {
  type CgrdAccess,
  GRD_NOT_FOUND,
  grdScopeCondition,
  nowIso,
  recordGrdHistory,
  requireGrdAccess,
} from "@/lib/services/prevention-cgrd-access"

// ── Comité ────────────────────────────────────────────────────────────────────

/** Dotación activa del centro de trabajo — el padrón que fija qué órgano corresponde. */
async function worksiteHeadcount(tx: DB | Tx, worksiteId: string): Promise<number> {
  const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(workers)
    .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))
  return row?.count ?? 0
}

/**
 * Qué órgano corresponde a la faena hoy y qué existe, para que la UI y la
 * compuerta puedan mostrar la brecha sin recalcular la regla cada una.
 */
export async function getGrdStructureStatus(worksiteId: string, access: CgrdAccess) {
  requireGrdAccess(access, "prevention:cgrd:view", worksiteId)
  const [headcount, [committee], [coordinator]] = await Promise.all([
    worksiteHeadcount(db, worksiteId),
    db.select().from(preventionGrdCommittees)
      .where(and(eq(preventionGrdCommittees.worksiteId, worksiteId), eq(preventionGrdCommittees.status, "active"))).limit(1),
    db.select().from(preventionGrdCoordinators)
      .where(and(eq(preventionGrdCoordinators.worksiteId, worksiteId), eq(preventionGrdCoordinators.status, "active"))).limit(1),
  ])
  const required = resolveGrdStructure(headcount)
  const existing: GrdStructure | null = committee ? "committee" : coordinator ? "coordinator" : null
  return {
    worksiteId,
    headcount,
    required,
    existing,
    committee: committee ?? null,
    coordinator: coordinator ?? null,
    // Sobrecumplir no es incumplir: un comité en una faena de 12 personas es
    // válido. Lo que no basta es un coordinador donde corresponde comité.
    satisfied: existing !== null && grdStructureSatisfies(existing, headcount),
  }
}

/**
 * Designa al coordinador (hasta 25 personas). Desde 26 la norma exige comité,
 * así que designar un coordinador ahí se rechaza: no es una preferencia
 * organizacional, es el mínimo del DS 44.
 */
export async function designateGrdCoordinator(input: unknown, access: CgrdAccess) {
  const data = grdCoordinatorDesignateSchema.parse(input)
  requireGrdAccess(access, "prevention:cgrd:committee:manage", data.worksiteId)

  return db.transaction(async (tx) => {
    const headcount = await worksiteHeadcount(tx, data.worksiteId)
    if (resolveGrdStructure(headcount) === "committee") {
      throw new Error(`Con ${headcount} personas corresponde constituir el CGRD, no designar un coordinador (desde ${GRD_COMMITTEE_MIN_HEADCOUNT}).`)
    }

    const [existingCommittee] = await tx.select({ id: preventionGrdCommittees.id }).from(preventionGrdCommittees)
      .where(and(eq(preventionGrdCommittees.worksiteId, data.worksiteId), eq(preventionGrdCommittees.status, "active"))).limit(1)
    if (existingCommittee) throw new Error("Esta faena ya tiene un CGRD vigente, que reemplaza al coordinador.")

    const [existing] = await tx.select({ id: preventionGrdCoordinators.id }).from(preventionGrdCoordinators)
      .where(and(eq(preventionGrdCoordinators.worksiteId, data.worksiteId), eq(preventionGrdCoordinators.status, "active"))).limit(1)
    if (existing) throw new Error("Esta faena ya tiene un coordinador de gestión del riesgo de desastres designado.")

    const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error("La persona no existe o está inactiva.")
    if (worker.worksiteId !== data.worksiteId) throw new Error("El coordinador debe pertenecer al centro de trabajo que coordina.")

    const [created] = await tx.insert(preventionGrdCoordinators).values({
      id: `grdco-${nanoid()}`,
      worksiteId: data.worksiteId,
      workerId: data.workerId,
      designatedOn: data.designatedOn,
      evidenceUrl: data.evidenceUrl,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo designar al coordinador.")

    await recordGrdHistory(tx, {
      entityType: "grd_coordinator", entityId: created.id, worksiteId: data.worksiteId,
      changeType: "designated", reason: `Coordinador designado con dotación de ${headcount} persona(s)`,
      afterState: created, actorUserId: access.userId,
    })
    return created
  }).then(async (created) => {
    // La N°79 se cumple con el órgano que corresponda: en una faena de hasta
    // 25 personas el acto exigible es designar al coordinador, no constituir
    // un comité que la norma no pide.
    await onGrdStructureEstablished({
      kind: "coordinator", id: created.id, worksiteId: created.worksiteId,
      establishedOn: created.designatedOn, evidenceUrl: created.evidenceUrl,
    })
    return created
  })
}

export async function endGrdCoordinator(input: unknown, access: CgrdAccess) {
  const data = grdCoordinatorEndSchema.parse(input)
  let revocation: Parameters<typeof recordPdtpFulfillmentRevocation>[0] | null = null

  const updated = await db.transaction(async (tx) => {
    const [coordinator] = await tx.select().from(preventionGrdCoordinators)
      .where(eq(preventionGrdCoordinators.id, data.coordinatorId)).limit(1)
    if (!coordinator) throw new Error(GRD_NOT_FOUND)
    requireGrdAccess(access, "prevention:cgrd:committee:manage", coordinator.worksiteId)
    if (coordinator.status !== "active") throw new Error("Esta designación ya terminó.")
    if (coordinator.version !== data.expectedVersion) throw new Error("La designación cambió mientras la editabas. Recarga y reintenta.")

    const [updated] = await tx.update(preventionGrdCoordinators).set({
      status: "ended", endedReason: data.reason, endedAt: nowIso(),
      version: coordinator.version + 1, updatedAt: nowIso(),
    }).where(and(
      eq(preventionGrdCoordinators.id, data.coordinatorId),
      eq(preventionGrdCoordinators.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La designación cambió mientras la editabas. Recarga y reintenta.")

    await recordGrdHistory(tx, {
      entityType: "grd_coordinator", entityId: updated.id, worksiteId: coordinator.worksiteId,
      changeType: "ended", reason: data.reason, beforeState: coordinator, afterState: updated, actorUserId: access.userId,
    })

    /* Revertir la N°79, igual que `dissolveGrdCommittee`: terminar la
     * designación deja a la faena sin el órgano que la actividad acredita, así
     * que el programa no puede seguir contándola. Mismo `sourceId` con prefijo
     * que usó `onGrdStructureEstablished` con kind "coordinator". Faltaba: la
     * rama del comité revocaba y la del coordinador no, así que una faena
     * chica quedaba con la N°79 acreditada sobre una designación terminada. */
    revocation = {
      sourceType: "cgrd",
      sourceId: `cgrd-coordinator:${updated.id}`,
      worksiteId: coordinator.worksiteId,
      revokedBy: access.userId,
      reason: data.reason,
    }
    return updated
  })

  if (revocation) await recordPdtpFulfillmentRevocation(revocation)

  return updated
}

export async function constituteGrdCommittee(input: unknown, access: CgrdAccess) {
  const data = grdCommitteeConstituteSchema.parse(input)
  requireGrdAccess(access, "prevention:cgrd:committee:manage", data.worksiteId)

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: preventionGrdCommittees.id }).from(preventionGrdCommittees)
      .where(and(eq(preventionGrdCommittees.worksiteId, data.worksiteId), eq(preventionGrdCommittees.status, "active")))
      .limit(1)
    if (existing) throw new Error("Esta faena ya tiene un Comité de Gestión de Riesgos de Desastres vigente.")

    // Constituir comité sobre cualquier dotación es válido: la norma fija un
    // mínimo desde 26 personas y sobrecumplirlo no es incumplir. Lo que no se
    // permite es lo inverso —coordinador donde corresponde comité—, y eso lo
    // bloquea `designateGrdCoordinator`.
    //
    // El comité reemplaza al coordinador: es el camino de migración de la
    // faena que cruza el umbral, y dejar los dos vigentes afirmaría dos
    // órganos donde la norma pide uno.
    const [coordinator] = await tx.select().from(preventionGrdCoordinators)
      .where(and(eq(preventionGrdCoordinators.worksiteId, data.worksiteId), eq(preventionGrdCoordinators.status, "active"))).limit(1)

    const [created] = await tx.insert(preventionGrdCommittees).values({
      id: `grdc-${nanoid()}`,
      worksiteId: data.worksiteId,
      name: data.name,
      constitutedOn: data.constitutedOn,
      mandateEndsOn: data.mandateEndsOn,
      evidenceUrl: data.evidenceUrl,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo constituir el comité.")

    if (coordinator) {
      const [endedCoordinator] = await tx.update(preventionGrdCoordinators).set({
        status: "ended",
        endedReason: `Reemplazado por el CGRD constituido el ${data.constitutedOn}.`,
        endedAt: nowIso(), version: coordinator.version + 1, updatedAt: nowIso(),
      }).where(and(
        eq(preventionGrdCoordinators.id, coordinator.id),
        eq(preventionGrdCoordinators.status, "active"),
      )).returning()
      if (endedCoordinator) {
        await recordGrdHistory(tx, {
          entityType: "grd_coordinator", entityId: coordinator.id, worksiteId: data.worksiteId,
          changeType: "superseded", reason: `Reemplazado por el CGRD ${created.id}.`,
          beforeState: coordinator, afterState: endedCoordinator, actorUserId: access.userId,
        })
      }
    }

    await recordGrdHistory(tx, {
      entityType: "grd_committee", entityId: created.id, worksiteId: data.worksiteId,
      changeType: "constituted", reason: `Comité constituido con mandato hasta ${data.mandateEndsOn}`,
      afterState: created, actorUserId: access.userId,
    })
    return created
  }).then(async (created) => {
    // N°79. Fuera de la transacción y sin propagar el error: el comité ya
    // existe y la acreditación puede reintentarse (mismo patrón que CPHS).
    await onGrdStructureEstablished({
      kind: "committee", id: created.id, worksiteId: created.worksiteId,
      establishedOn: created.constitutedOn, evidenceUrl: created.evidenceUrl,
    })
    return created
  })
}

export async function dissolveGrdCommittee(input: unknown, access: CgrdAccess) {
  const data = grdCommitteeDissolveSchema.parse(input)
  let revocation: Parameters<typeof recordPdtpFulfillmentRevocation>[0] | null = null

  const updated = await db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionGrdCommittees).where(eq(preventionGrdCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(GRD_NOT_FOUND)
    requireGrdAccess(access, "prevention:cgrd:committee:manage", committee.worksiteId)
    if (committee.status !== "active") throw new Error("El comité ya no está vigente.")
    if (committee.version !== data.expectedVersion) throw new Error("El comité cambió mientras lo editabas. Recarga y reintenta.")

    const [updated] = await tx.update(preventionGrdCommittees).set({
      status: "dissolved", version: committee.version + 1, updatedAt: nowIso(),
    }).where(and(eq(preventionGrdCommittees.id, data.committeeId), eq(preventionGrdCommittees.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("El comité cambió mientras lo editabas. Recarga y reintenta.")

    await recordGrdHistory(tx, {
      entityType: "grd_committee", entityId: updated.id, worksiteId: committee.worksiteId,
      changeType: "dissolved", reason: data.reason, beforeState: committee, afterState: updated, actorUserId: access.userId,
    })

    // Revertir la N°79: el mismo `sourceId` con prefijo que usó
    // `onGrdStructureEstablished` (kind "committee") al constituirlo. Se
    // dispara DESPUÉS del commit, sin propagar el error.
    revocation = {
      sourceType: "cgrd",
      sourceId: `cgrd-committee:${updated.id}`,
      worksiteId: committee.worksiteId,
      revokedBy: access.userId,
      reason: data.reason,
    }
    return updated
  })

  if (revocation) await recordPdtpFulfillmentRevocation(revocation)

  return updated
}

export async function addGrdMember(input: unknown, access: CgrdAccess) {
  const data = grdMemberAddSchema.parse(input)
  return db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionGrdCommittees).where(eq(preventionGrdCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(GRD_NOT_FOUND)
    requireGrdAccess(access, "prevention:cgrd:committee:manage", committee.worksiteId)
    if (committee.status !== "active") throw new Error("Un comité disuelto o vencido no admite integrantes nuevos.")

    const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error("La persona no existe o está inactiva.")
    if (worker.worksiteId !== committee.worksiteId) {
      throw new Error("El comité representa a un centro de trabajo: no admite integrantes de otra faena.")
    }

    const [created] = await tx.insert(preventionGrdMembers).values({
      id: `grdm-${nanoid()}`,
      committeeId: data.committeeId,
      workerId: data.workerId,
      role: data.role ?? "integrante",
    }).returning()
    if (!created) throw new Error("No se pudo incorporar al integrante.")
    await recordGrdHistory(tx, {
      entityType: "grd_member", entityId: created.id, worksiteId: committee.worksiteId,
      changeType: "added", reason: `Integrante incorporado como ${data.role ?? "integrante"}`, afterState: created, actorUserId: access.userId,
    })
    return created
  })
}

export async function removeGrdMember(input: unknown, access: CgrdAccess) {
  const data = grdMemberRemoveSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ member: preventionGrdMembers, committee: preventionGrdCommittees })
      .from(preventionGrdMembers)
      .innerJoin(preventionGrdCommittees, eq(preventionGrdMembers.committeeId, preventionGrdCommittees.id))
      .where(eq(preventionGrdMembers.id, data.memberId)).limit(1)
    if (!row) throw new Error(GRD_NOT_FOUND)
    requireGrdAccess(access, "prevention:cgrd:committee:manage", row.committee.worksiteId)
    if (row.member.status !== "active") throw new Error("El integrante ya no está activo.")

    const [updated] = await tx.update(preventionGrdMembers).set({ status: "resigned", updatedAt: nowIso() })
      .where(and(eq(preventionGrdMembers.id, data.memberId), eq(preventionGrdMembers.status, "active"))).returning()
    if (!updated) throw new Error("El integrante ya no está activo o fue actualizado concurrentemente.")

    await recordGrdHistory(tx, {
      entityType: "grd_member", entityId: updated.id, worksiteId: row.committee.worksiteId,
      changeType: "resigned", reason: data.reason, beforeState: row.member, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

export async function listGrdCommittees(access: CgrdAccess) {
  requireGrdAccess(access, "prevention:cgrd:view")
  const condition = grdScopeCondition(access.scope, preventionGrdCommittees.worksiteId)
  return condition ? db.select().from(preventionGrdCommittees).where(condition) : db.select().from(preventionGrdCommittees)
}

export async function listGrdMembers(committeeId: string, access: CgrdAccess) {
  const [committee] = await db.select().from(preventionGrdCommittees).where(eq(preventionGrdCommittees.id, committeeId)).limit(1)
  if (!committee) throw new Error(GRD_NOT_FOUND)
  requireGrdAccess(access, "prevention:cgrd:view", committee.worksiteId)
  return db.select().from(preventionGrdMembers).where(eq(preventionGrdMembers.committeeId, committeeId))
}

/** Candidatos a integrante, dentro del alcance de faena — molde de `listCommitteeWorkers` (CPHS). */
export async function listGrdWorkers(access: CgrdAccess) {
  requireGrdAccess(access, "prevention:cgrd:view")
  if (access.scope.mode === "none") return []
  return db.select({
    id: workers.id, firstName: workers.firstName, lastName: workers.lastName,
    position: workers.position, worksiteId: workers.worksiteId,
  })
    .from(workers)
    .where(and(
      eq(workers.isActive, true),
      access.scope.mode === "some" ? inArray(workers.worksiteId, access.scope.ids) : undefined,
    ))
    .orderBy(asc(workers.lastName), asc(workers.firstName))
}

// ── Matriz GRD (N°80) ─────────────────────────────────────────────────────────

export async function createGrdMatrixDraft(input: unknown, access: CgrdAccess) {
  const data = grdMatrixDraftSchema.parse(input)
  requireGrdAccess(access, "prevention:cgrd:matrix:edit", data.worksiteId)

  return db.transaction(async (tx) => {
    const existing = await tx.select({ matrixVersion: preventionGrdMatrices.matrixVersion }).from(preventionGrdMatrices)
      .where(eq(preventionGrdMatrices.worksiteId, data.worksiteId))
    const nextVersion = existing.reduce((max, row) => Math.max(max, row.matrixVersion), 0) + 1

    const [created] = await tx.insert(preventionGrdMatrices).values({
      id: `grdx-${nanoid()}`,
      worksiteId: data.worksiteId,
      matrixVersion: nextVersion,
      title: data.title,
      revisionReason: data.revisionReason,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear la versión de la matriz GRD.")

    await recordGrdHistory(tx, {
      entityType: "grd_matrix", entityId: created.id, worksiteId: data.worksiteId,
      changeType: "created", reason: data.revisionReason, afterState: created, actorUserId: access.userId,
    })
    return created
  })
}

async function loadEditableMatrix(tx: DB | Tx, matrixId: string) {
  const [matrix] = await tx.select().from(preventionGrdMatrices).where(eq(preventionGrdMatrices.id, matrixId)).limit(1)
  if (!matrix) throw new Error(GRD_NOT_FOUND)
  if (matrix.status !== "draft") throw new Error("Sólo se pueden editar amenazas de una versión en borrador.")
  return matrix
}

export async function addGrdThreat(input: unknown, access: CgrdAccess) {
  const data = grdThreatUpsertSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await loadEditableMatrix(tx, data.matrixId)
    requireGrdAccess(access, "prevention:cgrd:matrix:edit", matrix.worksiteId)

    const [created] = await tx.insert(preventionGrdThreats).values({
      id: `grdt-${nanoid()}`,
      matrixId: data.matrixId,
      name: data.name,
      origin: data.origin,
      historicalAnalysis: data.historicalAnalysis,
      legalRequirement: data.legalRequirement,
      workPlan: data.workPlan,
      emergencyScenarioId: data.emergencyScenarioId ?? null,
    }).returning()
    if (!created) throw new Error("No se pudo agregar la amenaza.")
    await recordGrdHistory(tx, {
      entityType: "grd_threat", entityId: created.id, worksiteId: matrix.worksiteId,
      changeType: "added", reason: `Amenaza agregada: ${data.name}`, afterState: created, actorUserId: access.userId,
    })
    return created
  })
}

export async function removeGrdThreat(input: unknown, access: CgrdAccess) {
  const data = grdThreatRemoveSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ threat: preventionGrdThreats, matrix: preventionGrdMatrices })
      .from(preventionGrdThreats)
      .innerJoin(preventionGrdMatrices, eq(preventionGrdThreats.matrixId, preventionGrdMatrices.id))
      .where(eq(preventionGrdThreats.id, data.threatId)).limit(1)
    if (!row) throw new Error(GRD_NOT_FOUND)
    if (row.matrix.status !== "draft") throw new Error("Sólo se pueden editar amenazas de una versión en borrador.")
    requireGrdAccess(access, "prevention:cgrd:matrix:edit", row.matrix.worksiteId)

    await tx.delete(preventionGrdThreats).where(eq(preventionGrdThreats.id, data.threatId))
    await recordGrdHistory(tx, {
      entityType: "grd_threat", entityId: row.threat.id, worksiteId: row.matrix.worksiteId,
      changeType: "removed", reason: `Amenaza retirada: ${row.threat.name}`, beforeState: row.threat, actorUserId: access.userId,
    })
  })
}

export async function listGrdThreats(matrixId: string, access: CgrdAccess) {
  const [matrix] = await db.select().from(preventionGrdMatrices).where(eq(preventionGrdMatrices.id, matrixId)).limit(1)
  if (!matrix) throw new Error(GRD_NOT_FOUND)
  requireGrdAccess(access, "prevention:cgrd:view", matrix.worksiteId)
  return db.select().from(preventionGrdThreats).where(eq(preventionGrdThreats.matrixId, matrixId))
}

/**
 * Publica la matriz en borrador (N°80): único acto de la máquina simplificada
 * — sin revisión ni aprobación intermedias, una sola persona publica con su
 * evidencia. Reemplaza cualquier versión previamente publicada de la faena.
 */
export async function publishGrdMatrix(input: unknown, access: CgrdAccess) {
  const data = grdMatrixPublishSchema.parse(input)
  let accreditation: Parameters<typeof onGrdMatrixPublished>[0] | null = null

  const result = await db.transaction(async (tx) => {
    const [matrix] = await tx.select().from(preventionGrdMatrices).where(eq(preventionGrdMatrices.id, data.matrixId)).limit(1)
    if (!matrix) throw new Error(GRD_NOT_FOUND)
    requireGrdAccess(access, "prevention:cgrd:matrix:publish", matrix.worksiteId)
    if (matrix.status !== "draft") throw new Error(`Sólo una matriz en borrador puede publicarse (estado actual: ${matrix.status}).`)
    if (matrix.version !== data.expectedVersion) throw new Error("La matriz GRD cambió mientras la revisabas. Recarga antes de continuar.")

    const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(preventionGrdThreats).where(eq(preventionGrdThreats.matrixId, matrix.id))
    if (!countRow?.count) throw new Error("Una matriz GRD sin amenazas no puede publicarse.")

    const now = nowIso()

    const previousPublished = await tx.select().from(preventionGrdMatrices).where(and(
      eq(preventionGrdMatrices.worksiteId, matrix.worksiteId),
      eq(preventionGrdMatrices.status, "published"),
    ))
    for (const previous of previousPublished) {
      const [superseded] = await tx.update(preventionGrdMatrices)
        .set({ status: "superseded", version: previous.version + 1, updatedAt: now })
        .where(and(
          eq(preventionGrdMatrices.id, previous.id),
          eq(preventionGrdMatrices.status, "published"),
          eq(preventionGrdMatrices.version, previous.version),
        ))
        .returning()
      if (superseded) {
        await recordGrdHistory(tx, {
          entityType: "grd_matrix", entityId: previous.id, worksiteId: previous.worksiteId,
          changeType: "superseded", reason: `Reemplazada por matriz GRD v${matrix.matrixVersion} (${matrix.id}).`,
          beforeState: { status: previous.status, version: previous.version }, afterState: { status: superseded.status, supersededByMatrixId: matrix.id },
          actorUserId: access.userId,
        })
      }
    }

    const [updated] = await tx.update(preventionGrdMatrices).set({
      status: "published",
      version: matrix.version + 1,
      evidenceUrl: data.evidenceUrl,
      publishedByUserId: access.userId,
      publishedAt: now,
      updatedAt: now,
    })
      .where(and(eq(preventionGrdMatrices.id, matrix.id), eq(preventionGrdMatrices.version, data.expectedVersion), eq(preventionGrdMatrices.status, "draft")))
      .returning()
    if (!updated) throw new Error("La matriz GRD cambió mientras la revisabas. Recarga antes de continuar.")

    await recordGrdHistory(tx, {
      entityType: "grd_matrix", entityId: matrix.id, worksiteId: matrix.worksiteId,
      changeType: "published",
      reason: `Matriz GRD v${matrix.matrixVersion} publicada`,
      beforeState: { status: matrix.status, version: matrix.version },
      afterState: { status: updated.status, version: updated.version, evidenceUrl: updated.evidenceUrl },
      actorUserId: access.userId,
    })

    const threats = await tx.select({ id: preventionGrdThreats.id }).from(preventionGrdThreats).where(eq(preventionGrdThreats.matrixId, matrix.id))
    accreditation = {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, matrixVersion: matrix.matrixVersion,
      publishedAt: updated.publishedAt ?? now, threatCount: threats.length, evidenceUrl: updated.evidenceUrl ?? data.evidenceUrl,
    }
    return updated
  })

  // Fuera de la transacción: el motor escribe con su propia conexión, así que
  // llamarlo dentro dejaría una ejecución huérfana si la transacción revierte.
  if (accreditation) await onGrdMatrixPublished(accreditation)
  return result
}

export async function listGrdMatrices(access: CgrdAccess, worksiteId?: string) {
  requireGrdAccess(access, "prevention:cgrd:view", worksiteId)
  if (worksiteId) return db.select().from(preventionGrdMatrices).where(eq(preventionGrdMatrices.worksiteId, worksiteId))
  const condition = grdScopeCondition(access.scope, preventionGrdMatrices.worksiteId)
  return condition ? db.select().from(preventionGrdMatrices).where(condition) : db.select().from(preventionGrdMatrices)
}

// ── Actas de reunión (N°81) ───────────────────────────────────────────────────

/**
 * Registra el acta de una sesión ya realizada (N°81): un solo acto, sin
 * convocatoria previa ni cancelación — se carga después del hecho, con su
 * evidencia, como el resto de las constancias del módulo.
 */
export async function recordGrdMeeting(input: unknown, access: CgrdAccess) {
  const data = grdMeetingRecordSchema.parse(input)

  const result = await db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionGrdCommittees).where(eq(preventionGrdCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(GRD_NOT_FOUND)
    requireGrdAccess(access, "prevention:cgrd:meeting:manage", committee.worksiteId)
    if (committee.status !== "active") throw new Error("Un comité disuelto o vencido no puede registrar sesiones.")

    const [created] = await tx.insert(preventionGrdMeetings).values({
      id: `grdmt-${nanoid()}`,
      code: `CGRD-${codeYear()}-${nanoid(8).toUpperCase()}`,
      committeeId: data.committeeId,
      heldOn: data.heldOn,
      agenda: data.agenda,
      minutes: data.minutes,
      quorumReached: data.quorumReached,
      evidenceUrl: data.evidenceUrl,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar el acta.")

    // Los acuerdos van antes de cerrar la transacción: si `createCapaActionWithClient`
    // rechaza un responsable inactivo, el acta no queda registrada a medias
    // con acuerdos perdidos — toda la transacción revierte.
    for (const agreement of data.agreements) {
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "cgrd",
        sourceId: created.id,
        worksiteId: committee.worksiteId,
        finding: agreement.description,
        actionDescription: agreement.actionDescription,
        responsibleUserId: agreement.responsibleUserId ?? null,
        priority: agreement.priority,
        targetDate: agreement.targetDate,
        evidenceRequired: true,
      }, access.userId)
      await tx.insert(preventionGrdAgreements).values({
        id: `grdag-${nanoid()}`,
        meetingId: created.id,
        description: agreement.description,
        capaActionId: capa.id,
      })
    }

    await recordGrdHistory(tx, {
      entityType: "grd_meeting", entityId: created.id, worksiteId: committee.worksiteId,
      changeType: "recorded", reason: `Acta registrada con ${data.agreements.length} acuerdo(s)`,
      afterState: created, actorUserId: access.userId,
    })
    return { meeting: created, worksiteId: committee.worksiteId }
  })

  /* `heldOn` y no `createdAt`: el acta se carga después de la sesión, y el
   * motor de acreditación usa `occurredAt` para resolver el período del
   * programa (`periodSlot`) y para verificar que el hecho caiga dentro del año
   * del programa activo (`yearOfOccurrence`). Acreditar con la fecha de
   * digitación le anotaría a septiembre una sesión de junio, y dejaría fuera
   * del programa una sesión de diciembre cargada en enero. */
  await onGrdMeetingClosed({
    meetingId: result.meeting.id, worksiteId: result.worksiteId,
    heldOn: result.meeting.heldOn, evidenceUrl: result.meeting.evidenceUrl,
  })
  return result.meeting
}

/**
 * Anula un acta mal cargada y revierte la N°81 que acreditó (N°81).
 *
 * No borra la fila: el acta acreditó, y conservarla es lo que explica por qué
 * el programa contó —y después descontó— esa sesión. Sus acuerdos siguen
 * colgando de ella con sus CAPA, que se cierran o cancelan por su propio
 * flujo: una CAPA en curso no se borra porque el acta que la originó estuviera
 * mal transcrita.
 */
export async function annulGrdMeeting(input: unknown, access: CgrdAccess) {
  const data = grdMeetingAnnulSchema.parse(input)
  let revocation: Parameters<typeof recordPdtpFulfillmentRevocation>[0] | null = null

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.select({ meeting: preventionGrdMeetings, committee: preventionGrdCommittees })
      .from(preventionGrdMeetings)
      .innerJoin(preventionGrdCommittees, eq(preventionGrdMeetings.committeeId, preventionGrdCommittees.id))
      .where(eq(preventionGrdMeetings.id, data.meetingId)).limit(1)
    if (!row) throw new Error(GRD_NOT_FOUND)
    requireGrdAccess(access, "prevention:cgrd:meeting:manage", row.committee.worksiteId)
    if (row.meeting.annulledAt) throw new Error("Esta acta ya está anulada.")

    const now = nowIso()
    const [updated] = await tx.update(preventionGrdMeetings).set({
      annulledAt: now, annulledByUserId: access.userId, annulledReason: data.reason,
    }).where(and(
      eq(preventionGrdMeetings.id, data.meetingId),
      sql`${preventionGrdMeetings.annulledAt} IS NULL`,
    )).returning()
    if (!updated) throw new Error("Esta acta ya está anulada.")

    await recordGrdHistory(tx, {
      entityType: "grd_meeting", entityId: updated.id, worksiteId: row.committee.worksiteId,
      changeType: "annulled", reason: data.reason, beforeState: row.meeting, afterState: updated, actorUserId: access.userId,
    })

    // Mismo `sourceId` con prefijo que usó `onGrdMeetingClosed` al registrarla.
    revocation = {
      sourceType: "cgrd",
      sourceId: `cgrd-meeting:${updated.id}`,
      worksiteId: row.committee.worksiteId,
      revokedBy: access.userId,
      reason: data.reason,
    }
    return updated
  })

  if (revocation) await recordPdtpFulfillmentRevocation(revocation)

  return updated
}

/**
 * Acuerdos de las actas de un comité, con el estado vivo de su CAPA — no una
 * copia: la tabla de acuerdos no tiene `status` propio a propósito.
 */
export async function listGrdAgreements(committeeId: string, access: CgrdAccess) {
  const [committee] = await db.select().from(preventionGrdCommittees).where(eq(preventionGrdCommittees.id, committeeId)).limit(1)
  if (!committee) throw new Error(GRD_NOT_FOUND)
  requireGrdAccess(access, "prevention:cgrd:view", committee.worksiteId)
  return db.select({
    id: preventionGrdAgreements.id,
    meetingId: preventionGrdAgreements.meetingId,
    description: preventionGrdAgreements.description,
    capaActionId: preventionGrdAgreements.capaActionId,
    capaCode: preventionCapaActions.code,
    capaStatus: preventionCapaActions.status,
    capaTargetDate: preventionCapaActions.targetDate,
  })
    .from(preventionGrdAgreements)
    .innerJoin(preventionGrdMeetings, eq(preventionGrdAgreements.meetingId, preventionGrdMeetings.id))
    .leftJoin(preventionCapaActions, eq(preventionGrdAgreements.capaActionId, preventionCapaActions.id))
    .where(eq(preventionGrdMeetings.committeeId, committeeId))
}

export async function listGrdMeetings(access: CgrdAccess, committeeId?: string) {
  if (committeeId) {
    const [committee] = await db.select().from(preventionGrdCommittees).where(eq(preventionGrdCommittees.id, committeeId)).limit(1)
    if (!committee) throw new Error(GRD_NOT_FOUND)
    requireGrdAccess(access, "prevention:cgrd:view", committee.worksiteId)
    return db.select().from(preventionGrdMeetings).where(eq(preventionGrdMeetings.committeeId, committeeId))
  }
  requireGrdAccess(access, "prevention:cgrd:view")
  const committees = await listGrdCommittees(access)
  if (committees.length === 0) return []
  const rows = await Promise.all(committees.map((committee) => db.select().from(preventionGrdMeetings).where(eq(preventionGrdMeetings.committeeId, committee.id))))
  return rows.flat()
}

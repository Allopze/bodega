import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivityWorksiteExclusions, pdtpExecutionDeviations, pdtpExecutions, pdtpChangeLog, pdtpObligations, pdtpPrograms, worksites } from "@/db/schema"
import { pdtpExecutionId } from "./helpers"
import { addPdtpChangeLogEntry, assertWorksiteAccess } from "./helpers"
import type { WorksiteScope } from "./helpers"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { pdtpExecutionSchema } from "@/lib/validation/prevention"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"
import { existsSync } from "node:fs"
import { logger } from "@/lib/logger"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"
import { isPdtpPeriodOnOrAfterActivation } from "./period"

export async function markPdtpExecution(input: unknown, userId: string, scope: WorksiteScope) {
  const data = pdtpExecutionSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const [activity] = await db.select({
    programId: pdtpActivities.programId,
    n: pdtpActivities.n,
    status: pdtpActivities.status,
    retiredEffectiveFrom: pdtpActivities.retiredEffectiveFrom,
    evidenceRequirement: pdtpActivities.evidenceRequirement,
  }).from(pdtpActivities).where(eq(pdtpActivities.id, data.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db.select({
    status: pdtpPrograms.status,
    year: pdtpPrograms.year,
    version: pdtpPrograms.version,
    activatedAt: pdtpPrograms.activatedAt,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "active") throw new Error("Solo se pueden registrar ejecuciones contra programas PDTP en estado activo.")
  // Si el programa declara membresía de faenas, una faena fuera de ella no
  // puede registrar ejecuciones (ver lib/services/pdtp/worksites.ts).
  await assertPdtpWorksiteCanOperateProgram(activity.programId, data.worksiteId)
  // Espejo del guard de overrides.ts: sin esto, una ejecución con el año
  // calendario (en vez del año del programa) queda huérfana — el detalle y
  // /aprobaciones consultan por `program.year`, así que nunca aparecería.
  if (program.year !== data.year) {
    throw new Error(`La ejecución debe corresponder al año del programa (${program.year}).`)
  }
  if (!isPdtpPeriodOnOrAfterActivation(data, program.activatedAt)) {
    throw new Error("El programa aún no estaba activo en el período seleccionado. Registra actividades desde su semana de activación.")
  }
  // La actividad declara qué evidencia exige y hasta ahora eso era sólo un
  // texto en la tarjeta: el esquema deja la evidencia opcional y la única red
  // era el aprobador. Lo acreditado por integración (accreditPdtpFromEvent)
  // no pasa por acá y queda exento a propósito — su evidencia es el registro
  // del módulo de origen.
  const requirement = activity.evidenceRequirement?.trim()
  const hasEvidence = Boolean(data.evidenceText?.trim())
    || Boolean(data.evidenceUrl?.trim())
    || (data.evidencePhotos?.length ?? 0) > 0
  if (requirement && !hasEvidence) {
    throw new Error(`Esta actividad exige evidencia: ${requirement}`)
  }
  if (!isPdtpActivityEffectiveForPeriod(activity, data.year, data.month, data.week)) {
    throw new Error("La actividad está retirada para el período seleccionado y no admite nuevas ejecuciones.")
  }
  const [exclusion] = await db.select({ id: pdtpActivityWorksiteExclusions.id })
    .from(pdtpActivityWorksiteExclusions)
    .where(and(
      eq(pdtpActivityWorksiteExclusions.activityId, data.activityId),
      eq(pdtpActivityWorksiteExclusions.worksiteId, data.worksiteId),
    ))
    .limit(1)
  if (exclusion) {
    throw new Error("La actividad está excluida para esta faena y no admite ejecuciones.")
  }

  // Exclusión mutua con los desvíos por celda (deviations.ts):
  // `not_applicable`/`reprogrammed` retiraron o movieron el planificado de
  // esta celda — registrar una ejecución sobre ella contradiría al desvío,
  // así que se rechaza. Un `not_performed` activo, en cambio, describía "no
  // se hizo" hasta ahora: si llega una ejecución con cantidad > 0, el hecho
  // ocurrió después de todo y el desvío deja de ser cierto — se retira solo,
  // más abajo, dentro de la misma transacción que registra la ejecución.
  const [activeDeviation] = await db.select({
    id: pdtpExecutionDeviations.id,
    kind: pdtpExecutionDeviations.kind,
  }).from(pdtpExecutionDeviations).where(and(
    eq(pdtpExecutionDeviations.activityId, data.activityId),
    eq(pdtpExecutionDeviations.worksiteId, data.worksiteId),
    eq(pdtpExecutionDeviations.year, data.year),
    eq(pdtpExecutionDeviations.month, data.month),
    eq(pdtpExecutionDeviations.week, data.week),
    eq(pdtpExecutionDeviations.status, "active"),
  )).limit(1)
  if (activeDeviation && (activeDeviation.kind === "not_applicable" || activeDeviation.kind === "reprogrammed")) {
    throw new Error("Esta celda tiene un desvío activo (no aplicable o reprogramado) y no admite ejecuciones.")
  }

  // Si la ejecución ya está aprobada, no se permite reescribir. Sólo
  // 'draft' o 'rejected' (devuelta para corrección) son editables.
  // H-M3: también leemos evidenceUrl/evidencePhotos existentes para
  // hacer append-only (preservar la historia de evidencias).
  const [existing] = await db
    .select({
      status: pdtpExecutions.status,
      evidenceUrl: pdtpExecutions.evidenceUrl,
      evidencePhotos: pdtpExecutions.evidencePhotos,
    })
    .from(pdtpExecutions)
    .where(and(
      eq(pdtpExecutions.activityId, data.activityId),
      eq(pdtpExecutions.worksiteId, data.worksiteId),
      eq(pdtpExecutions.year, data.year),
      eq(pdtpExecutions.month, data.month),
      eq(pdtpExecutions.week, data.week),
      isNull(pdtpExecutions.obligationId),
    ))
    .limit(1)
  if (existing && existing.status === "approved") {
    throw new Error("La ejecución ya fue aprobada y no se puede modificar.")
  }

  // Append-only: dedupe por nombre de archivo, preserva URLs previas
  function fileName(url: string): string {
    const idx = url.lastIndexOf("/")
    return idx >= 0 ? url.slice(idx + 1) : url
  }
  const previousPhotos = Array.isArray(existing?.evidencePhotos) ? existing.evidencePhotos : []
  const newPhotosInput = (data.evidencePhotos ?? []).filter(Boolean)
  // H-B7: filtramos fotos nuevas cuyo archivo no exista físicamente
  const verifiedNewPhotos = newPhotosInput.filter((url) => {
    const absolutePath = resolvePdtpEvidenceFile(url)
    if (!absolutePath || !existsSync(absolutePath)) {
      logger.warn({ url }, "[pdtp] foto de evidencia sin archivo físico, descartada")
      return false
    }
    return true
  })
  const allPhotos = [...previousPhotos, ...verifiedNewPhotos]
  const dedupedPhotos: string[] = []
  const seen = new Set<string>()
  for (const url of allPhotos) {
    const name = fileName(url)
    if (seen.has(name)) continue
    seen.add(name)
    dedupedPhotos.push(url)
  }
  // evidenceUrl: si viene uno nuevo, se usa; si no, se preserva el
  // previo. Esto evita que un re-envío sin archivo borre el archivo
  // que el prevencionista subió antes.
  // H-B7: si se recibió una URL nueva, verificamos que el archivo
  // físico exista; si no, descartamos la referencia y loggeamos.
  // Razón: la DB no debe quedar con referencias a archivos inexistentes
  // (un upload pudo fallar, el cliente pudo cerrar la pestaña, etc).
  let nextEvidenceUrl: string | null = null
  if (data.evidenceUrl) {
    const absolutePath = resolvePdtpEvidenceFile(data.evidenceUrl)
    if (absolutePath && existsSync(absolutePath)) {
      nextEvidenceUrl = data.evidenceUrl
    } else {
      logger.warn(
        { evidenceUrl: data.evidenceUrl, activityId: data.activityId, worksiteId: data.worksiteId },
        "[pdtp] evidenceUrl no se pudo resolver a un archivo físico; se descarta la referencia"
      )
    }
  } else {
    nextEvidenceUrl = existing?.evidenceUrl ?? null
  }

  const now = new Date().toISOString()
  const id = pdtpExecutionId(data.activityId, data.worksiteId, data.year, data.month, data.week)

  // H-B8 (intencional): `evidenceText || null` colapsa string vacío a
  // null en DB. Es la convención del módulo: "sin texto de evidencia"
  // ≡ NULL (semánticamente equivalente y simplifica queries). Lo mismo
  // aplica a `evidenceUrl` cuando se preserva el previo inexistente.
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(pdtpExecutions).values({
      id, activityId: data.activityId, worksiteId: data.worksiteId, year: data.year, month: data.month,
      week: data.week, executedQuantity: data.executedQuantity, status: "submitted",
      evidenceText: data.evidenceText || null, evidenceUrl: nextEvidenceUrl,
      evidencePhotos: dedupedPhotos, executedByUserId: userId, executedAt: now, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [pdtpExecutions.activityId, pdtpExecutions.worksiteId, pdtpExecutions.year, pdtpExecutions.month, pdtpExecutions.week],
      targetWhere: sql`${pdtpExecutions.obligationId} IS NULL AND ${pdtpExecutions.origin} <> 'integration'`,
      set: {
        executedQuantity: data.executedQuantity, status: "submitted",
        evidenceText: data.evidenceText || null, evidenceUrl: nextEvidenceUrl,
        evidencePhotos: dedupedPhotos, executedByUserId: userId, executedAt: now,
        // Limpia rechazo previo: cuando el prevencionista reenvía, la
        // ejecución vuelve a 'submitted' con un nuevo intento.
        rejectedByUserId: null, rejectedAt: null, rejectionReason: null,
        updatedAt: now,
      },
      // El SELECT previo permite preservar las evidencias; esta condición es
      // la garantía de escritura: una aprobación concurrente nunca puede ser
      // degradada de approved a submitted por este upsert.
      setWhere: ne(pdtpExecutions.status, "approved"),
    }).returning()

    if (!row) throw new Error("La ejecución ya fue aprobada y no se puede modificar.")

    // El hecho ocurrió después de todo: un `not_performed` activo sobre esta
    // celda deja de ser cierto en cuanto llega una ejecución con cantidad
    // real. Se retira automáticamente, con su propio motivo y su propia
    // entrada de changelog — no requiere que el usuario lo haga a mano.
    if (activeDeviation && activeDeviation.kind === "not_performed" && data.executedQuantity > 0) {
      const withdrawn = await tx.update(pdtpExecutionDeviations).set({
        status: "withdrawn",
        withdrawnByUserId: userId,
        withdrawnAt: now,
        withdrawReason: "Ejecución registrada posteriormente",
      }).where(and(
        eq(pdtpExecutionDeviations.id, activeDeviation.id),
        eq(pdtpExecutionDeviations.status, "active"),
      )).returning({ id: pdtpExecutionDeviations.id })
      if (withdrawn.length > 0) {
        await addPdtpChangeLogEntry(
          activity.programId, program.version, userId, `deviation:${activity.n}`,
          { status: "active" },
          { status: "withdrawn", reason: "Ejecución registrada posteriormente" },
          `Desvío "no realizado" retirado automáticamente para actividad ${activity.n}: ejecución registrada posteriormente.`,
          tx,
        )
      }
    }

    await recordOperationalActivity({
      eventType: existing ? "pdtp.execution_resubmitted" : "pdtp.execution_submitted",
      module: "pdtp",
      entityType: "pdtp_execution",
      entityId: row.id,
      worksiteId: data.worksiteId,
      actorUserId: userId,
      payload: { year: data.year, month: data.month, week: data.week, status: "submitted" },
    }, tx)
    return row
  })
}

export async function approvePdtpExecution(executionId: string, userId: string, scope: WorksiteScope) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpExecutions} WHERE id = ${executionId} FOR UPDATE`)
    const [execution] = await tx.select().from(pdtpExecutions).where(eq(pdtpExecutions.id, executionId)).limit(1)
    if (!execution) throw new Error("Ejecución PDTP no encontrada.")
    if (execution.status === "approved") throw new Error("La ejecución ya fue aprobada.")
    if (execution.status !== "submitted" && execution.status !== "rejected") {
      throw new Error("Solo se pueden aprobar ejecuciones en estado 'submitted' o 'rejected'.")
    }
    // Segregación: quien registró el cumplimiento no puede ser quien lo
    // aprueba. `executedByUserId` es null en las de `origin: 'integration'`
    // (nadie "tecleó" nada), así que esto sólo aplica a las manuales —mismo
    // criterio que el resto de Prevención (`prevention-risk-legal.ts`,
    // `prevention-indicadores.ts`). Faltaba acá: un usuario con `execute` y
    // `approve` podía aprobar lo suyo (hallazgo del 2026-09-02).
    if (execution.executedByUserId && execution.executedByUserId === userId) {
      throw new Error("Quien registró el cumplimiento no puede aprobarlo. Debe hacerlo otra persona.")
    }
    assertWorksiteAccess(execution.worksiteId, scope)

    const now = new Date().toISOString()
    const [updated] = await tx.update(pdtpExecutions)
      .set({
        status: "approved",
        approvedByUserId: userId,
        approvedAt: now,
        rejectedByUserId: null,
        rejectedAt: null,
        rejectionReason: null,
        sourceMetadataJson: {
          ...((execution.sourceMetadataJson ?? {}) as Record<string, unknown>),
          approvalMode: "manual",
          manuallyApprovedByUserId: userId,
          manuallyApprovedAt: now,
        },
        updatedAt: now,
      })
      .where(and(
        eq(pdtpExecutions.id, executionId),
        inArray(pdtpExecutions.status, ["submitted", "rejected"]),
      )).returning()
    if (!updated) throw new Error("La ejecución cambió de estado antes de poder aprobarse. Actualiza la página e inténtalo nuevamente.")
    if (execution.obligationId) {
      const [closed] = await tx.update(pdtpObligations).set({
        status: "completed",
        completedQuantity: execution.executedQuantity,
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(pdtpObligations.id, execution.obligationId),
        eq(pdtpObligations.status, "reported"),
      )).returning({ id: pdtpObligations.id })
      if (!closed) throw new Error("La obligación asociada cambió antes de completar su aprobación.")
    }
    await recordOperationalActivity({
      eventType: "pdtp.execution_approved",
      module: "pdtp",
      entityType: "pdtp_execution",
      entityId: updated.id,
      worksiteId: execution.worksiteId,
      actorUserId: userId,
      payload: { status: "approved", obligationCompleted: Boolean(execution.obligationId) },
    }, tx)
    return updated
  })
}

export async function rejectPdtpExecution(
  executionId: string,
  userId: string,
  reason: string,
  scope: WorksiteScope,
) {
  if (!reason || reason.trim().length === 0) {
    throw new Error("Debes indicar el motivo del rechazo.")
  }
  if (reason.length > 1000) {
    throw new Error("El motivo del rechazo no puede superar 1000 caracteres.")
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpExecutions} WHERE id = ${executionId} FOR UPDATE`)
    const [execution] = await tx.select().from(pdtpExecutions).where(eq(pdtpExecutions.id, executionId)).limit(1)
    if (!execution) throw new Error("Ejecución PDTP no encontrada.")
    if (execution.status === "approved") throw new Error("La ejecución ya fue aprobada, no se puede rechazar.")
    if (execution.status === "rejected") throw new Error("La ejecución ya fue rechazada.")
    if (execution.status !== "submitted") throw new Error("Solo se pueden rechazar ejecuciones en estado 'submitted'.")
    assertWorksiteAccess(execution.worksiteId, scope)

    const now = new Date().toISOString()
    const [updated] = await tx.update(pdtpExecutions)
      .set({
        status: "rejected",
        rejectedByUserId: userId,
        rejectedAt: now,
        rejectionReason: reason.trim(),
        updatedAt: now,
      })
      .where(and(
        eq(pdtpExecutions.id, executionId),
        eq(pdtpExecutions.status, "submitted"),
      )).returning()
    if (!updated) throw new Error("La ejecución cambió de estado antes de poder rechazarse. Actualiza la página e inténtalo nuevamente.")
    if (execution.obligationId) {
      await tx.update(pdtpObligations).set({
        status: sql`CASE WHEN ${pdtpObligations.dueAt} < ${now} THEN 'overdue' ELSE 'pending' END`,
        completedQuantity: 0,
        reportedAt: null,
        updatedAt: now,
      }).where(and(eq(pdtpObligations.id, execution.obligationId), eq(pdtpObligations.status, "reported")))
    }
    await recordOperationalActivity({
      eventType: "pdtp.execution_rejected",
      module: "pdtp",
      entityType: "pdtp_execution",
      entityId: updated.id,
      worksiteId: execution.worksiteId,
      actorUserId: userId,
      payload: { status: "rejected", hasObligation: Boolean(execution.obligationId) },
    }, tx)
    return updated
  })
}

export type PendingPdtpExecution = {
  id: string
  activityId: string
  activityN: number
  activityName: string
  worksiteId: string
  worksiteName: string
  year: number
  month: number
  week: number
  executedQuantity: number
  evidenceText: string | null
  evidenceUrl: string | null
  evidencePhotos: string[]
  executedByUserId: string | null
  executedAt: string | null
}

export async function listPendingPdtpExecutions(
  scope: WorksiteScope,
  filter: { programId?: string; year?: number } = {},
): Promise<PendingPdtpExecution[]> {
  // Bug E: antes exigía un `year` fijo (el caller pasaba
  // currentPdtpPeriod().year) — un programa cuyo año difiere del calendario
  // (o cuyas ejecuciones ya no son del año en curso) nunca aparecía acá.
  // Con `programId` filtramos por las actividades de ESE programa (no por
  // año: un programa tiene un solo año, y así funciona sin importar cuál
  // sea). Sin programId ni year, se listan pendientes de todos los años.
  const rows = await db
    .select({
      id: pdtpExecutions.id,
      activityId: pdtpExecutions.activityId,
      activityN: pdtpActivities.n,
      activityName: pdtpActivities.activity,
      worksiteId: pdtpExecutions.worksiteId,
      worksiteName: worksites.name,
      year: pdtpExecutions.year,
      month: pdtpExecutions.month,
      week: pdtpExecutions.week,
      executedQuantity: pdtpExecutions.executedQuantity,
      evidenceText: pdtpExecutions.evidenceText,
      evidenceUrl: pdtpExecutions.evidenceUrl,
      evidencePhotos: pdtpExecutions.evidencePhotos,
      executedByUserId: pdtpExecutions.executedByUserId,
      executedAt: pdtpExecutions.executedAt,
    })
    .from(pdtpExecutions)
    .innerJoin(pdtpActivities, eq(pdtpExecutions.activityId, pdtpActivities.id))
    .innerJoin(worksites, eq(pdtpExecutions.worksiteId, worksites.id))
    .where(and(
      eq(pdtpExecutions.status, "submitted"),
      filter.programId ? eq(pdtpActivities.programId, filter.programId) : undefined,
      filter.year ? eq(pdtpExecutions.year, filter.year) : undefined,
      scope === "all" ? undefined : inArray(pdtpExecutions.worksiteId, scope),
    ))
    .orderBy(asc(worksites.name), asc(pdtpExecutions.month), asc(pdtpExecutions.week))

  return rows.map((r) => ({
    ...r,
    evidencePhotos: Array.isArray(r.evidencePhotos) ? r.evidencePhotos : [],
  }))
}

export async function getPendingPdtpApprovalsForView(params: {
  worksiteId: string
  year: number
  activityIds: string[]
}): Promise<Array<{ id: string; activityId: string; month: number; week: number }>> {
  if (params.activityIds.length === 0) return []
  return db
    .select({
      id: pdtpExecutions.id,
      activityId: pdtpExecutions.activityId,
      month: pdtpExecutions.month,
      week: pdtpExecutions.week,
    })
    .from(pdtpExecutions)
    .where(and(
      eq(pdtpExecutions.worksiteId, params.worksiteId),
      eq(pdtpExecutions.status, "submitted"),
      eq(pdtpExecutions.year, params.year),
      inArray(pdtpExecutions.activityId, params.activityIds),
    ))
}

export async function getPdtpChangeLog(programId: string) {
  return db
    .select()
    .from(pdtpChangeLog)
    .where(eq(pdtpChangeLog.programId, programId))
    .orderBy(desc(pdtpChangeLog.changedAt))
    .limit(20)
}

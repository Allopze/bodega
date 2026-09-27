import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpActivities, pdtpActivityWorksiteAssignees, pdtpActivityWorksiteExclusions, pdtpExecutionDeviations, pdtpExecutions, pdtpChangeLog, pdtpObligations, pdtpPrograms, worksites } from "@/db/schema"
import { pdtpExecutionId } from "./helpers"
import { addPdtpChangeLogEntry, assertWorksiteAccess, pdtpCellLockKey } from "./helpers"
import type { WorksiteScope } from "./helpers"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { pdtpExecutionSchema } from "@/lib/validation/prevention"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"
import { existsSync } from "node:fs"
import { logger } from "@/lib/logger"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"
import { isPdtpPeriodOnOrAfterActivation } from "./period"
import { assertPdtpPeriodOpen } from "./period-guard"
import { todayInChile } from "@/lib/utils"
import { hashPdtpEvidenceFiles } from "./evidence-files"
import {
  pdtpExecutionHistorySnapshot,
  pdtpNextSubmissionMetadata,
  recordPdtpExecutionHistory,
} from "./execution-history"

export type MarkPdtpExecutionOptions = {
  /**
   * Quien administra el programa (`prevention:pdtp:override:manage`) puede
   * corregir el envío pendiente de otra persona y registrar por la persona
   * asignada. El resto sólo actúa sobre lo propio.
   */
  canActForOthers?: boolean
}

export async function markPdtpExecution(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
  options: MarkPdtpExecutionOptions = {},
) {
  const data = pdtpExecutionSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const [activity] = await db.select({
    programId: pdtpActivities.programId,
    n: pdtpActivities.n,
    status: pdtpActivities.status,
    retiredEffectiveFrom: pdtpActivities.retiredEffectiveFrom,
    evidenceRequirement: pdtpActivities.evidenceRequirement,
    mechanism: pdtpActivities.mechanism,
    manualEvidencePolicy: pdtpActivities.manualEvidencePolicy,
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
  // La actividad declara qué evidencia exige. El requisito se evalúa más
  // abajo (después de resolver `nextEvidenceUrl`/`dedupedPhotos`), una vez
  // verificado el archivo físico — ver el comentario junto a esa evaluación.
  const requirement = activity.evidenceRequirement?.trim()
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

  // PREV-I03 (auditoría 2026-09-26): la asignación nominal era sólo un filtro
  // de /pendientes — cualquiera con `execute` en la faena registraba la
  // actividad de otra persona. Con una asignación vigente, registra la persona
  // asignada; quien administra el programa puede hacerlo por ella.
  if (!options.canActForOthers) {
    const today = todayInChile()
    const assignees = await db.select({ userId: pdtpActivityWorksiteAssignees.userId })
      .from(pdtpActivityWorksiteAssignees)
      .where(and(
        eq(pdtpActivityWorksiteAssignees.activityId, data.activityId),
        eq(pdtpActivityWorksiteAssignees.worksiteId, data.worksiteId),
        lte(pdtpActivityWorksiteAssignees.validFrom, today),
        or(isNull(pdtpActivityWorksiteAssignees.validUntil), gte(pdtpActivityWorksiteAssignees.validUntil, today)),
      ))
    if (assignees.length > 0 && !assignees.some((assignee) => assignee.userId === userId)) {
      throw new Error("Esta actividad está asignada a otra persona en esta faena. Solo quien está asignado, o quien administra el programa, puede registrarla.")
    }
  }

  const now = new Date().toISOString()
  const id = pdtpExecutionId(data.activityId, data.worksiteId, data.year, data.month, data.week)
  // W5-SHA: el checksum de lo que llega se calcula aquí, en el servidor y
  // fuera de la transacción (lee el archivo completo). Dentro sólo se guardan
  // los de las rutas que de verdad quedaron vinculadas.
  const incomingSha256 = await hashPdtpEvidenceFiles([data.evidenceUrl, ...(data.evidencePhotos ?? [])])

  // H-B8 (intencional): `evidenceText || null` colapsa string vacío a
  // null en DB. Es la convención del módulo: "sin texto de evidencia"
  // ≡ NULL (semánticamente equivalente y simplifica queries).
  return db.transaction(async (tx) => {
    // Exclusión mutua con los desvíos por celda (deviations.ts):
    // `not_applicable`/`reprogrammed` retiraron o movieron el planificado de
    // esta celda — registrar una ejecución sobre ella contradiría al desvío,
    // así que se rechaza. Un `not_performed` activo, en cambio, describía "no
    // se hizo" hasta ahora: si llega una ejecución con cantidad > 0, el hecho
    // ocurrió después de todo y el desvío deja de ser cierto — se retira solo,
    // más abajo, en esta misma transacción.
    //
    // TOCTOU: esta lectura vive DENTRO de la transacción y detrás del mismo
    // advisory lock por celda que toma `recordPdtpDeviation`. Leerla afuera
    // dejaba pasar dos operaciones concurrentes y la celda terminaba con
    // ejecución aprobada Y desvío activo. El `FOR UPDATE` retiene la fila de
    // desvío mientras esta transacción decide; el advisory lock cubre el caso
    // que el `FOR UPDATE` no puede —que el desvío todavía no exista— y es lo
    // que hace de la lectura una condición de escritura, igual que
    // `setWhere: ne(status, 'approved')` más abajo lo es para la aprobación.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pdtpCellLockKey(data.activityId, data.worksiteId, data.year, data.month, data.week)}))`)
    // Mes cerrado: la foto del cierre ya se congeló y se distribuyó; escribir
    // sobre ese mes la dejaría mintiendo. Va DENTRO de la transacción, con el
    // `tx`, por lo mismo que la lectura del desvío de arriba: comprobarlo
    // afuera es leer un estado que otra transacción puede cambiar antes del
    // INSERT.
    await assertPdtpPeriodOpen(activity.programId, data.worksiteId, data.year, data.month, tx)
    const [activeDeviation] = await tx.select({
      id: pdtpExecutionDeviations.id,
      kind: pdtpExecutionDeviations.kind,
      status: pdtpExecutionDeviations.status,
    }).from(pdtpExecutionDeviations).where(and(
      eq(pdtpExecutionDeviations.activityId, data.activityId),
      eq(pdtpExecutionDeviations.worksiteId, data.worksiteId),
      eq(pdtpExecutionDeviations.year, data.year),
      eq(pdtpExecutionDeviations.month, data.month),
      eq(pdtpExecutionDeviations.week, data.week),
      inArray(pdtpExecutionDeviations.status, ["active", "pending_review"]),
    )).limit(1).for("update")
    // PREV-C07: un "No aplica" en revisión ocupa la celda igual que uno
    // vigente. Aceptar la ejecución dejaría al revisor aprobando una exclusión
    // sobre una semana que ya declara trabajo hecho.
    if (activeDeviation?.status === "pending_review") {
      throw new Error("Esta celda tiene un 'no aplica' en revisión. Retíralo o espera a que se revise antes de registrar la ejecución.")
    }
    if (activeDeviation && (activeDeviation.kind === "not_applicable" || activeDeviation.kind === "reprogrammed")) {
      throw new Error("Esta celda tiene un desvío activo (no aplicable o reprogramado) y no admite ejecuciones.")
    }

    // El registro previo de la celda se lee aquí, detrás del lock: la fusión
    // de evidencias y el control de autor deciden sobre él, y leído afuera dos
    // envíos concurrentes se pisaban la foto o el archivo del otro.
    const [existing] = await tx
      .select({
        status: pdtpExecutions.status,
        executedQuantity: pdtpExecutions.executedQuantity,
        evidenceUrl: pdtpExecutions.evidenceUrl,
        evidencePhotos: pdtpExecutions.evidencePhotos,
        executedByUserId: pdtpExecutions.executedByUserId,
        rejectionReason: pdtpExecutions.rejectionReason,
        evidenceText: pdtpExecutions.evidenceText,
        sourceMetadataJson: pdtpExecutions.sourceMetadataJson,
      })
      .from(pdtpExecutions)
      .where(and(
        eq(pdtpExecutions.activityId, data.activityId),
        eq(pdtpExecutions.worksiteId, data.worksiteId),
        eq(pdtpExecutions.year, data.year),
        eq(pdtpExecutions.month, data.month),
        eq(pdtpExecutions.week, data.week),
        isNull(pdtpExecutions.obligationId),
        // W1-N01: la fila de la carga manual es la única que el upsert de abajo
        // puede escribir (`targetWhere` excluye `integration`). Leer una fila
        // de integración aquí le prestaba su archivo a la carga manual —se
        // saltaba PREV-B02— o la bloqueaba por estar ya aprobada.
        ne(pdtpExecutions.origin, "integration"),
      ))
      .limit(1)
      .for("update")
    // Si la ejecución ya está aprobada, no se permite reescribir. Sólo
    // 'draft' o 'rejected' (devuelta para corrección) son editables.
    if (existing && existing.status === "approved") {
      throw new Error("La ejecución ya fue aprobada y no se puede modificar.")
    }
    // PREV-B03: un envío pendiente es de quien lo registró. Reemplazarlo en
    // silencio cambiaba cantidad, evidencia y autor de lo que el aprobador iba
    // a revisar. Un rechazo sí devuelve la celda a cualquiera con `execute`.
    if (
      existing?.status === "submitted"
      && existing.executedByUserId
      && existing.executedByUserId !== userId
      && !options.canActForOthers
    ) {
      throw new Error("Esta semana ya tiene un registro enviado por otra persona que espera aprobación. No se puede reemplazar: pide a quien lo registró que lo corrija, o que se rechace para volver a enviarlo.")
    }

    const { evidenceUrl: nextEvidenceUrl, evidencePhotos: dedupedPhotos } = mergePdtpEvidence(existing, data)

    // Ronda de corrección (2026-09-23): gate GENÉRICO para CUALQUIER actividad
    // con `evidenceRequirement` — nunca una ejecución completamente vacía. Se
    // evalúa sobre lo que llegó en ESTE envío y excluye `constancia` a
    // propósito: su falta de archivo la explica mejor el gate de abajo.
    const hasEvidence = Boolean(data.evidenceText?.trim())
      || Boolean(data.evidenceUrl?.trim())
      || (data.evidencePhotos?.length ?? 0) > 0
    if (requirement && !hasEvidence && activity.mechanism !== "constancia") {
      throw new Error(`Esta actividad exige evidencia: ${requirement}`)
    }

    // Task 9 (M2.1): en una `constancia` que declara requisito, la observación
    // no basta. Se evalúa sobre el resultado FINAL (ya verificado contra el
    // disco): un reenvío que sólo corrige el texto no pierde el archivo real
    // que ya tenía guardado.
    const hasRealEvidence = Boolean(nextEvidenceUrl) || dedupedPhotos.length > 0
    if (requirement && activity.mechanism === "constancia" && !hasRealEvidence) {
      throw new Error(`Esta actividad exige evidencia: ${requirement}. La observación no basta — adjunta un archivo (foto o PDF).`)
    }

    // PREV-B02 (auditoría 2026-09-26): declarar una cantidad es declarar que
    // la actividad se hizo, y eso exige evidencia verificable en toda
    // actividad —no sólo en las que traían `evidenceRequirement`—. La única
    // excepción es la declarada en `manualEvidencePolicy`, y aun así exige
    // una observación escrita. Una cantidad cero no declara cumplimiento.
    if (data.executedQuantity > 0 && !hasRealEvidence) {
      if (activity.manualEvidencePolicy !== "declaration_allowed") {
        throw new Error("Para declarar la actividad como realizada adjunta un archivo (foto o PDF) como evidencia verificable.")
      }
      if (!data.evidenceText?.trim()) {
        throw new Error("Esta actividad admite una observación en lugar de un archivo, pero no puede quedar vacía: describe dónde está la evidencia o adjunta un archivo.")
      }
    }

    // PREV-M03: `evidence_status` dice qué respalda esta carga. Antes quedaba
    // en `pending` para siempre y una fila migrada conservaba
    // `migrated_without_attachment` aunque después recibiera evidencia real.
    const evidenceStatus = hasRealEvidence || Boolean(data.evidenceText?.trim())
      ? "provided" as const
      : "not_required" as const

    // PREV-I04 / W5-SHA: número de intento y sha256 por archivo viajan en los
    // metadatos de la fila (sin migración) y se copian al historial.
    const sourceMetadataJson = pdtpNextSubmissionMetadata(existing?.sourceMetadataJson, {
      isResubmission: Boolean(existing),
      linkedPaths: [nextEvidenceUrl, ...dedupedPhotos],
      incomingSha256,
    })

    const [row] = await tx.insert(pdtpExecutions).values({
      id, activityId: data.activityId, worksiteId: data.worksiteId, year: data.year, month: data.month,
      week: data.week, executedQuantity: data.executedQuantity, status: "submitted",
      evidenceText: data.evidenceText || null, evidenceUrl: nextEvidenceUrl,
      evidencePhotos: dedupedPhotos, evidenceStatus, executedByUserId: userId, executedAt: now, createdAt: now, updatedAt: now,
      sourceMetadataJson,
    }).onConflictDoUpdate({
      target: [pdtpExecutions.activityId, pdtpExecutions.worksiteId, pdtpExecutions.year, pdtpExecutions.month, pdtpExecutions.week],
      targetWhere: sql`${pdtpExecutions.obligationId} IS NULL AND ${pdtpExecutions.origin} <> 'integration'`,
      set: {
        executedQuantity: data.executedQuantity, status: "submitted",
        evidenceText: data.evidenceText || null, evidenceUrl: nextEvidenceUrl,
        evidencePhotos: dedupedPhotos, evidenceStatus, executedByUserId: userId, executedAt: now,
        sourceMetadataJson,
        // Limpia rechazo previo: cuando el prevencionista reenvía, la
        // ejecución vuelve a 'submitted' con un nuevo intento. El motivo no se
        // pierde: queda en el evento `pdtp.execution_resubmitted` de abajo.
        rejectedByUserId: null, rejectedAt: null, rejectionReason: null,
        updatedAt: now,
      },
      // Esta condición es la garantía de escritura: una aprobación
      // concurrente nunca puede ser degradada de approved a submitted.
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

    // PREV-I04: el intento anterior (estado, motivo de rechazo, archivo y
    // autor) queda en el evento; la fila sólo guarda el intento vigente.
    await recordOperationalActivity({
      eventType: existing ? "pdtp.execution_resubmitted" : "pdtp.execution_submitted",
      module: "pdtp",
      entityType: "pdtp_execution",
      entityId: row.id,
      worksiteId: data.worksiteId,
      actorUserId: userId,
      payload: {
        year: data.year, month: data.month, week: data.week, status: "submitted",
        ...(existing ? {
          previousStatus: existing.status,
          previousQuantity: existing.executedQuantity,
          previousRejectionReason: existing.rejectionReason ?? null,
          previousEvidenceUrl: existing.evidenceUrl ?? null,
          previousExecutedByUserId: existing.executedByUserId ?? null,
        } : {}),
      },
    }, tx)
    // PREV-I04 (D10): la traza completa del intento —el anterior y el nuevo,
    // con sus archivos— queda en la bitácora, en esta misma transacción.
    await recordPdtpExecutionHistory(tx, {
      executionId: row.id,
      worksiteId: data.worksiteId,
      changeType: existing ? "resubmitted" : "submitted",
      actorUserId: userId,
      before: existing ? pdtpExecutionHistorySnapshot(existing) : null,
      after: pdtpExecutionHistorySnapshot(row),
    })
    return row
  })
}

function evidenceFileName(url: string): string {
  const idx = url.lastIndexOf("/")
  return idx >= 0 ? url.slice(idx + 1) : url
}

function pdtpEvidenceFileExists(url: string): boolean {
  const absolutePath = resolvePdtpEvidenceFile(url)
  return Boolean(absolutePath && existsSync(absolutePath))
}

/**
 * Evidencia append-only de una celda (H-M3, PREV-B03). Las fotos previas se
 * conservan, y un archivo principal reemplazado pasa a la lista en vez de
 * perderse: así sigue referenciado —descargable y fuera del alcance del GC de
 * huérfanos— aunque el intento vigente traiga otro.
 *
 * H-B7: una ruta nueva sin archivo físico (un upload que falló, una pestaña
 * cerrada) se descarta y se conserva la previa; la BD nunca apunta a archivos
 * inexistentes.
 *
 * Exportada porque `reportPdtpObligation` aplica la misma regla: reportar de
 * nuevo una obligación rechazada reemplazaba el archivo y el del intento
 * anterior quedaba sin referencia (PREV-B03 en obligaciones).
 */
export function mergePdtpEvidence(
  existing: { evidenceUrl: string | null; evidencePhotos: unknown } | undefined,
  data: { activityId: string; worksiteId: string; evidenceUrl?: string; evidencePhotos?: string[] },
): { evidenceUrl: string | null; evidencePhotos: string[] } {
  const previousPhotos = Array.isArray(existing?.evidencePhotos) ? existing.evidencePhotos as string[] : []
  const verifiedNewPhotos = (data.evidencePhotos ?? []).filter(Boolean).filter((url) => {
    if (pdtpEvidenceFileExists(url)) return true
    logger.warn({ url }, "[pdtp] foto de evidencia sin archivo físico, descartada")
    return false
  })

  let evidenceUrl = existing?.evidenceUrl ?? null
  let replaced: string | null = null
  if (data.evidenceUrl) {
    if (pdtpEvidenceFileExists(data.evidenceUrl)) {
      if (evidenceUrl && evidenceUrl !== data.evidenceUrl) replaced = evidenceUrl
      evidenceUrl = data.evidenceUrl
    } else {
      logger.warn(
        { evidenceUrl: data.evidenceUrl, activityId: data.activityId, worksiteId: data.worksiteId },
        "[pdtp] evidenceUrl no se pudo resolver a un archivo físico; se descarta la referencia",
      )
    }
  }

  const evidencePhotos: string[] = []
  const seen = new Set<string>()
  for (const url of [...previousPhotos, ...(replaced ? [replaced] : []), ...verifiedNewPhotos]) {
    const name = evidenceFileName(url)
    if (seen.has(name)) continue
    seen.add(name)
    evidencePhotos.push(url)
  }
  return { evidenceUrl, evidencePhotos }
}

/**
 * PREV-B02: la aprobación vuelve a exigir evidencia verificable. Una ejecución
 * puede llegar a la cola sin archivo (importada, o con un archivo que después
 * desapareció del disco) y aprobarla la contaba como cumplida. Las de
 * integración se respaldan en su registro de origen, no en un archivo.
 */
function assertExecutionHasEvidenceForApproval(
  execution: {
    origin: string
    executedQuantity: number | string
    evidenceUrl: string | null
    evidencePhotos: unknown
    evidenceText: string | null
    evidenceStatus: string
  },
  manualEvidencePolicy: string | undefined,
) {
  if (execution.origin === "integration" || Number(execution.executedQuantity) <= 0) return
  const photos = Array.isArray(execution.evidencePhotos) ? execution.evidencePhotos as string[] : []
  const hasFile = [execution.evidenceUrl, ...photos].some((url) => typeof url === "string" && pdtpEvidenceFileExists(url))
  if (hasFile) return
  // PREV-M03: el texto automático de una fila migrada ("Migrado desde…; sin
  // evidencia adjunta") no es una declaración de nadie. Mientras nadie la
  // reenvíe con evidencia propia, no se aprueba ni por la excepción.
  if (
    manualEvidencePolicy === "declaration_allowed"
    && execution.evidenceText?.trim()
    && execution.evidenceStatus !== "migrated_without_attachment"
  ) return
  throw new Error("No se puede aprobar: la ejecución está sin evidencia verificable (no se adjuntó un archivo o ya no existe). Recházala para que se corrija.")
}

/**
 * El mes de la celda que esta ejecución ocupa tiene que estar abierto para
 * aprobarla o rechazarla: las dos cambian lo que el indicador del mes dice, y
 * ese número ya está congelado en la foto del cierre.
 *
 * El programa se resuelve desde la actividad porque la fila de ejecución sólo
 * conoce la celda. Se hace con el `tx` de la operación, no con `db`.
 */
async function assertPdtpPeriodOpenForExecution(
  tx: Tx,
  execution: { activityId: string; worksiteId: string; year: number; month: number },
): Promise<void> {
  const [activity] = await tx.select({ programId: pdtpActivities.programId })
    .from(pdtpActivities).where(eq(pdtpActivities.id, execution.activityId)).limit(1)
  if (!activity) return
  await assertPdtpPeriodOpen(activity.programId, execution.worksiteId, execution.year, execution.month, tx)
}

/**
 * Programa, versión y número de la actividad de una ejecución: lo que
 * necesitan el control de cambios y la política de evidencia al aprobar o
 * rechazar. Se lee con el `tx` de la operación.
 */
async function loadExecutionActivityContext(tx: Tx, activityId: string) {
  const [context] = await tx.select({
    programId: pdtpActivities.programId,
    n: pdtpActivities.n,
    manualEvidencePolicy: pdtpActivities.manualEvidencePolicy,
    programVersion: pdtpPrograms.version,
  })
    .from(pdtpActivities)
    .innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId))
    .where(eq(pdtpActivities.id, activityId))
    .limit(1)
  return context
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
    await assertPdtpPeriodOpenForExecution(tx, execution)
    const context = await loadExecutionActivityContext(tx, execution.activityId)
    assertExecutionHasEvidenceForApproval(execution, context?.manualEvidencePolicy)

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
    await recordPdtpExecutionHistory(tx, {
      executionId: updated.id,
      worksiteId: execution.worksiteId,
      changeType: "approved",
      actorUserId: userId,
      before: pdtpExecutionHistorySnapshot(execution),
      after: pdtpExecutionHistorySnapshot(updated),
    })
    // PREV-I04: aprobar cambia lo que el programa declara cumplido; queda en
    // su control de cambios, igual que desvíos y cierres.
    if (context) {
      await addPdtpChangeLogEntry(
        context.programId, context.programVersion, userId, `execution:${updated.id}`,
        { status: execution.status },
        { status: "approved" },
        `Ejecución de la actividad N°${context.n} (mes ${execution.month}, semana ${execution.week}) aprobada.`,
        tx,
      )
    }
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
    await assertPdtpPeriodOpenForExecution(tx, execution)

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
      payload: { status: "rejected", hasObligation: Boolean(execution.obligationId), reason: reason.trim() },
    }, tx)
    await recordPdtpExecutionHistory(tx, {
      executionId: updated.id,
      worksiteId: execution.worksiteId,
      changeType: "rejected",
      actorUserId: userId,
      reason: reason.trim(),
      before: pdtpExecutionHistorySnapshot(execution),
      after: pdtpExecutionHistorySnapshot(updated),
    })
    const context = await loadExecutionActivityContext(tx, execution.activityId)
    if (context) {
      await addPdtpChangeLogEntry(
        context.programId, context.programVersion, userId, `execution:${updated.id}`,
        { status: execution.status },
        { status: "rejected", reason: reason.trim() },
        `Ejecución de la actividad N°${context.n} (mes ${execution.month}, semana ${execution.week}) rechazada. Motivo: ${reason.trim()}`,
        tx,
      )
    }
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

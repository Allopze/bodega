/**
 * scripts/revert-pdtp-revoked-approvals.ts
 *
 * PREV-B01-BACKFILL (tanda T3). Antes del fix de B01, revocar la fuente de una
 * acreditación saltaba las ejecuciones que una persona había aprobado
 * (`skippedApproved`) y el libro marcaba el evento `revoked`: la actividad
 * siguió "cumplida" respaldada por un registro anulado, y nadie se enteró. El
 * fix sólo rige hacia adelante; este script corrige lo anterior.
 *
 *   npm run pdtp:revert-revoked-approvals                      # reporte (no escribe)
 *   npm run pdtp:revert-revoked-approvals -- --include-inspections
 *   npm run pdtp:revert-revoked-approvals -- --apply --actor <userId>
 *
 * En producción la imagen no trae `tsx`: el servicio one-shot
 * `revert-pdtp-revoked-approvals` de docker-compose corre el bundle en modo
 * reporte, y aplicar exige el override explícito
 *   docker compose run --rm revert-pdtp-revoked-approvals \
 *     node scripts/revert-pdtp-revoked-approvals.mjs --apply --actor <userId>
 * No está conectado a `deploy-prod.sh`: se corre a mano, después de revisar el
 * reporte con Prevención y con respaldo previo.
 *
 * Reglas:
 * - Reporte por defecto. `--apply` exige `--actor` con un usuario existente: la
 *   reversión deja entrada en el control de cambios con un responsable real
 *   (FK a `users`) — D17.
 * - Omite y lista lo cerrado (D17): meses con cierre `closed` y programas
 *   `closed`/`archived` o con el año cerrado. Un cierre es evidencia distribuida
 *   y reabrirlo es un acto humano con motivo.
 * - Omite y lista las filas agregadas de varias fuentes (la reversión humana
 *   dejaría en borrador la fila entera) y las que ya no apuntan al origen.
 * - No revierte si el origen se volvió a marcar hecho después de la revocación.
 * - Aplica con `revokePdtpAccreditationWithClient(..., onlyExecutionIds)`: la
 *   misma lógica corregida (borrador, `previousApprovedByUserId`, control de
 *   cambios, historial y reapertura de la ocurrencia enlazada), sólo sobre las
 *   ejecuciones clasificadas. Una transacción por evento, que relee y
 *   reclasifica con el evento bloqueado.
 * - Anota el evento (`result_json.backfillB01`) sin tocar `updated_at` ni
 *   `status`: el reconciliador decide la última intención por `updated_at` y
 *   adelantarlo haría rechazar una nueva finalización del mismo origen.
 * - Período ciego: el libro de revocaciones nació el 03-09-2026. Antes, los
 *   conectores revocaban sin dejar fila y `skippedApproved` sólo quedaba en el
 *   log; esas aprobaciones no son detectables por el libro. El reporte lo
 *   declara y lista para revisión manual las aprobaciones humanas de
 *   integración creadas antes de esa fecha. Nunca se aplican.
 */

import { pathToFileURL } from "node:url"
import { and, eq, inArray, lt, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpExecutions,
  pdtpFulfillmentEvents,
  pdtpPeriodClosures,
  pdtpPrograms,
  preventionInspectionRuns,
  users,
  worksites,
} from "@/db/schema"
import { revokePdtpAccreditationWithClient, type RevocationInput } from "@/lib/services/pdtp/accreditation"
import { formatDate } from "@/lib/utils"

/** Nacimiento del libro de revocaciones (`pdtp_fulfillment_events`). */
export const PDTP_B01_BLIND_PERIOD_BEFORE = "2026-09-03"

export type PdtpRevokedApprovalClass =
  | "revert"
  | "already_reverted"
  | "missing_execution"
  | "source_mismatch"
  | "source_recompleted"
  | "closed_program"
  | "closed_period"
  | "aggregated_manual"
  | "auto_approved"

const CLASS_LABELS: Record<PdtpRevokedApprovalClass, string> = {
  revert: "se revierte a borrador",
  already_reverted: "ya no está aprobada",
  missing_execution: "la ejecución ya no existe",
  source_mismatch: "la ejecución ya no apunta al registro anulado",
  source_recompleted: "el registro de origen se volvió a marcar hecho después de anularse",
  closed_program: "programa cerrado: se omite (D17)",
  closed_period: "mes cerrado: se omite (D17)",
  aggregated_manual: "fila agregada de varias fuentes: revisar a mano",
  auto_approved: "aprobación automática (anomalía): revisar a mano",
}

export type PdtpRevokedApprovalRow = {
  eventId: string
  sourceType: string
  sourceId: string
  worksiteId: string
  worksiteName: string | null
  revokedOn: string
  revokeReason: string | null
  executionId: string
  activityId: string
  activityN: number | null
  programId: string | null
  year: number | null
  month: number | null
  approvedByUserId: string | null
  classification: PdtpRevokedApprovalClass
  detail: string
}

export type PdtpBlindPeriodCandidate = {
  executionId: string
  sourceType: string | null
  sourceId: string | null
  worksiteId: string
  activityN: number | null
  year: number
  month: number
  approvedByUserId: string | null
  createdOn: string
}

export type PdtpRevokedApprovalsPlan = {
  generatedAt: string
  blindPeriod: { before: string; note: string }
  counts: Record<PdtpRevokedApprovalClass, number>
  rows: PdtpRevokedApprovalRow[]
  blindPeriodCandidates: PdtpBlindPeriodCandidate[]
  inspectionCandidates?: PdtpBlindPeriodCandidate[]
}

type Client = typeof db | Tx

type SkippedApproved = { activityId: string; executionId: string }

function skippedApprovedOf(resultJson: unknown): SkippedApproved[] {
  const list = (resultJson as { skippedApproved?: unknown } | null)?.skippedApproved
  if (!Array.isArray(list)) return []
  return list.filter((item): item is SkippedApproved => Boolean(item)
    && typeof (item as SkippedApproved).executionId === "string"
    && typeof (item as SkippedApproved).activityId === "string")
}

function metadataOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** `updatedAt, createdAt, id`: el mismo criterio de "última intención" del reconciliador. */
function intentionKey(row: { updatedAt: string; createdAt: string; id: string }): string {
  return `${new Date(row.updatedAt).toISOString()}:${new Date(row.createdAt).toISOString()}:${row.id}`
}

async function candidateEvents(client: Client, eventIds?: string[]) {
  return client.select().from(pdtpFulfillmentEvents).where(and(
    eq(pdtpFulfillmentEvents.eventType, "revoked"),
    eq(pdtpFulfillmentEvents.status, "revoked"),
    sql`jsonb_typeof(${pdtpFulfillmentEvents.resultJson} -> 'skippedApproved') = 'array'`,
    sql`jsonb_array_length(${pdtpFulfillmentEvents.resultJson} -> 'skippedApproved') > 0`,
    sql`NOT (${pdtpFulfillmentEvents.resultJson} ? 'backfillB01')`,
    eventIds ? inArray(pdtpFulfillmentEvents.id, eventIds) : undefined,
  ))
}

async function classifyEvent(client: Client, event: typeof pdtpFulfillmentEvents.$inferSelect): Promise<PdtpRevokedApprovalRow[]> {
  const skipped = skippedApprovedOf(event.resultJson)
  if (skipped.length === 0) return []
  const executionIds = [...new Set(skipped.map((item) => item.executionId))]
  const [executions, completedEvents, [worksite]] = await Promise.all([
    client.select({
      execution: pdtpExecutions,
      activityN: pdtpActivities.n,
      programId: pdtpPrograms.id,
      programStatus: pdtpPrograms.status,
      yearClosedAt: pdtpPrograms.yearClosedAt,
    }).from(pdtpExecutions)
      .leftJoin(pdtpActivities, eq(pdtpActivities.id, pdtpExecutions.activityId))
      .leftJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId))
      .where(inArray(pdtpExecutions.id, executionIds)),
    client.select({
      id: pdtpFulfillmentEvents.id,
      status: pdtpFulfillmentEvents.status,
      createdAt: pdtpFulfillmentEvents.createdAt,
      updatedAt: pdtpFulfillmentEvents.updatedAt,
    }).from(pdtpFulfillmentEvents).where(and(
      eq(pdtpFulfillmentEvents.sourceType, event.sourceType),
      eq(pdtpFulfillmentEvents.sourceId, event.sourceId),
      eq(pdtpFulfillmentEvents.eventType, "completed"),
    )),
    client.select({ name: worksites.name }).from(worksites).where(eq(worksites.id, event.worksiteId)).limit(1),
  ])
  const byId = new Map(executions.map((row) => [row.execution.id, row]))
  const revokedKey = intentionKey(event)
  // Una finalización posterior (que no se rechazó) es la última intención del
  // origen: la aprobación vuelve a tener respaldo, o lo tendrá al reconciliar.
  const recompleted = completedEvents.some((row) => row.status !== "rejected" && intentionKey(row) > revokedKey)

  const rows: PdtpRevokedApprovalRow[] = []
  for (const item of skipped) {
    const found = byId.get(item.executionId)
    const execution = found?.execution
    const metadata = metadataOf(execution?.sourceMetadataJson)
    const keys = Array.isArray(metadata.accreditedKeys) ? metadata.accreditedKeys as string[] : []
    let classification: PdtpRevokedApprovalClass
    if (!execution) classification = "missing_execution"
    else if (execution.status !== "approved") classification = "already_reverted"
    else if (execution.origin !== "integration" || execution.worksiteId !== event.worksiteId
      || !((execution.sourceType === event.sourceType && execution.sourceId === event.sourceId)
        || keys.includes(`pdtp-accredit:${execution.activityId}:${event.worksiteId}:${event.sourceType}:${event.sourceId}`))) {
      classification = "source_mismatch"
    } else if (recompleted) classification = "source_recompleted"
    else if (found.programStatus === "closed" || found.programStatus === "archived" || found.yearClosedAt) classification = "closed_program"
    else if (found.programId && await monthClosed(client, found.programId, execution.worksiteId, execution.year, execution.month)) classification = "closed_period"
    else if (keys.length > 1) classification = "aggregated_manual"
    else if (metadata.approvalMode === "automatic_source_event") classification = "auto_approved"
    else classification = "revert"

    rows.push({
      eventId: event.id,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      worksiteId: event.worksiteId,
      worksiteName: worksite?.name ?? null,
      revokedOn: formatDate(event.updatedAt),
      revokeReason: event.evidenceRef ?? null,
      executionId: item.executionId,
      activityId: item.activityId,
      activityN: found?.activityN ?? null,
      programId: found?.programId ?? null,
      year: execution?.year ?? null,
      month: execution?.month ?? null,
      approvedByUserId: execution?.approvedByUserId ?? null,
      classification,
      detail: CLASS_LABELS[classification],
    })
  }
  return rows
}

async function monthClosed(client: Client, programId: string, worksiteId: string, year: number, month: number): Promise<boolean> {
  const [closure] = await client.select({ status: pdtpPeriodClosures.status }).from(pdtpPeriodClosures).where(and(
    eq(pdtpPeriodClosures.programId, programId),
    eq(pdtpPeriodClosures.worksiteId, worksiteId),
    eq(pdtpPeriodClosures.year, year),
    eq(pdtpPeriodClosures.month, month),
  )).limit(1)
  return closure?.status === "closed"
}

function emptyCounts(): Record<PdtpRevokedApprovalClass, number> {
  return Object.fromEntries(Object.keys(CLASS_LABELS).map((key) => [key, 0])) as Record<PdtpRevokedApprovalClass, number>
}

async function manualIntegrationApprovals(where: ReturnType<typeof and>) {
  const rows = await db.select({
    execution: pdtpExecutions,
    activityN: pdtpActivities.n,
  }).from(pdtpExecutions)
    .leftJoin(pdtpActivities, eq(pdtpActivities.id, pdtpExecutions.activityId))
    .where(and(
      eq(pdtpExecutions.origin, "integration"),
      eq(pdtpExecutions.status, "approved"),
      sql`COALESCE(${pdtpExecutions.sourceMetadataJson} ->> 'approvalMode', '') <> 'automatic_source_event'`,
      where,
    ))
  return rows.map(({ execution, activityN }): PdtpBlindPeriodCandidate => ({
    executionId: execution.id,
    sourceType: execution.sourceType,
    sourceId: execution.sourceId,
    worksiteId: execution.worksiteId,
    activityN: activityN ?? null,
    year: execution.year,
    month: execution.month,
    approvedByUserId: execution.approvedByUserId,
    createdOn: formatDate(execution.createdAt),
  }))
}

/** Reporte, de sólo lectura. */
export async function planPdtpRevokedApprovalsBackfill(options: { includeInspections?: boolean } = {}): Promise<PdtpRevokedApprovalsPlan> {
  const events = await candidateEvents(db)
  const rows: PdtpRevokedApprovalRow[] = []
  for (const event of events) rows.push(...await classifyEvent(db, event))
  const counts = emptyCounts()
  for (const row of rows) counts[row.classification]++

  const listed = new Set(rows.map((row) => row.executionId))
  const blindPeriodCandidates = (await manualIntegrationApprovals(and(lt(pdtpExecutions.createdAt, `${PDTP_B01_BLIND_PERIOD_BEFORE}T00:00:00-03:00`))))
    .filter((row) => !listed.has(row.executionId))

  let inspectionCandidates: PdtpBlindPeriodCandidate[] | undefined
  if (options.includeInspections) {
    // La rama transaccional de inspecciones revertía sin dejar fila en el
    // libro. Heurística por estado del run: revisar fila a fila.
    const openRuns = db.select({ id: preventionInspectionRuns.id }).from(preventionInspectionRuns)
      .where(inArray(preventionInspectionRuns.status, ["planned", "in_progress", "cancelled"]))
    inspectionCandidates = (await manualIntegrationApprovals(and(
      eq(pdtpExecutions.sourceType, "inspeccion"),
      inArray(pdtpExecutions.sourceId, openRuns),
    ))).filter((row) => !listed.has(row.executionId))
  }

  return {
    generatedAt: new Date().toISOString(),
    blindPeriod: {
      before: PDTP_B01_BLIND_PERIOD_BEFORE,
      note: `El libro de revocaciones existe desde el ${formatDate(PDTP_B01_BLIND_PERIOD_BEFORE)}. Una anulación anterior no dejó fila y no es detectable por el libro: `
        + "las aprobaciones humanas de integración creadas antes de esa fecha se listan en `blindPeriodCandidates` para revisión manual y nunca se aplican.",
    },
    counts,
    rows,
    blindPeriodCandidates,
    ...(inspectionCandidates ? { inspectionCandidates } : {}),
  }
}

export type PdtpRevokedApprovalsApplyResult = {
  reverted: Array<{ eventId: string; executionId: string }>
  skipped: Array<{ eventId: string; executionId: string; classification: PdtpRevokedApprovalClass }>
}

/**
 * Aplica sobre lo que el reporte clasifica `revert`. Una transacción por
 * evento: bloquea el evento, reclasifica y revierte sólo esas ejecuciones.
 */
export async function applyPdtpRevokedApprovalsBackfill(input: { actorUserId: string }): Promise<PdtpRevokedApprovalsApplyResult> {
  const actorUserId = input.actorUserId?.trim()
  if (!actorUserId) throw new Error("--apply exige --actor <userId>: la reversión queda a nombre de una persona real.")
  const [actor] = await db.select({ id: users.id }).from(users).where(eq(users.id, actorUserId)).limit(1)
  if (!actor) throw new Error(`El actor ${actorUserId} no existe: --actor debe ser un usuario real.`)

  const result: PdtpRevokedApprovalsApplyResult = { reverted: [], skipped: [] }
  const events = await candidateEvents(db)
  for (const candidate of events) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${pdtpFulfillmentEvents} WHERE id = ${candidate.id} FOR UPDATE`)
      const [event] = await candidateEvents(tx, [candidate.id])
      if (!event) return
      const rows = await classifyEvent(tx, event)
      const toRevert = rows.filter((row) => row.classification === "revert")
      for (const row of rows) {
        if (row.classification !== "revert") result.skipped.push({ eventId: event.id, executionId: row.executionId, classification: row.classification })
      }
      if (toRevert.length === 0) return
      const revocation: RevocationInput & { onlyExecutionIds: string[] } = {
        sourceType: event.sourceType as RevocationInput["sourceType"],
        sourceId: event.sourceId,
        worksiteId: event.worksiteId,
        revokedBy: actorUserId,
        reason: `Corrección PREV-B01: el registro de origen se anuló el ${formatDate(event.updatedAt)} y la aprobación no se había revertido.`
          + (event.evidenceRef ? ` Motivo original: ${event.evidenceRef}` : ""),
        onlyExecutionIds: toRevert.map((row) => row.executionId),
      }
      const revoked = await revokePdtpAccreditationWithClient(revocation, tx)
      for (const row of revoked.revertedApproved) result.reverted.push({ eventId: event.id, executionId: row.executionId })
      // Sólo `result_json`: `updated_at` y `status` quedan intactos (ver docblock).
      await tx.update(pdtpFulfillmentEvents).set({
        resultJson: {
          ...metadataOf(event.resultJson),
          backfillB01: {
            appliedAt: new Date().toISOString(),
            actorUserId,
            revertedApproved: revoked.revertedApproved,
            skipped: rows.filter((row) => row.classification !== "revert").map((row) => ({ executionId: row.executionId, classification: row.classification })),
          },
        },
      }).where(eq(pdtpFulfillmentEvents.id, event.id))
    })
  }
  return result
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes("--apply")
  const plan = await planPdtpRevokedApprovalsBackfill({ includeInspections: args.includes("--include-inspections") })
  console.log(JSON.stringify(plan, null, 2))
  if (!apply) {
    console.error(`Reporte PREV-B01: ${plan.counts.revert} aprobación(es) para revertir, ${plan.rows.length - plan.counts.revert} omitida(s) con motivo, ${plan.blindPeriodCandidates.length} candidata(s) del período ciego. No se escribió nada (usa --apply --actor <userId>).`)
    process.exit(0)
  }
  const result = await applyPdtpRevokedApprovalsBackfill({ actorUserId: argValue(args, "--actor") ?? "" })
  console.log(JSON.stringify({ applied: result }, null, 2))
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1) })
}

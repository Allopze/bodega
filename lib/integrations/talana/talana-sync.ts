/**
 * Orquestador de la sincronización diaria con Talana (sólo lectura).
 *
 * 1. Descarga contratos (todos y los vigentes) y ausencias.
 * 2. Verifica que la descarga esté completa y evalúa el fusible contra la
 *    última copia buena. Bloqueada = no aplica nada y no reemplaza la copia.
 * 3. Planifica con `talana-planner` (función pura).
 * 4. Guarda la copia local y, según el modo, sólo registra el plan
 *    (`simulate`) o lo aplica persona por persona (`apply`).
 * 5. Abre en el PDTP la inducción de los ingresos recientes y de los traslados.
 * 6. Cierra la corrida y avisa si hubo problema o si se recuperó.
 *
 * Ninguna pantalla llama a Talana: sólo esto, desde el cron (o la CLI de dev).
 */
import { and, desc, eq, inArray, lt, ne, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  talanaAbsences, talanaContracts, talanaSyncRunItems, talanaSyncRuns, talanaWorkerLinks,
  workerPositionAliases, workerPositions, workers, worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { cleanRut, validateRut } from "@/lib/rut"
import { evaluateWorksitePreventiveOrganization } from "@/lib/services/pdtp-adapters/preventive-organization-connector"
import { onWorkerEnteredDotacion } from "@/lib/services/pdtp-adapters/worker-lifecycle-connector"
import { UNCLASSIFIED_POSITION_CODE } from "@/lib/services/worker-positions"
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"
import type { WorkerLifecycleEvent } from "@/lib/services/workers"
import { todayInChile } from "@/lib/utils"
import { isChomeEmployer } from "./mapping"
import { loadLastActivityByWorker } from "./talana-activity"
import { notifyTalanaRunOutcome } from "./talana-alerts"
import { applyPersonPlan, type AppliedItem } from "./talana-apply"
import { createTalanaClient, TalanaClientError, type TalanaAbsenceRow, type TalanaClient, type TalanaContractRow } from "./talana-client"
import {
  findBajaCandidates, planTalanaSync,
  type PlannerBase, type PlannerContract, type PlannerInput, type PlannerPosition, type PlanItem, type PlanItemKind,
} from "./talana-planner"
import { checkSnapshotComplete, evaluateActiveDrop, evaluateFusible, exceedsMassAltas, type FusibleReason } from "./talana-snapshot"

export type TalanaSyncTrigger = "cron" | "manual"
export type TalanaRunMode = "simulate" | "apply"
export type TalanaRunStatus = "success" | "partial" | "failed" | "blocked"

export interface TalanaSyncCounts {
  contractsReceived: number
  contractsRejected: number
  activeContracts: number
  absencesReceived: number
  altas: number
  reactivaciones: number
  bajas: number
  traslados: number
  cargos: number
  jefes: number
  sexos: number
  skipped: number
  failed: number
}

export interface TalanaSyncResult {
  runId: string
  mode: TalanaRunMode
  /** `blocked` = el fusible no dejó aplicar nada; `partial` = alguna persona falló. */
  status: Exclude<TalanaRunStatus, "failed">
  fusibleReason: FusibleReason | null
  counts: TalanaSyncCounts
}

/** Falla de la corrida completa; `code` es seguro de registrar (`TALANA_*`). */
export class TalanaSyncFailure extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "TalanaSyncFailure"
  }
}

export interface RunTalanaSyncOptions {
  trigger: TalanaSyncTrigger
  mode: TalanaRunMode
  token: string
  actorUserId?: string | null
  /** Sólo pruebas. */
  client?: TalanaClient
  now?: Date
}

/** Una corrida en `running` más allá de esto quedó colgada (el proceso murió o se trabó). */
const STALLED_AFTER_MS = 15 * 60_000
/** Los ítems de corridas más antiguas se purgan; las corridas quedan. */
const ITEM_RETENTION_DAYS = 180
const CHUNK = 200

const KIND_COUNTER: Record<PlanItemKind, keyof TalanaSyncCounts> = {
  alta: "altas", reactivacion: "reactivaciones", baja: "bajas", traslado: "traslados", cargo: "cargos", jefe: "jefes", sexo: "sexos",
}

function emptyCounts(): TalanaSyncCounts {
  return {
    contractsReceived: 0, contractsRejected: 0, activeContracts: 0, absencesReceived: 0, altas: 0, reactivaciones: 0,
    bajas: 0, traslados: 0, cargos: 0, jefes: 0, sexos: 0, skipped: 0, failed: 0,
  }
}

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

function canonicalWorkerRut(rut: string | null): string | null {
  return rut && validateRut(rut) ? cleanRut(rut) : null
}

/* ── Estado de Chome ──────────────────────────────────────────────────────── */

async function loadChomeState() {
  const [workerRows, positionRows, aliasRows, worksiteRows, linkRows] = await Promise.all([
    db.select({
      id: workers.id, rut: workers.rut, firstName: workers.firstName, lastName: workers.lastName, sex: workers.sex,
      positionId: workers.positionId, supervisor: workers.supervisor, worksiteId: workers.worksiteId,
      isActive: workers.isActive, createdAt: workers.createdAt,
    }).from(workers),
    db.select().from(workerPositions),
    db.select({ positionId: workerPositionAliases.positionId, alias: workerPositionAliases.alias }).from(workerPositionAliases),
    db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites),
    db.select().from(talanaWorkerLinks),
  ])
  const aliasesByPosition = new Map<string, string[]>()
  for (const alias of aliasRows) aliasesByPosition.set(alias.positionId, [...(aliasesByPosition.get(alias.positionId) ?? []), alias.alias])
  const positions: PlannerPosition[] = positionRows.map((position) => ({
    id: position.id, name: position.name, isSystem: position.isSystem, isActive: position.isActive,
    keys: [position.normalizedKey, normalizeWorkerPositionKey(position.name), ...(aliasesByPosition.get(position.id) ?? []).map(normalizeWorkerPositionKey)],
  }))
  const bases = new Map<string, PlannerBase>()
  for (const link of linkRows) {
    bases.set(link.rut, {
      cargoKey: link.baseCargoKey, positionId: link.basePositionId, costCenterId: link.baseCostCenterId,
      worksiteId: link.baseWorksiteId, jefeKey: link.baseJefeKey, supervisor: link.baseSupervisor,
    })
  }
  return {
    workers: workerRows.map((worker) => ({
      id: worker.id, rut: canonicalWorkerRut(worker.rut), firstName: worker.firstName, lastName: worker.lastName,
      sex: worker.sex, positionId: worker.positionId, supervisor: worker.supervisor, worksiteId: worker.worksiteId,
      isActive: worker.isActive, createdOn: todayInChile(worker.createdAt),
    })),
    positions,
    worksites: worksiteRows,
    bases,
    unclassifiedPositionId: positionRows.find((position) => position.code === UNCLASSIFIED_POSITION_CODE)?.id ?? null,
  }
}

/* ── Copia local ──────────────────────────────────────────────────────────── */

function contractValues(row: TalanaContractRow, listedActive: boolean, runId: string, now: string) {
  return {
    talanaPersonId: row.personId, rut: row.rut, rutValid: row.rutValid, firstName: row.firstName,
    lastNamePaternal: row.lastNamePaternal, lastNameMaternal: row.lastNameMaternal, sex: row.sex,
    employerName: row.employerName, contractType: row.contractType, cargo: row.cargo, costCenterId: row.costCenterId,
    costCenterName: row.costCenterName, jefeRut: row.jefeRut, jefeName: row.jefeName, hiredOn: row.hiredOn,
    startsOn: row.startsOn, endsOn: row.endsOn, finiquitado: row.finiquitado, talanaActive: row.active,
    listedActive, talanaModifiedAt: row.modifiedAt, lastSeenAt: now, lastSeenRunId: runId, missingSince: null,
  }
}

async function persistSnapshot(args: {
  runId: string
  now: string
  contracts: TalanaContractRow[]
  activeIds: Set<number>
  absences: TalanaAbsenceRow[]
  linkWorkerByRut: Map<string, string>
}) {
  await db.transaction(async (tx) => {
    for (const batch of chunks(args.contracts)) {
      await tx.insert(talanaContracts)
        .values(batch.map((row) => ({ talanaContractId: row.id, ...contractValues(row, args.activeIds.has(row.id), args.runId, args.now) })))
        .onConflictDoUpdate({
          target: talanaContracts.talanaContractId,
          set: Object.fromEntries(Object.keys(contractValues(batch[0]!, false, "", "")).map((key) => [key, sql.raw(`excluded."${snake(key)}"`)])),
        })
    }
    // Contratos que dejaron de aparecer: quedan, marcados. No mueven nada en Chome.
    const seen = args.contracts.map((row) => row.id)
    const missing = tx.update(talanaContracts).set({ listedActive: false, missingSince: sql`COALESCE(${talanaContracts.missingSince}, ${args.now})` })
    await (seen.length ? missing.where(notInArray(talanaContracts.talanaContractId, seen)) : missing)

    // Ausencias: sólo las vigentes o futuras de esta descarga; no se acumula historia.
    await tx.delete(talanaAbsences)
    for (const batch of chunks(args.absences)) {
      await tx.insert(talanaAbsences).values(batch.map((row) => ({
        talanaAbsenceId: row.id, rut: row.rut, absenceType: row.type, startsOn: row.startsOn, endsOn: row.endsOn,
        returnOn: row.returnOn, status: row.status, approved: row.approved, lastSeenRunId: args.runId, updatedAt: args.now,
      }))).onConflictDoNothing()
    }

    // Vínculo persona ↔ ficha (sin tocar la base, que sólo escribe la aplicación).
    await tx.update(talanaWorkerLinks).set({ workerId: null })
    for (const batch of chunks([...args.linkWorkerByRut.entries()])) {
      await tx.insert(talanaWorkerLinks)
        .values(batch.map(([rut, workerId]) => ({ rut, workerId, updatedAt: args.now })))
        .onConflictDoUpdate({ target: talanaWorkerLinks.rut, set: { workerId: sql`excluded.worker_id`, updatedAt: args.now } })
    }
  })
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/* ── Corridas ─────────────────────────────────────────────────────────────── */

async function closeAbandonedRuns(now: Date) {
  await db.update(talanaSyncRuns)
    .set({ status: "failed", errorCode: "TALANA_RUN_ABANDONED", finishedAt: now.toISOString() })
    .where(and(eq(talanaSyncRuns.status, "running"), lt(talanaSyncRuns.startedAt, new Date(now.getTime() - STALLED_AFTER_MS).toISOString())))
}

/** El último bloqueo fue revisado por una persona: esta corrida no vuelve a evaluar la caída. */
async function fusibleWasAccepted(): Promise<boolean> {
  const [last] = await db.select({ status: talanaSyncRuns.status, acceptedAt: talanaSyncRuns.fusibleAcceptedAt })
    .from(talanaSyncRuns)
    .where(ne(talanaSyncRuns.status, "running"))
    .orderBy(desc(talanaSyncRuns.startedAt))
    .limit(1)
  return last?.status === "blocked" && !!last.acceptedAt
}

async function hasAppliedBefore(): Promise<boolean> {
  const [row] = await db.select({ id: talanaSyncRuns.id }).from(talanaSyncRuns)
    .where(and(eq(talanaSyncRuns.mode, "apply"), inArray(talanaSyncRuns.status, ["success", "partial"])))
    .limit(1)
  return !!row
}

/** Una corrida sigue en `running` hace más de 15 minutos: quedó colgada. */
export async function hasStalledTalanaRun(now = new Date()): Promise<boolean> {
  const [row] = await db.select({ id: talanaSyncRuns.id }).from(talanaSyncRuns)
    .where(and(eq(talanaSyncRuns.status, "running"), lt(talanaSyncRuns.startedAt, new Date(now.getTime() - STALLED_AFTER_MS).toISOString())))
    .limit(1)
  return !!row
}

async function insertItems(runId: string, entries: Array<{ workerId: string | null; contractId: number | null; rut: string; item: PlanItem | AppliedItem }>) {
  for (const batch of chunks(entries)) {
    await db.insert(talanaSyncRunItems).values(batch.map((entry) => ({
      id: nanoid(), runId, workerId: entry.workerId, talanaContractId: entry.contractId, rut: entry.rut,
      kind: entry.item.kind, outcome: entry.item.outcome, reasonCode: entry.item.reasonCode,
      beforeLabel: entry.item.kind === "sexo" ? null : entry.item.before?.slice(0, 200) ?? null,
      afterLabel: entry.item.kind === "sexo" ? null : entry.item.after?.slice(0, 200) ?? null,
    })))
  }
}

function tally(counts: TalanaSyncCounts, items: Array<PlanItem | AppliedItem>, done: "planned" | "applied") {
  for (const item of items) {
    if (item.outcome === done) counts[KIND_COUNTER[item.kind]]++
    else if (item.outcome === "skipped") counts.skipped++
  }
}

/* ── Corrida ──────────────────────────────────────────────────────────────── */

export async function runTalanaSync(options: RunTalanaSyncOptions): Promise<TalanaSyncResult> {
  const nowDate = options.now ?? new Date()
  const now = nowDate.toISOString()
  const today = todayInChile(nowDate)
  const runId = `talanarun-${nanoid()}`
  const counts = emptyCounts()

  await closeAbandonedRuns(nowDate)
  await db.insert(talanaSyncRuns).values({
    id: runId, trigger: options.trigger, mode: options.mode, status: "running", actorUserId: options.actorUserId ?? null, startedAt: now,
  })

  try {
    /* 1. Descarga ─ */
    const client = options.client ?? createTalanaClient({ token: options.token })
    const all = await client.listContracts({ onlyActive: false })
    const active = await client.listContracts({ onlyActive: true })
    const absences = await client.listAbsences({ absentSince: today })
    counts.contractsReceived = all.rows.length
    counts.contractsRejected = all.rejected
    counts.absencesReceived = absences.rows.length

    /* 2. Completa y fusible ─ */
    if (checkSnapshotComplete({ all, active })) throw new TalanaSyncFailure("TALANA_SNAPSHOT_INCOMPLETE")
    const activeIds = new Set(active.rows.map((row) => row.id))
    const chomeRows = all.rows.filter((row) => isChomeEmployer(row.employerName))
    const chomeActiveIds = new Set(chomeRows.filter((row) => activeIds.has(row.id)).map((row) => row.id))
    counts.activeContracts = chomeActiveIds.size

    const stored = await db.select({
      id: talanaContracts.talanaContractId, employerName: talanaContracts.employerName, listedActive: talanaContracts.listedActive,
      activationProcessedAt: talanaContracts.activationProcessedAt, finiquitoProcessedAt: talanaContracts.finiquitoProcessedAt,
    }).from(talanaContracts)
    const storedById = new Map(stored.map((row) => [row.id, row]))
    const previousActiveIds = new Set(stored.filter((row) => row.listedActive && isChomeEmployer(row.employerName)).map((row) => row.id))
    const drop = evaluateActiveDrop({ previousActiveIds, current: chomeRows, currentActiveIds: chomeActiveIds, today })
    const bypass = await fusibleWasAccepted()
    let fusible = evaluateFusible({ activeCount: chomeActiveIds.size, drop, bypassDrop: bypass })

    /* 3. Plan ─ */
    const chome = await loadChomeState()
    const contracts: PlannerContract[] = all.rows.map((row) => ({
      id: row.id, rut: row.rut, rutValid: row.rutValid, firstName: row.firstName, lastNamePaternal: row.lastNamePaternal,
      lastNameMaternal: row.lastNameMaternal, sex: row.sex, employerName: row.employerName, contractType: row.contractType,
      cargo: row.cargo, costCenterId: row.costCenterId, costCenterName: row.costCenterName, jefeRut: row.jefeRut,
      jefeName: row.jefeName, hiredOn: row.hiredOn, startsOn: row.startsOn, endsOn: row.endsOn, finiquitado: row.finiquitado,
      listedActive: activeIds.has(row.id),
      activationProcessedAt: storedById.get(row.id)?.activationProcessedAt ?? null,
      finiquitoProcessedAt: storedById.get(row.id)?.finiquitoProcessedAt ?? null,
    }))
    const plannerInput: PlannerInput = {
      today, contracts, workers: chome.workers, positions: chome.positions, worksites: chome.worksites,
      bases: chome.bases, lastActivityByWorker: new Map(), unclassifiedPositionId: chome.unclassifiedPositionId,
    }
    plannerInput.lastActivityByWorker = await loadLastActivityByWorker(findBajaCandidates(plannerInput))
    const plan = planTalanaSync(plannerInput)
    if (!fusible && exceedsMassAltas({ plannedAltas: plan.plannedAltas, activeCount: chomeActiveIds.size, hasAppliedBefore: await hasAppliedBefore(), bypass })) {
      fusible = "mass_altas"
    }

    if (fusible) {
      await db.update(talanaSyncRuns).set({
        status: "blocked", fusibleReason: fusible, fusibleBypassed: false, finishedAt: new Date().toISOString(),
        previousActiveContracts: drop.previousActive, unexplainedDrop: drop.unexplainedDrop, ...counts,
      }).where(eq(talanaSyncRuns.id, runId))
      await notifyTalanaRunOutcome({ runId, status: "blocked", reason: fusible, failedPeople: 0 }, today)
      return { runId, mode: options.mode, status: "blocked", fusibleReason: fusible, counts }
    }

    /* 4. Copia local ─ */
    const linkWorkerByRut = new Map<string, string>()
    const workersByRut = new Map<string, string[]>()
    for (const worker of chome.workers) if (worker.rut) workersByRut.set(worker.rut, [...(workersByRut.get(worker.rut) ?? []), worker.id])
    for (const row of chomeRows) {
      const ids = workersByRut.get(row.rut)
      if (row.rutValid && ids?.length === 1) linkWorkerByRut.set(row.rut, ids[0]!)
    }
    await persistSnapshot({ runId, now, contracts: all.rows, activeIds, absences: absences.rows, linkWorkerByRut })

    /* 5. Simular o aplicar ─ */
    let status: "success" | "partial" = "success"
    if (options.mode === "simulate") {
      const entries = plan.persons.flatMap((person) => person.items.map((item) => ({ workerId: person.workerId, contractId: person.primaryContractId, rut: person.rut, item })))
      await insertItems(runId, entries)
      tally(counts, entries.map((entry) => entry.item), "planned")
    } else {
      const events: WorkerLifecycleEvent[] = []
      const recentEvents: WorkerLifecycleEvent[] = []
      const entries: Array<{ workerId: string | null; contractId: number | null; rut: string; item: AppliedItem }> = []
      for (const person of plan.persons) {
        const applied = await applyPersonPlan(person, { runId, now })
        if (applied.failed) counts.failed++
        for (const item of applied.items) entries.push({ workerId: applied.workerId, contractId: person.primaryContractId, rut: person.rut, item })
        events.push(...applied.events)
        // Inducción del PDTP: traslados siempre; altas y reactivaciones sólo si el ingreso es reciente.
        recentEvents.push(...applied.events.filter((event) => event.kind === "traslado" || person.recentHire))
      }
      await insertItems(runId, entries)
      tally(counts, entries.map((entry) => entry.item), "applied")
      if (counts.failed > 0) status = "partial"
      if (events.length > 0) {
        try {
          if (recentEvents.length > 0) await onWorkerEnteredDotacion(recentEvents, null)
          await evaluateWorksitePreventiveOrganization(events.map((event) => event.worksiteId))
        } catch (error) {
          logger.error("[talana] no se pudo registrar el cambio de dotación en el PDTP", { code: error instanceof Error ? error.name : "unknown" })
        }
      }
    }

    /* 6. Cierre ─ */
    await db.delete(talanaSyncRunItems).where(inArray(
      talanaSyncRunItems.runId,
      db.select({ id: talanaSyncRuns.id }).from(talanaSyncRuns)
        .where(lt(talanaSyncRuns.startedAt, new Date(nowDate.getTime() - ITEM_RETENTION_DAYS * 86_400_000).toISOString())),
    ))
    await db.update(talanaSyncRuns).set({
      status, fusibleBypassed: bypass, finishedAt: new Date().toISOString(),
      previousActiveContracts: drop.previousActive, unexplainedDrop: drop.unexplainedDrop, ...counts,
    }).where(eq(talanaSyncRuns.id, runId))
    await notifyTalanaRunOutcome({ runId, status, reason: null, failedPeople: counts.failed }, today)
    return { runId, mode: options.mode, status, fusibleReason: null, counts }
  } catch (error) {
    const code = error instanceof TalanaClientError || error instanceof TalanaSyncFailure ? error.code : "TALANA_SYNC_FAILED"
    if (code === "TALANA_SYNC_FAILED") logger.error("[talana] la corrida falló", { code: error instanceof Error ? error.name : "unknown" })
    await db.update(talanaSyncRuns).set({ status: "failed", errorCode: code, finishedAt: new Date().toISOString(), ...counts })
      .where(eq(talanaSyncRuns.id, runId)).catch(() => undefined)
    await notifyTalanaRunOutcome({ runId, status: "failed", reason: code, failedPeople: 0 }, today)
    throw new TalanaSyncFailure(code)
  }
}


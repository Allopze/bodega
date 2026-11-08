/**
 * Lecturas de la sincronización con Talana para `/admin/talana` y para la
 * ficha del trabajador. Sólo consultas: ninguna escribe en Talana ni cambia
 * trabajadores. La única escritura es `acceptTalanaFusible`, que deja constancia
 * de que una persona revisó un bloqueo.
 *
 * Quién llama decide el permiso (`admin:workers_hr`) y el alcance de faena;
 * este módulo no conoce la sesión salvo en `filterByWorksiteScope`.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lte, gte, ne, or, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  talanaAbsences,
  talanaContracts,
  talanaSyncRunItems,
  talanaSyncRuns,
  workerPositionAliases,
  workerPositions,
  workers,
  worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite, isGlobalRole } from "@/lib/auth/scope"
import { cleanRut } from "@/lib/rut"
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"
import { todayInChile } from "@/lib/utils"
import { isChomeEmployer, titleCase } from "./mapping"
import type { PlannerContract, PlannerPosition, PlannerWorker, PlannerWorksite } from "./talana-planner"
import { computeDifferences, type TalanaDifference } from "./talana-differences"
import { loadTalanaConfig, type TalanaConfigSources, type TalanaSyncMode } from "./talana-settings"
import { summarizeTalanaPerson, type TalanaWorkerSummary } from "./worker-hr-status"

/* ── Tipos ────────────────────────────────────────────────────────────────── */

export type TalanaRunRow = typeof talanaSyncRuns.$inferSelect
export type TalanaItemKind = "alta" | "reactivacion" | "baja" | "traslado" | "cargo" | "jefe" | "sexo"
export type TalanaItemOutcome = "planned" | "applied" | "skipped" | "failed"

export interface TalanaOverview {
  /**
   * Lo vigente (guardado en la plataforma, o el `.env`) y de dónde sale cada
   * valor. Nunca el token: este objeto viaja a componentes de servidor que
   * pasan datos al navegador.
   */
  config: {
    mode: TalanaSyncMode
    hasCredentials: boolean
    sources: TalanaConfigSources
    /** Hay un token guardado que este servidor no puede abrir. */
    tokenUnreadable: boolean
  }
  /** La corrida más reciente, incluso si sigue en curso. */
  lastRun: TalanaRunRow | null
  /** La última corrida terminada, si quedó bloqueada por el fusible y nadie la revisó. */
  blockedRun: TalanaRunRow | null
  /** Cuándo terminó la última corrida que sí descargó datos (`success` o `partial`). */
  lastGoodSyncAt: string | null
  /** Contratos vigentes de las razones sociales de Chome. */
  activeContracts: number
  /** Ausencias en curso hoy (aprobadas o sin resolver) de personas con contrato en Chome. */
  currentAbsences: number
}

export interface TalanaRunItemRow {
  id: string
  runId: string
  workerId: string | null
  /** Faena de la ficha de Chome; nula si el cambio aún no tiene ficha (un alta). */
  worksiteId: string | null
  worksiteName: string | null
  /** Nombre en Chome o, si no hay ficha, el de Talana. */
  displayName: string
  rut: string | null
  kind: TalanaItemKind
  outcome: TalanaItemOutcome
  reasonCode: string | null
  beforeLabel: string | null
  afterLabel: string | null
}

export interface TalanaDifferencesResult {
  differences: TalanaDifference[]
  /** Cuándo se descargaron los datos de Talana con los que se calculó. */
  syncedAt: string | null
}

/* ── Utilidades ───────────────────────────────────────────────────────────── */

/** Máximo de valores por `IN (...)`: Postgres admite 65 535 parámetros por consulta. */
const IN_CHUNK = 1000

async function inChunks<T>(values: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let index = 0; index < values.length; index += IN_CHUNK) {
    out.push(...await fetchChunk(values.slice(index, index + IN_CHUNK)))
  }
  return out
}

/** RUT canónico de una ficha, o `null` si está vacío o no tiene forma de RUT. */
function canonicalRut(rut: string | null | undefined): string | null {
  if (!rut) return null
  const cleaned = cleanRut(rut)
  return cleaned.length >= 2 ? cleaned : null
}

const talanaPersonName = (contract: { firstName: string | null; lastNamePaternal: string | null; lastNameMaternal: string | null }) =>
  titleCase([contract.firstName, contract.lastNamePaternal, contract.lastNameMaternal].filter(Boolean).join(" ")) || "Sin nombre"

/** Cuándo terminó la última corrida que descargó datos de Talana. */
async function readLastGoodSyncAt(): Promise<string | null> {
  const [row] = await db
    .select({ finishedAt: talanaSyncRuns.finishedAt })
    .from(talanaSyncRuns)
    .where(and(inArray(talanaSyncRuns.status, ["success", "partial"]), isNotNull(talanaSyncRuns.finishedAt)))
    .orderBy(desc(talanaSyncRuns.startedAt))
    .limit(1)
  return row?.finishedAt ?? null
}

/**
 * Alcance de faena sobre filas ya calculadas. Una fila sin faena (una persona de
 * Talana que aún no tiene ficha, un alta que todavía no se aplica) no pertenece
 * a ninguna faena: sólo la ve una sesión global.
 */
export function filterByWorksiteScope<T extends { worksiteId: string | null }>(session: Session | null, rows: T[]): T[] {
  if (isGlobalRole(session)) return rows
  return rows.filter((row) => row.worksiteId !== null && canAccessWorksite(session, row.worksiteId))
}

/* ── Resumen de la pantalla ───────────────────────────────────────────────── */

export async function getTalanaOverview(): Promise<TalanaOverview> {
  const config = await loadTalanaConfig()
  const today = todayInChile()

  const [lastRun, lastFinished, lastGoodSyncAt, activeByEmployer, absenceRows, chomeRutRows] = await Promise.all([
    db.query.talanaSyncRuns.findFirst({ orderBy: [desc(talanaSyncRuns.startedAt)] }),
    db.query.talanaSyncRuns.findFirst({
      where: isNotNull(talanaSyncRuns.finishedAt),
      orderBy: [desc(talanaSyncRuns.startedAt)],
    }),
    readLastGoodSyncAt(),
    db
      .select({ employerName: talanaContracts.employerName, total: sql<number>`count(*)::int` })
      .from(talanaContracts)
      .where(eq(talanaContracts.listedActive, true))
      .groupBy(talanaContracts.employerName),
    db
      .select({ rut: talanaAbsences.rut })
      .from(talanaAbsences)
      .where(and(
        lte(talanaAbsences.startsOn, today),
        gte(talanaAbsences.endsOn, today),
        or(isNull(talanaAbsences.approved), eq(talanaAbsences.approved, true)),
      )),
    db
      .selectDistinct({ rut: talanaContracts.rut, employerName: talanaContracts.employerName })
      .from(talanaContracts),
  ])

  const activeContracts = activeByEmployer
    .filter((row) => isChomeEmployer(row.employerName))
    .reduce((total, row) => total + row.total, 0)

  const chomeRuts = new Set(chomeRutRows.filter((row) => isChomeEmployer(row.employerName)).map((row) => row.rut))
  const currentAbsences = absenceRows.filter((row) => chomeRuts.has(row.rut)).length

  const blockedRun = lastFinished && lastFinished.status === "blocked" && lastFinished.fusibleAcceptedAt === null
    ? lastFinished
    : null

  return {
    config: {
      mode: config.mode,
      hasCredentials: config.hasCredentials,
      sources: config.sources,
      tokenUnreadable: config.tokenUnreadable,
    },
    lastRun: lastRun ?? null,
    blockedRun,
    lastGoodSyncAt,
    activeContracts,
    currentAbsences,
  }
}

export async function listTalanaRuns(limit = 30): Promise<TalanaRunRow[]> {
  return db.query.talanaSyncRuns.findMany({
    orderBy: [desc(talanaSyncRuns.startedAt)],
    limit,
  })
}

const KIND_ORDER: Record<TalanaItemKind, number> = {
  alta: 0, reactivacion: 1, baja: 2, traslado: 3, cargo: 4, jefe: 5, sexo: 6,
}

/** Lo que una corrida planeó o hizo, persona por persona, con el nombre para mostrar. */
export async function listTalanaRunItems(runId: string): Promise<TalanaRunItemRow[]> {
  const rows = await db
    .select({
      id: talanaSyncRunItems.id,
      runId: talanaSyncRunItems.runId,
      workerId: talanaSyncRunItems.workerId,
      rut: talanaSyncRunItems.rut,
      kind: talanaSyncRunItems.kind,
      outcome: talanaSyncRunItems.outcome,
      reasonCode: talanaSyncRunItems.reasonCode,
      beforeLabel: talanaSyncRunItems.beforeLabel,
      afterLabel: talanaSyncRunItems.afterLabel,
      workerFirstName: workers.firstName,
      workerLastName: workers.lastName,
      worksiteId: workers.worksiteId,
      worksiteName: worksites.name,
      contractFirstName: talanaContracts.firstName,
      contractLastNamePaternal: talanaContracts.lastNamePaternal,
      contractLastNameMaternal: talanaContracts.lastNameMaternal,
    })
    .from(talanaSyncRunItems)
    .leftJoin(workers, eq(workers.id, talanaSyncRunItems.workerId))
    .leftJoin(worksites, eq(worksites.id, workers.worksiteId))
    .leftJoin(talanaContracts, eq(talanaContracts.talanaContractId, talanaSyncRunItems.talanaContractId))
    .where(eq(talanaSyncRunItems.runId, runId))
    .orderBy(talanaSyncRunItems.createdAt, talanaSyncRunItems.id)

  const items = rows.map<TalanaRunItemRow>((row) => ({
    id: row.id,
    runId: row.runId,
    workerId: row.workerId,
    worksiteId: row.worksiteId ?? null,
    worksiteName: row.worksiteName ?? null,
    displayName: row.workerFirstName !== null && row.workerLastName !== null
      ? `${row.workerFirstName.trim()} ${row.workerLastName.trim()}`
      : talanaPersonName({
        firstName: row.contractFirstName,
        lastNamePaternal: row.contractLastNamePaternal,
        lastNameMaternal: row.contractLastNameMaternal,
      }),
    rut: row.rut,
    kind: row.kind as TalanaItemKind,
    outcome: row.outcome as TalanaItemOutcome,
    reasonCode: row.reasonCode,
    beforeLabel: row.beforeLabel,
    afterLabel: row.afterLabel,
  }))

  return items.sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.displayName.localeCompare(b.displayName, "es-CL", { sensitivity: "base" }))
}

/* ── Diferencias Talana ↔ Chome ───────────────────────────────────────────── */

export async function loadTalanaDifferences(): Promise<TalanaDifferencesResult> {
  const [contractRows, workerRows, positionRows, aliasRows, worksiteRows, syncedAt] = await Promise.all([
    db.select().from(talanaContracts),
    db
      .select({
        id: workers.id,
        rut: workers.rut,
        firstName: workers.firstName,
        lastName: workers.lastName,
        sex: workers.sex,
        positionId: workers.positionId,
        supervisor: workers.supervisor,
        worksiteId: workers.worksiteId,
        isActive: workers.isActive,
        createdAt: workers.createdAt,
      })
      .from(workers),
    db
      .select({ id: workerPositions.id, name: workerPositions.name, isSystem: workerPositions.isSystem, isActive: workerPositions.isActive })
      .from(workerPositions),
    db.select({ positionId: workerPositionAliases.positionId, alias: workerPositionAliases.alias }).from(workerPositionAliases),
    db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites),
    readLastGoodSyncAt(),
  ])

  // Sin ninguna copia de Talana todavía, «no figura en Talana» se diría de cada
  // trabajador activo: no es una diferencia, es que nunca se descargó nada.
  if (contractRows.length === 0) return { differences: [], syncedAt }

  const contracts: PlannerContract[] = contractRows.map((row) => ({
    id: row.talanaContractId,
    rut: row.rut,
    rutValid: row.rutValid,
    firstName: row.firstName,
    lastNamePaternal: row.lastNamePaternal,
    lastNameMaternal: row.lastNameMaternal,
    sex: row.sex === "M" || row.sex === "F" || row.sex === "N" ? row.sex : null,
    employerName: row.employerName,
    contractType: row.contractType,
    cargo: row.cargo,
    costCenterId: row.costCenterId,
    costCenterName: row.costCenterName,
    jefeRut: row.jefeRut,
    jefeName: row.jefeName,
    hiredOn: row.hiredOn,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    finiquitado: row.finiquitado,
    listedActive: row.listedActive,
    activationProcessedAt: row.activationProcessedAt,
    finiquitoProcessedAt: row.finiquitoProcessedAt,
  }))

  const plannerWorkers: PlannerWorker[] = workerRows.map((row) => ({
    id: row.id,
    rut: canonicalRut(row.rut),
    firstName: row.firstName,
    lastName: row.lastName,
    sex: row.sex,
    positionId: row.positionId,
    supervisor: row.supervisor,
    worksiteId: row.worksiteId,
    isActive: row.isActive,
    createdOn: todayInChile(row.createdAt),
  }))

  const aliasesByPosition = new Map<string, string[]>()
  for (const alias of aliasRows) {
    aliasesByPosition.set(alias.positionId, [...(aliasesByPosition.get(alias.positionId) ?? []), alias.alias])
  }
  const positions: PlannerPosition[] = positionRows.map((row) => ({
    id: row.id,
    name: row.name,
    isSystem: row.isSystem,
    isActive: row.isActive,
    keys: [row.name, ...(aliasesByPosition.get(row.id) ?? [])].map(normalizeWorkerPositionKey),
  }))

  const plannerWorksites: PlannerWorksite[] = worksiteRows

  const differences = computeDifferences({
    today: todayInChile(),
    contracts,
    workers: plannerWorkers,
    positions,
    worksites: plannerWorksites,
  })
  return { differences, syncedAt }
}

/* ── Resumen laboral por trabajador ───────────────────────────────────────── */

/**
 * Lo que Talana dice de cada trabajador, para la lista y la ficha de
 * Trabajadores. Se cruza por RUT canónico y sólo cuentan los contratos de las
 * razones sociales de Chome. Quien no tiene nada que mostrar no aparece.
 */
export async function getTalanaWorkerSummaries(
  workerList: { id: string; rut: string | null }[],
): Promise<Record<string, TalanaWorkerSummary>> {
  const rutByWorker = new Map<string, string>()
  for (const worker of workerList) {
    const rut = canonicalRut(worker.rut)
    if (rut) rutByWorker.set(worker.id, rut)
  }
  if (rutByWorker.size === 0) return {}

  const ruts = [...new Set(rutByWorker.values())]
  const [contractRows, absenceRows, syncedAt] = await Promise.all([
    inChunks(ruts, (chunk) => db.select().from(talanaContracts).where(inArray(talanaContracts.rut, chunk))),
    inChunks(ruts, (chunk) => db.select().from(talanaAbsences).where(inArray(talanaAbsences.rut, chunk))),
    readLastGoodSyncAt(),
  ])

  const contractsByRut = new Map<string, typeof contractRows>()
  for (const row of contractRows) {
    if (!isChomeEmployer(row.employerName)) continue
    contractsByRut.set(row.rut, [...(contractsByRut.get(row.rut) ?? []), row])
  }
  const absencesByRut = new Map<string, typeof absenceRows>()
  for (const row of absenceRows) {
    absencesByRut.set(row.rut, [...(absencesByRut.get(row.rut) ?? []), row])
  }

  const today = todayInChile()
  const summaries: Record<string, TalanaWorkerSummary> = {}
  for (const [workerId, rut] of rutByWorker) {
    const contracts = contractsByRut.get(rut) ?? []
    const absences = absencesByRut.get(rut) ?? []
    if (contracts.length === 0 && absences.length === 0) continue
    const summary = summarizeTalanaPerson({
      contracts: contracts.map((row) => ({
        id: row.talanaContractId,
        contractType: row.contractType,
        hiredOn: row.hiredOn,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        finiquitado: row.finiquitado,
        listedActive: row.listedActive,
        costCenterName: row.costCenterName,
        cargo: row.cargo,
        jefeName: row.jefeName,
      })),
      absences: absences.map((row) => ({
        type: row.absenceType,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        approved: row.approved,
      })),
      today,
      syncedAt,
    })
    if (!summary.contract && !summary.absence) continue
    summaries[workerId] = summary
  }
  return summaries
}

/* ── Fusible ──────────────────────────────────────────────────────────────── */

/**
 * Deja constancia de que una persona revisó el bloqueo del fusible: la próxima
 * corrida podrá aplicar. Sólo vale para la última corrida terminada, que debe
 * seguir bloqueada y sin aceptar; sobre una corrida vieja (ya hubo otra después)
 * no hay nada que rearmar. Devuelve `false` si no se pudo.
 */
export async function acceptTalanaFusible(
  runId: string,
  actor: { userId: string; email?: string | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ id: talanaSyncRuns.id })
      .from(talanaSyncRuns)
      .where(and(isNotNull(talanaSyncRuns.finishedAt), ne(talanaSyncRuns.status, "running")))
      .orderBy(desc(talanaSyncRuns.startedAt))
      .limit(1)
    if (latest?.id !== runId) return false

    const acceptedAt = new Date().toISOString()
    const [updated] = await tx
      .update(talanaSyncRuns)
      .set({ fusibleAcceptedAt: acceptedAt, fusibleAcceptedBy: actor.userId })
      .where(and(
        eq(talanaSyncRuns.id, runId),
        eq(talanaSyncRuns.status, "blocked"),
        isNull(talanaSyncRuns.fusibleAcceptedAt),
      ))
      .returning({ id: talanaSyncRuns.id, fusibleReason: talanaSyncRuns.fusibleReason })
    if (!updated) return false

    await recordAudit({
      userId: actor.userId,
      userEmail: actor.email ?? undefined,
      action: "update",
      entityType: "talana_sync_run",
      entityId: runId,
      oldState: { fusibleAcceptedAt: null },
      newState: { fusibleAcceptedAt: acceptedAt, fusibleReason: updated.fusibleReason },
      reason: "Fusible rearmado",
    }, tx)
    return true
  })
}

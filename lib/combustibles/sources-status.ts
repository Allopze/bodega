import "server-only"
import type { Session } from "next-auth"
import { NOT_IN_FLEET } from "@/lib/combustibles/plate-resolver"
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, max, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelControlImportBatches,
  fuelImportBatches,
  fuelLoads,
  fuelOperationBatches,
  fuelOperationRecords,
  fuelProviderSyncRuns,
  fuelProviderTransactions,
  fuelSupplyInputs,
  fuelTaeLoadingPoints,
  fuelTaeSubmissions,
  fuelTelemetryDaily,
  fuelVehicles,
} from "@/db/schema"
import { isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import { isCopecMonthClosed } from "@/lib/combustibles/copec-coverage"
import { listCopecPeriodCoverage } from "@/lib/combustibles/copec-coverage-store"
import { toChileInstantRange } from "@/lib/combustibles/period/adapters"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { listTaeImportBatches } from "@/lib/combustibles/tae-import-ledger"
import { loadVisionLinkConfig } from "@/lib/integrations/visionlink/visionlink-settings"
import { describeProviderPendingItems, listProviderPendingItems } from "@/lib/combustibles/provider-pending-items"
import { logger } from "@/lib/logger"
import { getCronJobHealth, type CronJobHealth } from "@/lib/services/cron-lock"
import { userFacingErrorText } from "@/lib/user-facing-error"
import { addDaysToPlainDate, formatDate, formatQty, todayInChile } from "@/lib/utils"

/**
 * Estado de cada fuente de datos de Combustible, en palabras (pantalla
 * «Fuentes de datos» y paso 1 del Panel).
 *
 * Una fuente aparece sólo para quien puede verla o usarla: las sincronizaciones
 * y la planilla de cargas son globales (un rol acotado no las ve), y los lotes
 * de tarjeta, telemetría, surtidor y sellos se acotan a las faenas del usuario.
 */
export type FuelSourceKey = "copec" | "planilla" | "telemetria" | "surtidor" | "terreno" | "historico-sellos" | "facturas"

/** Un dato de la fila de una fuente («Última actualización: ayer»), con un enlace opcional a donde se cambia. */
export interface FuelSourceFact {
  label: string
  value: string
  /** A dónde lleva «cambiarlo»; sólo se pone para quien tiene permiso de hacerlo. */
  href?: string
  hrefLabel?: string
}

export interface FuelSourceStatus {
  key: FuelSourceKey
  name: string
  description: string
  /** `pendiente`: falta algo que una persona puede resolver; `falla`: la última corrida falló. */
  status: "ok" | "pendiente" | "falla" | "sin_datos"
  /** «Al día», «Hasta ayer», «Importada el 28 oct», «Falló hoy a las 05:30». */
  statusLabel: string
  lastUpdateAt: string | null
  facts: FuelSourceFact[]
  /** Pantallas que usan esta fuente. */
  feeds: string[]
  /** Lo que falta resolver, en una frase, o `null`. */
  problem: string | null
  /** Dónde se arregla `problem`, cuando hay un lugar concreto y la persona puede entrar. */
  problemLink?: { href: string; label: string }
  /** Detalle técnico plegado (cobertura por mes, calidad de la corrida…). */
  technical: string[]
  /**
   * Hasta qué día civil (`YYYY-MM-DD`) llegan los datos para el período, o
   * `null` si no se sabe. Nunca pasa del fin del período ni de hoy.
   */
  completeUntil?: string | null
  /**
   * Si trajo datos del período: `true`/`false` cuando la fuente lo sabe de
   * primera mano (cargas o facturas contadas en el período), `null` cuando no
   * es periódica (el histórico de sellos). Sin valor, se deduce de `completeUntil`.
   */
  dataInPeriod?: boolean | null
  /** Fuente activa que no trajo nada del período en curso: el Panel la nombra. */
  missingInPeriod?: boolean
}

const JOB = { copec: "fuel-copec-sync", visionlink: "fuel-visionlink-sync" } as const

/** Una corrida «en curso» por más de esto se da por colgada. */
const STUCK_RUN_MS = 3 * 60 * 60 * 1000

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const

/** «28 oct» a partir de un día civil. */
function shortDay(plainDate: string): string {
  const month = Number(plainDate.slice(5, 7))
  return `${Number(plainDate.slice(8, 10))} ${MONTHS_SHORT[month - 1] ?? ""}`.trim()
}

function monthName(monthKey: string): string {
  return MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1] ?? monthKey
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function minDay(left: string, right: string): string {
  return left <= right ? left : right
}

const TIME_FORMAT = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Santiago" })

/** «hoy», «ayer» o «el 28 oct» para un instante, en día civil de Chile. */
function onDayLabel(iso: string, today: string): string {
  const day = todayInChile(iso)
  const diff = daysBetween(day, today)
  return diff === 0 ? "hoy" : diff === 1 ? "ayer" : `el ${shortDay(day)}`
}

/** «hoy a las 05:31», «ayer a las 05:31», «el 28 oct a las 05:31». */
function whenLabel(iso: string, today: string): string {
  const parsed = new Date(iso)
  const day = onDayLabel(iso, today)
  return Number.isNaN(parsed.getTime()) ? day : `${day} a las ${TIME_FORMAT.format(parsed)}`
}

function plural(total: number, one: string, many: string): string {
  return `${formatQty(total)} ${total === 1 ? one : many}`
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}

function addMonthKey(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`
}

function lastDayOfMonthKey(monthKey: string): string {
  return addDaysToPlainDate(`${addMonthKey(monthKey)}-01`, -1)
}

interface Ctx {
  session: Session
  period: ResolvedFuelPeriod
  today: string
  global: boolean
  has: (permission: string) => boolean
  cron: Map<string, CronJobHealth>
}

function emptyStatus(key: FuelSourceKey, name: string, description: string, feeds: string[]): FuelSourceStatus {
  return { key, name, description, status: "sin_datos", statusLabel: "Sin datos", lastUpdateAt: null, facts: [], feeds, problem: null, technical: [], completeUntil: null }
}

/** Un día civil: nunca más allá del fin del período ni de hoy. */
function clipToPeriod(day: string, ctx: Ctx): string {
  return minDay(minDay(day, ctx.period.to), ctx.today)
}

/* ── Copec ─────────────────────────────────────────────────────── */

async function providerSource(ctx: Ctx): Promise<FuelSourceStatus | null> {
  const { session, period, today, has } = ctx
  const canSync = has("combustibles:sync_integrations")
  // Quien sólo importa ve el estado de los reportes de sus faenas, no el de la integración.
  if (!canSync && !has("combustibles:import")) return null

  const provider = "copec"
  const base = emptyStatus("copec", "Copec", "Tarjetas de equipos y abastecimiento de estanques", ["Cargas › Tarjetas", "Cuadratura", "Equipos"])
  const sourceFilter = like(fuelImportBatches.fuente, "Copec%")
  const scope = worksiteScopeSql(session, fuelImportBatches.worksiteId)
  // La integración se administra con `sync_integrations`; quien no lo tiene ve sólo los reportes de sus faenas.
  const syncMode = canSync
  const [lastBatch, runs] = await Promise.all([
    db.select({ createdAt: fuelImportBatches.createdAt, periodoHasta: fuelImportBatches.periodoHasta })
      .from(fuelImportBatches)
      .where(and(sourceFilter, eq(fuelImportBatches.estado, "importado"), scope))
      .orderBy(desc(fuelImportBatches.createdAt))
      .limit(1),
    syncMode
      ? db.select().from(fuelProviderSyncRuns).where(eq(fuelProviderSyncRuns.provider, provider)).orderBy(desc(fuelProviderSyncRuns.startedAt)).limit(25)
      : Promise.resolve<Array<typeof fuelProviderSyncRuns.$inferSelect>>([]),
  ])
  const batch = lastBatch[0] ?? null

  // Sin acceso a la integración sólo se informa el último lote que ve esta persona.
  if (!syncMode) {
    if (!batch) return { ...base, statusLabel: "Sin reportes" }
    return {
      ...base,
      status: "ok",
      statusLabel: `Importado ${onDayLabel(batch.createdAt, today)}`,
      lastUpdateAt: batch.createdAt,
      facts: [{ label: "Último reporte", value: `hasta el ${formatDate(batch.periodoHasta)}` }],
      completeUntil: clipToPeriod(batch.periodoHasta, ctx),
    }
  }

  const latest = runs[0] ?? null
  const lastGood = runs.find((run) => run.status === "success" || run.status === "partial") ?? null
  const cron = ctx.cron.get(JOB[provider]) ?? null
  const lastGoodAt = lastGood ? (lastGood.finishedAt ?? lastGood.startedAt) : null
  const lastGoodDay = lastGoodAt ? todayInChile(lastGoodAt) : null

  const technical: string[] = []
  const facts: FuelSourceFact[] = []
  let problem: string | null = null
  let problemLink: FuelSourceStatus["problemLink"]
  const storedError = (error: string) => userFacingErrorText(error)
  let status: FuelSourceStatus["status"] = "ok"
  let statusLabel = "Al día"

  if (latest) {
    technical.push(
      `Calidad de la última corrida: ${formatQty(latest.rowsReceived)} recibidas, ${formatQty(latest.rowsAccepted)} aceptadas, ${formatQty(latest.rowsRejected)} rechazadas, ${formatQty(latest.rowsPending)} pendientes.`,
      `Última corrida ${whenLabel(latest.finishedAt ?? latest.startedAt, today)}, ${latest.trigger === "cron" ? "automática" : "a pedido de una persona"}.`,
    )
  }

  // Una corrida que el cron intentó pero que no llegó a registrar (sin credenciales, portal caído).
  const cronFailedAfterLatest = cron?.lastOutcome === "failed" && !!cron.lastStartedAt && (!latest || cron.lastStartedAt > latest.startedAt)
  let running = false

  if (!latest && !cron?.lastStartedAt) {
    status = "sin_datos"
    statusLabel = "Sin sincronizar"
  } else if (cronFailedAfterLatest && cron?.lastStartedAt) {
    status = "falla"
    statusLabel = `Falló ${whenLabel(cron.lastStartedAt, today)}`
    // Con cuándo falló adelante: un error de hace meses se leía como un problema de hoy.
    problem = `${statusLabel}: ${(cron.lastDetail ? storedError(cron.lastDetail) : null) ?? "la sincronización automática no terminó. Revisa el detalle técnico o vuelve a intentarlo."}`
  } else if (latest?.status === "failed") {
    status = "falla"
    statusLabel = `Falló ${whenLabel(latest.finishedAt ?? latest.startedAt, today)}`
    problem = `${statusLabel}: ${(latest.error ? storedError(latest.error) : null) ?? "la sincronización no terminó. Revisa el detalle técnico o vuelve a intentarlo."}`
    if (lastGoodAt) problem += ` Los datos llegan hasta ${onDayLabel(lastGoodAt, today)}.`
  } else if (latest?.status === "running") {
    running = true
    const stuck = Date.now() - Date.parse(latest.startedAt) > STUCK_RUN_MS
    status = stuck ? "falla" : "ok"
    statusLabel = stuck ? "La última corrida no terminó" : "Sincronizando ahora"
    if (stuck) problem = "La última corrida quedó abierta sin terminar. Espera unos minutos o vuelve a sincronizar."
  }

  // Frescura: sólo cuando la corrida más reciente no falló ni sigue en curso.
  let completeUntil: string | null = lastGoodDay ? clipToPeriod(lastGoodDay, ctx) : null
  if (status === "ok" && !running && lastGoodDay && lastGoodAt) {
    if (period.status === "cerrado") {
      // En un período cerrado importa si lo que llegó cubre hasta su último día.
      if (lastGoodDay <= period.to) {
        status = "pendiente"
        statusLabel = `Hasta el ${shortDay(lastGoodDay)}`
        problem = `La última sincronización fue ${onDayLabel(lastGoodAt, today)}, antes de que cerrara ${period.inLabel.replace(/^en /, "")}.`
      } else statusLabel = "Completa"
    } else {
      const age = daysBetween(lastGoodDay, today)
      if (age >= 2) {
        status = "pendiente"
        statusLabel = `Sin actualizar desde el ${shortDay(lastGoodDay)}`
        problem = `Hace ${age} días que no llegan datos de ${base.name}.`
      } else statusLabel = age === 1 ? "Hasta ayer" : "Al día"
    }
  }

  if (lastGoodAt) facts.push({ label: "Última actualización", value: whenLabel(lastGoodAt, today) })

  // Cobertura por mes (Copec): un mes cerrado del período sin cobertura terminal está incompleto.
  {
    const coverage = await listCopecPeriodCoverage(period.from, period.to)
    const missing: string[] = []
    for (const month of period.monthKeys) {
      if (lastDayOfMonthKey(month) >= today) continue
      const rows = coverage.filter((row) => row.periodMonth === `${month}-01`)
      if (!isCopecMonthClosed(rows)) missing.push(month)
    }
    if (missing.length > 0) {
      const names = listJoin(missing.map(monthName))
      technical.push(`Cobertura: ${missing.length === 1 ? "falta cerrar" : "faltan por cerrar"} ${names}.`)
      if (status === "ok") {
        status = "pendiente"
        statusLabel = `Falta cerrar ${names}`
      }
      problem ??= `${missing.length === 1 ? "El mes de" : "Los meses de"} ${names} no ${missing.length === 1 ? "está completo" : "están completos"} en Copec.`
      const before = addDaysToPlainDate(`${missing[0]}-01`, -1)
      completeUntil = before < period.from ? null : minDay(before, completeUntil ?? before)
    } else {
      technical.push("Cobertura: todos los meses cerrados del período están completos; el mes en curso se recalcula en cada corrida.")
    }
  }

  // Lo que no se contó por no ser de la flota no es un problema, pero tampoco
  // desaparece en silencio: queda dicho en el detalle técnico, con las patentes.
  if (latest) {
    const excluded = await db
      .select({ plate: fuelProviderTransactions.sourcePlate, loads: count() })
      .from(fuelProviderTransactions)
      // Sólo las fuera de flota: un agregado repartido por día también queda
      // `excluded` (sus litros los cuentan las transacciones) y no es «ajeno».
      .where(and(eq(fuelProviderTransactions.syncRunId, latest.id), eq(fuelProviderTransactions.status, "excluded"), eq(fuelProviderTransactions.resolutionCode, NOT_IN_FLEET.code)))
      .groupBy(fuelProviderTransactions.sourcePlate)
    const loads = excluded.reduce((total, row) => total + row.loads, 0)
    if (loads > 0) {
      const plates = excluded.map((row) => row.plate).filter((plate): plate is string => Boolean(plate)).sort()
      const shown = plates.length > 5 ? `${plates.slice(0, 5).join(", ")} y ${plates.length - 5} más` : listJoin(plates)
      technical.push(`No se contaron ${plural(loads, "carga", "cargas")} de patentes que no están en la flota (${shown}). Si alguna es propia, agrégala a la flota y vuelve a sincronizar ese mes.`)
    }
  }

  const pendingRows = latest && latest.status !== "failed" ? latest.rowsPending : 0
  if (pendingRows > 0) {
    const where = latest ? ` en ${monthName(latest.requestedFrom.slice(0, 7))}` : ""
    // Nombra qué tarjetas y patentes son: con sólo la cantidad había que ir a la
    // base para saber qué arreglar, y una tarjeta se arregla en otro lado que una patente.
    const items = latest ? await listProviderPendingItems(latest.id) : []
    if (items.some((item) => item.kind === "tae_card") && ctx.has("admin:fleet_catalog")) {
      problemLink = { href: "/admin/flota-catalogos/estanques-combustible", label: "Ir a Estanques de combustible" }
    }
    const sentence = items.length
      ? `${plural(pendingRows, "carga quedó pendiente", "cargas quedaron pendientes")}${where}: ${describeProviderPendingItems(items)}. No se importan hasta resolverlo.`
      : `${plural(pendingRows, "carga tiene", "cargas tienen")} una patente que no está en la flota o sin asignación${where}; no se importan hasta vincularla.`
    problem = problem ? `${problem} ${sentence}` : sentence
    if (status === "ok") {
      status = "pendiente"
      statusLabel = `${statusLabel} · ${formatQty(pendingRows)} por vincular`
    }
  }

  if (batch) facts.push({ label: "Último lote", value: `hasta el ${formatDate(batch.periodoHasta)}` })

  return { ...base, status, statusLabel, lastUpdateAt: lastGoodAt, facts, problem, ...(problemLink ? { problemLink } : {}), technical, completeUntil }
}

/* ── Planilla de cargas ─────────────────────────────────────────────────── */

async function planillaSource(ctx: Ctx): Promise<FuelSourceStatus | null> {
  // La planilla abarca varias faenas por archivo: sólo un rol global la importa y la ve.
  if (!ctx.global || !ctx.has("combustibles:import")) return null
  const base = emptyStatus("planilla", "Planilla de cargas", "Una fila por carga (CONSOLIDADO COMBUSTIBLES)", ["Cargas", "Equipos", "Por revisar"])
  const live = eq(fuelOperationBatches.estado, "importado")
  const [[latest], [agg]] = await Promise.all([
    db.select({
      id: fuelOperationBatches.id,
      fileName: fuelOperationBatches.archivoNombre,
      rows: fuelOperationBatches.filasValidas,
      rejected: fuelOperationBatches.filasInvalidas,
      createdAt: fuelOperationBatches.createdAt,
    }).from(fuelOperationBatches).where(live).orderBy(desc(fuelOperationBatches.createdAt)).limit(1),
    db.select({ until: max(fuelOperationBatches.periodoHasta) }).from(fuelOperationBatches).where(live),
  ])
  if (!latest) return { ...base, statusLabel: "Sin archivos" }

  const [[unlinked], [unmatched]] = await Promise.all([
    db.select({ plates: sql<number>`count(DISTINCT ${fuelOperationRecords.plate})::int` })
      .from(fuelOperationRecords)
      .where(and(eq(fuelOperationRecords.batchId, latest.id), isNull(fuelOperationRecords.vehicleId))),
    db.select({ names: sql<number>`count(DISTINCT ${fuelOperationRecords.faenaNombre})::int` })
      .from(fuelOperationRecords)
      .where(and(eq(fuelOperationRecords.batchId, latest.id), isNull(fuelOperationRecords.worksiteId), isNotNull(fuelOperationRecords.faenaNombre))),
  ])

  const problems: string[] = []
  const plates = unlinked?.plates ?? 0
  const faenas = unmatched?.names ?? 0
  if (plates > 0) problems.push(plural(plates, "patente sin vincular a un equipo", "patentes sin vincular a un equipo"))
  if (faenas > 0) problems.push(plural(faenas, "faena sin asociar", "faenas sin asociar"))
  const problem = problems.length ? `El último archivo tiene ${listJoin(problems)}.` : null
  const until = agg?.until ?? null

  return {
    ...base,
    status: problem ? "pendiente" : "ok",
    statusLabel: `Importada ${onDayLabel(latest.createdAt, ctx.today)}`,
    lastUpdateAt: latest.createdAt,
    facts: [
      { label: "Último archivo", value: `${latest.fileName} · ${plural(latest.rows, "fila", "filas")}` },
      { label: "Rechazadas", value: latest.rejected > 0 ? `${formatQty(latest.rejected)}, descargables en Excel` : "Ninguna" },
      ...(until ? [{ label: "Cubre hasta", value: formatDate(until) }] : []),
    ],
    problem,
    technical: [
      "Se rechazan las filas sin fecha o con fecha de relleno (30-12-1899), con 0 litros o con sellos de relleno.",
      "Las filas que ya estaban importadas se omiten solas.",
    ],
    completeUntil: until ? clipToPeriod(until, ctx) : null,
  }
}

/* ── Telemetría y surtidor ──────────────────────────────────────────────── */

async function lastControlBatch(ctx: Ctx, kind: "telemetry" | "supply_inputs") {
  const own = ctx.global ? undefined : eq(fuelControlImportBatches.importedBy, ctx.session.user.id)
  const [row] = await db.select({
    fileName: fuelControlImportBatches.fileName,
    rows: sql<number>`(${fuelControlImportBatches.insertedRows} + ${fuelControlImportBatches.updatedRows})::int`,
    createdAt: fuelControlImportBatches.createdAt,
  })
    .from(fuelControlImportBatches)
    .where(and(eq(fuelControlImportBatches.kind, kind), eq(fuelControlImportBatches.status, "imported"), own))
    .orderBy(desc(fuelControlImportBatches.createdAt))
    .limit(1)
  return row ?? null
}

async function telemetriaSource(ctx: Ctx): Promise<FuelSourceStatus | null> {
  if (!ctx.has("combustibles:import")) return null
  const base = emptyStatus("telemetria", "Telemetría de equipos", "Horas de motor, horas en vacío y litros por día (VisionLink)", ["Consumo › Motor en vacío"])
  const [batch, [agg]] = await Promise.all([
    lastControlBatch(ctx, "telemetry"),
    db.select({ lastDay: max(fuelTelemetryDaily.day) })
      .from(fuelTelemetryDaily)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelTelemetryDaily.vehicleId))
      .where(worksiteScopeSql(ctx.session, fuelVehicles.worksiteId)),
  ])
  const lastDay = agg?.lastDay ?? null
  if (!lastDay && !batch) return { ...base, statusLabel: "Sin datos" }

  const vision = await loadVisionLinkConfig()
  const cron = ctx.cron.get(JOB.visionlink) ?? null
  // Con la sincronización diaria de VisionLink activa, quedarse atrás sí es un problema.
  const continuous = vision.hasCredentials && vision.syncEnabled && ctx.global
  const expected = minDay(ctx.period.to, addDaysToPlainDate(ctx.today, -1))

  let status: FuelSourceStatus["status"] = "ok"
  let statusLabel = batch ? `Importada ${onDayLabel(batch.createdAt, ctx.today)}` : "Con datos"
  let problem: string | null = null

  if (continuous) {
    if (cron?.lastOutcome === "failed" && cron.lastStartedAt) {
      status = "falla"
      statusLabel = `Falló ${whenLabel(cron.lastStartedAt, ctx.today)}`
      problem = (cron.lastDetail ? userFacingErrorText(cron.lastDetail) : null) ?? "La última sincronización de VisionLink falló."
    } else if (lastDay && ctx.period.status !== "futuro" && lastDay < expected) {
      status = "pendiente"
      statusLabel = `Hasta el ${shortDay(lastDay)}`
      problem = `Faltan los datos del ${shortDay(addDaysToPlainDate(lastDay, 1))} al ${shortDay(expected)}.`
    } else statusLabel = lastDay && daysBetween(lastDay, ctx.today) <= 1 ? "Hasta ayer" : statusLabel
  } else if (lastDay) {
    statusLabel = `Hasta el ${shortDay(lastDay)}`
  }

  return {
    ...base,
    status,
    statusLabel,
    lastUpdateAt: batch?.createdAt ?? null,
    facts: [
      ...(batch ? [{ label: "Último archivo", value: `${batch.fileName} · ${plural(Number(batch.rows), "fila", "filas")}` }] : []),
      ...(lastDay ? [{ label: "Último día con datos", value: formatDate(lastDay) }] : []),
      ...(continuous ? [{ label: "Sincronización diaria", value: "Activada (VisionLink)" }] : []),
    ],
    problem,
    technical: ["Cada fila es un equipo en un día; reimportar días ya cargados de la misma fuente los actualiza, no los duplica."],
    completeUntil: lastDay ? clipToPeriod(lastDay, ctx) : null,
  }
}

async function surtidorSource(ctx: Ctx): Promise<FuelSourceStatus | null> {
  if (!ctx.has("combustibles:import")) return null
  const base = emptyStatus("surtidor", "Surtidores sin integración", "Despachos de surtidores del mandante y otras tarjetas (CMPC)", ["Cuadratura › Por mandante"])
  const [batch, [agg]] = await Promise.all([
    lastControlBatch(ctx, "supply_inputs"),
    db.select({ last: max(fuelSupplyInputs.occurredAt) }).from(fuelSupplyInputs).where(worksiteScopeSql(ctx.session, fuelSupplyInputs.worksiteId)),
  ])
  if (!batch && !agg?.last) return { ...base, statusLabel: "Sin despachos" }
  const lastDay = agg?.last ? todayInChile(agg.last) : null
  return {
    ...base,
    status: "ok",
    statusLabel: batch ? `Importado ${onDayLabel(batch.createdAt, ctx.today)}` : "Con despachos",
    lastUpdateAt: batch?.createdAt ?? null,
    facts: [
      ...(batch ? [{ label: "Último archivo", value: `${batch.fileName} · ${plural(Number(batch.rows), "fila", "filas")}` }] : []),
      ...(lastDay ? [{ label: "Último despacho", value: formatDate(lastDay) }] : []),
    ],
    technical: ["La guía o folio de cada despacho evita duplicarlo al reimportar el mismo archivo."],
    completeUntil: lastDay ? clipToPeriod(lastDay, ctx) : null,
  }
}

/* ── Formulario en terreno ──────────────────────────────────────────────── */

async function terrenoSource(ctx: Ctx): Promise<FuelSourceStatus | null> {
  if (!ctx.has("combustibles:tae_view")) return null
  const base = emptyStatus("terreno", "Formulario en terreno", "Cargas registradas por QR o desde la app", ["Cargas", "Cuadratura", "Equipos"])
  const live = and(
    inArray(fuelTaeSubmissions.source, ["public_pwa", "internal_app"]),
    ne(fuelTaeSubmissions.status, "voided"),
    worksiteScopeSql(ctx.session, fuelTaeSubmissions.worksiteId),
  )
  const range = toChileInstantRange(ctx.period)
  const inRange = and(live, gte(fuelTaeSubmissions.loadedAt, range.start), lt(fuelTaeSubmissions.loadedAt, range.endExclusive))
  const [[last], [inPeriod], [toValidate], [points]] = await Promise.all([
    db.select({ at: max(fuelTaeSubmissions.submittedAt) }).from(fuelTaeSubmissions).where(live),
    db.select({ total: count() }).from(fuelTaeSubmissions).where(inRange),
    db.select({ total: count() }).from(fuelTaeSubmissions).where(and(inRange, eq(fuelTaeSubmissions.status, "submitted"))),
    db.select({ total: count(), worksites: sql<number>`count(DISTINCT ${fuelTaeLoadingPoints.worksiteId})::int` })
      .from(fuelTaeLoadingPoints)
      .where(and(eq(fuelTaeLoadingPoints.isActive, true), worksiteScopeSql(ctx.session, fuelTaeLoadingPoints.worksiteId))),
  ])
  const lastAt = last?.at ?? null
  const received = inPeriod?.total ?? 0
  const activePoints = points?.total ?? 0
  const facts = [
    { label: "Puntos de carga activos", value: activePoints > 0 ? `${formatQty(activePoints)} en ${plural(points?.worksites ?? 0, "faena", "faenas")}` : "Ninguno" },
    { label: "Por validar", value: plural(toValidate?.total ?? 0, "carga", "cargas") },
    ...(lastAt ? [{ label: "Último QR recibido", value: whenLabel(lastAt, ctx.today) }] : []),
  ]
  if (!lastAt) {
    return {
      ...base,
      statusLabel: activePoints > 0 ? "Sin cargas todavía" : "Sin puntos de carga",
      facts,
      // Sin puntos de carga no hay nada roto: es una forma de registrar cargas
      // que la empresa puede no usar. Va como sugerencia, no en «Falta resolver».
      technical: activePoints > 0 ? [] : ["Para registrar cargas por QR, crea un punto de carga en Ajustes › Puntos de carga y QR."],
    }
  }
  return {
    ...base,
    status: "ok",
    statusLabel: received > 0 ? `${plural(received, "carga", "cargas")} en ${ctx.period.inLabel}` : `Sin cargas en ${ctx.period.inLabel}`,
    lastUpdateAt: lastAt,
    facts,
    completeUntil: clipToPeriod(todayInChile(lastAt), ctx),
    dataInPeriod: received > 0,
  }
}

/* ── Histórico de sellos ────────────────────────────────────────────────── */

async function historicoSellosSource(ctx: Ctx): Promise<FuelSourceStatus | null> {
  if (!ctx.has("combustibles:tae_import")) return null
  const base = emptyStatus("historico-sellos", "Histórico de sellos", "Planilla antigua del formulario de sellos", ["Cargas", "Cuadratura › Sellos"])
  const [latest] = await listTaeImportBatches(ctx.session, { limit: 1 })
  if (!latest) return { ...base, statusLabel: "Sin archivos" }
  return {
    ...base,
    status: "ok",
    statusLabel: `Importado ${onDayLabel(latest.createdAt, ctx.today)}`,
    lastUpdateAt: latest.createdAt,
    facts: [{ label: "Último archivo", value: `${latest.fileName} · ${plural(latest.validRows + latest.observedRows, "fila", "filas")}` }],
    dataInPeriod: null,
    technical: ["Antes de importar se genera un reporte de equivalencias en Excel y se decide cada identidad dudosa."],
  }
}

/* ── Facturas ───────────────────────────────────────────────────────────── */

async function facturasSource(ctx: Ctx): Promise<FuelSourceStatus | null> {
  if (!(ctx.has("combustibles:import") && ctx.has("combustibles:view") && ctx.has("combustibles:view_costs"))) return null
  const base = emptyStatus("facturas", "Facturas en Excel", "Planilla «Control de facturas de combustible»", ["Pagos › Facturas"])
  const live = and(ne(fuelLoads.status, "cancelled"), worksiteScopeSql(ctx.session, fuelLoads.worksiteId))
  const [[last], [inPeriod]] = await Promise.all([
    db.select({ at: max(fuelLoads.createdAt) }).from(fuelLoads).where(live),
    db.select({ total: count() }).from(fuelLoads).where(and(live, inArray(fuelLoads.month, ctx.period.monthKeys))),
  ])
  const lastAt = last?.at ?? null
  if (!lastAt) return { ...base, statusLabel: "Sin facturas" }
  const received = inPeriod?.total ?? 0
  return {
    ...base,
    status: "ok",
    statusLabel: received > 0 ? `${plural(received, "factura", "facturas")} en ${ctx.period.inLabel}` : `Sin facturas en ${ctx.period.inLabel}`,
    lastUpdateAt: lastAt,
    dataInPeriod: received > 0,
    facts: [{ label: "Última carga de facturas", value: onDayLabel(lastAt, ctx.today) }],
    technical: ["Este importador no deja un lote: lo importado se corrige o se anula desde Pagos › Facturas."],
  }
}

export async function getFuelSourceStatuses(
  session: Session,
  period: ResolvedFuelPeriod,
  options: { keys?: readonly FuelSourceKey[] } = {},
): Promise<FuelSourceStatus[]> {
  const permissions = new Set<string>(session.user?.permissions ?? [])
  const cron = new Map<string, CronJobHealth>()
  try {
    for (const job of await getCronJobHealth()) cron.set(job.jobName, job)
  } catch (error) {
    // Sin la bitácora de cron se sigue con lo demás: sólo se pierde el aviso de «falló».
    logger.error("[fuentes] no se pudo leer la bitácora de cron", error)
  }
  const ctx: Ctx = { session, period, today: todayInChile(), global: isGlobalRole(session), has: (permission) => permissions.has(permission), cron }

  const builders: Array<{ key: FuelSourceKey; name: string; run: () => Promise<FuelSourceStatus | null> }> = [
    { key: "copec", name: "Copec", run: () => providerSource(ctx) },
    { key: "planilla", name: "Planilla de cargas", run: () => planillaSource(ctx) },
    { key: "telemetria", name: "Telemetría de equipos", run: () => telemetriaSource(ctx) },
    { key: "surtidor", name: "Surtidores sin integración", run: () => surtidorSource(ctx) },
    { key: "terreno", name: "Formulario en terreno", run: () => terrenoSource(ctx) },
    { key: "historico-sellos", name: "Histórico de sellos", run: () => historicoSellosSource(ctx) },
    { key: "facturas", name: "Facturas en Excel", run: () => facturasSource(ctx) },
  ]
  const wanted = options.keys ? new Set(options.keys) : null
  const selected = wanted ? builders.filter((builder) => wanted.has(builder.key)) : builders
  const settled = await Promise.allSettled(selected.map((builder) => builder.run()))
  const out: FuelSourceStatus[] = []
  settled.forEach((result, index) => {
    const builder = selected[index]!
    if (result.status === "fulfilled") {
      if (result.value) out.push(result.value)
      return
    }
    // Una fuente que no se pudo consultar no se da por buena: queda pendiente y lo dice.
    logger.error(`[fuentes] no se pudo consultar ${builder.key}`, result.reason)
    out.push({
      ...emptyStatus(builder.key, builder.name, "", []),
      status: "pendiente",
      statusLabel: "No se pudo consultar",
      problem: `No se pudo consultar el estado de ${builder.name}. Vuelve a cargar la página.`,
    })
  })
  return applyPeriodCoverage(out, period)
}

/**
 * Una fuente activa (que ya trajo datos alguna vez) sin nada del período: en un
 * período cerrado queda pendiente —el mes se cerró sin esos datos—; en el
 * período en curso sólo se avisa, porque todavía pueden llegar. Una fuente que
 * nunca trajo nada (`sin_datos`) no está en uso y no cuenta.
 */
export function applyPeriodCoverage(
  statuses: readonly FuelSourceStatus[],
  period: Pick<ResolvedFuelPeriod, "from" | "status" | "inLabel">,
): FuelSourceStatus[] {
  return statuses.map((source) => {
    if (source.status !== "ok" || period.status === "futuro") return source
    const inPeriod = source.dataInPeriod !== undefined
      ? source.dataInPeriod
      : source.completeUntil != null ? source.completeUntil >= period.from : null
    if (inPeriod !== false) return source
    if (period.status === "cerrado") {
      return {
        ...source,
        status: "pendiente",
        statusLabel: `Sin datos en ${period.inLabel}`,
        problem: source.problem ?? `No trajo datos en ${period.inLabel}.`,
      }
    }
    // Terreno y facturas ya dicen «Sin cargas/facturas en …» en su rótulo.
    const statusLabel = source.dataInPeriod === false ? source.statusLabel : `Todavía sin datos en ${period.inLabel}`
    return { ...source, statusLabel, missingInPeriod: true }
  })
}

/** Resumen para el Panel: listo si ninguna fuente está pendiente ni falló. */
export function summarizeFuelSources(statuses: readonly FuelSourceStatus[]): { ready: boolean; pending: FuelSourceStatus[] } {
  const pending = statuses.filter((status) => status.status === "pendiente" || status.status === "falla")
  return { ready: statuses.length > 0 && pending.length === 0, pending }
}

/** La respuesta de una frase de «Fuentes de datos»: qué llegó y qué falta. */
export function describeFuelSources(statuses: readonly FuelSourceStatus[], period: Pick<ResolvedFuelPeriod, "inLabel">): string {
  if (statuses.length === 0) return "Todavía no hay fuentes de datos que mostrar."
  // Cada problema se lista con su fuente en la página (`page.tsx`): en un
  // solo párrafo no se veía la separación entre fuentes.
  const problems = statuses.filter((status) => status.problem).length
  if (problems > 0) return problems === 1 ? "Falta resolver en una fuente:" : `Falta resolver en ${problems} fuentes:`
  if (statuses.some((status) => status.status === "falla" || status.status === "pendiente")) return "Hay fuentes que no se actualizaron a tiempo."
  return `Todo llegó a tiempo en ${period.inLabel}.`
}

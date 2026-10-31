import "server-only"
import type { Session } from "next-auth"
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, max, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelControlImportBatches,
  fuelImportBatches,
  fuelLoads,
  fuelOperationBatches,
  fuelOperationRecords,
  fuelProviderSyncRuns,
  fuelSupplyInputs,
  fuelTaeLoadingPoints,
  fuelTaeSubmissions,
  fuelTelemetryDaily,
  fuelVehicles,
} from "@/db/schema"
import { isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import { readAramcoConfig } from "@/lib/combustibles/aramco-settings"
import { listCopecPeriodCoverage } from "@/lib/combustibles/copec-coverage-store"
import { ARAMCO_SOURCES } from "@/lib/combustibles/fuel-sources"
import { toChileInstantRange } from "@/lib/combustibles/period/adapters"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { listTaeImportBatches } from "@/lib/combustibles/tae-import-ledger"
import { readVisionLinkConfig } from "@/lib/integrations/visionlink/visionlink-settings"
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
export type FuelSourceKey = "copec" | "aramco" | "planilla" | "telemetria" | "surtidor" | "terreno" | "historico-sellos" | "facturas"

export interface FuelSourceStatus {
  key: FuelSourceKey
  name: string
  description: string
  /** `pendiente`: falta algo que una persona puede resolver; `falla`: la última corrida falló. */
  status: "ok" | "pendiente" | "falla" | "sin_datos"
  /** «Al día», «Hasta ayer», «Importada el 28 oct», «Falló hoy a las 05:30». */
  statusLabel: string
  lastUpdateAt: string | null
  facts: { label: string; value: string }[]
  /** Pantallas que usan esta fuente. */
  feeds: string[]
  /** Lo que falta resolver, en una frase, o `null`. */
  problem: string | null
  /** Detalle técnico plegado (cobertura por mes, calidad de la corrida…). */
  technical: string[]
  /**
   * Hasta qué día civil (`YYYY-MM-DD`) llegan los datos para el período, o
   * `null` si no se sabe. Nunca pasa del fin del período ni de hoy.
   */
  completeUntil?: string | null
}

const JOB = { copec: "fuel-copec-sync", aramco: "fuel-aramco-sync", visionlink: "fuel-visionlink-sync" } as const

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

/* ── Copec y Aramco ─────────────────────────────────────────────────────── */

const COPEC_COVERAGE_COMBOS = ["tct:diesel", "tct:bluemax", "tae:diesel", "tae:bluemax"] as const
const COVERAGE_TERMINAL = new Set(["complete", "legitimate_empty"])

async function providerSource(provider: "copec" | "aramco", ctx: Ctx): Promise<FuelSourceStatus | null> {
  const { session, period, today, has } = ctx
  const canSync = has("combustibles:sync_integrations")
  // Quien sólo importa ve el estado de los reportes de sus faenas, no el de la integración.
  if (!canSync && !has("combustibles:import")) return null

  const isCopec = provider === "copec"
  const base = isCopec
    ? emptyStatus("copec", "Copec", "Tarjetas de equipos y abastecimiento de estanques", ["Cargas › Tarjetas", "Cuadratura", "Equipos"])
    : emptyStatus("aramco", "Aramco", "Tarjetas Aramco Fleet", ["Cargas › Tarjetas", "Cuadratura"])

  const sourceFilter = isCopec ? like(fuelImportBatches.fuente, "Copec%") : inArray(fuelImportBatches.fuente, ARAMCO_SOURCES)
  const scope = worksiteScopeSql(session, fuelImportBatches.worksiteId)
  // La integración se administra con `sync_integrations`; quien no lo tiene ve sólo los reportes de sus faenas.
  const syncMode = canSync
  const [lastBatch, runs, config] = await Promise.all([
    db.select({ createdAt: fuelImportBatches.createdAt, periodoHasta: fuelImportBatches.periodoHasta })
      .from(fuelImportBatches)
      .where(and(sourceFilter, eq(fuelImportBatches.estado, "importado"), scope))
      .orderBy(desc(fuelImportBatches.createdAt))
      .limit(1),
    syncMode
      ? db.select().from(fuelProviderSyncRuns).where(eq(fuelProviderSyncRuns.provider, provider)).orderBy(desc(fuelProviderSyncRuns.startedAt)).limit(25)
      : Promise.resolve<Array<typeof fuelProviderSyncRuns.$inferSelect>>([]),
    syncMode && !isCopec ? readAramcoConfig() : Promise.resolve(null),
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
  const facts: { label: string; value: string }[] = []
  let problem: string | null = null
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
    if (!isCopec && config && !config.hasCredentials) problem = "Faltan las credenciales de Aramco. Se configuran en Ajustes › Integraciones."
  } else if (cronFailedAfterLatest && cron?.lastStartedAt) {
    status = "falla"
    statusLabel = `Falló ${whenLabel(cron.lastStartedAt, today)}`
    problem = (cron.lastDetail ? userFacingErrorText(cron.lastDetail) : null) ?? "La sincronización automática falló. Revisa el detalle técnico o vuelve a intentarlo."
  } else if (latest?.status === "failed") {
    status = "falla"
    statusLabel = `Falló ${whenLabel(latest.finishedAt ?? latest.startedAt, today)}`
    problem = (latest.error ? userFacingErrorText(latest.error) : null) ?? "La última sincronización falló. Revisa el detalle técnico o vuelve a intentarlo."
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
  if (isCopec) {
    const coverage = await listCopecPeriodCoverage(period.from, period.to)
    const missing: string[] = []
    for (const month of period.monthKeys) {
      if (lastDayOfMonthKey(month) >= today) continue
      const rows = coverage.filter((row) => row.periodMonth === `${month}-01`)
      const done = COPEC_COVERAGE_COMBOS.every((combo) => rows.some((row) => row.sourceAccount === combo && COVERAGE_TERMINAL.has(row.status)))
      if (!done) missing.push(month)
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

  const pendingRows = latest && latest.status !== "failed" ? latest.rowsPending : 0
  if (pendingRows > 0) {
    const where = isCopec && latest ? ` en ${monthName(latest.requestedFrom.slice(0, 7))}` : ""
    const sentence = `${plural(pendingRows, "carga tiene", "cargas tienen")} una patente que no está en la flota o sin asignación${where}; no se importan hasta vincularla.`
    problem = problem ? `${problem} ${sentence}` : sentence
    if (status === "ok") {
      status = "pendiente"
      statusLabel = `${statusLabel} · ${formatQty(pendingRows)} por vincular`
    }
  }

  if (!isCopec && config) {
    facts.push({ label: "Sincronización automática", value: config.hasCredentials ? (config.syncEnabled ? "Activada" : "Apagada") : "Sin credenciales" })
    if (!config.hasCredentials) problem ??= "Faltan las credenciales de Aramco. Se configuran en Ajustes › Integraciones."
  }
  if (batch) facts.push({ label: "Último lote", value: `hasta el ${formatDate(batch.periodoHasta)}` })

  return { ...base, status, statusLabel, lastUpdateAt: lastGoodAt, facts, problem, technical, completeUntil }
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

  const vision = readVisionLinkConfig()
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
      problem: activePoints > 0 ? null : "Aún no hay un punto de carga con su QR. Se crean en Ajustes › Puntos de carga y QR.",
    }
  }
  return {
    ...base,
    status: "ok",
    statusLabel: received > 0 ? `${plural(received, "carga", "cargas")} ${ctx.period.inLabel}` : `Sin cargas ${ctx.period.inLabel}`,
    lastUpdateAt: lastAt,
    facts,
    completeUntil: clipToPeriod(todayInChile(lastAt), ctx),
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
    statusLabel: received > 0 ? `${plural(received, "factura", "facturas")} ${ctx.period.inLabel}` : `Sin facturas ${ctx.period.inLabel}`,
    lastUpdateAt: lastAt,
    facts: [{ label: "Última carga de facturas", value: onDayLabel(lastAt, ctx.today) }],
    technical: ["Este importador no deja un lote: lo importado se corrige o se anula desde Pagos › Facturas."],
  }
}

export async function getFuelSourceStatuses(session: Session, period: ResolvedFuelPeriod): Promise<FuelSourceStatus[]> {
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
    { key: "copec", name: "Copec", run: () => providerSource("copec", ctx) },
    { key: "aramco", name: "Aramco", run: () => providerSource("aramco", ctx) },
    { key: "planilla", name: "Planilla de cargas", run: () => planillaSource(ctx) },
    { key: "telemetria", name: "Telemetría de equipos", run: () => telemetriaSource(ctx) },
    { key: "surtidor", name: "Surtidores sin integración", run: () => surtidorSource(ctx) },
    { key: "terreno", name: "Formulario en terreno", run: () => terrenoSource(ctx) },
    { key: "historico-sellos", name: "Histórico de sellos", run: () => historicoSellosSource(ctx) },
    { key: "facturas", name: "Facturas en Excel", run: () => facturasSource(ctx) },
  ]
  const settled = await Promise.allSettled(builders.map((builder) => builder.run()))
  const out: FuelSourceStatus[] = []
  settled.forEach((result, index) => {
    const builder = builders[index]!
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
  return out
}

/** Resumen para el Panel: listo si ninguna fuente está pendiente ni falló. */
export function summarizeFuelSources(statuses: readonly FuelSourceStatus[]): { ready: boolean; pending: FuelSourceStatus[] } {
  const pending = statuses.filter((status) => status.status === "pendiente" || status.status === "falla")
  return { ready: statuses.length > 0 && pending.length === 0, pending }
}

/** La respuesta de una frase de «Fuentes de datos»: qué llegó y qué falta. */
export function describeFuelSources(statuses: readonly FuelSourceStatus[], period: Pick<ResolvedFuelPeriod, "inLabel">): string {
  if (statuses.length === 0) return "Todavía no hay fuentes de datos que mostrar."
  const problems = statuses.flatMap((status) => (status.problem ? [status.problem] : []))
  if (problems.length > 0) return `Falta resolver: ${problems.join(" ")}`
  if (statuses.some((status) => status.status === "falla" || status.status === "pendiente")) return "Hay fuentes que no se actualizaron a tiempo."
  return `Todo llegó a tiempo ${period.inLabel}.`
}

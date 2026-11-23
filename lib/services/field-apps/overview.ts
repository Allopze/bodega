/**
 * lib/services/field-apps/overview.ts — Lecturas de TI sobre las apps del teléfono.
 *
 * Dos fuentes, a propósito separadas:
 * - `pwa_devices` / `pwa_device_days`: lo que cada teléfono avisa (estado, versión,
 *   pendientes). Sólo existe desde que las apps mandan el aviso.
 * - Las tablas de negocio (`mant_records`, `ppa_submissions`, `fuel_tae_submissions`,
 *   credenciales y enlaces): demora de llegada, uso, accesos y calidad de captura.
 *   Existen desde antes del aviso y no dependen de él.
 *
 * Son cifras de funcionamiento y uso: ninguna consulta devuelve el contenido de un
 * registro. Un registro anulado cuenta igual (en demora, uso y calidad): viajó desde
 * el teléfono, que es lo que se mide; no es una cifra de negocio.
 *
 * Alcance (`serviceWorksiteScope`): con un alcance acotado sólo se ven filas de las
 * faenas del rol. Los teléfonos sin faena y todo lo de Mantención por teléfono o
 * credencial (que no pertenece a una faena) lo ve sólo `"all"`; Mantención por
 * persona se acota por la faena de sus registros.
 */
import { and, eq, gte, inArray, isNull, ne, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelTaePublicLinks,
  fuelTaeSubmissions,
  mantDeviceCredentials,
  mantRecords,
  ppaSubmissions,
  pwaDevices,
  users,
  worksites,
} from "@/db/schema"
import { BUILD_ID } from "@/lib/build-info"
import {
  ACCESS_EXPIRING_DAYS,
  ACCESS_UNUSED_DAYS,
  ACTIVE_WINDOW_MS,
  FORGET_AFTER_MS,
  STOPPED_PRIOR_DAYS,
  STOPPED_RECENT_DAYS,
  deviceState,
  isVersionBehind,
  type DeviceState,
} from "@/lib/apps/device-state"
import { FIELD_APPS, type FieldAppId } from "@/lib/apps/field-apps"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { chileDayStartInstant, todayInChile } from "@/lib/utils"
import type {
  AccessLinkRow,
  AccessSummary,
  CaptureQuality,
  FieldAppSummary,
  FieldDeviceRow,
  LatencyWeek,
  UsageRow,
} from "./types"

type Scope = string[] | "all"

const DAY_MS = 86_400_000
/** Semanas que muestran la demora y el OCR. */
const TREND_WEEKS = 12
/** Ventana de «envíos en 30 días» y de identificación manual. */
const USAGE_DAYS = 30
const STATE_ORDER: Record<DeviceState, number> = { error: 0, stuck: 1, silent: 2, ok: 3 }

function iso(now: Date, offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString()
}

/** Lunes (Chile) de la semana de `now`, `YYYY-MM-DD`. */
function chileWeekStart(now: Date): string {
  const today = todayInChile(now)
  const date = new Date(`${today}T00:00:00Z`)
  const back = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - back * DAY_MS).toISOString().slice(0, 10)
}

/** Los lunes de las últimas `TREND_WEEKS` semanas, de la más vieja a la actual. */
function trendWeekStarts(now: Date): string[] {
  const current = new Date(`${chileWeekStart(now)}T00:00:00Z`).getTime()
  return Array.from({ length: TREND_WEEKS }, (_, index) =>
    new Date(current - (TREND_WEEKS - 1 - index) * 7 * DAY_MS).toISOString().slice(0, 10))
}

/** Misma expresión de semana chilena que usaba `apps-overview.ts`. */
function chileWeek(column: AnyColumn): SQL<string> {
  return sql<string>`to_char(date_trunc('week', ${column} AT TIME ZONE 'America/Santiago'), 'YYYY-MM-DD')`
}

function round(value: number | null, digits = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Filtro de teléfonos de una app. Los de Mantención no tienen faena (el mecánico
 * trabaja en varias), y un teléfono sin faena no es de ninguna faena en el alcance:
 * sólo `"all"` los ve.
 */
function deviceScope(app: FieldAppId, scope: Scope): SQL | undefined {
  if (scope === "all") return undefined
  if (app === "mantencion") return sql`false`
  return worksiteScopeSqlFor(scope, pwaDevices.worksiteId)
}

/** Dónde vive cada envío y cómo se mide su demora (spec §5.6). */
interface SubmissionSource {
  arrivedAt:  AnyColumn
  /** Cuándo se llenó o firmó en el teléfono. */
  originAt:   SQL
  /** El envío se hizo sin señal. */
  offline:    SQL
  worksiteId: AnyColumn
  /** Cláusula de la app (TAE sólo cuenta lo que llegó por la PWA pública). */
  base:       SQL | undefined
}

function submissionSource(app: FieldAppId): SubmissionSource {
  switch (app) {
    case "mantencion":
      return {
        arrivedAt: mantRecords.receivedAt,
        originAt: sql`${mantRecords.signedAt}`,
        offline: sql`${mantRecords.offlineSince} IS NOT NULL`,
        worksiteId: mantRecords.worksiteId,
        base: undefined,
      }
    case "ppa":
      // `filled_at` nulo = envío en línea: llegó cuando se llenó.
      return {
        arrivedAt: ppaSubmissions.createdAt,
        originAt: sql`COALESCE(${ppaSubmissions.filledAt}, ${ppaSubmissions.createdAt})`,
        offline: sql`${ppaSubmissions.filledAt} IS NOT NULL`,
        worksiteId: ppaSubmissions.worksiteId,
        base: undefined,
      }
    case "tae":
      return {
        arrivedAt: fuelTaeSubmissions.createdAt,
        originAt: sql`${fuelTaeSubmissions.loadedAt}`,
        offline: sql`${fuelTaeSubmissions.loadedAtSource} = 'device_offline'`,
        worksiteId: fuelTaeSubmissions.worksiteId,
        base: eq(fuelTaeSubmissions.source, "public_pwa"),
      }
  }
}

function sourceTable(app: FieldAppId) {
  return app === "mantencion" ? mantRecords : app === "ppa" ? ppaSubmissions : fuelTaeSubmissions
}

/** Filtro de alcance de los envíos de una app: Mantención por persona se acota por faena. */
function submissionScope(source: SubmissionSource, scope: Scope): SQL | undefined {
  return worksiteScopeSqlFor(scope, source.worksiteId)
}

function linkStatus(
  link: { revokedAt: string | null; expiresAt: string | null },
  now: Date,
): "active" | "revoked" | "expired" {
  if (link.revokedAt) return "revoked"
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return "expired"
  return "active"
}

/* ── Accesos ────────────────────────────────────────────────────────────── */

interface AccessCounts {
  active:              number
  expiringSoon:        number
  unused:              number
  revokedOrExpired30d: number
}

async function readCredentialCounts(now: Date): Promise<AccessCounts> {
  const nowIso = now.toISOString()
  const live = and(isNull(mantDeviceCredentials.revokedAt), gte(mantDeviceCredentials.expiresAt, nowIso))
  const since30 = iso(now, -30 * DAY_MS)
  const [row] = await db.select({
    active: sql<number>`(count(*) filter (where ${live}))::int`,
    expiringSoon: sql<number>`(count(*) filter (where ${live} and ${mantDeviceCredentials.expiresAt} <= ${iso(now, ACCESS_EXPIRING_DAYS * DAY_MS)}::timestamptz))::int`,
    unused: sql<number>`(count(*) filter (where ${live} and COALESCE(${mantDeviceCredentials.lastUsedAt}, ${mantDeviceCredentials.createdAt}) < ${iso(now, -ACCESS_UNUSED_DAYS * DAY_MS)}::timestamptz))::int`,
    closed: sql<number>`(count(*) filter (where
      (${mantDeviceCredentials.revokedAt} is not null and ${mantDeviceCredentials.revokedAt} >= ${since30}::timestamptz)
      or (${mantDeviceCredentials.revokedAt} is null and ${mantDeviceCredentials.expiresAt} < ${nowIso}::timestamptz and ${mantDeviceCredentials.expiresAt} >= ${since30}::timestamptz)
    ))::int`,
  }).from(mantDeviceCredentials)
  return {
    active: row?.active ?? 0,
    expiringSoon: row?.expiringSoon ?? 0,
    unused: row?.unused ?? 0,
    revokedOrExpired30d: row?.closed ?? 0,
  }
}

async function readLinkAccess(scope: Scope, now: Date): Promise<{ counts: AccessCounts; links: AccessLinkRow[] }> {
  const rows = await db.select({
    id: fuelTaePublicLinks.id,
    label: fuelTaePublicLinks.label,
    worksiteName: worksites.name,
    expiresAt: fuelTaePublicLinks.expiresAt,
    revokedAt: fuelTaePublicLinks.revokedAt,
    lastUsedAt: fuelTaePublicLinks.lastUsedAt,
    createdAt: fuelTaePublicLinks.createdAt,
  })
    .from(fuelTaePublicLinks)
    .innerJoin(worksites, eq(worksites.id, fuelTaePublicLinks.worksiteId))
    .where(worksiteScopeSqlFor(scope, fuelTaePublicLinks.worksiteId))

  const deviceCounts = await db.select({
    linkId: pwaDevices.taeLinkId,
    count: sql<number>`count(*)::int`,
  })
    .from(pwaDevices)
    .where(and(
      eq(pwaDevices.app, "tae"),
      gte(pwaDevices.lastSeenAt, iso(now, -ACTIVE_WINDOW_MS)),
      deviceScope("tae", scope),
    ))
    .groupBy(pwaDevices.taeLinkId)
  const devicesByLink = new Map(deviceCounts.map((row) => [row.linkId, row.count]))

  const nowMs = now.getTime()
  const expiringLimit = nowMs + ACCESS_EXPIRING_DAYS * DAY_MS
  const unusedLimit = nowMs - ACCESS_UNUSED_DAYS * DAY_MS
  const since30 = nowMs - 30 * DAY_MS
  const counts: AccessCounts = { active: 0, expiringSoon: 0, unused: 0, revokedOrExpired30d: 0 }
  const links: AccessLinkRow[] = []

  for (const row of rows) {
    const status = linkStatus(row, now)
    if (status === "active") {
      counts.active += 1
      // Sin vencimiento (`expires_at` nulo) no vence.
      if (row.expiresAt && new Date(row.expiresAt).getTime() <= expiringLimit) counts.expiringSoon += 1
      if (new Date(row.lastUsedAt ?? row.createdAt).getTime() < unusedLimit) counts.unused += 1
    } else {
      const closedAt = status === "revoked" ? row.revokedAt : row.expiresAt
      if (!closedAt || new Date(closedAt).getTime() < since30) continue
      counts.revokedOrExpired30d += 1
    }
    links.push({
      id: row.id,
      label: row.label,
      worksiteName: row.worksiteName,
      status,
      lastUsedAt: row.lastUsedAt,
      activeDevices: devicesByLink.get(row.id) ?? 0,
    })
  }

  const statusOrder = { active: 0, expired: 1, revoked: 2 } as const
  links.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
    || a.worksiteName.localeCompare(b.worksiteName, "es")
    || a.label.localeCompare(b.label, "es"))
  return { counts, links }
}

export async function getFieldAppAccess(
  app: "mantencion" | "tae",
  scope: Scope,
  now: Date = new Date(),
): Promise<AccessSummary | null> {
  if (app === "mantencion") {
    // Las credenciales del mecánico no pertenecen a una faena.
    if (scope !== "all") return null
    return { kind: "credentials", ...(await readCredentialCounts(now)), links: [] }
  }
  const { counts, links } = await readLinkAccess(scope, now)
  return { kind: "links", ...counts, links }
}

/* ── Resumen ────────────────────────────────────────────────────────────── */

async function readLastSubmissions(scope: Scope): Promise<Record<FieldAppId, string | null>> {
  const entries = await Promise.all(FIELD_APPS.map(async (app) => {
    const source = submissionSource(app.id)
    const [row] = await db.select({ last: sql<string | null>`max(${source.arrivedAt})` })
      .from(sourceTable(app.id))
      .where(and(source.base, submissionScope(source, scope)))
    return [app.id, row?.last ? new Date(row.last).toISOString() : null] as const
  }))
  return Object.fromEntries(entries) as Record<FieldAppId, string | null>
}

export async function getFieldAppSummaries(scope: Scope, now: Date = new Date()): Promise<FieldAppSummary[]> {
  const activeSince = now.getTime() - ACTIVE_WINDOW_MS
  const [devices, bounds, lastSubmissions, credentials, links, enabledFlags] = await Promise.all([
    db.select({
      app: pwaDevices.app,
      version: pwaDevices.version,
      lastSeenAt: pwaDevices.lastSeenAt,
      pendingCount: pwaDevices.pendingCount,
      failedCount: pwaDevices.failedCount,
      oldestPendingAt: pwaDevices.oldestPendingAt,
    })
      .from(pwaDevices)
      .where(and(gte(pwaDevices.lastSeenAt, iso(now, -FORGET_AFTER_MS)), orScope(scope))),
    db.select({
      app: pwaDevices.app,
      first: sql<string | null>`min(${pwaDevices.firstSeenAt})`,
      last: sql<string | null>`max(${pwaDevices.lastSeenAt})`,
    })
      .from(pwaDevices)
      .where(orScope(scope))
      .groupBy(pwaDevices.app),
    readLastSubmissions(scope),
    getFieldAppAccess("mantencion", scope, now),
    getFieldAppAccess("tae", scope, now),
    Promise.all(FIELD_APPS.map((app) => isRouteOperational(app.toggleRoute))),
  ])

  const boundsByApp = new Map(bounds.map((row) => [row.app, row]))
  const attention: Record<FieldAppId, number> = {
    ppa: 0,
    mantencion: credentials ? credentials.expiringSoon + credentials.unused : 0,
    tae: links ? links.expiringSoon + links.unused : 0,
  }

  return FIELD_APPS.map((app, index) => {
    const mine = devices.filter((row) => row.app === app.id)
    // Mantención no tiene faena: con un alcance acotado no se ve ningún teléfono suyo.
    const visible = app.id === "mantencion" && scope !== "all" ? [] : mine
    const byState: Record<DeviceState, number> = { error: 0, stuck: 0, silent: 0, ok: 0 }
    let versionBehind = 0
    let activeDevices = 0
    for (const device of visible) {
      byState[deviceState(device, now)] += 1
      if (isVersionBehind(device.version, BUILD_ID)) versionBehind += 1
      if (new Date(device.lastSeenAt).getTime() >= activeSince) activeDevices += 1
    }
    const range = boundsByApp.get(app.id)
    const hidden = app.id === "mantencion" && scope !== "all"
    return {
      app: app.id,
      enabled: enabledFlags[index] ?? false,
      firstReportAt: !hidden && range?.first ? new Date(range.first).toISOString() : null,
      lastReportAt: !hidden && range?.last ? new Date(range.last).toISOString() : null,
      activeDevices,
      seenDevices: visible.length,
      byState,
      versionBehind,
      accessesNeedingAttention: attention[app.id],
      lastSubmissionAt: lastSubmissions[app.id],
    }
  })
}

/** Alcance de teléfonos en consultas que mezclan apps: Mantención sólo con `"all"`. */
function orScope(scope: Scope): SQL | undefined {
  if (scope === "all") return undefined
  const own = worksiteScopeSqlFor(scope, pwaDevices.worksiteId)
  return and(ne(pwaDevices.app, "mantencion"), own)
}

/* ── Teléfonos ──────────────────────────────────────────────────────────── */

export async function getFieldAppDevices(app: FieldAppId, scope: Scope, now: Date = new Date()): Promise<FieldDeviceRow[]> {
  const rows = await db.select({
    deviceId: pwaDevices.deviceId,
    platform: pwaDevices.platform,
    installed: pwaDevices.installed,
    version: pwaDevices.version,
    builtAt: pwaDevices.builtAt,
    pendingCount: pwaDevices.pendingCount,
    failedCount: pwaDevices.failedCount,
    oldestPendingAt: pwaDevices.oldestPendingAt,
    lastAttemptAt: pwaDevices.lastAttemptAt,
    lastError: pwaDevices.lastError,
    lastErrorAt: pwaDevices.lastErrorAt,
    firstSeenAt: pwaDevices.firstSeenAt,
    lastSeenAt: pwaDevices.lastSeenAt,
    userName: users.name,
    worksiteName: worksites.name,
    linkLabel: fuelTaePublicLinks.label,
    linkRevokedAt: fuelTaePublicLinks.revokedAt,
    linkExpiresAt: fuelTaePublicLinks.expiresAt,
  })
    .from(pwaDevices)
    .leftJoin(users, eq(users.id, pwaDevices.userId))
    .leftJoin(worksites, eq(worksites.id, pwaDevices.worksiteId))
    .leftJoin(fuelTaePublicLinks, eq(fuelTaePublicLinks.id, pwaDevices.taeLinkId))
    .where(and(
      eq(pwaDevices.app, app),
      gte(pwaDevices.lastSeenAt, iso(now, -FORGET_AFTER_MS)),
      deviceScope(app, scope),
    ))

  const result: FieldDeviceRow[] = rows.map((row) => ({
    app,
    deviceId: row.deviceId,
    platform: row.platform,
    installed: row.installed,
    version: row.version,
    builtAt: row.builtAt,
    versionBehind: isVersionBehind(row.version, BUILD_ID),
    state: deviceState(row, now),
    pendingCount: row.pendingCount,
    failedCount: row.failedCount,
    oldestPendingAt: row.oldestPendingAt,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    userName: app === "mantencion" ? row.userName : null,
    worksiteName: row.worksiteName,
    linkLabel: app === "tae" ? row.linkLabel : null,
    linkStatus: app === "tae" && row.linkLabel !== null
      ? linkStatus({ revokedAt: row.linkRevokedAt, expiresAt: row.linkExpiresAt }, now)
      : null,
  }))

  return result.sort((a, b) =>
    STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
}

/* ── Demora de llegada ──────────────────────────────────────────────────── */

export async function getFieldAppLatency(app: FieldAppId, scope: Scope, now: Date = new Date()): Promise<LatencyWeek[]> {
  const weeks = trendWeekStarts(now)
  const source = submissionSource(app)
  const week = chileWeek(source.arrivedAt)
  // Un reloj adelantado en el teléfono daría una demora negativa: se recorta a 0.
  const minutes = sql`greatest(extract(epoch from (${source.arrivedAt} - ${source.originAt})) / 60.0, 0)`

  const rows = await db.select({
    week,
    count: sql<number>`count(*)::int`,
    p50: sql<number | null>`percentile_cont(0.5) within group (order by ${minutes})`,
    p90: sql<number | null>`percentile_cont(0.9) within group (order by ${minutes})`,
    offline: sql<number>`(count(*) filter (where ${source.offline}))::int`,
  })
    .from(sourceTable(app))
    .where(and(
      source.base,
      submissionScope(source, scope),
      gte(source.arrivedAt, chileDayStartInstant(weeks[0]!)),
      sql`${source.arrivedAt} <= ${now.toISOString()}::timestamptz`,
    ))
    .groupBy(week)

  const byWeek = new Map(rows.map((row) => [row.week, row]))
  return weeks.map((weekStart) => {
    const row = byWeek.get(weekStart)
    if (!row || row.count === 0) {
      return { weekStart, count: 0, p50Minutes: null, p90Minutes: null, offlineShare: null }
    }
    return {
      weekStart,
      count: row.count,
      p50Minutes: round(numberOrNull(row.p50)),
      p90Minutes: round(numberOrNull(row.p90)),
      offlineShare: round(row.offline / row.count, 4),
    }
  })
}

/* ── Uso ────────────────────────────────────────────────────────────────── */

export async function getFieldAppUsage(app: FieldAppId, scope: Scope, now: Date = new Date()): Promise<UsageRow[]> {
  const source = submissionSource(app)
  const nowIso = now.toISOString()
  const since30 = iso(now, -USAGE_DAYS * DAY_MS)
  const recentFrom = iso(now, -STOPPED_RECENT_DAYS * DAY_MS)
  const priorFrom = iso(now, -(STOPPED_RECENT_DAYS + STOPPED_PRIOR_DAYS) * DAY_MS)
  const window = and(
    source.base,
    submissionScope(source, scope),
    gte(source.arrivedAt, iso(now, -FORGET_AFTER_MS)),
    sql`${source.arrivedAt} <= ${nowIso}::timestamptz`,
  )

  // Una persona (Mantención) o una faena (PPA, TAE), según la app.
  const byPerson = app === "mantencion"
  const keyColumn: AnyColumn = byPerson ? mantRecords.registeredBy : source.worksiteId
  const aggregates = {
    last: sql<string | null>`max(${source.arrivedAt})`,
    in30: sql<number>`(count(*) filter (where ${source.arrivedAt} >= ${since30}::timestamptz))::int`,
    recent: sql<number>`(count(*) filter (where ${source.arrivedAt} >= ${recentFrom}::timestamptz))::int`,
    prior: sql<number>`(count(*) filter (where ${source.arrivedAt} >= ${priorFrom}::timestamptz and ${source.arrivedAt} < ${recentFrom}::timestamptz))::int`,
  }
  const rows = byPerson
    ? await db.select({ key: mantRecords.registeredBy, label: users.name, ...aggregates })
      .from(mantRecords)
      .innerJoin(users, eq(users.id, mantRecords.registeredBy))
      .where(window)
      .groupBy(mantRecords.registeredBy, users.name)
    : await db.select({ key: keyColumn, label: worksites.name, ...aggregates })
      .from(sourceTable(app))
      .innerJoin(worksites, eq(worksites.id, source.worksiteId))
      .where(window)
      .groupBy(keyColumn, worksites.name)

  // Teléfonos activos por faena (PPA, TAE) o por persona (Mantención); lo de
  // Mantención no pertenece a una faena, así que un alcance acotado no lo ve.
  const activeByKey = new Map<string, number>()
  const hideDevices = byPerson && scope !== "all"
  if (!hideDevices) {
    const deviceKey = byPerson ? pwaDevices.userId : pwaDevices.worksiteId
    const devices = await db.select({ key: deviceKey, count: sql<number>`count(*)::int` })
      .from(pwaDevices)
      .where(and(
        eq(pwaDevices.app, app),
        gte(pwaDevices.lastSeenAt, iso(now, -ACTIVE_WINDOW_MS)),
        deviceScope(app, scope),
      ))
      .groupBy(deviceKey)
    for (const row of devices) if (row.key) activeByKey.set(row.key, row.count)
  }

  const labels = new Map<string, string>()
  const usage = new Map<string, UsageRow>()
  for (const row of rows) {
    labels.set(row.key, row.label)
    usage.set(row.key, {
      key: row.key,
      label: row.label,
      activeDevices: activeByKey.get(row.key) ?? 0,
      lastSubmissionAt: row.last ? new Date(row.last).toISOString() : null,
      submissions30d: row.in30,
      stopped: row.prior > 0 && row.recent === 0,
    })
  }

  // Una faena o persona con teléfonos activos pero sin envíos en 90 días también se lista.
  const missing = [...activeByKey.keys()].filter((key) => !usage.has(key))
  if (missing.length > 0) {
    const names = byPerson
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, missing))
      : await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, missing))
    for (const { id, name } of names) {
      usage.set(id, {
        key: id,
        label: name,
        activeDevices: activeByKey.get(id) ?? 0,
        lastSubmissionAt: null,
        submissions30d: 0,
        stopped: false,
      })
    }
  }

  return [...usage.values()].sort((a, b) =>
    Number(b.stopped) - Number(a.stopped)
    || b.submissions30d - a.submissions30d
    || a.label.localeCompare(b.label, "es"))
}

/* ── Calidad de captura ─────────────────────────────────────────────────── */

export async function getFieldAppCaptureQuality(
  app: "ppa" | "tae",
  scope: Scope,
  now: Date = new Date(),
): Promise<CaptureQuality> {
  const source = submissionSource(app)
  const manualColumn = app === "ppa" ? ppaSubmissions.manualIdentificacion : fuelTaeSubmissions.manualIdentity
  const since30 = iso(now, -USAGE_DAYS * DAY_MS)

  const identityRows = await db.select({
    worksiteId: source.worksiteId,
    worksiteName: worksites.name,
    total: sql<number>`count(*)::int`,
    manual: sql<number>`(count(*) filter (where ${manualColumn}))::int`,
  })
    .from(sourceTable(app))
    .innerJoin(worksites, eq(worksites.id, source.worksiteId))
    .where(and(
      source.base,
      submissionScope(source, scope),
      gte(source.arrivedAt, since30),
      sql`${source.arrivedAt} <= ${now.toISOString()}::timestamptz`,
    ))
    .groupBy(source.worksiteId, worksites.name)

  const manualIdentity = identityRows
    .map((row) => ({ worksiteId: row.worksiteId as string, worksiteName: row.worksiteName, total: row.total, manual: row.manual }))
    .sort((a, b) => b.manual / b.total - a.manual / a.total || b.total - a.total || a.worksiteName.localeCompare(b.worksiteName, "es"))

  if (app === "ppa") return { manualIdentity, ocrWeeks: null }

  const weeks = trendWeekStarts(now)
  const week = chileWeek(fuelTaeSubmissions.createdAt)
  const ocrRows = await db.select({
    week,
    readings: sql<number>`(count(*) filter (where ${fuelTaeSubmissions.meterReadingSource} is not null))::int`,
    ocr: sql<number>`(count(*) filter (where ${fuelTaeSubmissions.meterReadingSource} = 'ocr'))::int`,
    manual: sql<number>`(count(*) filter (where ${fuelTaeSubmissions.meterReadingSource} = 'manual'))::int`,
    confidence: sql<number | null>`avg(${fuelTaeSubmissions.ocrConfidence}) filter (where ${fuelTaeSubmissions.meterReadingSource} = 'ocr')`,
  })
    .from(fuelTaeSubmissions)
    .where(and(
      source.base,
      submissionScope(source, scope),
      gte(fuelTaeSubmissions.createdAt, chileDayStartInstant(weeks[0]!)),
      sql`${fuelTaeSubmissions.createdAt} <= ${now.toISOString()}::timestamptz`,
    ))
    .groupBy(week)
  const byWeek = new Map(ocrRows.map((row) => [row.week, row]))
  return {
    manualIdentity,
    ocrWeeks: weeks.map((weekStart) => {
      const row = byWeek.get(weekStart)
      return {
        weekStart,
        readings: row?.readings ?? 0,
        ocr: row?.ocr ?? 0,
        manual: row?.manual ?? 0,
        avgConfidence: round(numberOrNull(row?.confidence), 3),
      }
    }),
  }
}

/**
 * Lecturas de TI sobre las apps del teléfono (`field-apps/overview.ts`).
 *
 * Contra Postgres de verdad porque lo que se prueba son agregados (percentiles,
 * semanas chilenas, filtros por ventana) y el alcance por faena (Review Focus 5).
 * El «ahora» está fijo y el build, simulado, para que «versión atrasada» y las
 * ventanas sean deterministas.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof inMemoryDb }
testGlobal.__db = inMemoryDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/build-info", () => ({ BUILD_ID: "build-nuevo" }))
vi.mock("@/lib/services/module-toggles", () => ({
  isRouteOperational: vi.fn(async (route: string) => route !== "/mantencion/registros"),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const {
  getFieldAppSummaries,
  getFieldAppDevices,
  getFieldAppLatency,
  getFieldAppUsage,
  getFieldAppAccess,
  getFieldAppCaptureQuality,
} = await import("@/lib/services/field-apps/overview")

// Domingo 22-11-2026 12:00 en Chile (UTC-3). La semana actual empieza el lunes 16.
const NOW = new Date("2026-11-22T15:00:00Z")
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
/** Una hora fija dentro de la semana del lunes 16 (miércoles 18, 12:00 Chile). */
const THIS_WEEK = "2026-11-18T15:00:00Z"
/** Dentro de la semana del lunes 9. */
const LAST_WEEK = "2026-11-10T15:00:00Z"
const minusMin = (iso: string, minutes: number) => new Date(Date.parse(iso) - minutes * MIN).toISOString()

// Las filas de prueba sólo necesitan las columnas que se miden: las FK no se verifican.
await pg.exec("SET session_replication_role = replica")

for (const [id, name] of [["ws-a", "Faena A"], ["ws-b", "Faena B"], ["ws-c", "Faena C"]] as const) {
  await pg.query("INSERT INTO worksites (id, name, code, is_active) VALUES ($1, $2, $3, true)", [id, name, id.toUpperCase()])
}
for (const [id, name] of [["u-1", "Mecánico Uno"], ["u-2", "Mecánico Dos"]]) {
  await pg.query("INSERT INTO users (id, name, email, hashed_password) VALUES ($1, $2, $3, 'x')", [id, name, `${id}@example.com`])
}

interface DeviceSeed {
  app: string
  id: string
  lastSeen: string
  firstSeen?: string
  version?: string
  pending?: number
  failed?: number
  oldestPending?: string | null
  worksite?: string | null
  user?: string | null
  link?: string | null
}

async function seedDevice(d: DeviceSeed) {
  await pg.query(
    `INSERT INTO pwa_devices (app, device_id, first_seen_at, last_seen_at, version, installed, platform,
       pending_count, failed_count, oldest_pending_at, worksite_id, user_id, tae_link_id)
     VALUES ($1, $2, $3, $4, $5, true, 'Android', $6, $7, $8, $9, $10, $11)`,
    [d.app, d.id, d.firstSeen ?? d.lastSeen, d.lastSeen, d.version ?? "build-nuevo", d.pending ?? 0, d.failed ?? 0,
      d.oldestPending ?? null, d.worksite ?? null, d.user ?? null, d.link ?? null],
  )
}

async function seedPpa(id: string, worksite: string, createdAt: string, opts: { filledAt?: string | null; manual?: boolean; estado?: string } = {}) {
  await pg.query(
    `INSERT INTO ppa_submissions (id, worksite_id, worker_name, manual_identificacion, tipo_trabajo, answers_json,
       resultado, triggered_reasons, estado, public_token, filled_at, created_at, updated_at)
     VALUES ($1, $2, 'QA', $3, 'x', '{}', 'autorizado_auto', '[]', $4, $1, $5, $6, $6)`,
    [id, worksite, opts.manual ?? false, opts.estado ?? "aprobado_auto", opts.filledAt ?? null, createdAt],
  )
}

async function seedMant(id: string, worksite: string, user: string, receivedAt: string, signedMinutesBefore: number, opts: { offline?: boolean; status?: string } = {}) {
  const signed = minusMin(receivedAt, signedMinutesBefore)
  await pg.query(
    `INSERT INTO mant_records (id, kind, vehicle_id, equipment_snapshot, worksite_id, reading, unit, work_date,
       registered_by, executor_kind, executor_user_id, executor_name, signed_at, received_at, offline_since, status)
     VALUES ($1, 'C', 'v-1', '{}', $2, 100, 'km', '2026-11-18', $3, 'yo', $3, 'QA', $4, $5, $6, $7)`,
    [id, worksite, user, signed, receivedAt, opts.offline ? signed : null, opts.status ?? "vigente"],
  )
}

async function seedTae(id: string, worksite: string, createdAt: string, opts: {
  loadedMinutesBefore?: number; loadedAtSource?: string; source?: string
  meterSource?: string | null; confidence?: number | null; manual?: boolean
} = {}) {
  await pg.query(
    `INSERT INTO fuel_tae_submissions (id, client_submission_id, source, public_result_token, worksite_id, product_id,
       equipment_code_snapshot, loaded_at, submitted_at, driver_name_snapshot, supervisor_name_snapshot, manual_identity,
       meter_type, meter_reading_source, ocr_confidence, liters, loaded_at_source, created_at, updated_at)
     VALUES ($1, $1, $2, $1, $3, 'p-1', 'EQ', $4, $4, 'QA', 'QA', $5, 'odometer', $6, $7, 10, $8, $9, $9)`,
    [id, opts.source ?? "public_pwa", worksite, minusMin(createdAt, opts.loadedMinutesBefore ?? 0), opts.manual ?? false,
      opts.meterSource ?? null, opts.confidence ?? null, opts.loadedAtSource ?? "device", createdAt],
  )
}

async function seedLink(id: string, worksite: string, label: string, opts: {
  expires?: string | null; revoked?: string | null; lastUsed?: string | null; created?: string
} = {}) {
  await pg.query(
    `INSERT INTO fuel_tae_public_links (id, worksite_id, label, token_hash, expires_at, revoked_at, last_used_at, created_by, created_at)
     VALUES ($1, $2, $3, $1, $4, $5, $6, 'u-1', $7)`,
    [id, worksite, label, opts.expires ?? null, opts.revoked ?? null, opts.lastUsed ?? null, opts.created ?? ago(40 * DAY)],
  )
}

async function seedCredential(id: string, user: string, opts: { expires: string; revoked?: string | null; lastUsed?: string | null; created?: string }) {
  await pg.query(
    `INSERT INTO mant_device_credentials (id, user_id, device_id, token_hash, created_at, expires_at, last_used_at, revoked_at)
     VALUES ($1, $2, $1, $1, $3, $4, $5, $6)`,
    [id, user, opts.created ?? ago(30 * DAY), opts.expires, opts.lastUsed ?? null, opts.revoked ?? null],
  )
}

describe("lecturas de TI de las apps del teléfono", () => {
  // Corre antes de sembrar nada: una app sin avisos no es una app sin uso.
  it("sin avisos: firstReportAt null y nada que contar", async () => {
    const summaries = await getFieldAppSummaries("all", NOW)
    expect(summaries.map((row) => row.app)).toEqual(["ppa", "mantencion", "tae"])
    for (const row of summaries) {
      expect(row.firstReportAt).toBeNull()
      expect(row.lastReportAt).toBeNull()
      expect(row.activeDevices).toBe(0)
      expect(row.seenDevices).toBe(0)
      expect(row.byState).toEqual({ error: 0, stuck: 0, silent: 0, ok: 0 })
    }
    expect(await getFieldAppDevices("ppa", "all", NOW)).toEqual([])
  })

  it("siembra", async () => {
    // Enlaces TAE (los teléfonos de TAE apuntan a ellos).
    await seedLink("link-revocado", "ws-a", "QR revocado", { revoked: ago(3 * DAY), lastUsed: ago(2 * DAY) })
    await seedLink("link-vigente", "ws-a", "QR vigente", { lastUsed: ago(DAY) })
    await seedLink("link-por-vencer", "ws-a", "QR por vencer", { expires: ahead(5 * DAY), created: ago(30 * DAY) })
    await seedLink("link-vencido", "ws-b", "QR vencido", { expires: ago(10 * DAY), lastUsed: ago(12 * DAY) })
    await seedLink("link-viejo", "ws-b", "QR muy viejo", { expires: ago(100 * DAY) })

    // PPA: los cuatro estados, uno sin faena y uno olvidado (100 días).
    await seedDevice({ app: "ppa", id: "ppa-error", worksite: "ws-a", failed: 1, lastSeen: ago(MIN) })
    await seedDevice({
      app: "ppa", id: "ppa-atascado", worksite: "ws-a", version: "build-viejo", pending: 2,
      lastSeen: ago(10 * MIN), oldestPending: ago(10 * MIN + 3 * HOUR),
    })
    await seedDevice({ app: "ppa", id: "ppa-ok", worksite: "ws-b", lastSeen: ago(30 * MIN) })
    await seedDevice({ app: "ppa", id: "ppa-silencio", worksite: "ws-b", version: "build-viejo", lastSeen: ago(8 * DAY) })
    await seedDevice({ app: "ppa", id: "ppa-sin-faena", worksite: null, lastSeen: ago(2 * HOUR) })
    await seedDevice({ app: "ppa", id: "ppa-olvidado", worksite: "ws-a", lastSeen: ago(100 * DAY), firstSeen: ago(120 * DAY) })
    // Mantención: la persona la identifica una credencial; no tiene faena.
    await seedDevice({ app: "mantencion", id: "mant-1", user: "u-1", lastSeen: ago(HOUR) })
    // TAE: uno con el enlace revocado (lo que TI debe ver) y otro con el vigente.
    await seedDevice({ app: "tae", id: "tae-revocado", worksite: "ws-a", link: "link-revocado", lastSeen: ago(2 * HOUR) })
    await seedDevice({ app: "tae", id: "tae-vigente", worksite: "ws-a", link: "link-vigente", lastSeen: ago(HOUR) })

    // PPA: 5 envíos de la semana actual (0, 0, 10, 30 y 60 min; el último, cancelado), uno
    // con el reloj del teléfono adelantado (se recorta a 0) y otro de la semana anterior.
    await seedPpa("ppa-1", "ws-a", THIS_WEEK, { manual: true })
    await seedPpa("ppa-2", "ws-a", ahead(-4 * DAY), { filledAt: ahead(-4 * DAY + 5 * MIN) })
    await seedPpa("ppa-3", "ws-a", THIS_WEEK, { filledAt: minusMin(THIS_WEEK, 10), manual: true })
    await seedPpa("ppa-4", "ws-a", THIS_WEEK, { filledAt: minusMin(THIS_WEEK, 30) })
    await seedPpa("ppa-5", "ws-a", THIS_WEEK, { filledAt: minusMin(THIS_WEEK, 60), estado: "cancelado" })
    await seedPpa("ppa-semana-anterior", "ws-a", LAST_WEEK, { filledAt: minusMin(LAST_WEEK, 120) })
    await seedPpa("ppa-antiguo", "ws-a", "2026-06-01T15:00:00Z", { filledAt: minusMin("2026-06-01T15:00:00Z", 999) })
    // Faena B: sólo envíos entre 8 y 30 días atrás (dejó de enviar); C, a 60 días (no).
    await seedPpa("ppa-b", "ws-b", ago(20 * DAY), { manual: true })
    await seedPpa("ppa-c", "ws-c", ago(60 * DAY))

    // Mantención: 5 y 90 min, y una anulada de 5 (viajó igual).
    await seedMant("m-1", "ws-a", "u-1", THIS_WEEK, 5)
    await seedMant("m-2", "ws-a", "u-1", THIS_WEEK, 90, { offline: true })
    await seedMant("m-3", "ws-a", "u-1", THIS_WEEK, 5, { status: "anulado" })

    // TAE por la PWA: 20 min sin señal, 0, 0 y 0; uno interno que no cuenta.
    await seedTae("t-1", "ws-a", THIS_WEEK, { loadedMinutesBefore: 20, loadedAtSource: "device_offline", meterSource: "ocr", confidence: 0.9, manual: true })
    await seedTae("t-2", "ws-a", THIS_WEEK, { meterSource: "ocr", confidence: 0.7 })
    await seedTae("t-3", "ws-a", THIS_WEEK, { meterSource: "manual" })
    await seedTae("t-4", "ws-a", THIS_WEEK, { meterSource: null })
    await seedTae("t-interno", "ws-a", THIS_WEEK, { source: "internal_app", loadedMinutesBefore: 1440, meterSource: "ocr", confidence: 0.1 })

    // Credenciales del mecánico.
    await seedCredential("c-por-vencer", "u-1", { expires: ahead(3 * DAY), lastUsed: ago(DAY) })
    await seedCredential("c-sin-uso", "u-2", { expires: ahead(60 * DAY), created: ago(20 * DAY) })
    await seedCredential("c-normal", "u-2", { expires: ahead(60 * DAY), lastUsed: ago(DAY) })
    await seedCredential("c-revocada", "u-1", { expires: ahead(10 * DAY), revoked: ago(5 * DAY), lastUsed: ago(6 * DAY) })
    await seedCredential("c-vencida", "u-1", { expires: ago(10 * DAY), lastUsed: ago(12 * DAY) })
    await seedCredential("c-vieja", "u-1", { expires: ahead(10 * DAY), revoked: ago(100 * DAY) })
  })

  it("resumen cuenta activos, estados y versión atrasada", async () => {
    const [ppa, mant, tae] = await getFieldAppSummaries("all", NOW)
    // El olvidado (100 días) no se muestra.
    expect(ppa!.seenDevices).toBe(5)
    // Activo = aviso en 7 días: el de silencio (8 días) y el olvidado no.
    expect(ppa!.activeDevices).toBe(4)
    expect(ppa!.byState).toEqual({ error: 1, stuck: 1, silent: 1, ok: 2 })
    // El atascado y el de silencio corren un build que no es el actual.
    expect(ppa!.versionBehind).toBe(2)
    // «Desde cuándo llegan avisos» mira también a los teléfonos olvidados.
    expect(ppa!.firstReportAt).toBe(ago(120 * DAY))
    expect(ppa!.lastReportAt).toBe(ago(MIN))
    expect(ppa!.enabled).toBe(true)
    expect(ppa!.accessesNeedingAttention).toBe(0)
    expect(ppa!.lastSubmissionAt).toBe(THIS_WEEK.replace("Z", ".000Z"))

    expect(mant!.enabled).toBe(false)
    expect(mant!.seenDevices).toBe(1)
    expect(mant!.accessesNeedingAttention).toBe(2) // 1 por vencer + 1 sin uso

    expect(tae!.seenDevices).toBe(2)
    expect(tae!.accessesNeedingAttention).toBe(2) // el enlace por vencer, que además está sin uso
  })

  it("la lista excluye teléfonos de más de 90 días y ordena por estado y último aviso", async () => {
    const rows = await getFieldAppDevices("ppa", "all", NOW)
    expect(rows.map((row) => row.deviceId)).toEqual(["ppa-error", "ppa-atascado", "ppa-silencio", "ppa-ok", "ppa-sin-faena"])
    expect(rows.map((row) => row.state)).toEqual(["error", "stuck", "silent", "ok", "ok"])
    expect(rows.find((row) => row.deviceId === "ppa-atascado")?.versionBehind).toBe(true)
    expect(rows.find((row) => row.deviceId === "ppa-ok")).toMatchObject({ versionBehind: false, worksiteName: "Faena B", userName: null, linkLabel: null, linkStatus: null })
  })

  it("la lista identifica a la persona del mecánico y el enlace de TAE con su estado", async () => {
    const [mecanico] = await getFieldAppDevices("mantencion", "all", NOW)
    expect(mecanico).toMatchObject({ userName: "Mecánico Uno", worksiteName: null })

    const tae = await getFieldAppDevices("tae", "all", NOW)
    expect(tae.find((row) => row.deviceId === "tae-revocado")).toMatchObject({ linkLabel: "QR revocado", linkStatus: "revoked" })
    expect(tae.find((row) => row.deviceId === "tae-vigente")).toMatchObject({ linkLabel: "QR vigente", linkStatus: "active" })
  })

  it("demora: mediana y p90 en minutos por semana, y porcentaje sin señal", async () => {
    const weeks = await getFieldAppLatency("ppa", "all", NOW)
    expect(weeks).toHaveLength(12)
    expect(weeks[0]!.weekStart).toBe("2026-08-31")
    expect(weeks[11]!.weekStart).toBe("2026-11-16")

    // 0 (en línea), 0 (reloj adelantado, recortado), 10, 30 y 60 min; 4 de 5 con filled_at.
    // p90 = 30 + 0.6 × (60 − 30). El cancelado cuenta: viajó desde el teléfono.
    expect(weeks[11]).toEqual({ weekStart: "2026-11-16", count: 5, p50Minutes: 10, p90Minutes: 48, offlineShare: 0.8 })
    // Semana anterior: un único envío sin señal, 120 min.
    expect(weeks[10]).toEqual({ weekStart: "2026-11-09", count: 1, p50Minutes: 120, p90Minutes: 120, offlineShare: 1 })
    // Sin datos: cero y nulos, no semanas faltantes.
    expect(weeks[8]).toEqual({ weekStart: "2026-10-26", count: 0, p50Minutes: null, p90Minutes: null, offlineShare: null })
    // 5 + 1 + los de Faena B y C; el de junio queda fuera de las 12 semanas.
    expect(weeks.reduce((sum, week) => sum + week.count, 0)).toBe(8)
  })

  it("demora de Mantención (recibido − firmado) y de TAE (sólo PWA pública)", async () => {
    const mant = (await getFieldAppLatency("mantencion", "all", NOW))[11]!
    // 5, 5 (anulada) y 90 min. p50 = 5; p90 = 5 + 0.8 × 85 = 73; 1 de 3 sin señal.
    expect(mant).toEqual({ weekStart: "2026-11-16", count: 3, p50Minutes: 5, p90Minutes: 73, offlineShare: 0.3333 })

    const tae = (await getFieldAppLatency("tae", "all", NOW))[11]!
    // 0, 0, 0 y 20 min (el envío interno, de un día, no cuenta). p90 = 0.7 × 20.
    expect(tae).toEqual({ weekStart: "2026-11-16", count: 4, p50Minutes: 0, p90Minutes: 14, offlineShare: 0.25 })
  })

  it("uso marca «dejó de enviar» y cuenta teléfonos activos por faena", async () => {
    const rows = await getFieldAppUsage("ppa", "all", NOW)
    // La que dejó de enviar va primero.
    expect(rows.map((row) => row.key)).toEqual(["ws-b", "ws-a", "ws-c"])
    expect(rows[0]).toMatchObject({ label: "Faena B", stopped: true, submissions30d: 1, activeDevices: 1 })
    expect(rows[1]).toMatchObject({ label: "Faena A", stopped: false, submissions30d: 6, activeDevices: 2 })
    // 60 días atrás: ya no cuenta como «tenía envíos antes», así que no «dejó de enviar».
    expect(rows[2]).toMatchObject({ label: "Faena C", stopped: false, submissions30d: 0, activeDevices: 0 })
    expect(rows[2]!.lastSubmissionAt).toBe(ago(60 * DAY))
  })

  it("uso de Mantención va por persona y de TAE por faena", async () => {
    const mant = await getFieldAppUsage("mantencion", "all", NOW)
    expect(mant).toEqual([expect.objectContaining({ key: "u-1", label: "Mecánico Uno", submissions30d: 3, activeDevices: 1, stopped: false })])

    const tae = await getFieldAppUsage("tae", "all", NOW)
    expect(tae).toEqual([expect.objectContaining({ key: "ws-a", label: "Faena A", submissions30d: 4, activeDevices: 2 })])
  })

  it("accesos: por vencer y sin uso", async () => {
    expect(await getFieldAppAccess("mantencion", "all", NOW)).toEqual({
      kind: "credentials", active: 3, expiringSoon: 1, unused: 1, revokedOrExpired30d: 2, links: [],
    })

    const links = await getFieldAppAccess("tae", "all", NOW)
    expect(links).toMatchObject({ kind: "links", active: 2, expiringSoon: 1, unused: 1, revokedOrExpired30d: 2 })
    // El enlace de hace 100 días no se lista.
    expect(links!.links.map((link) => [link.label, link.status, link.activeDevices])).toEqual([
      ["QR por vencer", "active", 0],
      ["QR vigente", "active", 1],
      ["QR vencido", "expired", 0],
      ["QR revocado", "revoked", 1],
    ])
  })

  it("calidad de captura: identificación manual por faena y OCR por semana", async () => {
    const ppa = await getFieldAppCaptureQuality("ppa", "all", NOW)
    // Faena B: 1 de 1 (100 %); Faena A: 2 de 6 en 30 días (el de junio y el de C quedan fuera).
    expect(ppa.manualIdentity).toEqual([
      { worksiteId: "ws-b", worksiteName: "Faena B", total: 1, manual: 1 },
      { worksiteId: "ws-a", worksiteName: "Faena A", total: 6, manual: 2 },
    ])
    expect(ppa.ocrWeeks).toBeNull()

    const tae = await getFieldAppCaptureQuality("tae", "all", NOW)
    expect(tae.manualIdentity).toEqual([{ worksiteId: "ws-a", worksiteName: "Faena A", total: 4, manual: 1 }])
    expect(tae.ocrWeeks).toHaveLength(12)
    // 3 lecturas de medidor (la cuarta no tiene origen): 2 por OCR, 1 a mano, confianza media 0,8.
    expect(tae.ocrWeeks![11]).toEqual({ weekStart: "2026-11-16", readings: 3, ocr: 2, manual: 1, avgConfidence: 0.8 })
    expect(tae.ocrWeeks![10]).toEqual({ weekStart: "2026-11-09", readings: 0, ocr: 0, manual: 0, avgConfidence: null })
  })

  it("alcance acotado no ve otras faenas ni teléfonos sin faena; global ve todo", async () => {
    // Faena A: sus teléfonos PPA (no el olvidado, no el sin faena, no los de Faena B).
    expect((await getFieldAppDevices("ppa", ["ws-a"], NOW)).map((row) => row.deviceId)).toEqual(["ppa-error", "ppa-atascado"])
    expect((await getFieldAppDevices("ppa", ["ws-b"], NOW)).map((row) => row.deviceId)).toEqual(["ppa-silencio", "ppa-ok"])
    expect(await getFieldAppDevices("ppa", [], NOW)).toEqual([])
    // Los teléfonos del mecánico no tienen faena: sólo un rol global los ve.
    expect(await getFieldAppDevices("mantencion", ["ws-a"], NOW)).toEqual([])

    const [ppa, mant, tae] = await getFieldAppSummaries(["ws-a"], NOW)
    expect(ppa).toMatchObject({ seenDevices: 2, activeDevices: 2, byState: { error: 1, stuck: 1, silent: 0, ok: 0 }, versionBehind: 1 })
    expect(mant).toMatchObject({ seenDevices: 0, activeDevices: 0, firstReportAt: null, lastReportAt: null, accessesNeedingAttention: 0 })
    // El último envío de Mantención sí se acota por la faena de sus registros.
    expect(mant!.lastSubmissionAt).not.toBeNull()
    expect(tae).toMatchObject({ seenDevices: 2, accessesNeedingAttention: 2 })

    const [, , taeB] = await getFieldAppSummaries(["ws-b"], NOW)
    expect(taeB).toMatchObject({ seenDevices: 0, lastSubmissionAt: null, accessesNeedingAttention: 0 })

    // Uso, demora y calidad se acotan por la faena del envío.
    expect((await getFieldAppUsage("ppa", ["ws-a"], NOW)).map((row) => row.key)).toEqual(["ws-a"])
    expect((await getFieldAppLatency("ppa", ["ws-b"], NOW)).reduce((sum, week) => sum + week.count, 0)).toBe(1)
    expect((await getFieldAppCaptureQuality("tae", ["ws-b"], NOW)).manualIdentity).toEqual([])
    expect((await getFieldAppCaptureQuality("tae", ["ws-b"], NOW)).ocrWeeks!.every((week) => week.readings === 0)).toBe(true)

    // Mantención por persona: acotada por la faena de sus registros, y sin teléfonos.
    expect(await getFieldAppUsage("mantencion", ["ws-a"], NOW)).toEqual([
      expect.objectContaining({ key: "u-1", submissions30d: 3, activeDevices: 0 }),
    ])
    expect(await getFieldAppUsage("mantencion", ["ws-b"], NOW)).toEqual([])

    // Accesos: las credenciales no tienen faena; los enlaces, sí.
    expect(await getFieldAppAccess("mantencion", ["ws-a"], NOW)).toBeNull()
    expect(await getFieldAppAccess("tae", ["ws-a"], NOW)).toMatchObject({ active: 2, revokedOrExpired30d: 1 })
    expect((await getFieldAppAccess("tae", ["ws-a"], NOW))!.links).toHaveLength(3)
    expect(await getFieldAppAccess("tae", [], NOW)).toMatchObject({ active: 0, links: [] })
  })
})

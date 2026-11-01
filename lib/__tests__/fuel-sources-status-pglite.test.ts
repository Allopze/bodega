import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"
import { currentMonthPeriod, describeFuelPeriod, shiftFuelPeriod } from "@/lib/combustibles/period/parse"
import { todayInChile } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
// El módulo del servicio declara `server-only`; fuera de Next no existe el paquete.
vi.mock("server-only", () => ({}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

// Reloj fijo (mediodía de Chile): «hace una hora» no puede caer en el día anterior según la hora a la que corra la prueba.
vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(new Date("2026-10-31T16:00:00.000Z"))

const { describeFuelSources, getFuelSourceStatuses, summarizeFuelSources } = await import("@/lib/combustibles/sources-status")
const { countImportedFiles, listImportedFiles, visibleImportedFileKinds } = await import("@/app/(app)/combustibles/fuentes/imported-files")

const ALL_PERMISSIONS = [
  "combustibles:view", "combustibles:view_costs", "combustibles:import", "combustibles:tae_import",
  "combustibles:tae_view", "combustibles:sync_integrations", "combustibles:revert",
]

function session(options: { global: boolean; permissions: string[]; worksiteIds?: string[] }): Session {
  return {
    user: {
      id: options.global ? "user-global" : "user-scoped", name: "Prueba", email: "prueba@example.com", roles: [],
      permissions: options.permissions, worksiteIds: options.worksiteIds ?? [], primaryWorksiteId: null, avatarColor: null,
      isActive: true, isGlobal: options.global,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const daysAgo = (days: number) => hoursAgo(days * 24)

/** Fuentes de Combustible contra PostgreSQL: al día, atrasadas, con falla y según el alcance de quien mira. */
describe("estado de las fuentes de datos (PostgreSQL)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const userId = nanoid()
  const typeId = nanoid()
  const vehicleA = nanoid()
  const vehicleB = nanoid()
  const mediumId = `fsm-${nanoid().slice(0, 6)}`
  const productId = nanoid()
  const supplierId = nanoid()

  const monthPeriod = describeFuelPeriod(currentMonthPeriod(), "default")
  const pastPeriod = describeFuelPeriod(shiftFuelPeriod(currentMonthPeriod(), -1), "url")
  const global = () => session({ global: true, permissions: ALL_PERMISSIONS })

  beforeAll(async () => {
    process.env.ARAMCO_DOCUMENT_NUMBER = "11111111-1"
    process.env.ARAMCO_PASSWORD = "1234"
    delete process.env.VISIONLINK_CLIENT_ID
    delete process.env.VISIONLINK_CLIENT_SECRET
    delete process.env.VISIONLINK_SYNC_ENABLED
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena Norte", code: `FN-${nanoid().slice(0, 6)}`, isActive: true },
      { id: worksiteB, name: "Faena Sur", code: `FS-${nanoid().slice(0, 6)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Importadora", email: `imp-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: typeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: vehicleA, plate: `TA${nanoid().slice(0, 4).toUpperCase()}`, code: "KA-1", type: "camion", equipmentTypeId: typeId, worksiteId: worksiteA, isActive: true },
      { id: vehicleB, plate: `TB${nanoid().slice(0, 4).toUpperCase()}`, code: "KB-1", type: "camion", equipmentTypeId: typeId, worksiteId: worksiteB, isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelSupplyMedia).values({ id: mediumId, slug: mediumId, name: "Surtidor CMPC (prueba)", kind: "provider_station" })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: "Copec" })
  })

  afterAll(() => {
    delete process.env.ARAMCO_DOCUMENT_NUMBER
    delete process.env.ARAMCO_PASSWORD
  })

  beforeEach(async () => {
    await inMemoryDb.delete(schema.fuelProviderPeriodCoverage)
    await inMemoryDb.delete(schema.fuelProviderTransactions)
    await inMemoryDb.delete(schema.fuelProviderSyncRuns)
    await inMemoryDb.delete(schema.cronRuns)
    await inMemoryDb.delete(schema.fuelImportBatches)
    await inMemoryDb.delete(schema.fuelOperationRecords)
    await inMemoryDb.delete(schema.fuelOperationBatches)
    await inMemoryDb.delete(schema.fuelTelemetryDaily)
    await inMemoryDb.delete(schema.fuelSupplyInputs)
    await inMemoryDb.delete(schema.fuelControlImportBatches)
    await inMemoryDb.delete(schema.fuelLoads)
    await inMemoryDb.delete(schema.fuelTaeSubmissions)
    await inMemoryDb.delete(schema.fuelTaeLoadingPoints)
    await inMemoryDb.delete(schema.fuelTaeImportBatches)
  })

  async function run(provider: "copec" | "aramco", options: { startedAt: string; status?: string; rowsPending?: number; error?: string; requestedFrom?: string }) {
    const startedAt = options.startedAt
    const id = nanoid()
    await inMemoryDb.insert(schema.fuelProviderSyncRuns).values({
      id, provider, trigger: "cron", requestedFrom: options.requestedFrom ?? monthPeriod.from, requestedTo: monthPeriod.to,
      status: options.status ?? "success", correlationId: nanoid(), startedAt, finishedAt: options.status === "running" ? null : startedAt,
      rowsReceived: 100, rowsAccepted: 100 - (options.rowsPending ?? 0), rowsPending: options.rowsPending ?? 0, error: options.error ?? null,
    })
    return id
  }

  const byKey = (statuses: Awaited<ReturnType<typeof getFuelSourceStatuses>>, key: string) => statuses.find((status) => status.key === key)

  it("Copec y Aramco quedan «Al día» con una corrida de hoy y dicen hasta qué día llegan", async () => {
    await run("copec", { startedAt: hoursAgo(1) })
    await run("aramco", { startedAt: hoursAgo(1) })

    const statuses = await getFuelSourceStatuses(global(), monthPeriod)
    for (const key of ["copec", "aramco"]) {
      const source = byKey(statuses, key)!
      expect(source).toMatchObject({ status: "ok", statusLabel: "Al día", problem: null })
      expect(source.completeUntil).toBe(todayInChile())
      expect(source.lastUpdateAt).not.toBeNull()
    }
    expect(summarizeFuelSources(statuses.filter((status) => ["copec", "aramco"].includes(status.key))).ready).toBe(true)
  })

  it("Aramco lleva «Cambiar en Ajustes» junto a la sincronización automática sólo para quien administra integraciones y con credenciales", async () => {
    await run("aramco", { startedAt: hoursAgo(1) })
    const fact = (statuses: Awaited<ReturnType<typeof getFuelSourceStatuses>>) => byKey(statuses, "aramco")!.facts.find((item) => item.label === "Sincronización automática")!

    // Con el permiso de administrar integraciones el estado trae su enlace a Ajustes.
    const manager = session({ global: true, permissions: [...ALL_PERMISSIONS, "combustibles:manage_integrations"] })
    expect(fact(await getFuelSourceStatuses(manager, monthPeriod))).toMatchObject({ value: "Apagada", href: "/combustibles/ajustes/integraciones", hrefLabel: "Cambiar en Ajustes" })

    // Quien sólo sincroniza ve el estado, no un enlace a una pantalla que no puede abrir.
    expect(fact(await getFuelSourceStatuses(global(), monthPeriod)).href).toBeUndefined()

    // Sin credenciales no hay nada que activar: el estado lo dice y la fila ya manda a configurarlas.
    const password = process.env.ARAMCO_PASSWORD
    delete process.env.ARAMCO_PASSWORD
    try {
      expect(fact(await getFuelSourceStatuses(manager, monthPeriod))).toMatchObject({ value: "Sin credenciales" })
      expect(fact(await getFuelSourceStatuses(manager, monthPeriod)).href).toBeUndefined()
    } finally {
      process.env.ARAMCO_PASSWORD = password
    }
  })

  it("una fuente sin corrida en dos días o más queda pendiente y lo dice en una frase", async () => {
    await run("copec", { startedAt: daysAgo(4) })
    await run("aramco", { startedAt: daysAgo(1) })

    const statuses = await getFuelSourceStatuses(global(), monthPeriod)
    const copec = byKey(statuses, "copec")!
    expect(copec.status).toBe("pendiente")
    expect(copec.statusLabel).toMatch(/^Sin actualizar desde el /)
    expect(copec.problem).toMatch(/Hace 4 días que no llegan datos de Copec/)
    // Ayer todavía es «Hasta ayer»: el cron diario puede no haber corrido aún.
    expect(byKey(statuses, "aramco")).toMatchObject({ status: "ok", statusLabel: "Hasta ayer" })

    const { ready, pending } = summarizeFuelSources(statuses.filter((status) => ["copec", "aramco"].includes(status.key)))
    expect(ready).toBe(false)
    expect(pending.map((status) => status.key)).toEqual(["copec"])
    expect(describeFuelSources(statuses, monthPeriod)).toMatch(/^Falta resolver en (una fuente|\d+ fuentes):$/)
  })

  it("una corrida fallida es «falla» y conserva hasta cuándo llegan los datos buenos", async () => {
    await run("aramco", { startedAt: daysAgo(1) })
    await run("aramco", { startedAt: hoursAgo(2), status: "failed", error: "El portal de Aramco no respondió" })

    const aramco = byKey(await getFuelSourceStatuses(global(), monthPeriod), "aramco")!
    expect(aramco.status).toBe("falla")
    expect(aramco.statusLabel).toMatch(/^Falló hoy a las \d{2}:\d{2}$/)
    expect(aramco.problem).toMatch(/El portal de Aramco no respondió/)
    expect(aramco.problem).toMatch(/Los datos llegan hasta ayer/)
  })

  it("no deja pasar a la pantalla una consulta SQL guardada como error de la corrida", async () => {
    await run("copec", { startedAt: hoursAgo(1), status: "failed", error: "Failed query: insert into \"system_settings\"\nparams: x" })
    const copec = byKey(await getFuelSourceStatuses(global(), monthPeriod), "copec")!
    expect(copec.status).toBe("falla")
    expect(copec.problem).not.toMatch(/Failed query|params:/)
  })

  it("las filas pendientes por patente sin vincular dejan la fuente pendiente aunque haya llegado hoy", async () => {
    await run("copec", { startedAt: hoursAgo(1), rowsPending: 28 })
    const copec = byKey(await getFuelSourceStatuses(global(), monthPeriod), "copec")!
    expect(copec.status).toBe("pendiente")
    expect(copec.statusLabel).toBe("Al día · 28 por vincular")
    expect(copec.problem).toMatch(/28 cargas tienen una patente que no está en la flota/)
  })

  it("el 412 crudo que Aramco dejó guardado se muestra traducido y con su fecha", async () => {
    await run("aramco", { startedAt: hoursAgo(1), status: "failed", error: 'Aramco respondió 412 en users/authenticatecredential: { "validations": [ { "type": "LimitAttemptsReached", "message": "Límite de intentos alcanzado. Usuario bloqueado." } ] }' })
    const aramco = byKey(await getFuelSourceStatuses(global(), monthPeriod), "aramco")!
    expect(aramco.problem).toMatch(/^Falló hoy a las \d\d:\d\d: La cuenta de Aramco está bloqueada por exceso de intentos\./)
    expect(aramco.problem).not.toMatch(/validations|LimitAttemptsReached|412/)
  })

  it("con las filas pendientes en el ledger, el aviso nombra la tarjeta y la patente", async () => {
    const runId = await run("copec", { startedAt: hoursAgo(1), rowsPending: 3, requestedFrom: "2026-01-01" })
    const pending = (account: string, plate: string, day: string) => ({
      id: nanoid(), syncRunId: runId, provider: "copec", sourceAccount: account, identityKey: nanoid(), fingerprint: nanoid(),
      sourceRowKey: nanoid(), sourcePlate: plate, occurredAt: `2026-01-${day}T12:00:00.000Z`, quantity: 600, amount: 570000,
      status: "pending", resolutionCode: "unresolved_mapping", payloadHash: nanoid(),
    })
    await inMemoryDb.insert(schema.fuelProviderTransactions).values([
      pending("tae:diesel", "1-242269-00258-9-8", "02"),
      pending("tae:diesel", "1-242269-00258-9-8", "09"),
      pending("tct:diesel", "AB-CD12", "05"),
    ])
    const copec = byKey(await getFuelSourceStatuses(global(), monthPeriod), "copec")!
    expect(copec.problem).toBe("3 cargas quedaron pendientes en enero: tarjeta de abastecimiento 1-242269-00258-9-8 (2 cargas, sin estanque activo) y patente AB-CD12 (1, sin vehículo o asignación). No se importan hasta resolverlo.")
    // El enlace a Estanques sólo para quien puede entrar ahí.
    expect(copec.problemLink).toBeUndefined()
    const admin = byKey(await getFuelSourceStatuses(session({ global: true, permissions: [...ALL_PERMISSIONS, "admin:fleet_catalog"] }), monthPeriod), "copec")!
    expect(admin.problemLink).toEqual({ href: "/admin/flota-catalogos/estanques-combustible", label: "Ir a Estanques de combustible" })
  })

  it("en un período cerrado, un mes sin cobertura completa de Copec queda «Falta cerrar» y luego «Completa»", async () => {
    await run("copec", { startedAt: hoursAgo(1) })
    const pending = byKey(await getFuelSourceStatuses(global(), pastPeriod), "copec")!
    expect(pending.status).toBe("pendiente")
    expect(pending.statusLabel).toMatch(/^Falta cerrar /)
    expect(pending.problem).toMatch(/no está completo en Copec/)
    expect(pending.completeUntil).toBeNull()

    for (const [channel, product] of [["TCT", "diesel"], ["TCT", "bluemax"], ["TAE", "diesel"], ["TAE", "bluemax"]] as const) {
      await inMemoryDb.insert(schema.fuelProviderPeriodCoverage).values({
        id: nanoid(), provider: "copec", sourceAccount: `${channel.toLowerCase()}:${product}`, channel, product,
        periodMonth: `${pastPeriod.from.slice(0, 7)}-01`, status: "complete", sourceAvailability: "available",
      })
    }
    const done = byKey(await getFuelSourceStatuses(global(), pastPeriod), "copec")!
    expect(done).toMatchObject({ status: "ok", statusLabel: "Completa", problem: null })
    expect(done.completeUntil).toBe(pastPeriod.to)
  })

  it("sin corridas ni cron, la fuente dice «Sin sincronizar» y no cuenta como pendiente", async () => {
    const copec = byKey(await getFuelSourceStatuses(global(), monthPeriod), "copec")!
    expect(copec).toMatchObject({ status: "sin_datos", statusLabel: "Sin sincronizar" })
    expect(summarizeFuelSources([copec]).pending).toHaveLength(0)
  })

  it("un cron que falló antes de registrar corrida (sin credenciales, portal caído) aparece como falla", async () => {
    await inMemoryDb.insert(schema.cronRuns).values({ id: nanoid(), jobName: "fuel-copec-sync", startedAt: hoursAgo(1), outcome: "failed", detail: "Faltan las credenciales de Copec" })
    const copec = byKey(await getFuelSourceStatuses(global(), monthPeriod), "copec")!
    expect(copec.status).toBe("falla")
    // Con cuándo falló adelante, para no leer un error viejo como de hoy.
    expect(copec.problem).toBe("Falló hoy a las 12:00: Faltan las credenciales de Copec")
  })

  it("la planilla de cargas informa el último archivo y las patentes sin vincular, y sólo la ve un rol global", async () => {
    const batchId = nanoid()
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "consolidado_oct.xlsx", hashArchivo: nanoid(), estado: "importado", periodoDesde: "2026-10-01", periodoHasta: "2026-10-28",
      totalFilas: 1252, filasValidas: 1240, filasInvalidas: 12, totalEquipos: 40, importadoPor: userId,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      { id: nanoid(), batchId, vehicleId: vehicleA, plate: "AAAA11", fecha: "2026-10-02", liters: 40 },
      { id: nanoid(), batchId, vehicleId: null, plate: "TR-01", fecha: "2026-10-03", liters: 30 },
      { id: nanoid(), batchId, vehicleId: null, plate: "TR-01", fecha: "2026-10-04", liters: 30 },
    ])

    const planilla = byKey(await getFuelSourceStatuses(global(), monthPeriod), "planilla")!
    expect(planilla.status).toBe("pendiente")
    expect(planilla.problem).toBe("El último archivo tiene 1 patente sin vincular a un equipo.")
    expect(planilla.facts).toContainEqual({ label: "Último archivo", value: "consolidado_oct.xlsx · 1.240 filas" })
    expect(planilla.facts).toContainEqual({ label: "Rechazadas", value: "12, descargables en Excel" })
    expect(planilla.facts).toContainEqual({ label: "Cubre hasta", value: "28-10-2026" })

    const scoped = session({ global: false, permissions: ALL_PERMISSIONS, worksiteIds: [worksiteA] })
    expect(byKey(await getFuelSourceStatuses(scoped, monthPeriod), "planilla")).toBeUndefined()
  })

  it("una fuente activa sin datos de un período cerrado queda pendiente; en el período en curso sólo se avisa", async () => {
    const older = describeFuelPeriod(shiftFuelPeriod(shiftFuelPeriod(currentMonthPeriod(), -1), -1), "url")
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: nanoid(), archivoNombre: "consolidado_viejo.xlsx", hashArchivo: nanoid(), estado: "importado", periodoDesde: older.from, periodoHasta: older.to,
      totalFilas: 10, filasValidas: 10, filasInvalidas: 0, totalEquipos: 2, importadoPor: userId,
    })

    const closed = byKey(await getFuelSourceStatuses(global(), pastPeriod), "planilla")!
    expect(closed).toMatchObject({ status: "pendiente", statusLabel: `Sin datos en ${pastPeriod.inLabel}`, problem: `No trajo datos en ${pastPeriod.inLabel}.` })

    const current = byKey(await getFuelSourceStatuses(global(), monthPeriod), "planilla")!
    expect(current).toMatchObject({ status: "ok", statusLabel: `Todavía sin datos en ${monthPeriod.inLabel}`, missingInPeriod: true })
    // Una fuente que nunca trajo nada no está en uso: no se marca como faltante.
    expect(byKey(await getFuelSourceStatuses(global(), pastPeriod), "telemetria")).toMatchObject({ status: "sin_datos" })
  })

  it("un lote revertido no cuenta como la última planilla", async () => {
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: nanoid(), archivoNombre: "revertido.xlsx", hashArchivo: nanoid(), estado: "revertido", periodoDesde: "2026-10-01", periodoHasta: "2026-10-28", importadoPor: userId,
    })
    expect(byKey(await getFuelSourceStatuses(global(), monthPeriod), "planilla")).toMatchObject({ status: "sin_datos", statusLabel: "Sin archivos" })
  })

  it("alcance: un rol acotado que sólo importa ve los reportes de su faena, sin el detalle de la integración", async () => {
    await inMemoryDb.insert(schema.fuelImportBatches).values([
      { id: nanoid(), worksiteId: worksiteA, fuente: "Copec", periodoDesde: "2026-10-01", periodoHasta: "2026-10-15", archivoNombre: "a.xlsx", hashArchivo: nanoid(), importadoPor: userId },
      { id: nanoid(), worksiteId: worksiteB, fuente: "Aramco Fleet Diesel", periodoDesde: "2026-10-01", periodoHasta: "2026-10-20", archivoNombre: "b.xlsx", hashArchivo: nanoid(), importadoPor: userId },
    ])
    // La integración corrió hoy, pero esta persona no la administra.
    await run("copec", { startedAt: hoursAgo(1), rowsPending: 5 })

    const scoped = session({ global: false, permissions: ["combustibles:view", "combustibles:import"], worksiteIds: [worksiteA] })
    const statuses = await getFuelSourceStatuses(scoped, monthPeriod)
    expect(byKey(statuses, "copec")).toMatchObject({ status: "ok", problem: null, technical: [] })
    expect(byKey(statuses, "copec")!.facts).toEqual([{ label: "Último reporte", value: "hasta el 15-10-2026" }])
    // El único reporte de Aramco es de la otra faena.
    expect(byKey(statuses, "aramco")).toMatchObject({ status: "sin_datos", statusLabel: "Sin reportes" })
    expect(byKey(statuses, "planilla")).toBeUndefined()
    expect(byKey(statuses, "terreno")).toBeUndefined()
    expect(byKey(statuses, "historico-sellos")).toBeUndefined()
    expect(byKey(statuses, "facturas")).toBeUndefined()
  })

  it("sin ningún permiso del módulo no se devuelve ninguna fuente", async () => {
    const nobody = session({ global: false, permissions: ["combustibles:view"], worksiteIds: [worksiteA] })
    expect(await getFuelSourceStatuses(nobody, monthPeriod)).toEqual([])
  })

  it("telemetría y surtidor: el último día con datos y el alcance por faena del equipo", async () => {
    await inMemoryDb.insert(schema.fuelTelemetryDaily).values([
      { id: nanoid(), vehicleId: vehicleA, source: "visionlink", day: "2026-10-10", month: "2026-10", operatingHours: 8, idleHours: 2 },
      { id: nanoid(), vehicleId: vehicleB, source: "visionlink", day: "2026-10-20", month: "2026-10", operatingHours: 8, idleHours: 2 },
    ])
    await inMemoryDb.insert(schema.fuelSupplyInputs).values({
      id: nanoid(), supplyMediumId: mediumId, worksiteId: worksiteB, occurredAt: "2026-10-18T15:00:00.000Z", month: "2026-10", liters: 100, reference: nanoid(),
    })

    const all = await getFuelSourceStatuses(global(), monthPeriod)
    expect(byKey(all, "telemetria")!.facts).toContainEqual({ label: "Último día con datos", value: "20-10-2026" })
    expect(byKey(all, "telemetria")!.statusLabel).toBe("Hasta el 20 oct")
    expect(byKey(all, "surtidor")!.facts).toContainEqual({ label: "Último despacho", value: "18-10-2026" })

    const scoped = session({ global: false, permissions: ["combustibles:view", "combustibles:import"], worksiteIds: [worksiteA] })
    const mine = await getFuelSourceStatuses(scoped, monthPeriod)
    expect(byKey(mine, "telemetria")!.facts).toContainEqual({ label: "Último día con datos", value: "10-10-2026" })
    expect(byKey(mine, "surtidor")).toMatchObject({ statusLabel: "Sin despachos" })
  })

  it("con VisionLink activo, la telemetría atrasada es pendiente y dice qué días faltan", async () => {
    process.env.VISIONLINK_CLIENT_ID = "id"
    process.env.VISIONLINK_CLIENT_SECRET = "secreto"
    process.env.VISIONLINK_SYNC_ENABLED = "true"
    try {
      const old = todayInChile(new Date(Date.now() - 6 * 86_400_000))
      await inMemoryDb.insert(schema.fuelTelemetryDaily).values({ id: nanoid(), vehicleId: vehicleA, source: "visionlink-api", day: old, month: old.slice(0, 7), operatingHours: 8, idleHours: 1 })
      const telemetry = byKey(await getFuelSourceStatuses(global(), monthPeriod), "telemetria")!
      expect(telemetry.status).toBe("pendiente")
      expect(telemetry.problem).toMatch(/^Faltan los datos del /)
    } finally {
      delete process.env.VISIONLINK_CLIENT_ID
      delete process.env.VISIONLINK_CLIENT_SECRET
      delete process.env.VISIONLINK_SYNC_ENABLED
    }
  })

  it("formulario en terreno: cuenta las cargas del período y las que faltan por validar, acotado por faena", async () => {
    const pointA = nanoid()
    await inMemoryDb.insert(schema.fuelTaeLoadingPoints).values({ id: pointA, worksiteId: worksiteA, name: "Surtidor Norte" })
    const loadedAt = hoursAgo(3)
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([
      { id: nanoid(), clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32), worksiteId: worksiteA, loadingPointId: pointA, vehicleId: vehicleA, productId, equipmentCodeSnapshot: "KA-1", loadedAt, submittedAt: loadedAt, driverNameSnapshot: "C", supervisorNameSnapshot: "S", meterType: "odometer", liters: 40, status: "submitted" },
      { id: nanoid(), clientSubmissionId: nanoid(), source: "internal_app", publicResultToken: nanoid(32), worksiteId: worksiteA, vehicleId: vehicleA, productId, equipmentCodeSnapshot: "KA-1", loadedAt, submittedAt: loadedAt, driverNameSnapshot: "C", supervisorNameSnapshot: "S", meterType: "odometer", liters: 20, status: "validated" },
      { id: nanoid(), clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32), worksiteId: worksiteB, vehicleId: vehicleB, productId, equipmentCodeSnapshot: "KB-1", loadedAt, submittedAt: loadedAt, driverNameSnapshot: "C", supervisorNameSnapshot: "S", meterType: "odometer", liters: 30, status: "submitted" },
    ])

    const all = byKey(await getFuelSourceStatuses(global(), monthPeriod), "terreno")!
    expect(all.status).toBe("ok")
    expect(all.facts).toContainEqual({ label: "Por validar", value: "2 cargas" })
    expect(all.statusLabel).toMatch(/^3 cargas /)

    const scoped = session({ global: false, permissions: ["combustibles:view", "combustibles:tae_view"], worksiteIds: [worksiteA] })
    const mine = byKey(await getFuelSourceStatuses(scoped, monthPeriod), "terreno")!
    expect(mine.facts).toContainEqual({ label: "Por validar", value: "1 carga" })
    expect(mine.facts).toContainEqual({ label: "Puntos de carga activos", value: "1 en 1 faena" })
    expect(mine.statusLabel).toMatch(/^2 cargas /)
  })

  it("facturas: sólo con costos, y cuenta las del período", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: nanoid(), loadDate: `${monthPeriod.from.slice(0, 7)}-02`, month: monthPeriod.from.slice(0, 7), serviceType: "TCT", vehicleId: vehicleA, fuelSupplierId: supplierId,
      worksiteId: worksiteA, product: "PETROLEO DIESEL", productId, liters: 100, baseAmount: 1000, totalAmount: 1190, createdBy: userId,
    })
    const facturas = byKey(await getFuelSourceStatuses(global(), monthPeriod), "facturas")!
    expect(facturas).toMatchObject({ status: "ok" })
    expect(facturas.statusLabel).toMatch(/^1 factura /)

    const noCosts = session({ global: true, permissions: ["combustibles:view", "combustibles:import"] })
    expect(byKey(await getFuelSourceStatuses(noCosts, monthPeriod), "facturas")).toBeUndefined()
  })

  it("histórico de sellos: el último lote importado con sus filas", async () => {
    await inMemoryDb.insert(schema.fuelTaeImportBatches).values({ id: nanoid(), fileName: "sellos_2025_2026.xlsx", fileHash: nanoid(), status: "imported", totalRows: 3900, validRows: 3800, observedRows: 80, invalidRows: 20, importedBy: userId })
    const source = byKey(await getFuelSourceStatuses(global(), monthPeriod), "historico-sellos")!
    expect(source.status).toBe("ok")
    expect(source.facts).toContainEqual({ label: "Último archivo", value: "sellos_2025_2026.xlsx · 3.880 filas" })
  })
})

/** «Archivos importados»: los lotes de las cuatro tablas en una lista, con el alcance de cada tipo. */
describe("archivos importados (PostgreSQL)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const ana = nanoid()
  const beto = nanoid()
  const typeId = nanoid()
  const vehicleA = nanoid()
  const vehicleB = nanoid()
  const productId = nanoid()
  const sealBatchA = nanoid()
  const sealBatchB = nanoid()

  beforeAll(async () => {
    // El bloque anterior deja lotes propios: esta lista se prueba con lo que se inserta acá.
    await inMemoryDb.delete(schema.fuelTaeSubmissions)
    await inMemoryDb.delete(schema.fuelTaeImportBatches)
    await inMemoryDb.delete(schema.fuelImportBatches)
    await inMemoryDb.delete(schema.fuelOperationRecords)
    await inMemoryDb.delete(schema.fuelOperationBatches)
    await inMemoryDb.delete(schema.fuelControlImportBatches)
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena Norte", code: `FN-${nanoid().slice(0, 6)}`, isActive: true },
      { id: worksiteB, name: "Faena Sur", code: `FS-${nanoid().slice(0, 6)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values([
      { id: ana, name: "Ana Soto", email: `ana-${nanoid()}@example.com`, hashedPassword: "x", isActive: true },
      { id: beto, name: "Beto Rojas", email: `beto-${nanoid()}@example.com`, hashedPassword: "x", isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: typeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: vehicleA, plate: `TA${nanoid().slice(0, 4).toUpperCase()}`, code: "KA-1", type: "camion", equipmentTypeId: typeId, worksiteId: worksiteA, isActive: true },
      { id: vehicleB, plate: `TB${nanoid().slice(0, 4).toUpperCase()}`, code: "KB-1", type: "camion", equipmentTypeId: typeId, worksiteId: worksiteB, isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })

    await inMemoryDb.insert(schema.fuelImportBatches).values([
      { id: "t-a", worksiteId: worksiteA, fuente: "Copec TCT Diesel", periodoDesde: "2026-10-01", periodoHasta: "2026-10-31", archivoNombre: "copec-a.xlsx", hashArchivo: "h1", importadoPor: ana, filasValidas: 30, filasInvalidas: 1, createdAt: "2026-10-30T09:00:00.000Z" },
      { id: "t-b", worksiteId: worksiteB, fuente: "Aramco Fleet Diesel", periodoDesde: "2026-10-01", periodoHasta: "2026-10-31", archivoNombre: "aramco-b.xlsx", hashArchivo: "h2", importadoPor: beto, filasValidas: 12, estado: "revertido", createdAt: "2026-10-28T09:00:00.000Z" },
    ])
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: "p-1", archivoNombre: "consolidado.xlsx", hashArchivo: "h3", periodoDesde: "2026-10-01", periodoHasta: "2026-10-28", importadoPor: ana, filasValidas: 1240, filasInvalidas: 12, createdAt: "2026-10-29T09:00:00.000Z",
    })
    await inMemoryDb.insert(schema.fuelControlImportBatches).values([
      { id: "c-ana", kind: "telemetry", fileName: "visionlink.xlsx", fileHash: "h4", totalRows: 600, insertedRows: 580, updatedRows: 10, rejectedRows: 10, importedBy: ana, createdAt: "2026-10-27T09:00:00.000Z" },
      { id: "c-beto", kind: "supply_inputs", fileName: "despachos.xlsx", fileHash: "h5", totalRows: 86, insertedRows: 86, importedBy: beto, createdAt: "2026-10-26T09:00:00.000Z" },
    ])
    await inMemoryDb.insert(schema.fuelTaeImportBatches).values([
      { id: sealBatchA, fileName: "sellos-a.xlsx", fileHash: "h6", status: "imported", totalRows: 10, validRows: 9, observedRows: 1, invalidRows: 0, importedBy: ana, createdAt: "2026-10-25T09:00:00.000Z" },
      { id: sealBatchB, fileName: "sellos-b.xlsx", fileHash: "h7", status: "imported", totalRows: 10, validRows: 10, observedRows: 0, invalidRows: 0, importedBy: ana, createdAt: "2026-10-24T09:00:00.000Z" },
    ])
    const submission = (batchId: string, worksiteId: string, vehicleId: string) => ({
      id: nanoid(), clientSubmissionId: nanoid(), source: "legacy_xlsx", importBatchId: batchId, publicResultToken: nanoid(32), worksiteId, vehicleId, productId,
      equipmentCodeSnapshot: "K-1", loadedAt: "2026-09-01T12:00:00.000Z", submittedAt: "2026-09-01T12:00:00.000Z", driverNameSnapshot: "C", supervisorNameSnapshot: "S",
      meterType: "odometer", liters: 40, status: "validated", loadedAtSource: "import",
    })
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([submission(sealBatchA, worksiteA, vehicleA), submission(sealBatchB, worksiteB, vehicleB)])
  })

  const full = ["combustibles:view", "combustibles:import", "combustibles:tae_import", "combustibles:revert"]
  const globalSession = () => session({ global: true, permissions: full })

  it("un rol global ve los cinco tipos en una lista, del más nuevo al más antiguo, con quién y cuánto trajo", async () => {
    const page = await listImportedFiles(globalSession(), { limit: 25 })
    expect(page.visibleKinds).toEqual(["tarjeta", "planilla", "telemetria", "surtidor", "sellos"])
    expect(page.rows.map((row) => row.fileName)).toEqual(["copec-a.xlsx", "consolidado.xlsx", "aramco-b.xlsx", "visionlink.xlsx", "despachos.xlsx", "sellos-a.xlsx", "sellos-b.xlsx"])
    expect(page.total).toBe(7)
    expect(page.counts).toEqual({ tarjeta: 2, planilla: 1, telemetria: 1, surtidor: 1, sellos: 2 })

    const planilla = page.rows.find((row) => row.kind === "planilla")!
    expect(planilla).toMatchObject({ newRows: 1240, rejectedRows: 12, importedBy: "Ana Soto", status: "importado", href: expect.stringMatching(/\/fuentes\/archivos\/planilla\/p-1$/), canRevert: true })
    const telemetry = page.rows.find((row) => row.kind === "telemetria")!
    // Las importaciones del control se muestran en línea: no tienen ficha propia.
    expect(telemetry).toMatchObject({ newRows: 580, updatedRows: 10, rejectedRows: 10, href: null })
    const card = page.rows.find((row) => row.id === "t-a")!
    expect(card).toMatchObject({ worksite: "Faena Norte", source: "Copec TCT Diesel", period: { from: "2026-10-01", to: "2026-10-31" } })
  })

  it("filtra por tipo y por estado, y un archivo revertido no ofrece «Revertir»", async () => {
    const onlyCards = await listImportedFiles(globalSession(), { kind: "tarjeta", limit: 25 })
    expect(onlyCards.rows.map((row) => row.id)).toEqual(["t-a", "t-b"])
    expect(onlyCards.total).toBe(2)

    const reverted = await listImportedFiles(globalSession(), { status: "revertido", limit: 25 })
    expect(reverted.rows.map((row) => row.id)).toEqual(["t-b"])
    expect(reverted.rows[0]).toMatchObject({ status: "revertido", canRevert: false })
    expect(reverted.counts.tarjeta).toBe(1)
  })

  it("pagina: la segunda página sigue donde terminó la primera y el total no depende de la página", async () => {
    const first = await listImportedFiles(globalSession(), { limit: 3 })
    const second = await listImportedFiles(globalSession(), { limit: 3, offset: 3 })
    expect(first.rows).toHaveLength(3)
    expect(second.rows).toHaveLength(3)
    expect(new Set([...first.rows, ...second.rows].map((row) => row.key)).size).toBe(6)
    expect(first.total).toBe(second.total)
    expect((await countImportedFiles(globalSession(), {})).total).toBe(7)
  })

  it("sin el permiso de revertir no se ofrece «Revertir» en ningún archivo", async () => {
    const page = await listImportedFiles(session({ global: true, permissions: ["combustibles:view", "combustibles:import", "combustibles:tae_import"] }), { limit: 25 })
    expect(page.rows.length).toBeGreaterThan(0)
    expect(page.rows.every((row) => row.canRevert === false)).toBe(true)
  })

  it("alcance: un rol acotado sólo ve los reportes de su faena y lo que él importó; nunca la planilla", async () => {
    const scoped = session({ global: false, permissions: ["combustibles:view", "combustibles:import", "combustibles:revert"], worksiteIds: [worksiteA] })
    expect(visibleImportedFileKinds(scoped)).toEqual(["tarjeta", "telemetria", "surtidor"])
    const page = await listImportedFiles(scoped, { limit: 25 })
    // `session()` fija el id del usuario acotado en «user-scoped»: ninguno de los archivos del control es suyo.
    expect(page.rows.map((row) => row.id)).toEqual(["t-a"])
    expect(page.counts).toEqual({ tarjeta: 1, telemetria: 0, surtidor: 0 })
    expect(page.rows.some((row) => row.kind === "planilla" || row.kind === "sellos")).toBe(false)
  })

  it("alcance: un lote de sellos sólo aparece a un rol acotado si trae cargas de sus faenas", async () => {
    const scoped = session({ global: false, permissions: ["combustibles:tae_import"], worksiteIds: [worksiteA] })
    expect(visibleImportedFileKinds(scoped)).toEqual(["sellos"])
    const page = await listImportedFiles(scoped, { limit: 25 })
    expect(page.rows.map((row) => row.fileName)).toEqual(["sellos-a.xlsx"])
    // Para un rol acotado las cifras del archivo completo no se publican.
    expect(page.rows[0]).toMatchObject({ newRows: 1, rejectedRows: null })
    expect(page.counts.sellos).toBe(1)
  })

  it("quien sólo sincroniza integraciones ve los reportes de tarjeta y nada más", async () => {
    const syncOnly = session({ global: true, permissions: ["combustibles:sync_integrations"] })
    expect(visibleImportedFileKinds(syncOnly)).toEqual(["tarjeta"])
    expect(await visibleImportedFileKinds(session({ global: true, permissions: ["combustibles:view"] }))).toEqual([])
  })
})

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { computeRutDv } from "@/lib/rut"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { TalanaAbsenceRow, TalanaClient, TalanaContractRow, TalanaListResult } from "@/lib/integrations/talana/talana-client"

// Todo inventado: RUT con dígito verificador válido y nombres que no son de nadie.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en tiempo de ejecución
testGlobal.__db = inMemoryDb
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const mocks = vi.hoisted(() => ({
  entered: vi.fn(async (_events: unknown, _userId: string | null) => ({})),
  organization: vi.fn(async (_worksiteIds: string[]) => ({})),
  notify: vi.fn(async (_userIds: string[], _input: unknown) => {}),
}))
vi.mock("@/lib/services/pdtp-adapters/worker-lifecycle-connector", () => ({ onWorkerEnteredDotacion: mocks.entered }))
vi.mock("@/lib/services/pdtp-adapters/preventive-organization-connector", () => ({ evaluateWorksitePreventiveOrganization: mocks.organization }))
vi.mock("@/lib/services/notification-create", () => ({ createNotifications: mocks.notify }))
vi.mock("@/lib/services/notification-targeting", () => ({ getGlobalUserIdsWithPermission: async () => ["u-hr"] }))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const sync = () => import("@/lib/integrations/talana/talana-sync")

const rut = (body: string) => `${body}-${computeRutDv(body)}`
const R = {
  nuevo: rut("90000001"), antiguo: rut("90000002"), vacio: rut("90000003"), otraFaena: rut("90000004"),
  finiquito: rut("90000005"), recontratado: rut("90000006"), plazo: rut("90000007"), ajeno: rut("90000008"), jefe: rut("90000009"),
}
const NOW = new Date("2026-11-08T12:00:00Z")
const EMPLOYER = "SERVICIOS INDUSTRIALES CHOME LTDA"

let contractId = 1
function contract(rutValue: string, extra: Partial<TalanaContractRow> = {}): TalanaContractRow {
  return {
    id: contractId++, personId: null, rut: rutValue, rutValid: true, firstName: "PERSONA", lastNamePaternal: "PRUEBA",
    lastNameMaternal: rutValue.slice(0, 8), sex: "M", employerName: EMPLOYER, contractType: "Indefinido", cargo: "CHOFER",
    costCenterId: 1, costCenterName: "BIODIVERSA", jefeRut: R.jefe, jefeName: "JEFA PRUEBA", hiredOn: "2024-01-10",
    startsOn: "2024-01-10", endsOn: null, finiquitado: false, active: true, modifiedAt: null, ...extra,
  }
}

const list = <T,>(rows: T[]): TalanaListResult<T> => ({ rows, rejected: 0, declaredCount: rows.length, pages: 1, truncated: false })

function fakeClient(contracts: TalanaContractRow[], activeIds: Set<number>, absences: TalanaAbsenceRow[] = []): TalanaClient {
  return {
    listContracts: async ({ onlyActive }) => list(onlyActive ? contracts.filter((row) => activeIds.has(row.id)) : contracts),
    listAbsences: async () => list(absences),
  }
}

let CONTRACTS: TalanaContractRow[] = []
let ACTIVE = new Set<number>()

function scenario() {
  contractId = 1
  const rows = [
    contract(R.jefe, { firstName: "JEFA", lastNamePaternal: "PRUEBA", lastNameMaternal: "UNO", jefeRut: null, jefeName: null, cargo: "ADMINISTRADOR DE CONTRATO" }),
    contract(R.nuevo, { hiredOn: "2026-10-25", startsOn: "2026-10-25", sex: "F", firstName: "NUEVA" }),
    contract(R.antiguo, { firstName: "ANTIGUO", cargo: "OPERADOR" }),
    contract(R.vacio),
    contract(R.otraFaena, { costCenterId: 2, costCenterName: "MASISA TABLEROS" }),
    contract(R.finiquito, { finiquitado: true, endsOn: "2026-10-01", active: false }),
    contract(R.recontratado, { finiquitado: true, endsOn: "2026-09-01", active: false }),
    contract(R.plazo, { contractType: "Plazo Fijo", endsOn: "2026-10-23", active: false }),
  ]
  CONTRACTS = rows
  ACTIVE = new Set(rows.filter((row) => row.active).map((row) => row.id))
}

async function run(mode: "simulate" | "apply", client = fakeClient(CONTRACTS, ACTIVE)) {
  const { runTalanaSync } = await sync()
  return runTalanaSync({ trigger: "manual", mode, token: "t", client, now: NOW })
}

const worker = async (rutValue: string) => (await inMemoryDb.select().from(schema.workers).where(eq(schema.workers.rut, rutValue)))[0]
const auditCount = async () => (await inMemoryDb.select().from(schema.auditLog)).length

beforeEach(async () => {
  mocks.entered.mockClear()
  mocks.organization.mockClear()
  mocks.notify.mockClear()
  await pg.exec(`TRUNCATE talana_sync_run_items, talana_sync_runs, talana_contracts, talana_worker_links, talana_absences,
    audit_log, worker_position_history, deliveries, workers, worksites, users, system_settings CASCADE`)
  await pg.exec("DELETE FROM worker_positions WHERE is_system = false")
  scenario()
  await inMemoryDb.insert(schema.users).values({ id: "u-bodega", name: "Bodega", email: "bodega@chome.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "w-bio", name: "Biodiversa", code: "BIODIVERSA", isActive: true },
    { id: "w-mas", name: "Masisa", code: "MASISA", isActive: true },
  ])
  const { normalizeWorkerPositionKey } = await import("@/lib/services/worker-positions/normalization")
  await inMemoryDb.insert(schema.workerPositions).values(["Conductor de camión", "Operador de maquinaria", "Administrador de contrato", "Supervisor"].map((name, i) => ({
    id: `pos-${i}`, code: `TEST-${i}`, name, normalizedKey: normalizeWorkerPositionKey(name), needsReview: false,
  })))
  const common = { isActive: true, positionId: "worker-position-unclassified", position: "Sin clasificar", worksiteId: "w-bio", createdAt: "2025-01-01T00:00:00Z" }
  await inMemoryDb.insert(schema.workers).values([
    { id: "wk-jefe", rut: R.jefe, firstName: "Jefa", lastName: "Prueba Uno", ...common, positionId: "pos-2", position: "Administrador de contrato", sex: "female" },
    { id: "wk-vacio", rut: R.vacio, firstName: "Persona", lastName: "Prueba Vacio", ...common },
    { id: "wk-faena", rut: R.otraFaena, firstName: "Persona", lastName: "Prueba Faena", ...common, positionId: "pos-0", position: "Conductor de camión", sex: "male", supervisor: "Jefa Prueba Uno" },
    { id: "wk-fin", rut: R.finiquito, firstName: "Persona", lastName: "Prueba Fin", ...common },
    { id: "wk-rec", rut: R.recontratado, firstName: "Persona", lastName: "Prueba Rec", ...common },
    { id: "wk-plazo", rut: R.plazo, firstName: "Persona", lastName: "Prueba Plazo", ...common },
    { id: "wk-ajeno", rut: R.ajeno, firstName: "Persona", lastName: "Prueba Ajeno", ...common },
  ])
  // Recontratado sin registrarlo en Talana: recibió EPP después del término.
  await inMemoryDb.insert(schema.deliveries).values({
    id: "d-1", code: "ENT-2026-0001", deliveredBy: "u-bodega", deliveredAt: "2026-10-20T15:00:00Z", destinationType: "worker", workerId: "wk-rec",
  })
})

describe("sincronización con Talana", () => {
  it("simular guarda la copia y el plan, sin tocar trabajadores ni auditoría", async () => {
    const before = await auditCount()
    const result = await run("simulate")
    expect(result.status).toBe("success")
    expect(result.counts).toMatchObject({ altas: 2, bajas: 1, cargos: 1, sexos: 1, jefes: 1 })
    expect(await worker(R.nuevo)).toBeUndefined()
    expect((await worker(R.finiquito))?.isActive).toBe(true)
    expect(await auditCount()).toBe(before)
    const stored = await inMemoryDb.select().from(schema.talanaContracts)
    expect(stored).toHaveLength(8)
    expect(stored.every((row) => row.activationProcessedAt === null)).toBe(true)
    const items = await inMemoryDb.select().from(schema.talanaSyncRunItems).where(eq(schema.talanaSyncRunItems.runId, result.runId))
    expect(items.every((item) => item.outcome === "planned" || item.outcome === "skipped")).toBe(true)
  })

  it("aplicar: altas, completar vacíos, bajas con guarda, y nada por ausencias", async () => {
    const result = await run("apply")
    expect(result.status).toBe("success")

    const nueva = await worker(R.nuevo)
    expect(nueva).toMatchObject({ isActive: true, worksiteId: "w-bio", positionId: "pos-0", sex: "female", supervisor: "Jefa Prueba Uno" })
    expect(await worker(R.antiguo)).toMatchObject({ isActive: true, positionId: "pos-1" })

    // Completa lo vacío; no mueve a quien está en otra faena.
    expect(await worker(R.vacio)).toMatchObject({ positionId: "pos-0", sex: "male", supervisor: "Jefa Prueba Uno" })
    expect(await worker(R.otraFaena)).toMatchObject({ worksiteId: "w-bio" })

    // Baja sólo con finiquito y sin actividad posterior.
    expect((await worker(R.finiquito))?.isActive).toBe(false)
    expect((await worker(R.recontratado))?.isActive).toBe(true)
    // Plazo vencido sin finiquito, y quien no está en Talana: nada.
    expect((await worker(R.plazo))?.isActive).toBe(true)
    expect((await worker(R.ajeno))?.isActive).toBe(true)

    // Auditoría como sistema, sin el valor del sexo; historial de cargo `system`.
    const audits = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "worker"))
    expect(audits.length).toBeGreaterThan(0)
    expect(audits.every((row) => row.userId === null && row.userEmail === "sistema@chome.cl")).toBe(true)
    expect(audits.some((row) => (row.newState ?? "").includes("\"sex\""))).toBe(false)
    const history = await inMemoryDb.select().from(schema.workerPositionHistory).where(eq(schema.workerPositionHistory.workerId, nueva!.id))
    expect(history[0]?.source).toBe("system")

    // PDTP: inducción sólo para el ingreso reciente; organización para todas las faenas tocadas.
    const entered = mocks.entered.mock.calls[0]?.[0] as Array<{ workerId: string; kind: string }> | undefined
    expect(entered?.map((event) => event.workerId)).toEqual([nueva!.id])
    expect(mocks.organization).toHaveBeenCalled()
  })

  it("una segunda corrida no escribe nada", async () => {
    await run("apply")
    const audits = await auditCount()
    const result = await run("apply")
    expect(result.counts).toMatchObject({ altas: 0, reactivaciones: 0, bajas: 0, traslados: 0, cargos: 0, jefes: 0, sexos: 0 })
    expect(await auditCount()).toBe(audits)
  })

  it("sigue un cambio de cargo de Talana, pero respeta una edición manual", async () => {
    await run("apply")
    // A mano: el antiguo pasa a Supervisor.
    await inMemoryDb.update(schema.workers).set({ positionId: "pos-3", position: "Supervisor" }).where(eq(schema.workers.rut, R.antiguo))
    CONTRACTS = CONTRACTS.map((row) => (row.rut === R.vacio || row.rut === R.antiguo ? { ...row, cargo: "SUPERVISOR DE FAENA" } : row))
    await run("apply")
    expect((await worker(R.vacio))?.positionId).toBe("pos-3")
    expect((await worker(R.antiguo))?.positionId).toBe("pos-3")
    CONTRACTS = CONTRACTS.map((row) => (row.rut === R.antiguo ? { ...row, cargo: "CHOFER" } : row))
    const result = await run("apply")
    // Chome todavía tenía lo que mapeaba la base (Supervisor): ahora sí sigue a Talana.
    expect((await worker(R.antiguo))?.positionId).toBe("pos-0")
    expect(result.counts.cargos).toBe(1)
  })

  it("no reactiva a quien se desactivó a mano después de sincronizar", async () => {
    await run("apply")
    await inMemoryDb.update(schema.workers).set({ isActive: false }).where(eq(schema.workers.rut, R.vacio))
    await run("apply")
    expect((await worker(R.vacio))?.isActive).toBe(false)
  })

  it("el fusible bloquea, no reemplaza la copia y avisa una vez", async () => {
    await run("apply")
    const result = await run("apply", fakeClient(CONTRACTS, new Set()))
    expect(result).toMatchObject({ status: "blocked", fusibleReason: "no_active_contracts" })
    const stillActive = await inMemoryDb.select().from(schema.talanaContracts).where(eq(schema.talanaContracts.listedActive, true))
    expect(stillActive.length).toBeGreaterThan(0)
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(mocks.notify.mock.calls[0]?.[1]).toMatchObject({ entityHref: "/admin/talana" })
    const [run1] = await inMemoryDb.select().from(schema.talanaSyncRuns).where(and(eq(schema.talanaSyncRuns.id, result.runId), eq(schema.talanaSyncRuns.status, "blocked")))
    expect(run1?.fusibleReason).toBe("no_active_contracts")
  })

  it("una descarga incompleta falla sin tocar nada", async () => {
    const broken: TalanaClient = {
      listContracts: async () => ({ ...list(CONTRACTS), declaredCount: 99 }),
      listAbsences: async () => list([]),
    }
    const { TalanaSyncFailure } = await sync()
    await expect(run("apply", broken)).rejects.toBeInstanceOf(TalanaSyncFailure)
    expect(await worker(R.nuevo)).toBeUndefined()
    const [last] = await inMemoryDb.select().from(schema.talanaSyncRuns)
    expect(last).toMatchObject({ status: "failed", errorCode: "TALANA_SNAPSHOT_INCOMPLETE" })
  })
})

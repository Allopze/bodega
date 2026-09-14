/**
 * TRB-001 / TIL-001 / E2E-007 (auditoría 2026-09-14): el sistema no tenía el
 * concepto de baja de una persona. Estas pruebas fijan lo que ahora sabe
 * responder en ese momento: qué queda abierto y de qué clase.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const {
  describeWorkerOffboarding,
  getWorkerOffboardingSummary,
  onlyItPendings,
} = await import("@/lib/services/worker-offboarding")

const USER = "user-off-1"
const WS = "ws-off-1"
const WORKER = "wk-off-1"
const NOW = "2026-09-14T12:00:00.000Z"

async function seed() {
  await testDb.insert(schema.users).values({
    id: USER, name: "Jefa TI", email: "jefa@off.cl", hashedPassword: "x", isActive: true,
  })
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Baja", code: "OFF", isActive: true })
  await testDb.insert(schema.workers).values({
    id: WORKER, rut: "9999999-9", firstName: "Pedro", lastName: "Rojas", worksiteId: WS, isActive: true,
  })
}

async function clearPendings() {
  await testDb.delete(schema.itAssetAssignments)
  await testDb.delete(schema.itSystemAccess)
  await testDb.delete(schema.itLicenseAssignments)
  await testDb.delete(schema.deliveryItems)
  await testDb.delete(schema.deliveries)
  await testDb.delete(schema.preventionPermitCrew)
  await testDb.delete(schema.preventionWorkPermits)
}

/** Un acta de asignación TI abierta (sin devolución registrada). */
async function giveAsset(code: string) {
  await testDb.insert(schema.itAssetTypes)
    .values({ id: `at-${code}`, name: `Tipo ${code}`, category: "computacion" })
    .onConflictDoNothing()
  await testDb.insert(schema.itAssets).values({
    id: `as-${code}`, code: `INV-${code}`, assetTypeId: `at-${code}`, status: "asignado", worksiteId: WS,
  })
  await testDb.insert(schema.itAssetAssignments).values({
    id: `aa-${code}`, code, assetId: `as-${code}`, workerId: WORKER, worksiteId: WS,
    deliveredAt: NOW, deliveredByUserId: USER,
  })
}

async function grantAccess(name: string, status = "activo") {
  await testDb.insert(schema.itAccessSystems).values({ id: `sys-${name}`, name })
  await testDb.insert(schema.itSystemAccess).values({
    id: `acc-${name}`, systemId: `sys-${name}`, workerId: WORKER, status,
    revokedAt: status === "baja" ? NOW : null,
  })
}

async function assignLicense(name: string) {
  await testDb.insert(schema.itLicenses).values({ id: `lic-${name}`, name, periodicity: "anual" })
  await testDb.insert(schema.itLicenseAssignments).values({
    id: `la-${name}`, licenseId: `lic-${name}`, workerId: WORKER,
  })
}

async function deliverEpp(code: string, options: { voided?: boolean } = {}) {
  await testDb.insert(schema.deliveries).values({
    id: `d-${code}`, code, deliveredBy: USER, deliveredAt: NOW,
    destinationType: "worker", worksiteId: WS, workerId: WORKER,
    ...(options.voided
      ? { voidedAt: NOW, voidedBy: USER, voidReason: "Entrega anulada por error de registro" }
      : {}),
  })
  await testDb.insert(schema.deliveryItems).values({
    id: `di-${code}`, deliveryId: `d-${code}`, productNameFree: "Casco", quantity: 1,
  })
}

async function joinPermitCrew(code: string, status: string) {
  await testDb.insert(schema.preventionPermitTypes).values({
    id: `pt-${code}`, code: `PT-${code}`, name: "Altura", legalBasis: "DS 44 art. 1",
    createdByUserId: USER,
  })
  await testDb.insert(schema.preventionWorkPermits).values({
    id: `pw-${code}`, code, permitTypeId: `pt-${code}`, worksiteId: WS,
    taskDescription: "Trabajo en altura", location: "Torre 2",
    supervisorUserId: USER, requestedByUserId: USER,
    plannedStartAt: NOW, plannedEndAt: "2026-09-14T18:00:00.000Z", status,
    // Un permiso cerrado lo está con acta: el check lo exige.
    ...(status === "closed"
      ? { closedByUserId: USER, closedAt: NOW, closureSummary: "Trabajo terminado sin novedad" }
      : {}),
  })
  await testDb.insert(schema.preventionPermitCrew).values({
    id: `pc-${code}`, permitId: `pw-${code}`, workerId: WORKER, role: "executor",
  })
}

const kinds = async () => (await getWorkerOffboardingSummary(WORKER)).items.map((i) => i.kind)

describe("getWorkerOffboardingSummary", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await seed()
  })
  beforeEach(clearPendings)
  afterAll(async () => pg.close())

  it("una persona sin nada abierto se da de baja limpia", async () => {
    const summary = await getWorkerOffboardingSummary(WORKER)
    expect(summary.clear).toBe(true)
    expect(summary.items).toEqual([])
    expect(describeWorkerOffboarding(summary)).toMatch(/No quedan activos/)
  })

  it("cuenta las actas TI abiertas y las nombra por su código", async () => {
    await giveAsset("ACT-0001")
    const summary = await getWorkerOffboardingSummary(WORKER)
    expect(summary.clear).toBe(false)
    expect(summary.items).toEqual([{
      kind: "it_assets", count: 1, label: "1 activo TI sin devolver", samples: ["ACT-0001"],
    }])
  })

  it("un activo ya devuelto deja de contar", async () => {
    await giveAsset("ACT-0002")
    await testDb.update(schema.itAssetAssignments).set({ returnedAt: NOW })
    expect(await kinds()).toEqual([])
  })

  it("un acceso dado de baja no es un acceso vigente", async () => {
    await grantAccess("VPN", "baja")
    expect(await kinds()).toEqual([])
    await grantAccess("Correo")
    expect(await kinds()).toEqual(["it_access"])
  })

  it("una licencia revocada libera el asiento y deja de aparecer", async () => {
    await assignLicense("Office")
    expect(await kinds()).toEqual(["it_licenses"])
    await testDb.update(schema.itLicenseAssignments).set({ revokedAt: NOW })
    expect(await kinds()).toEqual([])
  })

  it("el EPP de una entrega anulada no queda pendiente de devolución", async () => {
    await deliverEpp("ENT-0001", { voided: true })
    expect(await kinds()).toEqual([])
    await deliverEpp("ENT-0002")
    expect(await kinds()).toEqual(["epp"])
  })

  it("sólo cuentan las cuadrillas de permisos que siguen abiertos", async () => {
    await joinPermitCrew("PT-CERRADO", "closed")
    expect(await kinds()).toEqual([])
    await joinPermitCrew("PT-ACTIVO", "active")
    expect(await kinds()).toEqual(["permit_crew"])
  })

  it("reúne todo lo abierto en un orden estable y lo resume en una línea", async () => {
    await giveAsset("ACT-0003")
    await grantAccess("Jira")
    await grantAccess("Slack")
    await assignLicense("Autocad")
    await deliverEpp("ENT-0003")
    await joinPermitCrew("PT-VIVO", "approved")

    const summary = await getWorkerOffboardingSummary(WORKER)
    expect(summary.items.map((i) => i.kind)).toEqual([
      "it_assets", "it_access", "it_licenses", "epp", "permit_crew",
    ])
    expect(describeWorkerOffboarding(summary)).toBe(
      "1 activo TI sin devolver; 2 accesos a sistemas vigentes; 1 licencia asignada; " +
      "1 entrega de EPP sin devolución; 1 permiso de trabajo abierto",
    )

    // El checklist de TI sólo puede exigir lo que TI puede cerrar: el EPP y la
    // cuadrilla son de bodega y de prevención.
    expect(onlyItPendings(summary).items.map((i) => i.kind)).toEqual([
      "it_assets", "it_access", "it_licenses",
    ])
  })
})

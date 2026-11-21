import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, inArray } from "drizzle-orm"
import ExcelJS from "exceljs"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// WP1 de Trinorma: maestros de faenas y equipos (tipo y alias de faena, propietarios, ubicación por
// confirmar, código duplicado y el script que los carga). El script importa `@/db` estáticamente: se
// importa dinámicamente, ya asignado `testGlobal.__db`.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb
const tx = inMemoryDb as never

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const ACTOR = "jefatura@chome.test"
const actor = { userId: "u-actor", email: ACTOR }
const TERCERO = "Persona Tercera de Prueba"

const SITES = [
  { id: "w-flor", code: "FLOR-DEL-LAJA", name: "Flor del Laja" },
  { id: "w-ofi", code: "OFICINA-CENTRAL", name: "Oficina Central" },
  { id: "w-hor", code: "HORCONES", name: "Horcones" },
  { id: "w-ara", code: "MANT-ARA", name: "Arauco", isActive: false },
  { id: "w-pac", code: "FA-007", name: "Pacifico" },
  { id: "w-cho", code: "CHOLGUAN-ARAUCO", name: "Cholguan - Arauco" },
  { id: "w-sf", code: "SANTA-FE", name: "Santa Fe" },
  { id: "w-mas", code: "MASISA", name: "Masisa" },
  { id: "w-ten", code: "TENO-ARAUCO", name: "Teno - Arauco" },
  { id: "w-cab", code: "MANT-CAB", name: "Cabrero", isActive: false },
]

async function load() { return import("../../scripts/apply-trinorma-maestros") }

async function seedVehicle(id: string, code: string | null, plate: string, worksiteId: string, extra: Partial<typeof schema.fuelVehicles.$inferInsert> = {}) {
  await inMemoryDb.insert(schema.fuelVehicles).values({ id, code, plate, type: "Camión", equipmentTypeId: "t1", worksiteId, ...extra })
}

async function workbookBytes(rows: unknown[][]) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet("Base de Datos")
  sheet.addRow([" INVENTARIO DE VEHICULOS, EQUIPOS Y MAQUINARIAS"])
  sheet.addRow([])
  sheet.addRow([null, "EMPRESA", "EQUIPO", "C.INT", "PATENTE", "MARCA"])
  for (const row of rows) sheet.addRow(row)
  return new Uint8Array(await book.xlsx.writeBuffer())
}

const INVENTORY_ROWS: unknown[][] = [
  [null, "CHOME", "CAMION", "KA-1", "AAAA11", "X"],
  [null, "ASIR", "CAMION", "KA-2", "BBBB22", "X"],
  [null, "SCOTIABANK", "CAMION", "KA-3", "CCCC33", "X"],
  [null, TERCERO, "CAMION", "KA-4", "DDDD44", "X"],
  [null, "CHOME", "CAMION", "KA-5", "EEEE55", "X"], // ya tiene propietario: no se pisa
  [null, "CHOME", "CAMION", "KA-99", "ZZZZ99", "X"], // no está en la flota
  [null, "ACTUALIZACION DE FAENAS — OCTUBRE 2026", null, null, null, null], // fila de notas
]

beforeEach(async () => {
  await pg.exec("TRUNCATE audit_log, mant_historical_records, worksite_aliases, fuel_vehicles, fleet_owners, worksites, users CASCADE")
  await inMemoryDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura", email: ACTOR, hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values(SITES)
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "t1", slug: "t1", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" }).onConflictDoNothing()
  await seedVehicle("v1", "KA-1", "AAAA11", "w-hor")
  await seedVehicle("v2", "KA-2", "BBBB22", "w-pac")
  await seedVehicle("v3", "KA-3", "CCCC33", "w-cab")
  await seedVehicle("v4", "KA-4", "DDDD44", "w-cho")
  await inMemoryDb.insert(schema.fleetOwners).values({ id: "o-previo", name: "Otra Empresa", kind: "tercero" })
  await seedVehicle("v5", "KA-5", "EEEE55", "w-pac", { ownerId: "o-previo" })
  await seedVehicle("v6", "KA-6", "FFFF66", "w-cab", { isActive: false })
  await inMemoryDb.insert(schema.mantHistoricalRecords).values(["a", "b"].map((key, index) => ({
    sourceKey: `k-${key}`, fingerprint: `f-${key}`, sourceFile: "x.xlsx", sourceSheet: "S", sourceRow: index + 2, submittedAt: "2026-01-01",
    worksiteText: "ARAUCO", worksiteId: "w-ara", equipmentText: "KA-1", equipmentMatch: "unmatched", orderText: "", kindText: "", readingText: "",
    description: "", hoursText: "", fields: [], importedBy: actor.userId,
  })))
})

async function snapshot() {
  const [worksites, aliases, owners, vehicles, audits, records] = await Promise.all([
    inMemoryDb.select().from(schema.worksites),
    inMemoryDb.select().from(schema.worksiteAliases),
    inMemoryDb.select().from(schema.fleetOwners),
    inMemoryDb.select().from(schema.fuelVehicles),
    inMemoryDb.select().from(schema.auditLog),
    inMemoryDb.select().from(schema.mantHistoricalRecords),
  ])
  return { worksites, aliases, owners, vehicles, audits, records }
}

describe("script apply-trinorma-maestros", () => {
  it("la simulación informa lo que haría pero no escribe nada", async () => {
    const { applyTrinormaMaestros, readInventoryOwners } = await load()
    const before = await snapshot()
    const inventory = await readInventoryOwners(await workbookBytes(INVENTORY_ROWS))
    const report = await applyTrinormaMaestros({ actorEmail: ACTOR, inventory, unirArauco: true })
    expect(report.outcomes.some((o) => o.result === "dry-run")).toBe(true)
    expect(report.outcomes.some((o) => o.result === "aplicado")).toBe(false)
    const after = await snapshot()
    expect(after).toEqual(before)
  })

  it("--apply aplica los cinco pasos y deja auditoría; nunca cambia la faena de un equipo", async () => {
    const { applyTrinormaMaestros, readInventoryOwners } = await load()
    const worksiteBefore = Object.fromEntries((await inMemoryDb.select().from(schema.fuelVehicles)).map((v) => [v.id, v.worksiteId]))
    const inventory = await readInventoryOwners(await workbookBytes(INVENTORY_ROWS))
    const report = await applyTrinormaMaestros({ actorEmail: ACTOR, apply: true, inventory, unirArauco: true })
    expect(report.outcomes.some((o) => o.result === "dry-run")).toBe(false)

    const state = await snapshot()
    const site = (code: string) => state.worksites.find((w) => w.code === code)!
    // 1 · tipos
    expect(site("FLOR-DEL-LAJA").kind).toBe("deposito")
    expect(site("OFICINA-CENTRAL").kind).toBe("administracion")
    expect(site("HORCONES").kind).toBe("operacion")
    // 2 · unión de las dos Arauco
    expect(site("HORCONES").name).toBe("Arauco")
    expect(site("MANT-ARA").name).toBe("Arauco (anterior)")
    expect(site("MANT-ARA").isActive).toBe(false)
    expect(state.records.every((r) => r.worksiteId === "w-hor")).toBe(true)
    // 3 · alias (Horcones ya no es el nombre exacto tras la unión)
    const aliasOf = (text: string) => state.aliases.find((a) => a.aliasText === text)?.worksiteId
    expect(aliasOf("Horcones")).toBe("w-hor")
    expect(aliasOf("Cholguan")).toBe("w-cho")
    expect(aliasOf("Cholguan Maderas")).toBe("w-cho")
    expect(aliasOf("Cholguan Residuos")).toBe("w-cho")
    expect(aliasOf("Rodantes Santa Fe")).toBe("w-sf")
    expect(aliasOf("Administración")).toBe("w-ofi")
    expect(aliasOf("Masisa Maderas")).toBe("w-mas")
    expect(aliasOf("Masisa Tableros")).toBe("w-mas")
    expect(aliasOf("Teno")).toBe("w-ten")
    expect(state.aliases).toHaveLength(9)
    expect(state.aliases.some((a) => /mininco|cabrero/i.test(a.aliasText))).toBe(false)
    // 4 · propietarios
    const owner = (id: string) => state.owners.find((o) => o.id === state.vehicles.find((v) => v.id === id)?.ownerId)
    expect(owner("v1")).toMatchObject({ name: "CHOME", kind: "propia" })
    expect(owner("v2")).toMatchObject({ name: "ASIR", kind: "relacionada" })
    expect(owner("v3")).toMatchObject({ name: "SCOTIABANK", kind: "financiera" })
    expect(owner("v4")).toMatchObject({ name: TERCERO, kind: "tercero" })
    expect(owner("v5")?.id).toBe("o-previo")
    expect(state.vehicles.find((v) => v.id === "v6")?.ownerId).toBeNull()
    // 5 · ubicación por confirmar: activos de faenas inactivas y de Pacífico
    const pending = (id: string) => state.vehicles.find((v) => v.id === id)!.locationPendingConfirmation
    expect(pending("v2")).toBe(true)
    expect(pending("v3")).toBe(true)
    expect(pending("v5")).toBe(true)
    expect(pending("v1")).toBe(false)
    expect(pending("v4")).toBe(false)
    expect(pending("v6")).toBe(false) // inactivo
    // la faena de ningún equipo cambió
    for (const vehicle of state.vehicles) expect(vehicle.worksiteId).toBe(worksiteBefore[vehicle.id])
    // auditoría
    const types = new Set(state.audits.map((a) => a.entityType))
    for (const type of ["worksite", "worksite_alias", "fleet_owner", "fuel_vehicle", "mant_historical_records"]) expect(types.has(type)).toBe(true)
    expect(state.audits.every((a) => a.userId === actor.userId)).toBe(true)
  })

  it("una segunda corrida no cambia nada", async () => {
    const { applyTrinormaMaestros, readInventoryOwners } = await load()
    const inventory = await readInventoryOwners(await workbookBytes(INVENTORY_ROWS))
    await applyTrinormaMaestros({ actorEmail: ACTOR, apply: true, inventory, unirArauco: true })
    const first = await snapshot()
    const second = await applyTrinormaMaestros({ actorEmail: ACTOR, apply: true, inventory, unirArauco: true })
    expect(second.outcomes.some((o) => o.result === "aplicado" || o.result === "dry-run")).toBe(false)
    expect(await snapshot()).toEqual(first)
  })

  it("sin --unir-arauco la unión sólo se informa y no se toca nada de las dos Arauco", async () => {
    const { applyTrinormaMaestros } = await load()
    const report = await applyTrinormaMaestros({ actorEmail: ACTOR, apply: true })
    const union = report.outcomes.find((o) => o.step.startsWith("2"))!
    expect(union.result).toBe("omitido")
    expect(union.detail).toMatch(/--unir-arauco/)
    const state = await snapshot()
    expect(state.worksites.find((w) => w.code === "HORCONES")?.name).toBe("Horcones")
    expect(state.worksites.find((w) => w.code === "MANT-ARA")?.name).toBe("Arauco")
    expect(state.records.every((r) => r.worksiteId === "w-ara")).toBe(true)
    // «Horcones» es todavía el nombre exacto de la faena: no necesita alias
    expect(state.aliases.some((a) => a.aliasText === "Horcones")).toBe(false)
    // sin inventario no hay propietarios
    expect(state.owners).toHaveLength(1)
  })

  it("no imprime nombres de personas: los propietarios tercero salen por cantidad", async () => {
    const { applyTrinormaMaestros, printMaestrosReport, readInventoryOwners } = await load()
    const inventory = await readInventoryOwners(await workbookBytes(INVENTORY_ROWS))
    const report = await applyTrinormaMaestros({ actorEmail: ACTOR, apply: true, inventory })
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    printMaestrosReport(report, true)
    const printed = log.mock.calls.map((call) => call.join(" ")).join("\n")
    log.mockRestore()
    expect(printed).not.toContain(TERCERO)
    expect(JSON.stringify(report)).not.toContain(TERCERO)
    expect(printed).toMatch(/1 empresa\(s\) o persona\(s\)/)
    expect(printed).toContain("CHOME")
  })

  it("una empresa tercera inactiva no filtra su nombre: ni en la impresión ni en el informe", async () => {
    const { applyTrinormaMaestros, printMaestrosReport, readInventoryOwners } = await load()
    await inMemoryDb.insert(schema.fleetOwners).values({ id: "o-inactiva", name: TERCERO, kind: "tercero", isActive: false })
    const inventory = await readInventoryOwners(await workbookBytes(INVENTORY_ROWS))
    const report = await applyTrinormaMaestros({ actorEmail: ACTOR, apply: true, inventory })
    const failed = report.outcomes.find((o) => o.step.startsWith("4") && o.item === "(tercero)")
    expect(failed).toMatchObject({ result: "omitido", action: "crear empresa" })
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    printMaestrosReport(report, true)
    const printed = log.mock.calls.map((call) => call.join(" ")).join("\n")
    log.mockRestore()
    expect(printed).not.toContain(TERCERO)
    expect(JSON.stringify(report)).not.toContain(TERCERO)
    // el equipo no recibió una empresa inutilizable
    expect((await snapshot()).vehicles.find((v) => v.id === "v4")?.ownerId).toBeNull()
  })

  it("no une las dos Arauco si MANT-ARA tiene equipos o contratos colgando", async () => {
    const { applyTrinormaMaestros } = await load()
    await seedVehicle("v7", "KA-7", "GGGG77", "w-ara")
    const report = await applyTrinormaMaestros({ actorEmail: ACTOR, apply: true, unirArauco: true })
    const union = report.outcomes.find((o) => o.step.startsWith("2"))!
    expect(union.result).toBe("omitido")
    expect(union.detail).toMatch(/1 equipo\(s\) y 0 contrato\(s\)/)
    const state = await snapshot()
    expect(state.worksites.find((w) => w.code === "HORCONES")?.name).toBe("Horcones")
    expect(state.worksites.find((w) => w.code === "MANT-ARA")?.name).toBe("Arauco")
    expect(state.records.every((r) => r.worksiteId === "w-ara")).toBe(true)
  })

  it("compara las empresas por nombre normalizado: «CHOME» y «Chome» no son un conflicto", async () => {
    const { applyTrinormaMaestros } = await load()
    const report = await applyTrinormaMaestros({
      actorEmail: ACTOR, apply: true,
      inventory: [{ company: "CHOME", code: "KA-1", plate: "AAAA11" }, { company: "Chome", code: "KA-1", plate: "AAAA11" }],
    })
    expect(report.outcomes.some((o) => /empresas distintas/.test(o.action))).toBe(false)
    const state = await snapshot()
    expect(state.owners.find((o) => o.id === state.vehicles.find((v) => v.id === "v1")?.ownerId)?.name).toBe("CHOME")
  })

  it("no crea una empresa que ningún equipo va a recibir", async () => {
    const { applyTrinormaMaestros } = await load()
    await applyTrinormaMaestros({
      actorEmail: ACTOR, apply: true,
      inventory: [
        { company: "Empresa Sin Destino", code: "KA-5", plate: "EEEE55" }, // ya tiene propietario
        { company: "Otra Sin Destino", code: "KA-404", plate: "NOEXISTE1" }, // no está en la flota
      ],
    })
    expect((await snapshot()).owners.map((o) => o.name)).toEqual(["Otra Empresa"])
  })

  it("informa la faena que falta en vez de abortar", async () => {
    const { applyTrinormaMaestros } = await load()
    await pg.exec("TRUNCATE worksite_aliases, mant_historical_records, fuel_vehicles, worksites, users CASCADE")
    await inMemoryDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura", email: ACTOR, hashedPassword: "x" })
    const report = await applyTrinormaMaestros({ actorEmail: ACTOR })
    expect(report.outcomes.filter((o) => o.result === "omitido" && o.detail === "falta la faena").length).toBeGreaterThan(0)
  })

  it("rechaza un correo sin usuario activo", async () => {
    const { applyTrinormaMaestros } = await load()
    await expect(applyTrinormaMaestros({ actorEmail: "nadie@chome.test" })).rejects.toThrow(/usuario activo/)
  })

  it("lee el inventario: ignora las filas de notas y exige las columnas", async () => {
    const { readInventoryOwners } = await load()
    const rows = await readInventoryOwners(await workbookBytes(INVENTORY_ROWS))
    expect(rows).toHaveLength(6)
    expect(rows[0]).toEqual({ company: "CHOME", code: "KA-1", plate: "AAAA11" })
    const book = new ExcelJS.Workbook()
    book.addWorksheet("Base de Datos").addRow(["nada"])
    await expect(readInventoryOwners(new Uint8Array(await book.xlsx.writeBuffer()))).rejects.toThrow(/EMPRESA, C\.INT y PATENTE/)
  })
})

describe("alias de faena y tipo de faena", () => {
  it("rechaza un alias que ya es el nombre de otra faena, uno repetido y uno vacío; acepta uno válido", async () => {
    const { addWorksiteAliasTx } = await import("@/lib/services/worksite-aliases")
    const nameOfOther = await addWorksiteAliasTx(tx, actor, { worksiteId: "w-hor", aliasText: " santa  FE " })
    expect(nameOfOther).toMatchObject({ ok: false })
    expect(!nameOfOther.ok && nameOfOther.message).toMatch(/nombre de la faena Santa Fe/)
    const ownName = await addWorksiteAliasTx(tx, actor, { worksiteId: "w-hor", aliasText: "horcones" })
    expect(!ownName.ok && ownName.message).toMatch(/ya es el nombre de la faena/)
    const empty = await addWorksiteAliasTx(tx, actor, { worksiteId: "w-hor", aliasText: "   " })
    expect(empty.ok).toBe(false)

    const ok = await addWorksiteAliasTx(tx, actor, { worksiteId: "w-hor", aliasText: "Fundo Horcones" })
    expect(ok.ok).toBe(true)
    const again = await addWorksiteAliasTx(tx, actor, { worksiteId: "w-hor", aliasText: "fundo horcones" })
    expect(!again.ok && again.message).toMatch(/ya tiene ese alias/)
    const other = await addWorksiteAliasTx(tx, actor, { worksiteId: "w-sf", aliasText: "FUNDO HORCONES" })
    expect(!other.ok && other.message).toMatch(/ya es alias de la faena Horcones/)
    expect(await inMemoryDb.select().from(schema.worksiteAliases)).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "worksite_alias"))).toHaveLength(1)
  })

  it("quitar un alias lo borra, lo audita y no toca el de otra faena", async () => {
    const { addWorksiteAliasTx, removeWorksiteAliasTx } = await import("@/lib/services/worksite-aliases")
    const added = await addWorksiteAliasTx(tx, actor, { worksiteId: "w-hor", aliasText: "Fundo" })
    const aliasId = added.ok ? added.data.id : ""
    expect((await removeWorksiteAliasTx(tx, actor, { worksiteId: "w-sf", aliasId })).ok).toBe(false)
    expect((await removeWorksiteAliasTx(tx, actor, { worksiteId: "w-hor", aliasId })).ok).toBe(true)
    expect(await inMemoryDb.select().from(schema.worksiteAliases)).toHaveLength(0)
    const audits = await inMemoryDb.select().from(schema.auditLog).where(inArray(schema.auditLog.action, ["create", "delete"]))
    expect(audits.map((a) => a.action).sort()).toEqual(["create", "delete"])
  })

  it("el tipo de faena cambia con auditoría y un valor repetido no escribe", async () => {
    const { setWorksiteKindTx } = await import("@/lib/services/worksite-kind")
    expect(await setWorksiteKindTx(tx, actor, { worksiteId: "w-flor", kind: "deposito" })).toMatchObject({ ok: true, changed: true })
    expect(await setWorksiteKindTx(tx, actor, { worksiteId: "w-flor", kind: "deposito" })).toMatchObject({ ok: true, changed: false })
    expect(await setWorksiteKindTx(tx, actor, { worksiteId: "nadie", kind: "deposito" })).toMatchObject({ ok: false })
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(1)
  })
})

describe("propietario del equipo y ubicación por confirmar", () => {
  it("asigna propietario y marca con auditoría, sin tocar la faena", async () => {
    const { createFleetOwnerTx, setVehicleOwnershipTx } = await import("@/lib/services/fleet-owners")
    const created = await createFleetOwnerTx(tx, actor, { name: "  Nueva  Empresa ", kind: "tercero" })
    expect(created).toMatchObject({ ok: true, data: { created: true } })
    const ownerId = created.ok ? created.data.id : ""
    const done = await setVehicleOwnershipTx(tx, actor, { vehicleId: "v1", ownerId, locationPendingConfirmation: true })
    expect(done).toMatchObject({ ok: true, data: { changed: true } })
    const [vehicle] = await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v1"))
    expect(vehicle).toMatchObject({ ownerId, locationPendingConfirmation: true, worksiteId: "w-hor" })
    const audit = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fuel_vehicle"))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entityId: "v1", worksiteId: "w-hor" })
    expect(await setVehicleOwnershipTx(tx, actor, { vehicleId: "v1", ownerId, locationPendingConfirmation: true })).toMatchObject({ ok: true, data: { changed: false } })
  })

  it("elegir o crear en línea: un nombre que ya existe (sin mayúsculas ni tildes) reutiliza la empresa", async () => {
    const { createFleetOwnerTx } = await import("@/lib/services/fleet-owners")
    const first = await createFleetOwnerTx(tx, actor, { name: "Maderas Ñuble", kind: "tercero" })
    const second = await createFleetOwnerTx(tx, actor, { name: "MADERAS ÑUBLE", kind: "propia" })
    expect(second).toMatchObject({ ok: true, data: { created: false, id: first.ok ? first.data.id : "?" } })
    expect(await inMemoryDb.select().from(schema.fleetOwners)).toHaveLength(2) // + la empresa previa del fixture
    expect(await createFleetOwnerTx(tx, actor, { name: "A", kind: "tercero" })).toMatchObject({ ok: false })
    expect(await createFleetOwnerTx(tx, actor, { name: "Empresa X", kind: "inventada" })).toMatchObject({ ok: false })
  })

  it("rechaza una empresa inexistente o inactiva", async () => {
    const { setVehicleOwnershipTx } = await import("@/lib/services/fleet-owners")
    await inMemoryDb.insert(schema.fleetOwners).values({ id: "o-off", name: "Inactiva", kind: "tercero", isActive: false })
    expect(await setVehicleOwnershipTx(tx, actor, { vehicleId: "v1", ownerId: "no-existe" })).toMatchObject({ ok: false })
    expect(await setVehicleOwnershipTx(tx, actor, { vehicleId: "v1", ownerId: "o-off" })).toMatchObject({ ok: false })
    expect(await setVehicleOwnershipTx(tx, actor, { vehicleId: "no-hay", ownerId: null })).toMatchObject({ ok: false })
  })

  it("clasifica las empresas del inventario según CONTRATOS.md", async () => {
    const { classifyFleetOwnerName } = await import("@/lib/services/fleet-owners")
    expect(classifyFleetOwnerName("CHOME")).toBe("propia")
    for (const name of ["ASIR", "ASIR Y ACUÑA", "SERVIMAR"]) expect(classifyFleetOwnerName(name)).toBe("relacionada")
    for (const name of ["SCOTIABANK", "BCO.ESTADO", "BCO. ITAU", "Banco de Chile", "Leasing Sur"]) expect(classifyFleetOwnerName(name)).toBe("financiera")
    for (const name of ["FAB.PUERTAS", "CONQUE LTDA.", TERCERO]) expect(classifyFleetOwnerName(name)).toBe("tercero")
  })
})

describe("código de equipo duplicado", () => {
  it("el índice rechaza «ka 001» si existe «KA-1» y el error se traduce a «Ya existe un equipo con el código KA-001»", async () => {
    const { duplicateEquipmentCodeError } = await import("@/lib/services/fleet-vehicle-code")
    let caught: unknown
    try { await seedVehicle("dup", "ka 001", "QQQQ11", "w-hor") } catch (error) { caught = error }
    expect(caught).toBeDefined()
    expect(duplicateEquipmentCodeError(caught, "ka 001")).toBe("Ya existe un equipo con el código KA-001.")
    // otro error cualquiera no se traduce
    expect(duplicateEquipmentCodeError(new Error("otra cosa"), "KA-1")).toBeNull()
  })

  it("el mensaje usa el código canónico y no inventa uno cuando no hay forma letras + números", async () => {
    const { duplicateEquipmentCodeMessage } = await import("@/lib/services/fleet-vehicle-code")
    expect(duplicateEquipmentCodeMessage("TO.38")).toBe("Ya existe un equipo con el código TO-38.")
    expect(duplicateEquipmentCodeMessage("sr-cj-44")).toBe("Ya existe un equipo con el código SRCJ-44.")
    expect(duplicateEquipmentCodeMessage("")).toBe("Ya existe un equipo con ese código.")
  })
})

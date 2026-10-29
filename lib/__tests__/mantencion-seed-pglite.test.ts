import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { PgTable } from "drizzle-orm/pg-core"
import { and, count, eq, isNull } from "drizzle-orm"
import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/*
 * Carga inicial del módulo de mantención (§13) contra Postgres de verdad (PGlite
 * con las migraciones completas). Lo que se verifica es lo que la pura lectura
 * del código no demuestra: que la carga es idempotente, que concilia con una
 * flota que ya tiene equipos sin duplicarlos ni pisarlos, y que una carga que
 * falla no deja una mitad escrita.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const { parseMantSeedData, seedMantencion } = await import("@/lib/services/mantencion/seed")
type SeedReport = Awaited<ReturnType<typeof seedMantencion>>
const { publishScheduleVersion } = await import("@/lib/services/mantencion/schedule-versions")
const { ensureFolioCode, listMantWorksites, resolveOrCreateWorksite } = await import("@/lib/services/mantencion/worksites")
const { ensureCatalogEntry, listEquipmentTypes, listMantCatalogs } = await import("@/lib/services/mantencion/catalogs")

const data = parseMantSeedData(JSON.parse(readFileSync(path.resolve(process.cwd(), "db/seed/mantencion-seed.json"), "utf8")))
const EMAILS = {
  "Luis Campos": "LCampos@example.test",
  "Nelson Silva": "nsilva@example.test",
  "Emilio Padilla": "epadilla@example.test",
}

const FAR_FUTURE = "2099-01-01T00:00:00.000Z"
let first: SeedReport
let second: SeedReport

async function total(table: PgTable): Promise<number> {
  const [row] = await testDb.select({ total: count() }).from(table)
  return row?.total ?? 0
}

async function snapshotCounts() {
  return {
    worksites: await total(schema.worksites),
    folios: await total(schema.mantWorksiteSettings),
    types: await total(schema.fuelEquipmentTypes),
    brands: await total(schema.mantBrands),
    workshops: await total(schema.mantWorkshops),
    drivers: await total(schema.mantDrivers),
    workTypes: await total(schema.mantWorkTypes),
    oils: await total(schema.mantOils),
    schedules: await total(schema.mantSchedules),
    intervals: await total(schema.mantScheduleIntervals),
    groups: await total(schema.mantScheduleGroups),
    items: await total(schema.mantScheduleItems),
    cells: await total(schema.mantScheduleItemIntervals),
    rules: await total(schema.mantScheduleBrandRules),
    versions: await total(schema.mantScheduleVersions),
    vehicles: await total(schema.fuelVehicles),
    profiles: await total(schema.mantEquipmentProfiles),
    history: await total(schema.mantEquipmentHistory),
    userRoles: await total(schema.userRoles),
    worksiteUsers: await total(schema.worksiteUsers),
    audit: await total(schema.auditLog),
  }
}

async function worksiteIdByName(name: string): Promise<string> {
  const [row] = await testDb.select({ id: schema.worksites.id }).from(schema.worksites).where(eq(schema.worksites.name, name))
  if (!row) throw new Error(`Falta la faena ${name}`)
  return row.id
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

  // Faenas que ya existían antes de la carga: con otra tilde, con otro código de folio y sin folio.
  await testDb.insert(schema.worksites).values([
    { id: "ws-santa-fe", name: "Santa Fe", code: "FN-SF" },
    { id: "ws-arauco", name: "Arauco", code: "FN-ARA" },
    { id: "ws-cabrero", name: "Cabrero", code: "FN-CAB" },
    { id: "ws-pacifico", name: "Pacifico", code: "FN-PAC" },
  ])
  await testDb.insert(schema.mantWorksiteSettings).values({ worksiteId: "ws-santa-fe", folioCode: "SFE" })

  // Flota que ya tenía equipos: uno por código (con datos distintos) y uno por patente (sin código).
  await testDb.insert(schema.fuelVehicles).values([
    {
      id: "veh-pre-ka135", plate: "RBYD98", code: "KA-135", type: "Camión", equipmentTypeId: "fet-camion",
      meterType: "odometer", performanceUnit: "km_per_liter", brand: null, model: null, year: 2020, worksiteId: "ws-santa-fe",
    },
    {
      id: "veh-pre-cr31", plate: "WT-1699", code: null, type: "Minicargador", equipmentTypeId: "fet-minicargador",
      meterType: "hour_meter", performanceUnit: "liters_per_hour", brand: null, model: null, year: null, worksiteId: "ws-cabrero",
    },
  ])

  // Mecánicos: una cuenta por nombre, una por correo, una inactiva, dos con el mismo nombre y una invitación pendiente.
  const account = (id: string, name: string, email: string, isActive = true) =>
    ({ id, name, email, hashedPassword: "hash-de-prueba", isActive })
  await testDb.insert(schema.roles).values({ id: "rol-mecanico", name: "mecanico", label: "Mecánico" })
  await testDb.insert(schema.users).values([
    account("u-javier", "Javier Roa", "javier.roa@example.test"),
    account("u-luis", "L. A. Campos", "lcampos@example.test"),
    account("u-deivis", "Deivis González", "deivis@example.test", false),
    account("u-leo-1", "Leonardo Echeverría", "leo1@example.test"),
    account("u-leo-2", "Leonardo Echeverría", "leo2@example.test"),
  ])
  await testDb.insert(schema.userInvitations).values({
    id: "inv-padilla", email: "epadilla@example.test", tokenHash: "hash-de-prueba", expiresAt: FAR_FUTURE,
  })

  // Un trabajador cuyo nombre calza con un conductor de la planilla (no debe vincularse solo).
  await testDb.insert(schema.workers).values([
    { id: "w-aedo", firstName: "José Antonio", lastName: "Aedo Polanco", worksiteId: "ws-arauco" },
    { id: "w-otro", firstName: "Pedro", lastName: "Soto Rojas", worksiteId: "ws-arauco" },
  ])
}, 120_000)

describe("una carga que falla no deja nada escrito", () => {
  it("revierte las faenas y los catálogos ya creados cuando una regla apunta a una marca sin catálogo", async () => {
    const before = await snapshotCounts()
    const broken = structuredClone(data)
    broken.pautas[0]!.reglasPorMarca!.marcas[0] = "Marca Fantasma"

    await expect(seedMantencion(testDb, broken)).rejects.toThrow(/Marca Fantasma/)

    expect(await snapshotCounts()).toEqual(before)
  }, 120_000)
})

describe("primera carga", () => {
  beforeAll(async () => {
    first = await seedMantencion(testDb, data, { invitationEmails: EMAILS })
  }, 180_000)

  it("deja 120 equipos con perfil, sin duplicar la flota", async () => {
    expect(await total(schema.mantEquipmentProfiles)).toBe(120)
    expect(await total(schema.fuelVehicles)).toBe(120)
    expect(first.equipment).toMatchObject({ created: 118, existing: 2, profilesCreated: 120, profilesExisting: 0 })
    expect(first.equipment.skipped).toEqual([])
    expect(first.changed).toBe(true)
    expect(first.warnings).toEqual([])
  })

  it("crea las dos pautas con 53 y 37 ítems, sus intervalos y la versión 1 publicada", async () => {
    const schedules = await testDb.select().from(schema.mantSchedules)
    expect(schedules.map((s) => [s.name, s.unit, s.version]).sort()).toEqual([["Camiones y tractos", "km", 1], ["Maquinaria pesada", "h", 1]])
    for (const [name, items, intervals] of [["Camiones y tractos", 53, 5], ["Maquinaria pesada", 37, 4]] as const) {
      const schedule = schedules.find((s) => s.name === name)!
      const own = await testDb.select().from(schema.mantScheduleItems).where(eq(schema.mantScheduleItems.scheduleId, schedule.id))
      expect(own, name).toHaveLength(items)
      expect(await testDb.select().from(schema.mantScheduleIntervals).where(eq(schema.mantScheduleIntervals.scheduleId, schedule.id))).toHaveLength(intervals)
      // La matriz trae una celda por ítem e intervalo.
      expect(await testDb.select().from(schema.mantScheduleItemIntervals).innerJoin(schema.mantScheduleItems, eq(schema.mantScheduleItems.id, schema.mantScheduleItemIntervals.itemId))
        .where(eq(schema.mantScheduleItems.scheduleId, schedule.id))).toHaveLength(items * intervals)
      const [version] = await testDb.select().from(schema.mantScheduleVersions).where(eq(schema.mantScheduleVersions.scheduleId, schedule.id))
      expect(version).toMatchObject({ version: 1, summary: "Carga inicial" })
      const snapshot = version!.snapshot as { version: number; intervals: number[]; groups: Array<{ items: unknown[] }> }
      expect(snapshot.version).toBe(1)
      expect(snapshot.groups.flatMap((g) => g.items)).toHaveLength(items)
    }
    expect(first.schedules.map((s) => [s.name, s.created, s.items, s.version])).toEqual([["Camiones y tractos", true, 53, 1], ["Maquinaria pesada", true, 37, 1]])
  })

  it("§19-1: el asterisco sale del nombre y el ítem queda «Por confirmar»; §19-2: la fila sin ítem se conserva", async () => {
    const [km15] = await testDb.select().from(schema.mantScheduleItems).where(eq(schema.mantScheduleItems.itemKey, "km15"))
    expect(km15).toMatchObject({ name: "Regulación válvulas motor", note: "Por confirmar" })
    const [km1] = await testDb.select().from(schema.mantScheduleItems).where(eq(schema.mantScheduleItems.itemKey, "km1"))
    expect(km1?.note).toBeNull()
    const rules = await testDb.select().from(schema.mantScheduleBrandRules)
    expect(rules).toHaveLength(9 * 7)
    const noItem = rules.filter((r) => r.itemId === null)
    expect(noItem).toHaveLength(7)
    expect(new Set(noItem.map((r) => r.sheetActivity))).toEqual(new Set(["Diagnóstico electrónico motor"]))
    // «Cambio filtro caja automatizada» (km22): AAWXXAX en Scania, Mercedes, MAN, Ford Cargo, Volkswagen, Freightliner, Sinotruk.
    const brands = new Map((await testDb.select().from(schema.mantBrands)).map((b) => [b.name, b.id]))
    const km22 = rules.filter((r) => r.sheetActivity === "Cambio filtro caja automatizada")
    const byBrand = Object.fromEntries(km22.map((r) => [[...brands].find(([, id]) => id === r.brandId)![0], r.value]))
    expect(byBrand).toEqual({ Scania: "A", Mercedes: "A", MAN: "W", "Ford Cargo": "X", Volkswagen: "X", Freightliner: "A", Sinotruk: "X" })
  })

  it("carga los catálogos: 15 marcas, 10 talleres, 27 conductores sin vincular, tipos de trabajo y aceites", async () => {
    expect(await total(schema.mantBrands)).toBe(15)
    expect(await total(schema.mantWorkshops)).toBe(10)
    expect(await total(schema.mantWorkTypes)).toBe(4)
    expect(await total(schema.mantOils)).toBe(4)
    const drivers = await testDb.select().from(schema.mantDrivers)
    expect(drivers).toHaveLength(27)
    expect(drivers.every((d) => d.workerId === null)).toBe(true)
    expect(first.catalogs).toEqual({
      brands: { created: 15, existing: 0 }, workshops: { created: 10, existing: 0 }, drivers: { created: 27, existing: 0 },
      workTypes: { created: 4, existing: 0 }, oils: { created: 4, existing: 0 },
    })
  })

  it("reporta, sin vincular, el trabajador que probablemente es el conductor AEDO POLANCO JOSE A.", () => {
    expect(first.driverMatches).toEqual([{ driver: "AEDO POLANCO JOSE A.", workers: ["José Antonio Aedo Polanco"] }])
  })

  it("las faenas ya existentes se reutilizan aunque cambie la tilde, y cada una queda con folio de tres letras único", async () => {
    // 14 faenas (10 del archivo + 4 que sólo traen los equipos); 4 ya existían.
    expect(first.worksites).toMatchObject({ created: 10, existing: 4 })
    const worksites = await listMantWorksites({ includeInactive: true })
    expect(worksites).toHaveLength(14)
    expect(worksites.some((w) => w.name === "Pacífico")).toBe(false)
    expect(worksites.find((w) => w.name === "Pacifico")?.folioCode).toBe("PAC")
    const folios = worksites.map((w) => w.folioCode)
    expect(folios.every((f) => f && /^[A-Z]{3}$/.test(f))).toBe(true)
    expect(new Set(folios).size).toBe(14)
    expect(Object.fromEntries(worksites.map((w) => [w.name, w.folioCode]))).toMatchObject({
      Biodiversa: "BIO", Cholguan: "CHO", "Flor del Laja": "FDL", "Sin ubicación": "SUB", Arauco: "ARA", Cabrero: "CAB",
      // Las cuatro que sólo aparecen en los equipos: folio derivado del nombre.
      Calymag: "CAL", Ecoservitran: "ECO", "Fab. Puertas": "FAB", Panguipulli: "PAN",
    })
    expect(first.worksites.derivedFolio).toHaveLength(4)
  })

  it("respeta el código de folio que una faena ya tenía y lo reporta", async () => {
    const [santaFe] = await testDb.select().from(schema.mantWorksiteSettings).where(eq(schema.mantWorksiteSettings.worksiteId, "ws-santa-fe"))
    expect(santaFe?.folioCode).toBe("SFE")
    expect(first.worksites.folioNotes).toEqual([expect.stringContaining("«Santa Fe»")])
    expect(first.worksites.folioNotes[0]).toContain("STF")
  })

  it("crea «Grúa horquilla» en la flota con horómetro y verifica la unidad de los demás tipos", async () => {
    const [grua] = await testDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "grua_horquilla"))
    expect(grua).toMatchObject({ name: "Grúa horquilla", defaultMeterType: "hour_meter" })
    expect(first.equipmentTypes).toMatchObject({ created: 1, existing: 9, problems: [] })
  })

  it("un equipo nuevo entra a la flota con su tipo, medidor, faena y perfil; «Sin patente» guarda el código como patente", async () => {
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.code, "TO-37"))
    expect(vehicle).toMatchObject({
      plate: "TO-37", type: "Bulldozer", equipmentTypeId: "fet-bulldozer", meterType: "hour_meter",
      performanceUnit: "liters_per_hour", brand: "Caterpillar", model: "D6 H", year: 2004, isActive: true,
      worksiteId: await worksiteIdByName("Cholguan"),
    })
    const [profile] = await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, vehicle!.id))
    expect(profile?.noPlate).toBe(true)
    expect(profile?.initialReading).toBeNull()
    const [schedule] = await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.id, profile!.scheduleId!))
    expect(schedule?.name).toBe("Maquinaria pesada")
    const [withPlate] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.code, "KA-137"))
    expect(withPlate?.plate).toBe("RXGR-19")
    const [plain] = await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, withPlate!.id))
    expect(plain?.noPlate).toBe(false)
  })

  it("cada equipo tiene la pauta de su unidad y su marca del catálogo, y deja un historial «import»", async () => {
    const rows = await testDb
      .select({ unit: schema.mantSchedules.unit, meter: schema.fuelEquipmentTypes.defaultMeterType })
      .from(schema.mantEquipmentProfiles)
      .innerJoin(schema.fuelVehicles, eq(schema.fuelVehicles.id, schema.mantEquipmentProfiles.vehicleId))
      .innerJoin(schema.fuelEquipmentTypes, eq(schema.fuelEquipmentTypes.id, schema.fuelVehicles.equipmentTypeId))
      .innerJoin(schema.mantSchedules, eq(schema.mantSchedules.id, schema.mantEquipmentProfiles.scheduleId))
    expect(rows).toHaveLength(120)
    expect(rows.every((r) => (r.unit === "km") === (r.meter === "odometer"))).toBe(true)
    const history = await testDb.select().from(schema.mantEquipmentHistory)
    expect(history.every((h) => h.action === "import")).toBe(true)
    expect(history.length).toBeGreaterThanOrEqual(120)
  })

  it("un vehículo que ya estaba en la flota con el mismo código no se duplica, no se pisa y su diferencia se reporta", async () => {
    const same = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.code, "KA-135"))
    expect(same).toHaveLength(1)
    expect(same[0]).toMatchObject({
      id: "veh-pre-ka135", plate: "RBYD98", year: 2020, worksiteId: "ws-santa-fe",
      // Sólo se completó lo que estaba vacío.
      brand: "Freightliner", model: "M2 106",
    })
    const [profile] = await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, "veh-pre-ka135"))
    expect(profile).toBeDefined()
    expect(first.equipment.differences.filter((d) => d.code === "KA-135")).toEqual([
      { code: "KA-135", field: "año", fleet: "2020", seed: "2021" },
      { code: "KA-135", field: "faena", fleet: "Santa Fe", seed: "Arauco" },
    ])
  })

  it("concilia por patente cuando el equipo de la flota no tiene código, y le completa el código", async () => {
    const same = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.plate, "WT-1699"))
    expect(same).toHaveLength(1)
    expect(same[0]).toMatchObject({ id: "veh-pre-cr31", code: "CR-31", brand: "Caterpillar", model: "246B", year: 2007 })
    expect(first.equipment.filledFromSeed).toBe(2)
  })

  it("mecánicos: vincula la cuenta por nombre y por correo; el resto queda pendiente de invitar, sin crear contraseñas", async () => {
    expect(first.mechanics).toMatchObject({ linked: 2, alreadyLinked: 0 })
    const links = await testDb.select().from(schema.userRoles).where(eq(schema.userRoles.roleId, "rol-mecanico"))
    expect(links.map((l) => l.userId).sort()).toEqual(["u-javier", "u-luis"])
    const biodiversa = await worksiteIdByName("Biodiversa")
    const worksiteLinks = await testDb.select().from(schema.worksiteUsers)
    expect(worksiteLinks.map((l) => [l.userId, l.worksiteId, l.isPrimary]).sort()).toEqual([["u-javier", biodiversa, true], ["u-luis", biodiversa, true]])

    const pending = Object.fromEntries(first.mechanics.pending.map((p) => [p.name, p]))
    expect(Object.keys(pending).sort()).toEqual(["Deivis González", "Emilio Padilla", "Leonardo Echeverría", "Marcelo Bastías", "Nelson Silva"])
    expect(pending["Deivis González"]!.action).toContain("inactiva")
    expect(pending["Leonardo Echeverría"]!.action).toContain("varias cuentas")
    expect(pending["Emilio Padilla"]!.action).toContain("invitación pendiente")
    expect(pending["Nelson Silva"]).toMatchObject({ hasEmail: true, worksite: "Cholguan" })
    expect(pending["Nelson Silva"]!.action).toContain("/admin/usuarios")
    expect(pending["Marcelo Bastías"]).toMatchObject({ hasEmail: false })
    expect(pending["Marcelo Bastías"]!.action).toContain("sin correo")
    // No se creó ninguna cuenta ni invitación nueva.
    expect(await total(schema.users)).toBe(5)
    expect(await total(schema.userInvitations)).toBe(1)
    // El reporte nunca lleva correos.
    expect(JSON.stringify(first)).not.toContain("example.test")
  })

  it("deja constancia en la bitácora de la creación de las faenas y de la carga", async () => {
    const worksiteAudit = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "worksite"), eq(schema.auditLog.action, "create")))
    expect(worksiteAudit).toHaveLength(10)
    const seedAudit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_seed"))
    expect(seedAudit).toHaveLength(1)
    expect(JSON.parse(seedAudit[0]!.newState ?? "{}")).toMatchObject({ vehicles: 118, profiles: 120, schedules: 2 })
  })
})

describe("segunda carga", () => {
  let before: Awaited<ReturnType<typeof snapshotCounts>>

  beforeAll(async () => {
    before = await snapshotCounts()
    second = await seedMantencion(testDb, data, { invitationEmails: EMAILS })
  }, 180_000)

  it("no cambia nada: ninguna tabla gana ni pierde filas", async () => {
    expect(second.changed).toBe(false)
    expect(await snapshotCounts()).toEqual(before)
  })

  it("el reporte lo dice entidad por entidad", () => {
    expect(second.worksites).toMatchObject({ created: 0, existing: 14 })
    expect(second.equipmentTypes).toMatchObject({ created: 0, existing: 10 })
    expect(Object.values(second.catalogs).every((pair) => pair.created === 0)).toBe(true)
    expect(second.schedules.map((s) => [s.name, s.created, s.items, s.version])).toEqual([["Camiones y tractos", false, 53, 1], ["Maquinaria pesada", false, 37, 1]])
    expect(second.equipment).toMatchObject({ created: 0, existing: 120, profilesCreated: 0, profilesExisting: 120, filledFromSeed: 0 })
    expect(second.mechanics).toMatchObject({ linked: 0, alreadyLinked: 2 })
  })

  it("las diferencias con la flota se siguen reportando (no se corrigieron solas)", () => {
    expect(second.equipment.differences.map((d) => `${d.code}:${d.field}`)).toEqual(["KA-135:año", "KA-135:faena"])
  })

  it("no escribe otra fila en la bitácora de la carga", async () => {
    expect(await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_seed"))).toHaveLength(1)
  })
})

describe("regla 17 · faena nueva no duplica", () => {
  it("«cholguán» y «CHOLGUAN» devuelven la existente «Cholguan» sin crear nada", async () => {
    const existing = await worksiteIdByName("Cholguan")
    const before = await total(schema.worksites)
    for (const typed of ["cholguán", "  CHOLGUAN ", "Cholguán"]) {
      const result = await testDb.transaction((tx) => resolveOrCreateWorksite(tx, { typedName: typed, actor: { userId: "u-javier" } }))
      expect(result, typed).toEqual({ id: existing, name: "Cholguan", created: false })
    }
    expect(await total(schema.worksites)).toBe(before)
  })

  it("una faena realmente nueva se crea con código propio y folio, y la segunda vez ya existe", async () => {
    const result = await testDb.transaction((tx) => resolveOrCreateWorksite(tx, { typedName: "  Nueva   Faena  ", actor: { userId: "u-javier", email: "javier.roa@example.test" } }))
    expect(result).toMatchObject({ name: "Nueva Faena", created: true })
    const [row] = await testDb.select().from(schema.worksites).where(eq(schema.worksites.id, result.id))
    expect(row).toMatchObject({ name: "Nueva Faena", code: "MANT-NUE", isActive: true })
    const [folio] = await testDb.select().from(schema.mantWorksiteSettings).where(eq(schema.mantWorksiteSettings.worksiteId, result.id))
    expect(folio?.folioCode).toBe("NUE")
    const audit = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "worksite"), eq(schema.auditLog.entityId, result.id)))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ userId: "u-javier", action: "create", entityCode: "MANT-NUE" })

    const again = await testDb.transaction((tx) => resolveOrCreateWorksite(tx, { typedName: "nueva faena", actor: { userId: "u-javier" } }))
    expect(again).toEqual({ id: result.id, name: "Nueva Faena", created: false })
  })

  it("rechaza un nombre vacío o demasiado largo con un mensaje legible", async () => {
    await expect(testDb.transaction((tx) => resolveOrCreateWorksite(tx, { typedName: "   ", actor: { userId: "u-javier" } }))).rejects.toThrow("Escribe el nombre de la faena.")
    await expect(testDb.transaction((tx) => resolveOrCreateWorksite(tx, { typedName: "x".repeat(81), actor: { userId: "u-javier" } }))).rejects.toThrow("80 caracteres")
  })

  it("ensureFolioCode es idempotente y da folio a una faena que no lo tenía", async () => {
    const id = "ws-sin-folio"
    await testDb.insert(schema.worksites).values({ id, name: "Ñuble Norte", code: "FN-NN" })
    const [a, b] = await testDb.transaction(async (tx) => [await ensureFolioCode(tx, id), await ensureFolioCode(tx, id)])
    expect(a).toBe("NUB")
    expect(b).toBe(a)
    expect(await testDb.select().from(schema.mantWorksiteSettings).where(eq(schema.mantWorksiteSettings.worksiteId, id))).toHaveLength(1)
  })

  it("el código de folio preferido que ya usa otra faena se reemplaza por uno derivado", async () => {
    const id = "ws-folio-tomado"
    await testDb.insert(schema.worksites).values({ id, name: "Biodiversa Sur", code: "FN-BS" })
    expect(await testDb.transaction((tx) => ensureFolioCode(tx, id, "BIO"))).toBe("BSU")
  })
})

describe("catálogos y tipos de equipo", () => {
  it("ensureCatalogEntry no duplica: «scania» es la «Scania» existente; un nombre nuevo se crea una sola vez", async () => {
    const [scania] = await testDb.select().from(schema.mantBrands).where(eq(schema.mantBrands.name, "Scania"))
    const existing = await testDb.transaction((tx) => ensureCatalogEntry(tx, "brands", "  scanía "))
    expect(existing).toEqual({ id: scania!.id, created: false })

    const created = await testDb.transaction((tx) => ensureCatalogEntry(tx, "workshops", "Taller   Nuevo"))
    expect(created.created).toBe(true)
    const again = await testDb.transaction((tx) => ensureCatalogEntry(tx, "workshops", "taller nuevo"))
    expect(again).toEqual({ id: created.id, created: false })
    const [row] = await testDb.select().from(schema.mantWorkshops).where(eq(schema.mantWorkshops.id, created.id))
    expect(row).toMatchObject({ name: "Taller Nuevo", nameKey: "taller nuevo", isActive: true })
    // Va al final del orden del catálogo.
    const sorted = await testDb.select().from(schema.mantWorkshops)
    expect(row!.sortOrder).toBe(Math.max(...sorted.map((w) => w.sortOrder)))
    await expect(testDb.transaction((tx) => ensureCatalogEntry(tx, "oils", "   "))).rejects.toThrow("Escribe un nombre.")
  })

  it("funciona en los cinco catálogos", async () => {
    for (const key of ["brands", "workshops", "drivers", "workTypes", "oils"] as const) {
      const first = await testDb.transaction((tx) => ensureCatalogEntry(tx, key, `Entrada de prueba ${key}`))
      const second = await testDb.transaction((tx) => ensureCatalogEntry(tx, key, `ENTRADA DE PRUEBA ${key}`))
      expect(first.created, key).toBe(true)
      expect(second, key).toEqual({ id: first.id, created: false })
    }
  })

  it("listMantCatalogs: en el orden del catálogo y sin las entradas inactivas, salvo que se pidan", async () => {
    await testDb.update(schema.mantOils).set({ isActive: false }).where(eq(schema.mantOils.name, "Corona"))
    const active = await listMantCatalogs()
    expect(active.oils.map((o) => o.name)).not.toContain("Corona")
    expect(active.workTypes.slice(0, 4).map((w) => w.name)).toEqual(["Mecánico", "Soldadura", "Eléctrico", "Hidráulico"])
    const all = await listMantCatalogs({ includeInactive: true })
    expect(all.oils.find((o) => o.name === "Corona")).toMatchObject({ isActive: false })
    expect(all.drivers.length).toBeGreaterThanOrEqual(27)
  })

  it("listEquipmentTypes sólo trae tipos con medidor y deriva la unidad", async () => {
    const types = await listEquipmentTypes()
    const unit = (name: string) => types.find((t) => t.name === name)?.unit
    expect(unit("Camión")).toBe("km")
    expect(unit("Tractocamión")).toBe("km")
    expect(unit("Cargador")).toBe("h")
    expect(unit("Grúa horquilla")).toBe("h")
    expect(unit("Estanque")).toBeUndefined()
    expect(unit("Hidrolavadora")).toBeUndefined()
  })
})

describe("regla 15 · cada edición de pauta sube la versión y conserva el snapshot anterior", () => {
  it("una nueva publicación crea la versión 2 y la versión 1 queda intacta", async () => {
    const [schedule] = await testDb.select().from(schema.mantSchedules).where(and(eq(schema.mantSchedules.name, "Camiones y tractos"), isNull(schema.mantSchedules.deletedAt)))
    const [v1Before] = await testDb.select().from(schema.mantScheduleVersions).where(and(eq(schema.mantScheduleVersions.scheduleId, schedule!.id), eq(schema.mantScheduleVersions.version, 1)))

    const version = await testDb.transaction((tx) => publishScheduleVersion(tx, { scheduleId: schedule!.id, userId: null, summary: "Cambio de prueba" }))
    expect(version).toBe(2)

    const versions = await testDb.select().from(schema.mantScheduleVersions).where(eq(schema.mantScheduleVersions.scheduleId, schedule!.id))
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2])
    expect(versions.find((v) => v.version === 1)!.snapshot).toEqual(v1Before!.snapshot)
    expect((versions.find((v) => v.version === 2)!.snapshot as { version: number }).version).toBe(2)
    const [after] = await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.id, schedule!.id))
    expect(after?.version).toBe(2)
  })
})

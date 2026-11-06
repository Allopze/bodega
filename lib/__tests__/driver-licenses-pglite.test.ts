/**
 * Servicio de licencias de conducir contra Postgres de verdad (PGlite):
 *
 *  - la nómina une a quien tiene licencia registrada con quien la exige por su
 *    cargo (capacidad `drives_vehicle` u `operates_equipment`), con las
 *    excepciones individuales `include` y `exclude`;
 *  - el estado es uno solo y la lista sale en orden de urgencia;
 *  - el alcance de faena se respeta en lecturas y escrituras;
 *  - cada alta, cambio y baja queda en la auditoría;
 *  - `writeDriverLicense` (el script de carga) es idempotente y usa el cliente
 *    que recibe.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import type { DriverLicenseClass, DriverLicenseInput } from "@/lib/validation/driver-licenses"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
// `can` real arrastra next-auth; el permiso se resuelve igual contra la sesión falsa.
vi.mock("@/lib/auth/can", () => ({
  can: (session: { user?: { permissions?: string[] } } | null, permission: string) =>
    session?.user?.permissions?.includes(permission) ?? false,
}))

const {
  getDriverRosterRow,
  listDriverCandidates,
  listDriverRoster,
  loadDriverRosterForReminders,
  removeDriverLicense,
  upsertDriverLicense,
  writeDriverLicense,
} = await import("@/lib/services/driver-licenses")

const ADMIN = "user-lic-admin"
const JEFE_A = "user-lic-jefe-a"
const WS_A = "ws-lic-a"
const WS_B = "ws-lic-b"
const WS_CERRADA = "ws-lic-cerrada"
const POS_CHOFER = "pos-lic-chofer"
const POS_OPERADOR = "pos-lic-operador"
const POS_SOLDADOR = "pos-lic-soldador"
const POS_SIN_CLASIFICAR = "worker-position-unclassified"

const PERMISSION = "flota:manage_licenses"

function session(userId: string, options: { permissions?: string[]; worksiteIds?: string[]; isGlobal?: boolean } = {}): Session {
  const worksiteIds = options.worksiteIds ?? []
  return {
    expires: "2099-01-01",
    user: {
      id: userId, name: userId, email: `${userId}@lic.test`, roles: [],
      isGlobal: options.isGlobal ?? false, isActive: true,
      worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null,
      permissions: options.permissions ?? [PERMISSION],
    },
  } as unknown as Session
}

/** Jefatura: ve todas las faenas. */
const jefatura = session(ADMIN, { isGlobal: true })
/** Jefe de terreno / admin. de contrato de la faena A. */
const jefeA = session(JEFE_A, { worksiteIds: [WS_A] })
const sinPermiso = session(JEFE_A, { worksiteIds: [WS_A], permissions: ["flota:view"] })
const sinFaenas = session(JEFE_A, { worksiteIds: [] })

const actor = { userId: ADMIN, userEmail: `${ADMIN}@lic.test` }

let drivesCapabilityId = ""
let operatesCapabilityId = ""
/** Los ids se renuevan en cada prueba: la auditoría es de sólo-agregar y no se puede vaciar. */
let run = 0
const id = (key: string) => `lic-${key}-${run}`

async function seedWorkers() {
  run += 1
  const today = todayInChile()
  const days = (n: number) => addDaysToPlainDate(today, n)

  await testDb.insert(schema.workers).values([
    { id: id("ana"), firstName: "Ana", lastName: "Chofer", rut: "11.111.111-1", worksiteId: WS_A, positionId: POS_CHOFER },
    { id: id("beto"), firstName: "Beto", lastName: "Chofer", worksiteId: WS_A, positionId: POS_CHOFER },
    { id: id("carla"), firstName: "Carla", lastName: "Operadora", worksiteId: WS_A, positionId: POS_OPERADOR },
    { id: id("dani"), firstName: "Dani", lastName: "Soldador", worksiteId: WS_A, positionId: POS_SOLDADOR },
    { id: id("eli"), firstName: "Eli", lastName: "Soldador", worksiteId: WS_A, positionId: POS_SOLDADOR },
    { id: id("fer"), firstName: "Fer", lastName: "Sinclasificar", worksiteId: WS_A, positionId: POS_SIN_CLASIFICAR },
    { id: id("gabi"), firstName: "Gabi", lastName: "Nocargo", worksiteId: WS_A, positionId: null },
    { id: id("hugo"), firstName: "Hugo", lastName: "Excluido", worksiteId: WS_A, positionId: POS_CHOFER },
    { id: id("ivan"), firstName: "Ivan", lastName: "Incluido", worksiteId: WS_A, positionId: POS_SOLDADOR },
    { id: id("jaime"), firstName: "Jaime", lastName: "Inactivo", worksiteId: WS_A, positionId: POS_CHOFER, isActive: false },
    { id: id("kari"), firstName: "Kari", lastName: "Operaria", worksiteId: WS_A, positionId: POS_SOLDADOR },
    { id: id("luis"), firstName: "Luis", lastName: "SinFecha", worksiteId: WS_A, positionId: POS_SOLDADOR },
    { id: id("mario"), firstName: "Mario", lastName: "ChoferB", worksiteId: WS_B, positionId: POS_CHOFER },
    { id: id("nora"), firstName: "Nora", lastName: "SoldadoraB", worksiteId: WS_B, positionId: POS_SOLDADOR },
  ])
  await testDb.insert(schema.workerDriverLicenses).values([
    { workerId: id("beto"), classes: ["A5"], expiresAt: days(200) },
    { workerId: id("carla"), classes: ["B"], expiresAt: days(10) },
    { workerId: id("eli"), classes: ["B"], expiresAt: days(-20) },
    { workerId: id("kari"), classes: ["D"], expiresAt: days(100) },
    { workerId: id("luis"), classes: ["B"], expiresAt: null, notes: "Falta la fecha" },
    { workerId: id("nora"), classes: ["A4"], expiresAt: days(5) },
  ])
  await testDb.insert(schema.workerCapabilityOverrides).values([
    { id: id("ov-hugo"), workerId: id("hugo"), capabilityId: drivesCapabilityId, mode: "exclude", reason: "Temporalmente no conduce" },
    { id: id("ov-ivan"), workerId: id("ivan"), capabilityId: drivesCapabilityId, mode: "include", reason: "Conduce la camioneta de faena" },
    { id: id("ov-kari"), workerId: id("kari"), capabilityId: operatesCapabilityId, mode: "include", reason: "Opera la retroexcavadora" },
  ])
}

const auditOf = (workerId: string, action?: string) =>
  testDb.select().from(schema.auditLog).where(and(
    eq(schema.auditLog.entityType, "worker_driver_license"),
    eq(schema.auditLog.entityId, workerId),
    action ? eq(schema.auditLog.action, action) : undefined,
  ))

const licenseOf = async (workerId: string) =>
  (await testDb.select().from(schema.workerDriverLicenses).where(eq(schema.workerDriverLicenses.workerId, workerId)))[0]

const json = (value: string | null) => (value ? JSON.parse(value) : null)

const input = (key: string, overrides: Partial<DriverLicenseInput> = {}): DriverLicenseInput => ({
  workerId: id(key),
  classes: ["A4", "A5"],
  expiresAt: addDaysToPlainDate(todayInChile(), 100),
  notes: null,
  ...overrides,
})

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values([
    { id: ADMIN, name: "Admin", email: `${ADMIN}@lic.test`, hashedPassword: "x", isActive: true },
    { id: JEFE_A, name: "Jefe A", email: `${JEFE_A}@lic.test`, hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "LIC-A", isActive: true },
    { id: WS_B, name: "Faena B", code: "LIC-B", isActive: true },
    { id: WS_CERRADA, name: "Faena cerrada", code: "LIC-C", isActive: false },
  ])
  // `drives_vehicle` y `operates_equipment` las siembra la migración del catálogo de cargos.
  const capabilities = await testDb.select().from(schema.workerCapabilities)
  drivesCapabilityId = capabilities.find((item) => item.code === "drives_vehicle")!.id
  operatesCapabilityId = capabilities.find((item) => item.code === "operates_equipment")!.id
  await testDb.insert(schema.workerPositions).values([
    { id: POS_CHOFER, code: "LIC-CHOFER", name: "Conductor de camión", normalizedKey: "conductor de camion lic", requiredLicenseClasses: ["A4", "A5"] },
    { id: POS_OPERADOR, code: "LIC-OPERADOR", name: "Operador de maquinaria", normalizedKey: "operador de maquinaria lic", requiredLicenseClasses: ["D"] },
    { id: POS_SOLDADOR, code: "LIC-SOLDADOR", name: "Soldador", normalizedKey: "soldador lic", requiredLicenseClasses: [] },
  ])
  await testDb.insert(schema.workerPositionCapabilities).values([
    { positionId: POS_CHOFER, capabilityId: drivesCapabilityId },
    { positionId: POS_OPERADOR, capabilityId: operatesCapabilityId },
  ])
})

beforeEach(async () => {
  // Los trabajadores van después de lo que los referencia.
  await testDb.delete(schema.workerCapabilityOverrides)
  await testDb.delete(schema.workerDriverLicenses)
  await testDb.delete(schema.workers)
  await seedWorkers()
})

describe("listDriverRoster — quién aparece", () => {
  it("une a quien tiene licencia con quien la exige por cargo, y deja fuera al resto", async () => {
    const roster = await listDriverRoster(jefatura)
    const names = roster.rows.map((row) => row.name)

    // Por capacidad del cargo (Ana, Mario, Carla), por excepción `include`
    // (Ivan, Kari) y por tener licencia aunque su cargo no conduzca (Beto,
    // Eli, Luis, Nora).
    expect([...names].sort()).toEqual([
      "Ana Chofer", "Beto Chofer", "Carla Operadora", "Eli Soldador", "Ivan Incluido",
      "Kari Operaria", "Luis SinFecha", "Mario ChoferB", "Nora SoldadoraB",
    ])
    // Ni conduce ni tiene licencia (Dani), sin cargo (Fer, Gabi), `exclude`
    // (Hugo) o inactivo (Jaime).
    for (const absent of ["Dani Soldador", "Fer Sinclasificar", "Gabi Nocargo", "Hugo Excluido", "Jaime Inactivo"]) {
      expect(names).not.toContain(absent)
    }
  })

  it("`requiresLicense` sale de la capacidad efectiva: cargo, `exclude` e `include`", async () => {
    const byName = new Map((await listDriverRoster(jefatura)).rows.map((row) => [row.name, row]))
    expect(byName.get("Ana Chofer")?.requiresLicense).toBe(true) // drives_vehicle por cargo
    expect(byName.get("Carla Operadora")?.requiresLicense).toBe(true) // operates_equipment por cargo
    expect(byName.get("Ivan Incluido")?.requiresLicense).toBe(true) // include sobre un cargo que no conduce
    expect(byName.get("Kari Operaria")?.requiresLicense).toBe(true) // include de operates_equipment
    expect(byName.get("Eli Soldador")?.requiresLicense).toBe(false) // sólo tiene licencia
    expect(byName.has("Hugo Excluido")).toBe(false) // exclude saca la capacidad heredada
  })

  it("un `exclude` no borra a quien además tiene licencia registrada: sale por la licencia", async () => {
    await testDb.insert(schema.workerDriverLicenses).values({
      workerId: id("hugo"), classes: ["B"], expiresAt: addDaysToPlainDate(todayInChile(), 90),
    })
    const hugo = (await listDriverRoster(jefatura)).rows.find((row) => row.name === "Hugo Excluido")
    expect(hugo).toMatchObject({ requiresLicense: false, status: "vigente" })
  })

  it("cada fila trae el estado único, los días y lo que falta", async () => {
    const byName = new Map((await listDriverRoster(jefatura)).rows.map((row) => [row.name, row]))

    expect(byName.get("Eli Soldador")).toMatchObject({ status: "vencida", expiry: { state: "vencido", days: -20 } })
    expect(byName.get("Ana Chofer")).toMatchObject({
      status: "sin_licencia", license: null, expiry: null,
      requiredClasses: ["A4", "A5"], positionName: "Conductor de camión", rut: "11.111.111-1", worksiteName: "Faena A",
    })
    // Clase insuficiente gana a «por vencer» (la licencia de Carla vence en 10 días).
    expect(byName.get("Carla Operadora")).toMatchObject({
      status: "clase_insuficiente", requiredClasses: ["D"], missingClasses: ["D"],
      license: { classes: ["B"] }, expiry: { state: "por_vencer", days: 10 },
    })
    expect(byName.get("Nora SoldadoraB")).toMatchObject({ status: "por_vencer", expiry: { days: 5 }, worksiteName: "Faena B" })
    expect(byName.get("Luis SinFecha")).toMatchObject({ status: "sin_fecha", license: { expiresAt: null, notes: "Falta la fecha" } })
    expect(byName.get("Beto Chofer")).toMatchObject({ status: "vigente", missingClasses: [] })
    expect(byName.get("Kari Operaria")).toMatchObject({ status: "vigente", requiredClasses: [] })
    expect(byName.get("Ivan Incluido")).toMatchObject({ status: "sin_licencia", requiredClasses: [] })
  })

  it("ordena por urgencia: vencidas, sin licencia, clase insuficiente, sin fecha, por vencer, vigentes", async () => {
    const roster = await listDriverRoster(jefatura)
    expect(roster.rows.map((row) => row.name)).toEqual([
      "Eli Soldador",
      "Ana Chofer", "Ivan Incluido", "Mario ChoferB",
      "Carla Operadora",
      "Luis SinFecha",
      "Nora SoldadoraB",
      "Kari Operaria", "Beto Chofer",
    ])
  })

  it("dentro de un estado: lo vencido más antiguo primero, lo por vencer más próximo primero", async () => {
    const today = todayInChile()
    const setExpiry = (key: string, offset: number) =>
      testDb.update(schema.workerDriverLicenses)
        .set({ expiresAt: addDaysToPlainDate(today, offset) }).where(eq(schema.workerDriverLicenses.workerId, id(key)))
    await setExpiry("luis", -90) // vencida hace 90 días (antes: sin fecha)
    await setExpiry("beto", 20)
    await setExpiry("kari", 2)

    expect((await listDriverRoster(jefatura)).rows.map((row) => row.name)).toEqual([
      "Luis SinFecha", "Eli Soldador", // -90 antes que -20
      "Ana Chofer", "Ivan Incluido", "Mario ChoferB",
      "Carla Operadora",
      "Kari Operaria", "Nora SoldadoraB", "Beto Chofer", // +2, +5, +20
    ])
  })

  it("devuelve hoy, la ventana de aviso y las faenas activas del alcance", async () => {
    const roster = await listDriverRoster(jefatura)
    expect(roster.today).toBe(todayInChile())
    expect(roster.warningDays).toBe(30)
    expect(roster.worksites).toEqual([{ id: WS_A, name: "Faena A" }, { id: WS_B, name: "Faena B" }])
  })

  it("cuenta a los trabajadores sin cargo o «Sin clasificar» del alcance, y no se mueve con el filtro de faena", async () => {
    expect((await listDriverRoster(jefatura)).unclassifiedWorkers).toBe(2) // Fer y Gabi
    expect((await listDriverRoster(jefatura, { worksiteId: WS_B })).unclassifiedWorkers).toBe(2)
    expect((await listDriverRoster(session(JEFE_A, { worksiteIds: [WS_B] }))).unclassifiedWorkers).toBe(0)
  })
})

describe("listDriverRoster — alcance y permiso", () => {
  it("filtra por faena", async () => {
    const roster = await listDriverRoster(jefatura, { worksiteId: WS_B })
    expect(roster.rows.map((row) => row.name)).toEqual(["Mario ChoferB", "Nora SoldadoraB"])
  })

  it("un jefe con una faena sólo ve esa faena y sólo ese filtro", async () => {
    const roster = await listDriverRoster(jefeA)
    expect(roster.rows.every((row) => row.worksiteId === WS_A)).toBe(true)
    expect(roster.rows).toHaveLength(7)
    expect(roster.worksites).toEqual([{ id: WS_A, name: "Faena A" }])
  })

  it("el filtro de faena se intersecta con el alcance, nunca lo amplía", async () => {
    const roster = await listDriverRoster(jefeA, { worksiteId: WS_B })
    expect(roster.rows).toEqual([])
  })

  it("sin faenas asignadas no ve nada (lista vacía no es «sin filtro»)", async () => {
    const roster = await listDriverRoster(sinFaenas)
    expect(roster.rows).toEqual([])
    expect(roster.worksites).toEqual([])
    expect(roster.unclassifiedWorkers).toBe(0)
  })

  it("sin `flota:manage_licenses` ninguna lectura responde", async () => {
    await expect(listDriverRoster(sinPermiso)).rejects.toThrow(/permisos/)
    await expect(getDriverRosterRow(sinPermiso, id("ana"))).rejects.toThrow(/permisos/)
    await expect(listDriverCandidates(sinPermiso)).rejects.toThrow(/permisos/)
  })
})

describe("getDriverRosterRow", () => {
  it("devuelve la fila de un trabajador de la nómina", async () => {
    expect(await getDriverRosterRow(jefatura, id("ana"))).toMatchObject({ workerId: id("ana"), status: "sin_licencia" })
    expect(await getDriverRosterRow(jefeA, id("eli"))).toMatchObject({ status: "vencida" })
  })

  it("null si no existe, está inactivo, no está en la nómina o está fuera de alcance", async () => {
    expect(await getDriverRosterRow(jefatura, "no-existe")).toBeNull()
    expect(await getDriverRosterRow(jefatura, id("jaime"))).toBeNull() // inactivo
    expect(await getDriverRosterRow(jefatura, id("dani"))).toBeNull() // ni conduce ni tiene licencia
    expect(await getDriverRosterRow(jefeA, id("mario"))).toBeNull() // faena B
  })
})

describe("listDriverCandidates", () => {
  it("lista a los activos sin licencia registrada, estén o no obligados por cargo", async () => {
    const candidates = await listDriverCandidates(jefatura)
    expect(candidates.map((candidate) => candidate.name)).toEqual([
      "Ana Chofer", "Dani Soldador", "Fer Sinclasificar", "Gabi Nocargo", "Hugo Excluido", "Ivan Incluido", "Mario ChoferB",
    ])
    expect(candidates[0]).toEqual({
      workerId: id("ana"), name: "Ana Chofer", rut: "11.111.111-1", worksiteName: "Faena A",
      positionName: "Conductor de camión", requiredClasses: ["A4", "A5"],
    })
    expect(candidates.find((candidate) => candidate.name === "Gabi Nocargo")).toMatchObject({ positionName: null, requiredClasses: [] })
  })

  it("respeta el alcance de faena", async () => {
    const names = (await listDriverCandidates(jefeA)).map((candidate) => candidate.name)
    expect(names).not.toContain("Mario ChoferB")
    expect(names).toContain("Ana Chofer")
    expect(await listDriverCandidates(sinFaenas)).toEqual([])
  })
})

describe("upsertDriverLicense", () => {
  it("crea la licencia, devuelve la fila recalculada y deja auditoría con rut", async () => {
    const expiresAt = addDaysToPlainDate(todayInChile(), 100)
    const result = await upsertDriverLicense(jefatura, input("ana", { classes: ["A5", "A4"], expiresAt, notes: "  Prórroga por 6 meses " }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.row).toMatchObject({
      workerId: id("ana"), status: "vigente", missingClasses: [],
      license: { classes: ["A4", "A5"], expiresAt, notes: "Prórroga por 6 meses" },
    })

    const stored = await licenseOf(id("ana"))
    expect(stored).toMatchObject({ classes: ["A4", "A5"], expiresAt, notes: "Prórroga por 6 meses", updatedByUserId: ADMIN })

    const [entry] = await auditOf(id("ana"))
    expect(entry).toMatchObject({
      action: "create", entityType: "worker_driver_license", entityId: id("ana"),
      entityCode: "11.111.111-1", worksiteId: WS_A, userId: ADMIN, userEmail: `${ADMIN}@lic.test`,
    })
    expect(entry?.oldState).toBeNull()
    expect(json(entry!.newState)).toEqual({ classes: ["A4", "A5"], expiresAt, notes: "Prórroga por 6 meses" })
  })

  it("la auditoría usa el nombre cuando el trabajador no tiene RUT", async () => {
    await upsertDriverLicense(jefatura, input("ivan", { classes: ["B"] }))
    const [entry] = await auditOf(id("ivan"))
    expect(entry?.entityCode).toBe("Ivan Incluido")
  })

  it("reemplaza una licencia existente: audita el cambio con el estado anterior y el nuevo", async () => {
    const before = await licenseOf(id("beto"))
    const yesterday = addDaysToPlainDate(todayInChile(), -1)
    const result = await upsertDriverLicense(jefeA, input("beto", { classes: ["B"], expiresAt: yesterday, notes: "Renovación en trámite" }))

    expect(result.ok).toBe(true)
    // Vencida gana sobre «clase insuficiente».
    expect(result.ok && result.row).toMatchObject({ status: "vencida", license: { classes: ["B"], notes: "Renovación en trámite" } })

    const [entry] = await auditOf(id("beto"), "update")
    expect(entry).toMatchObject({ userId: JEFE_A, worksiteId: WS_A })
    expect(json(entry!.oldState)).toEqual({ classes: ["A5"], expiresAt: before!.expiresAt, notes: null })
    expect(json(entry!.newState)).toEqual({ classes: ["B"], expiresAt: yesterday, notes: "Renovación en trámite" })

    const after = await licenseOf(id("beto"))
    expect(after?.updatedByUserId).toBe(JEFE_A)
    expect(after?.updatedAt).not.toBe(before?.updatedAt)
  })

  it("guardar lo mismo no audita ni cambia nada", async () => {
    const first = await upsertDriverLicense(jefatura, input("ana"))
    const second = await upsertDriverLicense(jefatura, input("ana", { classes: ["A5", "A4"] }))
    expect(first.ok && second.ok).toBe(true)
    expect(await auditOf(id("ana"))).toHaveLength(1)
  })

  it("«sin fecha» y «sin observación» se guardan como null aunque el formulario mande cadenas vacías", async () => {
    const result = await upsertDriverLicense(jefatura, input("ana", {
      classes: ["B"], expiresAt: "" as unknown as null, notes: "   ",
    }))
    expect(result.ok).toBe(true)
    expect(await licenseOf(id("ana"))).toMatchObject({ expiresAt: null, notes: null })
  })

  it("valida y devuelve el error por campo, sin escribir", async () => {
    const none = await upsertDriverLicense(jefatura, input("ana", { classes: [] }))
    expect(none).toMatchObject({ ok: false, message: "Marca al menos una clase", fieldErrors: { classes: "Marca al menos una clase" } })

    const unknown = await upsertDriverLicense(jefatura, input("ana", { classes: ["Z"] as unknown as DriverLicenseClass[] }))
    expect(unknown.ok).toBe(false)
    expect(!unknown.ok && unknown.fieldErrors?.classes).toBeTruthy()

    const badDate = await upsertDriverLicense(jefatura, input("ana", { expiresAt: "2026-02-31" }))
    expect(!badDate.ok && badDate.fieldErrors?.expiresAt).toBeTruthy()

    const longNotes = await upsertDriverLicense(jefatura, input("ana", { notes: "x".repeat(301) }))
    expect(!longNotes.ok && longNotes.fieldErrors?.notes).toBeTruthy()

    expect(await licenseOf(id("ana"))).toBeUndefined()
    expect(await auditOf(id("ana"))).toEqual([])
  })

  it("un trabajador fuera de alcance responde igual que uno que no existe, y no se escribe", async () => {
    const outside = await upsertDriverLicense(jefeA, input("mario"))
    const missing = await upsertDriverLicense(jefeA, { ...input("ana"), workerId: "no-existe" })
    expect(outside).toEqual({ ok: false, message: "Trabajador no encontrado", fieldErrors: { workerId: "Trabajador no encontrado" } })
    expect(missing).toEqual(outside)
    expect(await licenseOf(id("mario"))).toBeUndefined()
    expect(await auditOf(id("mario"))).toEqual([])
  })

  it("no se registra licencia a un trabajador inactivo", async () => {
    const result = await upsertDriverLicense(jefatura, input("jaime"))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toMatch(/inactivo/)
    expect(await licenseOf(id("jaime"))).toBeUndefined()
  })

  it("sin `flota:manage_licenses` no escribe", async () => {
    const result = await upsertDriverLicense(sinPermiso, input("ana"))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/permisos/) })
    expect(await licenseOf(id("ana"))).toBeUndefined()
  })

  it("al registrar la licencia el trabajador sale de «sin licencia» y de los candidatos", async () => {
    expect((await listDriverCandidates(jefatura)).map((candidate) => candidate.name)).toContain("Ana Chofer")
    await upsertDriverLicense(jefatura, input("ana"))
    expect((await listDriverCandidates(jefatura)).map((candidate) => candidate.name)).not.toContain("Ana Chofer")
    expect((await getDriverRosterRow(jefatura, id("ana")))?.status).toBe("vigente")
  })
})

describe("removeDriverLicense", () => {
  it("quita la licencia y audita con el estado anterior", async () => {
    const result = await removeDriverLicense(jefatura, id("beto"))
    expect(result).toEqual({ ok: true })
    expect(await licenseOf(id("beto"))).toBeUndefined()

    const [entry] = await auditOf(id("beto"), "delete")
    expect(entry).toMatchObject({ entityType: "worker_driver_license", worksiteId: WS_A, userId: ADMIN })
    expect(json(entry!.oldState)).toMatchObject({ classes: ["A5"] })
    expect(entry?.newState).toBeNull()
  })

  it("quien la exige por su cargo vuelve a figurar «sin licencia»", async () => {
    await removeDriverLicense(jefatura, id("beto"))
    expect((await getDriverRosterRow(jefatura, id("beto")))?.status).toBe("sin_licencia")
  })

  it("quien no la exige sale de la nómina al quitársela", async () => {
    await removeDriverLicense(jefatura, id("eli"))
    expect(await getDriverRosterRow(jefatura, id("eli"))).toBeNull()
  })

  it("no hay nada que quitar si no tiene licencia, y no audita", async () => {
    const result = await removeDriverLicense(jefatura, id("ana"))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/no tiene una licencia/) })
    expect(await auditOf(id("ana"))).toEqual([])
  })

  it("fuera de alcance responde «no encontrado» y la licencia queda", async () => {
    const result = await removeDriverLicense(jefeA, id("nora"))
    expect(result).toEqual({ ok: false, message: "Trabajador no encontrado" })
    expect(await licenseOf(id("nora"))).toBeDefined()
    expect(await auditOf(id("nora"))).toEqual([])
  })

  it("sin `flota:manage_licenses` no quita nada", async () => {
    const result = await removeDriverLicense(sinPermiso, id("beto"))
    expect(result.ok).toBe(false)
    expect(await licenseOf(id("beto"))).toBeDefined()
  })
})

describe("writeDriverLicense (script de carga)", () => {
  it("crea, y volver a correrlo es idempotente: unchanged sin auditoría nueva", async () => {
    const data = input("ana", { notes: "LEY 21.806" })
    expect(await writeDriverLicense(testDb, data, actor, "Carga desde la planilla")).toBe("created")
    expect(await writeDriverLicense(testDb, data, actor, "Carga desde la planilla")).toBe("unchanged")
    // El orden en que llegan las clases no cuenta como cambio.
    expect(await writeDriverLicense(testDb, { ...data, classes: ["A5", "A4"] }, actor, "Carga desde la planilla")).toBe("unchanged")

    const entries = await auditOf(id("ana"))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ action: "create", reason: "Carga desde la planilla", userId: ADMIN, worksiteId: WS_A })
    expect(await licenseOf(id("ana"))).toMatchObject({ classes: ["A4", "A5"], notes: "LEY 21.806", updatedByUserId: ADMIN })
  })

  it("un cambio de clases, de fecha o de nota es «updated» y se audita", async () => {
    const base = input("ana")
    await writeDriverLicense(testDb, base, actor, "Carga")
    expect(await writeDriverLicense(testDb, { ...base, classes: ["A5"] }, actor, "Corrección")).toBe("updated")
    expect(await writeDriverLicense(testDb, { ...base, classes: ["A5"], expiresAt: null }, actor, "Corrección")).toBe("updated")
    expect(await writeDriverLicense(testDb, { ...base, classes: ["A5"], expiresAt: null, notes: "Prórroga por 6 meses" }, actor, "Corrección")).toBe("updated")
    expect(await auditOf(id("ana"), "update")).toHaveLength(3)
    expect(await licenseOf(id("ana"))).toMatchObject({ classes: ["A5"], expiresAt: null, notes: "Prórroga por 6 meses" })
  })

  it("escribe dentro del cliente que recibe: si la transacción se revierte, no queda licencia ni auditoría", async () => {
    await expect(testDb.transaction(async (tx) => {
      expect(await writeDriverLicense(tx, input("dani"), actor, "Carga")).toBe("created")
      throw new Error("revertir")
    })).rejects.toThrow("revertir")

    expect(await licenseOf(id("dani"))).toBeUndefined()
    expect(await auditOf(id("dani"))).toEqual([])
  })

  it("un trabajador que no existe o datos inválidos fallan en vez de escribir a medias", async () => {
    await expect(writeDriverLicense(testDb, { ...input("ana"), workerId: "no-existe" }, actor, "Carga")).rejects.toThrow(/no existe/)
    await expect(writeDriverLicense(testDb, input("ana", { classes: [] }), actor, "Carga")).rejects.toThrow()
    await expect(writeDriverLicense(testDb, input("ana", { classes: ["Z"] as unknown as DriverLicenseClass[] }), actor, "Carga")).rejects.toThrow()
    expect(await licenseOf(id("ana"))).toBeUndefined()
  })

  it("no verifica sesión ni alcance: lo usa un script con actor, y funciona con trabajadores de cualquier faena", async () => {
    expect(await writeDriverLicense(testDb, input("mario", { classes: ["A5"] }), actor, "Carga")).toBe("created")
    const [entry] = await auditOf(id("mario"))
    expect(entry?.worksiteId).toBe(WS_B)
  })
})

describe("loadDriverRosterForReminders", () => {
  it("devuelve toda la nómina activa sin alcance, con la faena de cada fila", async () => {
    const rows = await loadDriverRosterForReminders(todayInChile(), 30)
    expect(rows).toHaveLength(9)
    expect(new Set(rows.map((row) => row.worksiteId))).toEqual(new Set([WS_A, WS_B]))
    expect(rows.find((row) => row.name === "Mario ChoferB")).toMatchObject({ worksiteId: WS_B, status: "sin_licencia" })
    expect(rows.map((row) => row.name)).not.toContain("Jaime Inactivo")
  })

  it("el estado depende del «hoy» y de la ventana que reciba, no de lo que haya en la base", async () => {
    const today = todayInChile()
    const narrow = await loadDriverRosterForReminders(today, 3)
    expect(narrow.find((row) => row.name === "Nora SoldadoraB")?.status).toBe("vigente") // vence en 5 días
    const wide = await loadDriverRosterForReminders(today, 30)
    expect(wide.find((row) => row.name === "Nora SoldadoraB")?.status).toBe("por_vencer")
    const later = await loadDriverRosterForReminders(addDaysToPlainDate(today, 6), 30)
    expect(later.find((row) => row.name === "Nora SoldadoraB")?.status).toBe("vencida")
  })

  it("coincide con lo que la pantalla muestra a una jefatura global", async () => {
    const screen = (await listDriverRoster(jefatura)).rows
    const reminders = await loadDriverRosterForReminders(todayInChile(), 30)
    expect(reminders.map((row) => [row.workerId, row.status])).toEqual(screen.map((row) => [row.workerId, row.status]))
  })
})

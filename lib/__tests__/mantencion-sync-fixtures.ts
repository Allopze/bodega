import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from "@/lib/auth/system-rbac"
import { nameKey } from "@/lib/mantencion/normalize"
import { publishScheduleVersion } from "@/lib/services/mantencion/schedule-versions"
import { todayInChile } from "@/lib/utils"

/**
 * Fixtures mínimos para las pruebas PGlite de la sincronización de mantención:
 * roles y permisos REALES del módulo (para que `getUserRbacById` resuelva igual
 * que en producción), dos faenas, un puñado de equipos y una pauta publicada.
 */

export const IDS = {
  wsBio: "ws-bio", wsCho: "ws-cho", wsAra: "ws-ara",
  mecBio: "u-mec-bio", mecBio2: "u-mec-bio2", mecCho: "u-mec-cho", supBio: "u-sup-bio", jefe: "u-jefe", plain: "u-plain", inactive: "u-inactive",
  truckBio: "v-ka135", truckCho: "v-ka200", machineBio: "v-mq01", retired: "v-ka999", truckAra: "v-ka300",
  schKm: "sch-km", schH: "sch-h",
  brandScania: "b-scania", brandVolvo: "b-volvo",
  wtMec: "wt-mec", wtSold: "wt-sold", oilMotor: "oil-motor", oilTrans: "oil-trans", workshop: "wk-melo", driver1: "dr-1", driver2: "dr-2",
} as const

export function daysAgo(days: number): string {
  return todayInChile(new Date(Date.now() - days * 86_400_000))
}

const MANT_PERMISSIONS = SYSTEM_PERMISSIONS.filter((permission) => permission.module === "mantencion_equipos")
const MANT_ROLE_SLUGS = ["mecanico", "supervisor_mantencion", "jefe_mantencion"]

export async function seedMantFixtures(db: DB): Promise<void> {
  const now = new Date().toISOString()
  const roles = SYSTEM_ROLES.filter((role) => MANT_ROLE_SLUGS.includes(role.name))
  await db.insert(schema.roles).values([
    ...roles,
    { id: "rol-test-plain", name: "plain_test", label: "Sin mantención", description: "Sin permisos del módulo", isGlobal: false },
  ]).onConflictDoNothing()
  await db.insert(schema.permissions).values(MANT_PERMISSIONS).onConflictDoNothing()
  const permissionIds = new Set(MANT_PERMISSIONS.map((permission) => permission.id))
  await db.insert(schema.rolePermissions)
    .values(SYSTEM_ROLE_PERMISSIONS.filter((grant) => permissionIds.has(grant.permissionId) && roles.some((role) => role.id === grant.roleId)))
    .onConflictDoNothing()

  const person = (id: string, name: string, extra: Partial<typeof schema.users.$inferInsert> = {}) => ({
    id, name, email: `${id}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now, ...extra,
  })
  await db.insert(schema.users).values([
    person(IDS.mecBio, "Javier Roa"), person(IDS.mecBio2, "Deivis González"), person(IDS.mecCho, "Pedro Cholguán"),
    person(IDS.supBio, "Francisco Amestica"), person(IDS.jefe, "Alexis Morales"), person(IDS.plain, "Sin Permiso"),
    person(IDS.inactive, "Mecánico Inactivo", { isActive: false }),
  ])
  await db.insert(schema.userRoles).values([
    { userId: IDS.mecBio, roleId: "rol-mecanico" }, { userId: IDS.mecBio2, roleId: "rol-mecanico" }, { userId: IDS.mecCho, roleId: "rol-mecanico" },
    { userId: IDS.supBio, roleId: "rol-sup-mantencion" }, { userId: IDS.jefe, roleId: "rol-jefe-mant" },
    { userId: IDS.plain, roleId: "rol-test-plain" }, { userId: IDS.inactive, roleId: "rol-mecanico" },
  ])

  await db.insert(schema.worksites).values([
    { id: IDS.wsBio, name: "Biodiversa", code: "FN-BIO", isActive: true, createdAt: now, updatedAt: now },
    { id: IDS.wsCho, name: "Cholguán", code: "FN-CHO", isActive: true, createdAt: now, updatedAt: now },
    { id: IDS.wsAra, name: "Arauco", code: "FN-ARA", isActive: true, createdAt: now, updatedAt: now },
  ])
  // Cholguán queda SIN código de folio a propósito: el primer registro debe derivarlo (`ensureFolioCode`).
  await db.insert(schema.mantWorksiteSettings).values([{ worksiteId: IDS.wsBio, folioCode: "BIO" }, { worksiteId: IDS.wsAra, folioCode: "ARA" }])
  await db.insert(schema.worksiteUsers).values([
    { userId: IDS.mecBio, worksiteId: IDS.wsBio, isPrimary: true }, { userId: IDS.mecBio2, worksiteId: IDS.wsBio, isPrimary: true },
    { userId: IDS.mecCho, worksiteId: IDS.wsCho, isPrimary: true }, { userId: IDS.supBio, worksiteId: IDS.wsBio, isPrimary: true },
    { userId: IDS.inactive, worksiteId: IDS.wsBio, isPrimary: true },
  ])

  const catalog = (id: string, name: string) => ({ id, name, nameKey: nameKey(name) })
  await db.insert(schema.mantBrands).values([catalog(IDS.brandScania, "Scania"), catalog(IDS.brandVolvo, "Volvo")])
  await db.insert(schema.mantWorkTypes).values([catalog(IDS.wtMec, "Mecánico"), catalog(IDS.wtSold, "Soldadura")])
  await db.insert(schema.mantOils).values([catalog(IDS.oilMotor, "Motor"), catalog(IDS.oilTrans, "Transmisión")])
  await db.insert(schema.mantWorkshops).values([catalog(IDS.workshop, "Maestranza Melo")])
  await db.insert(schema.mantDrivers).values([catalog(IDS.driver1, "AEDO POLANCO JOSE A."), catalog(IDS.driver2, "BELTRAN IRARRAZAVAL HECTOR A.")])

  await db.insert(schema.fuelEquipmentTypes).values([
    { id: "fet-test-km", slug: "t-camion", name: "Camión", category: "truck", defaultMeterType: "odometer" },
    { id: "fet-test-h", slug: "t-maquina", name: "Excavadora", category: "heavy", defaultMeterType: "hour_meter" },
  ])
  await seedSchedules(db)

  const vehicle = (id: string, code: string, plate: string, worksiteId: string, typeId: string, isActive = true) => ({
    id, code, plate, type: "Camión", equipmentTypeId: typeId, worksiteId, isActive, model: "R450", year: 2021, brand: "Scania",
  })
  await db.insert(schema.fuelVehicles).values([
    vehicle(IDS.truckBio, "KA-135", "RBYD-98", IDS.wsBio, "fet-test-km"),
    vehicle(IDS.truckCho, "KA-200", "BCDF-12", IDS.wsCho, "fet-test-km"),
    vehicle(IDS.truckAra, "KA-300", "GHJK-34", IDS.wsAra, "fet-test-km"),
    vehicle(IDS.machineBio, "MQ-01", "MQ-01", IDS.wsBio, "fet-test-h"),
    vehicle(IDS.retired, "KA-999", "PRST-56", IDS.wsBio, "fet-test-km", false),
  ])
  await db.insert(schema.mantEquipmentProfiles).values([
    { vehicleId: IDS.truckBio, brandId: IDS.brandScania, scheduleId: IDS.schKm, initialReading: 10_000, initialReadingDate: daysAgo(200) },
    { vehicleId: IDS.truckCho, brandId: IDS.brandVolvo, scheduleId: IDS.schKm, initialReading: 20_000, initialReadingDate: daysAgo(200) },
    { vehicleId: IDS.truckAra, brandId: IDS.brandScania, scheduleId: IDS.schKm, initialReading: 5_000, initialReadingDate: daysAgo(200) },
    { vehicleId: IDS.machineBio, brandId: IDS.brandScania, scheduleId: IDS.schH, initialReading: 900, initialReadingDate: daysAgo(200), noPlate: true },
    { vehicleId: IDS.retired, brandId: IDS.brandScania, scheduleId: IDS.schKm, initialReading: 1_000, initialReadingDate: daysAgo(200), retiredReason: "Siniestro" },
  ])
}

/** Pauta km (10.000/20.000/40.000, 4 ítems, reglas por marca) y pauta h (300/600). */
async function seedSchedules(db: DB): Promise<void> {
  await db.insert(schema.mantSchedules).values([
    { id: IDS.schKm, name: "Camiones y tractos", nameKey: "camiones y tractos", unit: "km" },
    { id: IDS.schH, name: "Maquinaria pesada", nameKey: "maquinaria pesada", unit: "h" },
  ])
  await db.insert(schema.mantScheduleIntervals).values([
    ...[10_000, 20_000, 40_000].map((value) => ({ id: `int-km-${value}`, scheduleId: IDS.schKm, value })),
    ...[300, 600].map((value) => ({ id: `int-h-${value}`, scheduleId: IDS.schH, value })),
  ])
  await db.insert(schema.mantScheduleGroups).values([
    { id: "g-motor", scheduleId: IDS.schKm, name: "Motor", sortOrder: 0 },
    { id: "g-frenos", scheduleId: IDS.schKm, name: "Frenos", sortOrder: 1 },
    { id: "g-gen", scheduleId: IDS.schH, name: "General", sortOrder: 0 },
  ])
  const items = [
    { id: "i-k1", scheduleId: IDS.schKm, groupId: "g-motor", itemKey: "k1", name: "Revisión aceite motor", sortOrder: 0, applies: [true, true, true] },
    { id: "i-k2", scheduleId: IDS.schKm, groupId: "g-motor", itemKey: "k2", name: "Cambio filtro aire", sortOrder: 1, applies: [false, true, true] },
    { id: "i-k3", scheduleId: IDS.schKm, groupId: "g-motor", itemKey: "k3", name: "Regulación válvulas", sortOrder: 2, applies: [false, false, true] },
    { id: "i-k4", scheduleId: IDS.schKm, groupId: "g-frenos", itemKey: "k4", name: "Revisión pastillas", sortOrder: 0, applies: [true, true, true] },
    { id: "i-h1", scheduleId: IDS.schH, groupId: "g-gen", itemKey: "h1", name: "Inspección general", sortOrder: 0, applies: [true, true] },
  ]
  await db.insert(schema.mantScheduleItems).values(items.map(({ applies: _applies, ...item }) => item))
  await db.insert(schema.mantScheduleItemIntervals).values(items.flatMap((item) => {
    const values = item.scheduleId === IDS.schKm ? [10_000, 20_000, 40_000] : [300, 600]
    const prefix = item.scheduleId === IDS.schKm ? "int-km" : "int-h"
    return item.applies.map((applies, index) => ({ itemId: item.id, intervalId: `${prefix}-${values[index]}`, applies }))
  }))
  // Scania: «Revisión pastillas» se confirma con el fabricante (W). Volvo: no aplica (X).
  await db.insert(schema.mantScheduleBrandRules).values([
    { id: "r-1", scheduleId: IDS.schKm, itemId: "i-k4", sheetActivity: "Revisión pastillas", brandId: IDS.brandScania, value: "W" },
    { id: "r-2", scheduleId: IDS.schKm, itemId: "i-k4", sheetActivity: "Revisión pastillas", brandId: IDS.brandVolvo, value: "X" },
  ])
  for (const scheduleId of [IDS.schKm, IDS.schH]) {
    await db.transaction((tx) => publishScheduleVersion(tx, { scheduleId, userId: null, summary: "Versión inicial de pruebas", initial: true }))
  }
}

/** Una foto ya subida (huérfana), sin archivo en disco: basta para la validación del registro. */
export async function insertOrphanPhoto(db: DB, input: { id: string; userId: string; kind: "filtros" | "sticker" | "correctiva" }): Promise<void> {
  await db.insert(schema.mantRecordPhotos).values({
    id: input.id, recordId: null, kind: input.kind, storageKey: `storage/mantencion/${input.id}.jpg`, mimeType: "image/jpeg",
    sha256: "0".repeat(64), bytes: 1000, width: 100, height: 100, stampedAt: new Date().toISOString(), uploadedBy: input.userId,
  })
}

export async function recordRows(db: DB, id?: string) {
  return db.select().from(schema.mantRecords).where(id ? eq(schema.mantRecords.id, id) : undefined)
}

import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { parseControlFilters, type ControlFilters } from "../filters"

/**
 * Datos de prueba compartidos por las consultas de sellos, conciliación y
 * ralentí: tres faenas (A y B del mandante M1, C del mandante M2), un equipo por
 * faena y un punto de carga fijo y uno de estanque en A. No es una prueba:
 * lo importan las pruebas PGlite de esta carpeta.
 */
export const IDS = {
  wsA: "ws-ctl-a", wsB: "ws-ctl-b", wsC: "ws-ctl-c",
  m1: "mand-ctl-1", m2: "mand-ctl-2",
  vA: "veh-ctl-a", vB: "veh-ctl-b", vC: "veh-ctl-c",
  lpFixed: "lp-ctl-fixed", lpTank: "lp-ctl-tank", lpTae: "lp-ctl-tae",
  product: "prod-ctl", eqType: "fet-ctl", user: "user-ctl", run: "run-ctl",
  mediumTct: "fsm-tct", mediumCmpc: "fsm-cmpc", mediumAramco: "fsm-aramco",
} as const

export function globalSession(): Session {
  return { user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions: [] }, expires: "2099-01-01" } as unknown as Session
}

export function scopedSession(worksiteIds: string[]): Session {
  return { user: { id: IDS.user, isGlobal: false, roles: [], worksiteIds, permissions: [] }, expires: "2099-01-01" } as unknown as Session
}

export function filtersFor(params: Record<string, string> = {}): ControlFilters {
  return parseControlFilters({ anio: "2026", ...params })
}

export async function seedControlFixtures(db: DB): Promise<void> {
  await db.insert(schema.users).values({ id: IDS.user, name: "QA", email: "qa-ctl@example.cl", hashedPassword: "x", isActive: true })
  await db.insert(schema.worksites).values([
    { id: IDS.wsA, name: "Faena A", code: "CTL-A" },
    { id: IDS.wsB, name: "Faena B", code: "CTL-B" },
    { id: IDS.wsC, name: "Faena C", code: "CTL-C" },
  ])
  await db.insert(schema.fuelMandantes).values([
    { id: IDS.m1, name: "Mandante Uno", tolerancePct: 2 },
    { id: IDS.m2, name: "Mandante Dos", tolerancePct: 5 },
  ])
  await db.insert(schema.fuelMandanteWorksites).values([
    { worksiteId: IDS.wsA, mandanteId: IDS.m1 },
    { worksiteId: IDS.wsB, mandanteId: IDS.m1 },
    { worksiteId: IDS.wsC, mandanteId: IDS.m2 },
  ])
  await db.insert(schema.fuelProducts).values({ id: IDS.product, code: "ctl-diesel", name: "Diésel", category: "diesel" })
  await db.insert(schema.fuelEquipmentTypes).values({ id: IDS.eqType, slug: "ctl-tipo", name: "Tipo de prueba", category: "heavy", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour" })
  await db.insert(schema.fuelVehicles).values([
    { id: IDS.vA, plate: "AA-0001", code: "KA-1", type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter", performanceUnit: "liters_per_hour", worksiteId: IDS.wsA },
    { id: IDS.vB, plate: "BB-0002", code: "KB-2", type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter", performanceUnit: "liters_per_hour", worksiteId: IDS.wsB },
    { id: IDS.vC, plate: "CC-0003", code: null, type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter", performanceUnit: "liters_per_hour", worksiteId: IDS.wsC },
  ])
  await db.insert(schema.fuelTaeLoadingPoints).values([
    { id: IDS.lpFixed, worksiteId: IDS.wsA, name: "Surtidor fijo", type: "fixed_dispenser" },
    { id: IDS.lpTank, worksiteId: IDS.wsA, name: "Estanque camioneta", type: "pickup_tank" },
    { id: IDS.lpTae, worksiteId: IDS.wsA, name: "Punto TAE", type: "tae" },
  ])
}

let counter = 0

/** Un envío de terreno con valores por defecto válidos; `overrides` pisa lo que la prueba necesite. */
export function submission(overrides: Partial<typeof schema.fuelTaeSubmissions.$inferInsert> = {}): typeof schema.fuelTaeSubmissions.$inferInsert {
  counter += 1
  return {
    id: `sub-ctl-${counter}`,
    clientSubmissionId: `client-ctl-${counter}`,
    publicResultToken: `token-ctl-${counter}`,
    worksiteId: IDS.wsA,
    vehicleId: IDS.vA,
    productId: IDS.product,
    equipmentCodeSnapshot: "KA-1",
    loadedAt: "2026-03-10T15:00:00.000Z",
    submittedAt: "2026-03-10T15:00:00.000Z",
    driverNameSnapshot: "Conductor Uno",
    supervisorNameSnapshot: "Supervisor Pérez",
    meterType: "hour_meter",
    meterReading: 100 + counter,
    liters: 100,
    removedSealNumber: "R-1",
    installedSealNumber: "I-1",
    ...overrides,
  }
}

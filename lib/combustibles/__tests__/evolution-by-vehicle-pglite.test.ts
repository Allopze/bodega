import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, globalSession, scopedSession, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"
import { buildEvolutionPanels } from "../evolution-panels"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = db
vi.mock("@/db", () => ({ get db() { return g.__db } }))
// `can()` real arrastra next-auth y next/headers; sólo se necesita el chequeo de permisos de la sesión.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

const { getEvolutionByVehicle } = await import("../consumption-dashboard")

/**
 * «Evolución por equipo» (small multiples) lee los reportes de tarjeta por patente y período. El alcance es el de la faena del
 * reporte: un usuario de la faena A no puede ver ni un litro de la faena B, ni siquiera en un panel «de otro equipo».
 */

const sessionWith = (base: Session, permissions: string[]): Session => ({ ...base, user: { ...base.user, permissions } }) as Session
const VIEW = ["combustibles:view"]

let n = 0
async function addRecord(input: { batch: string; worksiteId: string; vehicleId: string | null; plate: string; from: string; to: string; liters: number; amount?: number }) {
  n += 1
  await db.insert(schema.fuelConsumptionRecords).values({
    id: `rec-ev-${n}`, batchId: input.batch, worksiteId: input.worksiteId, vehicleId: input.vehicleId, patente: input.plate,
    cantidadUnidad: input.liters, monto: input.amount ?? input.liters * 1_000, periodoDesde: input.from, periodoHasta: input.to,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(db)
  for (const [id, worksiteId] of [["batch-ev-a", IDS.wsA], ["batch-ev-b", IDS.wsB]] as const) {
    await db.insert(schema.fuelImportBatches).values({
      id, worksiteId, fuente: "Copec", periodoDesde: "2026-05-01", periodoHasta: "2026-08-31", archivoNombre: `${id}.xlsx`, hashArchivo: `hash-${id}`, importadoPor: IDS.user,
    })
  }
  const months = [["2026-05-01", "2026-05-31"], ["2026-06-01", "2026-06-30"], ["2026-07-01", "2026-07-31"], ["2026-08-01", "2026-08-31"]] as const
  for (const [index, [from, to]] of months.entries()) {
    await addRecord({ batch: "batch-ev-a", worksiteId: IDS.wsA, vehicleId: IDS.vA, plate: "AA-0001", from, to, liters: 400 + index * 50 })
    await addRecord({ batch: "batch-ev-b", worksiteId: IDS.wsB, vehicleId: IDS.vB, plate: "BB-0002", from, to, liters: 900 + index * 10 })
  }
  // Una patente fuera de la flota (sin vehículo asociado) de la faena A, y un segundo reporte de AA-0001 el mismo mes.
  await addRecord({ batch: "batch-ev-a", worksiteId: IDS.wsA, vehicleId: null, plate: "ZZ-9999", from: "2026-06-01", to: "2026-06-30", liters: 70 })
  await addRecord({ batch: "batch-ev-a", worksiteId: IDS.wsA, vehicleId: IDS.vA, plate: "AA-0001", from: "2026-06-01", to: "2026-06-30", liters: 25 })
}, 60_000)

const WINDOW = { fromDate: "2026-05-01", toDate: "2026-08-31" }

describe("getEvolutionByVehicle · alcance", () => {
  it("un usuario de la faena A ve sólo patentes de A: ni una hora ni un litro de B llega a los paneles", async () => {
    const points = await getEvolutionByVehicle(sessionWith(scopedSession([IDS.wsA]), VIEW), WINDOW)

    expect(new Set(points.map((point) => point.plate))).toEqual(new Set(["AA-0001", "ZZ-9999"]))
    const view = buildEvolutionPanels(points)
    expect(view.panels.map((panel) => panel.plate)).toEqual(["AA-0001", "ZZ-9999"])
    expect(view.allLiters).toBe(400 + 450 + 500 + 550 + 25 + 70)
  })

  it("el filtro de faena se intersecta con el alcance: pedir la B desde la A no abre la B", async () => {
    const points = await getEvolutionByVehicle(sessionWith(scopedSession([IDS.wsA]), VIEW), { ...WINDOW, worksiteId: IDS.wsB })

    expect(points).toEqual([])
  })

  it("un usuario sin faenas no ve nada", async () => {
    expect(await getEvolutionByVehicle(sessionWith(scopedSession([]), VIEW), WINDOW)).toEqual([])
  })

  it("con alcance global se ven las dos faenas, y el filtro de faena acota a una", async () => {
    const all = await getEvolutionByVehicle(sessionWith(globalSession(), VIEW), WINDOW)
    expect(new Set(all.map((point) => point.plate))).toEqual(new Set(["AA-0001", "BB-0002", "ZZ-9999"]))
    const onlyB = await getEvolutionByVehicle(sessionWith(globalSession(), VIEW), { ...WINDOW, worksiteId: IDS.wsB })
    expect(new Set(onlyB.map((point) => point.plate))).toEqual(new Set(["BB-0002"]))
  })
})

describe("getEvolutionByVehicle · ventana", () => {
  it("la ventana de meses del gráfico (no el período de la pantalla) decide qué períodos entran: de mayo a agosto hay cuatro puntos por equipo", async () => {
    const view = buildEvolutionPanels(await getEvolutionByVehicle(sessionWith(globalSession(), VIEW), { ...WINDOW, worksiteId: IDS.wsA }))

    expect(view.periods).toEqual(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"])
    // Sólo agosto: un único período, el estado «hace falta otro período» que la pantalla explica en vez de dibujar puntos sueltos.
    const one = buildEvolutionPanels(await getEvolutionByVehicle(sessionWith(globalSession(), VIEW), { fromDate: "2026-08-01", toDate: "2026-08-31", worksiteId: IDS.wsA }))
    expect(one.periods).toEqual(["2026-08-01"])
  })

  it("dos reportes del mismo equipo y período se suman en un solo punto", async () => {
    const view = buildEvolutionPanels(await getEvolutionByVehicle(sessionWith(globalSession(), VIEW), { ...WINDOW, worksiteId: IDS.wsA }))

    const june = view.panels.find((panel) => panel.plate === "AA-0001")!.series.find((item) => item.periodo === "2026-06-01")
    expect(june!.liters).toBe(450 + 25)
  })

  it("la patente fuera de la flota llega sin vehículo, así que su panel no enlaza a ninguna ficha", async () => {
    const view = buildEvolutionPanels(await getEvolutionByVehicle(sessionWith(globalSession(), VIEW), { ...WINDOW, worksiteId: IDS.wsA }))

    expect(view.panels.find((panel) => panel.plate === "ZZ-9999")!.vehicleId).toBeNull()
    expect(view.panels.find((panel) => panel.plate === "AA-0001")!.vehicleId).toBe(IDS.vA)
  })
})

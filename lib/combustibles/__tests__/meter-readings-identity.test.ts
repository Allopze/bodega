import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"
import { saveMeterReadings, type ParsedMeterReading } from "../meter-readings"

// Contra el esquema real: lo que se prueba es el índice único y el ON CONFLICT
// que lo usa, y eso no se puede simular con un mock.
const pg = new PGlite()
const db = drizzle(pg, { schema })
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const worksiteId = nanoid()
const equipmentTypeId = nanoid()
await db.insert(schema.worksites).values({ id: worksiteId, name: "Faena lecturas", code: `ML-${nanoid().slice(0, 6)}`, isActive: true })
await db.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `ml-camion-${nanoid().slice(0, 6)}`, name: "Camión lecturas" })
const vehicles = { "SRCJ-47": nanoid(), "TBZW-37": nanoid() } as const
await db.insert(schema.fuelVehicles).values(Object.entries(vehicles).map(([plate, id]) => ({
  id, plate, type: "camion", equipmentTypeId, worksiteId, meterType: "odometer", isActive: true,
})))

const resolve = (plate: string) => {
  const id = vehicles[plate as keyof typeof vehicles]
  return id ? { id, meterType: "odometer" } : undefined
}

function reading(plate: string, sourceRef: string, value: number, occurredAt: string): ParsedMeterReading {
  return { plate, sourceRef, occurredAt, sourceDate: occurredAt.slice(0, 10), value, liters: 100, stationName: null, cardNumber: null, providerPerformance: null, rawPayload: {} }
}

const stored = (sourceRef: string) => db.select({ plate: schema.fuelMeterReadings.plate, value: schema.fuelMeterReadings.value })
  .from(schema.fuelMeterReadings).where(eq(schema.fuelMeterReadings.sourceRef, sourceRef)).orderBy(asc(schema.fuelMeterReadings.plate))

describe("identidad de las lecturas de odómetro", () => {
  // ene-2026, real: Copec usó la guía 660150998 para SRCJ-47 y TBZW-37. Con la
  // identidad (fuente, guía) el período entero caía con 21000.
  it("guarda las dos cargas cuando Copec reutiliza la guía entre vehículos", async () => {
    const batch = [reading("SRCJ-47", "660150998", 335_634, "2026-01-15T20:59:43.000Z"), reading("TBZW-37", "660150998", 77_582, "2026-01-16T00:18:05.000Z")]
    await expect(saveMeterReadings(db as never, "copec_tct", batch, resolve)).resolves.toEqual({ saved: 2, unresolved: 0 })
    expect(await stored("660150998")).toEqual([{ plate: "SRCJ-47", value: 335_634 }, { plate: "TBZW-37", value: 77_582 }])

    // Reimportar el mes no duplica: misma clave, misma fila.
    await saveMeterReadings(db as never, "copec_tct", batch, resolve)
    expect(await stored("660150998")).toHaveLength(2)
  })

  it("una fila repetida en el mismo archivo no tumba el lote: gana la última", async () => {
    const batch = [reading("SRCJ-47", "660400001", 340_000, "2026-02-01T12:00:00.000Z"), reading("SRCJ-47", "660400001", 340_010, "2026-02-01T12:00:00.000Z")]
    await expect(saveMeterReadings(db as never, "copec_tct", batch, resolve)).resolves.toEqual({ saved: 1, unresolved: 0 })
    expect(await stored("660400001")).toEqual([{ plate: "SRCJ-47", value: 340_010 }])
  })

  it("una guía reutilizada en otro mes no pisa la lectura del otro vehículo", async () => {
    await saveMeterReadings(db as never, "copec_tct", [reading("SRCJ-47", "660500001", 341_000, "2026-03-01T12:00:00.000Z")], resolve)
    await saveMeterReadings(db as never, "copec_tct", [reading("TBZW-37", "660500001", 80_000, "2026-04-01T12:00:00.000Z")], resolve)
    expect(await stored("660500001")).toEqual([{ plate: "SRCJ-47", value: 341_000 }, { plate: "TBZW-37", value: 80_000 }])
  })
})

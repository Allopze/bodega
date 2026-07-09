import { readFile } from "node:fs/promises"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "@/db/schema"

interface PatenteChileRow {
  patente: string
  tipo_vehiculo: string
  marca: string
  modelo: string
  numero_motor?: string
  año?: number
  anio?: number
}

loadEnvConfig(process.cwd())

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required")
  process.exit(1)
}

function normalizePlate(value: string): string {
  const raw = value.replace(/[^A-Z0-9]/gi, "").toUpperCase()
  return raw.length === 6 ? `${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4)}` : raw
}

function normalizeType(value: string): string {
  const clean = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^MAQ\.\s*/i, "MAQUINA ")
    .replace(/^MAQUINAINDUSTRIAL$/i, "MAQUINA INDUSTRIAL")
    .toLowerCase()

  return clean
}

function vehicleIdFromPlate(plate: string): string {
  return `fv-cl-${plate.replace(/[^a-z0-9]/gi, "").toLowerCase()}`
}

async function main() {
  const filePath = path.join(process.cwd(), "storage", "patentes_chile.json")
  const rows = JSON.parse(await readFile(filePath, "utf8")) as PatenteChileRow[]

  // Requiere un worksiteId (worksiteId es NOT NULL en fuelVehicles)
  const worksiteId = process.env.FUEL_VEHICLE_WORKSITE_ID ?? process.argv[2]
  if (!worksiteId) {
    console.error("Uso: npx tsx scripts/import-patentes-chile.ts <worksiteId>")
    console.error("  o define FUEL_VEHICLE_WORKSITE_ID en .env.local")
    process.exit(1)
  }

  const client = postgres(process.env.DATABASE_URL!, { max: 1 })
  const db = drizzle(client, { schema })

  let inserted = 0
  let updated = 0
  let skipped = 0

  try {
    for (const row of rows) {
      const plate = normalizePlate(row.patente)
      const vehicle = {
        id: vehicleIdFromPlate(plate),
        plate,
        type: normalizeType(row.tipo_vehiculo),
        brand: row.marca.trim(),
        model: row.modelo.trim(),
        year: row.año ?? row.anio ?? null,
        worksiteId,
        isActive: true,
        notes: row.numero_motor ? `Numero motor: ${row.numero_motor.trim()}` : null,
      } satisfies typeof schema.fuelVehicles.$inferInsert

      const existing = await db.query.fuelVehicles.findFirst({
        where: eq(schema.fuelVehicles.plate, plate),
      })

      if (!existing) {
        await db.insert(schema.fuelVehicles).values(vehicle)
        inserted += 1
        continue
      }

      if (existing.id === vehicle.id) {
        await db.update(schema.fuelVehicles)
          .set({
            type: vehicle.type,
            brand: vehicle.brand,
            model: vehicle.model,
            year: vehicle.year,
            notes: vehicle.notes,
            isActive: true,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.fuelVehicles.id, existing.id))
        updated += 1
        continue
      }

      skipped += 1
      console.log(`Patente existente con otro id, omitida: ${plate} (${existing.id})`)
    }
  } finally {
    await client.end()
  }

  console.log(`Vehiculos procesados: ${rows.length}`)
  console.log(`Insertados: ${inserted}`)
  console.log(`Actualizados: ${updated}`)
  console.log(`Omitidos: ${skipped}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

/**
 * Seed data for the Combustibles module.
 * Creates initial fuel vehicles, fuel suppliers, and IEC rate settings.
 * Run with: npx tsx db/seed-combustibles.ts
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { loadEnvConfig } from "@next/env"
import * as schema from "./schema"
import { eq } from "drizzle-orm"

loadEnvConfig(process.cwd())

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required")
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })

async function main() {
  console.log("🔧 Seeding combustibles module...")

  // Resolve a worksite — worksiteId is NOT NULL on fuelVehicles now
  const worksitesList = await db.query.worksites.findMany({
    where: eq(schema.worksites.isActive, true),
    limit: 1,
  })
  if (worksitesList.length === 0) {
    console.error("No hay faenas activas en la base de datos. Crea al menos una faena antes de ejecutar este seed.")
    process.exit(1)
  }
  const worksiteId = worksitesList[0]!.id
  console.log(`  Usando faena: ${worksitesList[0]!.name} (${worksiteId})`)

  const FUEL_VEHICLES: (typeof schema.fuelVehicles.$inferInsert)[] = [
    { id: "fv-camion-01", plate: "XX-XX-01", type: "camion", equipmentTypeId: "fet-camion", meterType: "odometer", performanceUnit: "km_per_liter", brand: "Hyundai", model: "HD78", year: 2020, worksiteId, isActive: true },
    { id: "fv-camion-02", plate: "XX-XX-02", type: "camion", equipmentTypeId: "fet-camion", meterType: "odometer", performanceUnit: "km_per_liter", brand: "Hyundai", model: "HD78", year: 2021, worksiteId, isActive: true },
    { id: "fv-camioneta-01", plate: "XX-XX-03", type: "camioneta", equipmentTypeId: "fet-camioneta", meterType: "odometer", performanceUnit: "km_per_liter", brand: "Toyota", model: "Hilux", year: 2022, worksiteId, isActive: true },
    { id: "fv-camioneta-02", plate: "XX-XX-04", type: "camioneta", equipmentTypeId: "fet-camioneta", meterType: "odometer", performanceUnit: "km_per_liter", brand: "Toyota", model: "Hilux", year: 2023, worksiteId, isActive: true },
    { id: "fv-estanque-01", plate: "XX-XX-05", type: "estanque", equipmentTypeId: "fet-estanque", meterType: "none", performanceUnit: "not_applicable", brand: "Mercedes-Benz", model: "Actros", year: 2019, worksiteId, isActive: true },
  ]

  const FUEL_SUPPLIERS: (typeof schema.fuelSuppliers.$inferInsert)[] = [
    { id: "fs-copec", name: "COPEC", rut: "97.080.000-1", contactName: "Área Cuenta Corriente", isActive: true },
    { id: "fs-aramco", name: "ARAMCO", rut: "76.320.590-7", contactName: "Ventas Corporativas", isActive: true },
  ]

  const FUEL_SETTINGS: (typeof schema.systemSettings.$inferInsert)[] = [
    { key: "fuel:iec_fixed_rate", value: "104.67" },     // CLP por litro - IEC Fijo
    { key: "fuel:iec_variable_rate", value: "82.07" },   // CLP por litro - IEC Variable
  ]

  // Seed fuel vehicles
  for (const vehicle of FUEL_VEHICLES) {
    const existing = await db.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, vehicle.id) })
    if (!existing) {
      await db.insert(schema.fuelVehicles).values(vehicle)
      console.log(`  ✓ Vehículo: ${vehicle.plate} (${vehicle.type})`)
    } else {
      console.log(`  · Vehículo ya existe: ${vehicle.plate}`)
    }
  }

  // Seed fuel suppliers
  for (const supplier of FUEL_SUPPLIERS) {
    const existing = await db.query.fuelSuppliers.findFirst({ where: eq(schema.fuelSuppliers.id, supplier.id) })
    if (!existing) {
      await db.insert(schema.fuelSuppliers).values(supplier)
      console.log(`  ✓ Proveedor: ${supplier.name}`)
    } else {
      console.log(`  · Proveedor ya existe: ${supplier.name}`)
    }
  }

  // Seed system settings for IEC rates
  for (const setting of FUEL_SETTINGS) {
    const existing = await db.query.systemSettings.findFirst({ where: eq(schema.systemSettings.key, setting.key) })
    if (!existing) {
      await db.insert(schema.systemSettings).values(setting)
      console.log(`  ✓ Setting: ${setting.key} = ${setting.value}`)
    } else {
      // Update if exists
      await db.update(schema.systemSettings).set({ value: setting.value, updatedAt: new Date().toISOString() }).where(eq(schema.systemSettings.key, setting.key))
      console.log(`  · Setting actualizado: ${setting.key} = ${setting.value}`)
    }
  }

  console.log("\n✅ Combustibles seed completado.")
  await client.end()
}

main().catch((e) => {
  console.error("Seed error:", e)
  process.exit(1)
})

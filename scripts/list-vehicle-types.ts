/**
 * Reporte de tipos heredados de vehículo.
 *
 * Lee fuel_vehicles.type de la base y clasifica cada valor:
 * - canónico (en FUEL_VEHICLE_TYPES o FUEL_VEHICLE_TYPE_ALIASES)
 * - heredado sin alias (requiere decisión manual)
 *
 * Solo lectura. Ejecutar con:
 *   npx tsx scripts/list-vehicle-types.ts
 */

import postgres from "postgres"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL es requerido")

const sql = postgres(databaseUrl, { max: 1 })

const FUEL_VEHICLE_TYPES = [
  "camion", "camioneta", "estanque",
  "cargador", "tractor", "excavadora", "bulldozer", "minicargador",
  "retroexcavadora", "hidrolavadora", "tracto", "station_wagon", "camion_3_4",
] as const

const FUEL_VEHICLE_TYPE_LABELS: Record<string, string> = {
  camion: "Camión", camioneta: "Camioneta", estanque: "Estanque",
  cargador: "Cargador", tractor: "Tractor", excavadora: "Excavadora",
  bulldozer: "Bulldozer", minicargador: "Minicargador",
  retroexcavadora: "Retroexcavadora", hidrolavadora: "Hidrolavadora",
  tracto: "Tracto", station_wagon: "Station wagon", camion_3_4: "Camión 3/4",
}

const FUEL_VEHICLE_TYPE_ALIASES: Record<string, string> = {
  "camion 3/4": "camion_3_4",
  "mini cargador": "minicargador",
  "retro excavadora": "retroexcavadora",
  "hidro lavadora": "hidrolavadora",
  tractocamion: "tracto",
  "station wagon": "station_wagon",
}

function normalize(t: string) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es-CL").replace(/\s+/g, " ")
}

function canonicalType(raw: string) {
  const n = normalize(raw)
  if ((FUEL_VEHICLE_TYPES as readonly string[]).includes(n)) return n
  return FUEL_VEHICLE_TYPE_ALIASES[n] ?? null
}

interface CountByType { raw: string; count: number }
interface VehicleRow { count: number; types_json: string }

async function main() {
  const [distinct, total] = await Promise.all([
    sql<CountByType[]>`
      select "type" as raw, count(*)::int as count
      from fuel_vehicles
      group by "type"
      order by "type"
    `,
    sql<VehicleRow[]>`select count(*)::int as count, json_agg("type") as types_json from fuel_vehicles`,
  ])

  console.log("=== Tipos de vehículo en fuel_vehicles ===\n")
  console.log(`Total vehículos: ${total[0]!.count}`)
  console.log(`Tipos distintos: ${distinct.length}\n`)

  for (const row of distinct) {
    const canonical = canonicalType(row.raw)
    if (canonical && canonical === normalize(row.raw)) {
      const label = FUEL_VEHICLE_TYPE_LABELS[canonical] ?? canonical
      console.log(`[canónico] ${row.raw} → ${label} (${row.count})`)
    } else if (canonical) {
      const label = FUEL_VEHICLE_TYPE_LABELS[canonical] ?? canonical
      console.log(`[alias]    ${row.raw} → ${label} (${row.count})`)
    } else {
      console.log(`[heredado] ${row.raw} (${row.count}) — sin alias, revisar`)
    }
  }

  const unclassified = distinct.filter((row) => !canonicalType(row.raw))
  if (unclassified.length > 0) {
    console.log(`\n⚠ ${unclassified.length} tipo(s) sin alias. Agregar a FUEL_VEHICLE_TYPE_ALIASES si corresponden:`)
    for (const row of unclassified) {
      console.log(`  "${row.raw}": ""`)
    }
  } else {
    console.log("\nTodos los tipos están clasificados (canónicos o con alias).")
  }

  await sql.end({ timeout: 5 })
}

main().catch(async (error) => {
  console.error("[list-vehicle-types] falló:", error)
  await sql.end({ timeout: 5 }).catch(() => {})
  process.exitCode = 1
})

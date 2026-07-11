/**
 * Verificador de calidad de datos de solo lectura.
 *
 * Ejecuta consultas contra DATABASE_URL con conteos de anomalías:
 * - Unidades no registradas en el maestro
 * - Flags EPP/Prevención divergentes entre categoría y producto
 * - Vencimientos faltantes en vehículos
 * - Proveedores duplicados por RUT (general y combustible)
 * - Responsables/hojas PDTP sin estado de actividad
 *
 * Solo lectura. No modifica datos. Ejecutar con:
 *   npx tsx scripts/verify-data-quality.ts
 */

import postgres from "postgres"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL es requerido")

const sql = postgres(databaseUrl, { max: 1 })

type CountRow = { count: number }
type StringRow = { value: string; count: number }

async function main() {
  console.log("=== Verificador de calidad de datos (solo lectura) ===\n")

  // ── Unidades no registradas ──
  const orphanUnits = await sql<CountRow[]>`
    select count(*)::int as count
    from products p
    where p.is_active = true
      and not exists (select 1 from product_units u where u.is_active = true and u.name = p.unit_of_measure)
  `
  console.log(`[unidades] productos activos con unidad fuera del maestro: ${orphanUnits[0]!.count}`)

  // ── Flags EPP/Prevención divergentes ──
  const eppDivergent = await sql<CountRow[]>`
    select count(*)::int as count
    from products p
    join product_categories c on c.id = p.category_id
    where p.is_active = true
      and c.is_active = true
      and (
        p.is_epp != c.is_epp
        or p.requires_prevencion != c.requires_prevencion
      )
  `
  console.log(`[epp/prev] productos con flags EPP/Prevención divergentes de su categoría: ${eppDivergent[0]!.count}`)

  // ── Productos sin proveedor preferido ──
  const withoutPreferred = await sql<CountRow[]>`
    select count(*)::int as count
    from products p
    where p.is_active = true
      and not exists (
        select 1 from product_suppliers ps
        where ps.product_id = p.id and ps.is_preferred = true
      )
  `
  console.log(`[productos] productos activos sin proveedor preferido: ${withoutPreferred[0]!.count}`)

  // ── Productos sin precio referencial ──
  const withoutPrice = await sql<CountRow[]>`
    select count(*)::int as count
    from products p
    where p.is_active = true
      and p.reference_price is null
  `
  console.log(`[productos] productos activos sin precio referencial: ${withoutPrice[0]!.count}`)

  // ── Vencimientos de vehículos ──
  const now = new Date().toISOString()
  const expiredVehicles = await sql<CountRow[]>`
    select count(*)::int as count
    from fuel_vehicles fv
    where fv.is_active = true
      and (
        fv.soap_expires_at < ${now}
        or fv.technical_inspection_expires_at < ${now}
        or fv.circulation_permit_expires_at < ${now}
        or fv.insurance_expires_at < ${now}
      )
  `
  console.log(`[flota] vehículos activos con al menos un vencimiento expirado: ${expiredVehicles[0]!.count}`)

  // ── Vehículos sin ninguna fecha de vigencia ──
  const withoutDates = await sql<CountRow[]>`
    select count(*)::int as count
    from fuel_vehicles fv
    where fv.is_active = true
      and fv.soap_expires_at is null
      and fv.technical_inspection_expires_at is null
      and fv.circulation_permit_expires_at is null
      and fv.insurance_expires_at is null
  `
  console.log(`[flota] vehículos activos sin ninguna fecha de vigencia: ${withoutDates[0]!.count}`)

  // ── Proveedores duplicados por RUT (generales) ──
  const dupRutGeneral = await sql<StringRow[]>`
    select rut as value, count(*)::int as count
    from suppliers
    where rut is not null and is_active = true
    group by rut
    having count(*) > 1
  `
  for (const row of dupRutGeneral) {
    console.log(`[proveedores] RUT duplicado (general): ${row.value} (${row.count} registros)`)
  }
  if (dupRutGeneral.length === 0) console.log("[proveedores] sin RUT duplicados en proveedores generales")

  // ── Proveedores RUT divergentes entre general y combustible ──
  const rutMismatch = await sql<{ fuel_id: string; fuel_rut: string; general_rut: string }[]>`
    select
      fs.id as fuel_id,
      fs.rut as fuel_rut,
      s.rut as general_rut
    from fuel_suppliers fs
    join suppliers s on s.id = fs.supplier_id
    where fs.rut is not null
      and s.rut is not null
      and fs.is_active = true
      and s.is_active = true
      and fs.rut != s.rut
  `
  for (const row of rutMismatch) {
    console.log(`[proveedores] RUT divergente general/combustible: ${row.fuel_id} (fuel: ${row.fuel_rut}, general: ${row.general_rut})`)
  }
  if (rutMismatch.length === 0) console.log("[proveedores] sin RUT divergentes entre general y combustible")

  // ── Proveedores de combustible sin vínculo a proveedor general ──
  const unlinkedFuel = await sql<CountRow[]>`
    select count(*)::int as count
    from fuel_suppliers fs
    where fs.is_active = true
      and fs.supplier_id is null
  `
  console.log(`[proveedores] proveedores de combustible activos sin identidad general vinculada: ${unlinkedFuel[0]!.count}`)

  // ── Familias EPP sin productos ──
  const emptyFamilies = await sql<CountRow[]>`
    select count(*)::int as count
    from epp_product_families f
    where not exists (select 1 from products p where p.family_id = f.id)
  `
  console.log(`[epp] familias EPP sin productos asociados: ${emptyFamilies[0]!.count}`)

  // ── Productos EPP sin familia ──
  const eppWithoutFamily = await sql<CountRow[]>`
    select count(*)::int as count
    from products p
    where p.is_active = true
      and p.is_epp = true
      and p.family_id is null
  `
  console.log(`[epp] productos EPP activos sin familyId: ${eppWithoutFamily[0]!.count}`)

  // ── PDTP: responsables sin isActive (siempre true por default de columna) ──
  const pdtpRespTotal = await sql<CountRow[]>`
    select count(*)::int as count from pdtp_responsible_catalog
  `
  const pdtpRespInactive = await sql<CountRow[]>`
    select count(*)::int as count from pdtp_responsible_catalog where is_active = false
  `
  console.log(`[pdtp] responsables: ${pdtpRespTotal[0]!.count} total, ${pdtpRespInactive[0]!.count} inactivos`)

  // ── PDTP: hojas sin isActive ──
  const pdtpSheetsTotal = await sql<CountRow[]>`
    select count(*)::int as count from pdtp_sheets
  `
  const pdtpSheetsInactive = await sql<CountRow[]>`
    select count(*)::int as count from pdtp_sheets where is_active = false
  `
  console.log(`[pdtp] hojas: ${pdtpSheetsTotal[0]!.count} total, ${pdtpSheetsInactive[0]!.count} inactivas`)

  console.log("\n=== Verificación completada ===")
  await sql.end({ timeout: 5 })
}

main().catch(async (error) => {
  console.error("[verify-data-quality] falló:", error)
  await sql.end({ timeout: 5 }).catch(() => {})
  process.exitCode = 1
})

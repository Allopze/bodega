/**
 * Exporta todos los EPP (Elementos de Protección Personal) del catálogo
 * a un archivo XLSX con código correlativo.
 *
 * Uso: npx tsx scripts/export-epps-xlsx.ts [--output ruta]
 *
 * El archivo generado incluye:
 *   - N° correlativo
 *   - SKU
 *   - Nombre del producto
 *   - Proveedor(es)
 *   - Precio de referencia
 *   - Unidad de medida
 *   - Familia / Tipo
 *   - Marca / Modelo
 *   - Atributos (talla, color, etc.)
 *   - Activo
 */

import { loadEnvConfig } from "@next/env"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { eq, sql, asc } from "drizzle-orm"
import ExcelJS from "exceljs"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import * as schema from "../db/schema"

loadEnvConfig(process.cwd())

const OUTPUT = resolve(process.argv[2] ?? "epps-catalogo.xlsx")

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required")
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

interface EppRow {
  correlativo: number
  sku: string
  nombre: string
  descripcion: string
  proveedores: string
  precioRef: number | null
  unidad: string
  familia: string | null
  eppType: string | null
  marca: string | null
  modelo: string | null
  atributos: string
  activo: string
}

async function main() {
  console.log("Consultando EPP del catálogo...")

  const rows = await db
    .select({
      id: schema.products.id,
      sku: schema.products.sku,
      name: schema.products.name,
      description: schema.products.description,
      unitOfMeasure: schema.products.unitOfMeasure,
      referencePrice: schema.products.referencePrice,
      isActive: schema.products.isActive,
      familyName: schema.eppProductFamilies.canonicalName,
      eppType: schema.eppProductFamilies.eppType,
      brand: schema.eppProductFamilies.brand,
      model_: schema.eppProductFamilies.model,
      attributes: sql<string>`(
        SELECT string_agg(pa.name || ': ' || COALESCE(pa.options, pa.name), '; ' ORDER BY pa.sort_order)
        FROM ${schema.productAttributes} pa
        WHERE pa.product_id = ${schema.products.id}
      )`,
      suppliers: sql<string>`(
        SELECT string_agg(DISTINCT s.name, ', ' ORDER BY s.name)
        FROM ${schema.productSuppliers} ps
        JOIN ${schema.suppliers} s ON s.id = ps.supplier_id
        WHERE ps.product_id = ${schema.products.id}
      )`,
    })
    .from(schema.products)
    .leftJoin(
      schema.eppProductFamilies,
      eq(schema.products.familyId, schema.eppProductFamilies.id)
    )
    .where(eq(schema.products.isEpp, true))
    .orderBy(asc(schema.products.name))

  console.log(`  → ${rows.length} EPP encontrados.`)

  const data: EppRow[] = rows.map((r, i) => ({
    correlativo: i + 1,
    sku: r.sku,
    nombre: r.name,
    descripcion: r.description ?? "",
    proveedores: r.suppliers ?? "",
    precioRef: r.referencePrice,
    unidad: r.unitOfMeasure,
    familia: r.familyName ?? null,
    eppType: r.eppType ?? null,
    marca: r.brand ?? null,
    modelo: r.model_ ?? null,
    atributos: r.attributes ?? "",
    activo: r.isActive ? "Sí" : "No",
  }))

  // ── Generar XLSX ─────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()

  const ws = workbook.addWorksheet("EPP")
  const HEADERS = [
    "N°", "SKU", "Nombre", "Descripción",
    "Proveedor(es)", "Precio Ref. ($)", "Unidad",
    "Familia", "Tipo EPP", "Marca", "Modelo",
    "Atributos", "Activo",
  ]

  // Header row
  const headerRow = ws.addRow(HEADERS)
  headerRow.font = { bold: true, size: 11, color: { theme: 0 } }
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E1F2" },
  }
  headerRow.alignment = { vertical: "middle", horizontal: "center" }
  headerRow.border = {
    bottom: { style: "thin" },
    top: { style: "thin" },
    left: { style: "thin" },
    right: { style: "thin" },
  }

  // Data rows
  for (const item of data) {
    const row = ws.addRow([
      item.correlativo,
      item.sku,
      item.nombre,
      item.descripcion,
      item.proveedores,
      item.precioRef ?? "",
      item.unidad,
      item.familia ?? "",
      item.eppType ?? "",
      item.marca ?? "",
      item.modelo ?? "",
      item.atributos,
      item.activo,
    ])
    row.alignment = { vertical: "middle" }
    row.border = {
      bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
    }
    // N° column centered
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" }
    // Price column formatted as number
    if (item.precioRef != null) {
      row.getCell(6).numFmt = '#,##0'
    }
  }

  // Column widths
  ws.columns = HEADERS.map((h, i) => {
    const widths = [6, 18, 40, 30, 25, 14, 10, 25, 14, 14, 14, 30, 8]
    return { width: widths[i] ?? 12 }
  })

  // Freeze header row
  ws.views = [{ state: "frozen", ySplit: 1 }]

  // Auto-filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: HEADERS.length },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  writeFileSync(OUTPUT, Buffer.from(buffer))

  console.log(`\n✅ XLSX generado: ${OUTPUT}`)
  console.log(`   Total EPP: ${data.length}`)
  console.log(`   Archivo: ${resolve(OUTPUT)}`)

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

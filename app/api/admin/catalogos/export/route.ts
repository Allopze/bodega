/**
 * GET /api/admin/catalogos/export?tipo=productos|proveedores|trabajadores
 *
 * Exporta el catálogo completo como XLSX para mantenimiento masivo.
 * Cada fila incluye el ID interno para permitir re-importar con actualizaciones.
 */

import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { canAny } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { buildXlsxBuffer, type ReportData } from "@/lib/reports/export"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"
import { db } from "@/db"
import { suppliers, workers, worksites } from "@/db/schema"
import { products, productCategories, productSuppliers } from "@/db/schema"
import { asc, eq } from "drizzle-orm"

const TYPE_PERMISSIONS: Record<string, Permission[]> = {
  productos:    ["admin:products"],
  proveedores:  ["admin:suppliers"],
  trabajadores: ["admin:workers"],
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const tipo = req.nextUrl.searchParams.get("tipo") ?? ""
  const requiredPermissions = TYPE_PERMISSIONS[tipo]
  if (!requiredPermissions) {
    return NextResponse.json({ error: "Tipo de catálogo inválido" }, { status: 400 })
  }
  if (!canAny(session, ...requiredPermissions)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  try {
    let report: ReportData

    switch (tipo) {
      case "productos":
        report = await buildProductosReport()
        break
      case "proveedores":
        report = await buildProveedoresReport()
        break
      case "trabajadores":
        report = await buildTrabajadoresReport()
        break
      default:
        return NextResponse.json({ error: "Tipo no implementado" }, { status: 400 })
    }

    const xlsx = await buildXlsxBuffer(report)
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
    }
    return new NextResponse(xlsx, { status: 200, headers })
  } catch (err) {
    logger.error("[admin/catalogos/export]", err)
    return NextResponse.json({ error: "Error al generar el reporte" }, { status: 500 })
  }
}

async function buildProductosReport(): Promise<ReportData> {
  const allProducts = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      categoryName: productCategories.name,
      description: products.description,
      unitOfMeasure: products.unitOfMeasure,
      isEpp: products.isEpp,
      requiresPrevencion: products.requiresPrevencion,
      referencePrice: products.referencePrice,
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .orderBy(asc(products.name))

  const allSuppliers = await db
    .select({
      productId: productSuppliers.productId,
      supplierName: suppliers.name,
      unitPrice: productSuppliers.unitPrice,
      isPreferred: productSuppliers.isPreferred,
    })
    .from(productSuppliers)
    .leftJoin(suppliers, eq(productSuppliers.supplierId, suppliers.id))

  const supplierMap = new Map<string, string>()
  for (const row of allSuppliers) {
    const entry = row.isPreferred
      ? `${row.supplierName ?? ""} (preferido)`
      : (row.supplierName ?? "")
    const existing = supplierMap.get(row.productId)
    if (existing) {
      supplierMap.set(row.productId, `${existing}; ${entry}`)
    } else {
      supplierMap.set(row.productId, entry)
    }
  }

  const headers = ["ID", "SKU", "Nombre", "Categoría", "Descripción", "Unidad", "EPP", "Prevención", "Precio ref.", "Proveedores", "Activo"]
  const rows = allProducts.map((p) => [
    p.id,
    p.sku,
    p.name,
    p.categoryName ?? "",
    p.description ?? "",
    p.unitOfMeasure,
    p.isEpp ? "Sí" : "No",
    p.requiresPrevencion ? "Sí" : "No",
    p.referencePrice ?? "",
    supplierMap.get(p.id) ?? "",
    p.isActive ? "Sí" : "No",
  ])

  return {
    filenameBase: "catalogo-productos",
    worksheetName: "Productos",
    headers,
    rows,
  }
}

async function buildProveedoresReport(): Promise<ReportData> {
  const allSuppliers = await db
    .select()
    .from(suppliers)
    .orderBy(asc(suppliers.name))

  const headers = ["ID", "Nombre", "RUT", "Giro", "Contacto", "Email", "Teléfono", "Dirección", "Comuna", "Ciudad", "Cond. pago", "Activo", "Notas"]
  const rows = allSuppliers.map((s) => [
    s.id,
    s.name,
    s.rut ?? "",
    s.businessActivity ?? "",
    s.contactName ?? "",
    s.email ?? "",
    s.phone ?? "",
    s.address ?? "",
    s.commune ?? "",
    s.city ?? "",
    s.paymentTerms ?? "",
    s.isActive ? "Sí" : "No",
    s.notes ?? "",
  ])

  return {
    filenameBase: "catalogo-proveedores",
    worksheetName: "Proveedores",
    headers,
    rows,
  }
}

async function buildTrabajadoresReport(): Promise<ReportData> {
  const allWorkers = await db
    .select({
      id: workers.id,
      rut: workers.rut,
      firstName: workers.firstName,
      lastName: workers.lastName,
      position: workers.position,
      supervisor: workers.supervisor,
      prevencionista: workers.prevencionista,
      worksiteName: worksites.name,
      isActive: workers.isActive,
    })
    .from(workers)
    .leftJoin(worksites, eq(workers.worksiteId, worksites.id))
    .orderBy(asc(workers.lastName), asc(workers.firstName))

  const headers = ["ID", "RUT", "Nombre", "Apellido", "Cargo", "Supervisor", "Prevencionista", "Faena", "Activo"]
  const rows = allWorkers.map((w) => [
    w.id,
    w.rut ?? "",
    w.firstName,
    w.lastName,
    w.position ?? "",
    w.supervisor ?? "",
    w.prevencionista ?? "",
    w.worksiteName ?? "",
    w.isActive ? "Sí" : "No",
  ])

  return {
    filenameBase: "catalogo-trabajadores",
    worksheetName: "Trabajadores",
    headers,
    rows,
  }
}

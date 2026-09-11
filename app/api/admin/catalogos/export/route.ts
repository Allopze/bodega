/**
 * GET /api/admin/catalogos/export?tipo=productos|proveedores|trabajadores
 *
 * Exporta el catálogo completo como Excel para mantenimiento masivo.
 * Cada fila incluye el ID interno para permitir re-importar con actualizaciones.
 */

import { type NextRequest, NextResponse } from "next/server"
import type { Session } from "next-auth"
import { auth } from "@/lib/auth/auth"
import { canAny } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"
import { buildXlsxBuffer, type ReportData } from "@/lib/reports/export"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"
import { db } from "@/db"
import {
  suppliers,
  workerCapabilities,
  workerPositionCapabilities,
  workerPositions,
  workers,
  worksites,
} from "@/db/schema"
import { products, productCategories, productSuppliers } from "@/db/schema"
import { and, asc, eq, inArray } from "drizzle-orm"

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
        report = await buildTrabajadoresReport(session)
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

async function buildTrabajadoresReport(session: Session): Promise<ReportData> {
  const allWorkers = await db
    .select({
      id: workers.id,
      rut: workers.rut,
      firstName: workers.firstName,
      lastName: workers.lastName,
      legacyPosition: workers.position,
      positionId: workerPositions.id,
      position: workerPositions.name,
      positionCode: workerPositions.code,
      positionNeedsReview: workerPositions.needsReview,
      supervisor: workers.supervisor,
      prevencionista: workers.prevencionista,
      worksiteName: worksites.name,
      isActive: workers.isActive,
    })
    .from(workers)
    .leftJoin(workerPositions, eq(workers.positionId, workerPositions.id))
    .leftJoin(worksites, eq(workers.worksiteId, worksites.id))
    .where(worksiteScopeSql(session, workers.worksiteId))
    .orderBy(asc(workers.lastName), asc(workers.firstName))

  const positionIds = [...new Set(allWorkers.map((worker) => worker.positionId).filter((id): id is string => Boolean(id)))]
  const capabilityRows = positionIds.length > 0
    ? await db.select({
        positionId: workerPositionCapabilities.positionId,
        name: workerCapabilities.name,
      })
        .from(workerPositionCapabilities)
        .innerJoin(workerCapabilities, eq(workerCapabilities.id, workerPositionCapabilities.capabilityId))
        .where(and(
          inArray(workerPositionCapabilities.positionId, positionIds),
          eq(workerCapabilities.isActive, true),
        ))
        .orderBy(asc(workerCapabilities.name))
    : []
  const capabilitiesByPosition = new Map<string, string[]>()
  for (const row of capabilityRows) {
    const current = capabilitiesByPosition.get(row.positionId) ?? []
    current.push(row.name)
    capabilitiesByPosition.set(row.positionId, current)
  }

  const headers = [
    "ID", "RUT", "Nombre", "Apellido", "Cargo", "Código cargo", "Capacidades",
    "Cargo pendiente de revisión", "Supervisor", "Prevencionista", "Faena", "Activo",
  ]
  const rows = allWorkers.map((w) => [
    w.id,
    w.rut ?? "",
    w.firstName,
    w.lastName,
    w.position ?? w.legacyPosition ?? "",
    w.positionCode ?? "",
    w.positionId ? (capabilitiesByPosition.get(w.positionId) ?? []).join("; ") : "",
    w.positionId ? (w.positionNeedsReview ? "Sí" : "No") : "Sí",
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

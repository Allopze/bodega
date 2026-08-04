/**
 * GET /api/reportes/export?tipo=<tipo>&from=<date>&to=<date>&faena=<id>&status=<status>
 *
 * Exports the requested report as Excel with optional filters.
 */

import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { canAny } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { buildXlsxBuffer, getReportData, type ExportFilters } from "@/lib/reports/export"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"

/**
 * Each export type requires one of the listed permissions. Report types
 * stay behind reports:view; the on-screen Adquisiciones list exports are
 * gated by the same permission needed to see the list ("si lo ves, lo
 * puedes exportar").
 */
const TYPE_PERMISSIONS: Record<string, Permission[]> = {
  analitica_resumen: ["analytics:export", "analytics:view"],
  gasto_faena:   ["reports:view"],
  items_sin_oc:  ["reports:view"],
  oc_por_estado: ["reports:view"],
  solicitudes:   ["requests:view_own", "requests:view_all"],
  compras:       ["purchasing:view", "purchasing:create_order"],
  oc_cerradas_sin_factura: ["purchasing:view", "purchasing:create_order"],
  recepcion:     ["receiving:view", "receiving:register_office", "receiving:register_faena"],
  dte_libro_compras:   ["purchasing:view"],
  dte_conciliacion:    ["purchasing:view"],
  dte_facturas_sin_oc: ["purchasing:view"],
}

const MAX_EXPORT_ROWS = 10_000

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const tipo = req.nextUrl.searchParams.get("tipo") ?? "gasto_faena"
  const requiredPermissions = TYPE_PERMISSIONS[tipo]
  if (!requiredPermissions) {
    return NextResponse.json({ error: "Tipo de reporte inválido" }, { status: 400 })
  }
  if (!canAny(session, ...requiredPermissions)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const filters: ExportFilters = {}
  const from = req.nextUrl.searchParams.get("from")
  const to = req.nextUrl.searchParams.get("to")
  const faena = req.nextUrl.searchParams.get("faena")
  const proveedor = req.nextUrl.searchParams.get("proveedor")
  const vehiculo = req.nextUrl.searchParams.get("vehiculo")
  const status = req.nextUrl.searchParams.get("status")
  const q = req.nextUrl.searchParams.get("q")
  if (from) filters.fromDate = from
  if (to) filters.toDate = to
  if (faena) filters.worksiteId = faena
  if (proveedor) filters.supplierId = proveedor
  if (vehiculo) filters.vehicleId = vehiculo
  if (status) filters.status = status
  if (q) filters.q = q
  if (req.nextUrl.searchParams.get("factura") === "pendiente") filters.invoicePending = true

  try {
    const report = await getReportData(tipo, session, filters, MAX_EXPORT_ROWS)

    const xlsx = await buildXlsxBuffer(report)
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
    }
    if (report.rowLimitApplied) {
      headers["X-Row-Limit-Applied"] = "true"
    }
    return new NextResponse(xlsx, {
      status: 200,
      headers,
    })
  } catch (err) {
    logger.error("[reportes/export]", err)
    return NextResponse.json({ error: "Error al generar el reporte" }, { status: 500 })
  }
}

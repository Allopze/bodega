/**
 * GET /api/reportes/export?tipo=<tipo>&from=<date>&to=<date>&faena=<id>&status=<status>
 *
 * Exports the requested report as Excel with optional filters.
 */

import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can, canAny } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { buildXlsxBuffer, getReportData, type ExportFilters } from "@/lib/reports/export"
import { recordAudit } from "@/lib/audit"
import { DteCodEmpMissingError } from "@/lib/services/dte-portal/require-cod-emp"
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
  facturacion_cobranza: ["billing:view", "billing:export"],
  bodega_valorizacion: ["reports:view", "warehouse:view_stock"],
  bodega_rotacion:     ["reports:view", "warehouse:view_stock"],
}

/**
 * Tipos que exigen TODOS los permisos listados, no uno cualquiera. La cartera
 * de cobranza se descarga por dos puertas (`/api/facturacion/facturas/export`
 * y ésta) y la otra ya exige `billing:view` + `billing:export`: la puerta más
 * laxa era la que decidía.
 */
const TYPE_REQUIRES_ALL_PERMISSIONS = new Set(["facturacion_cobranza"])

/** Tipos cuyo export el manifiesto promete auditado ("queda auditado"). */
const TYPE_AUDIT_ENTITY: Record<string, string> = {
  facturacion_cobranza: "billing_cobranza",
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
  const authorized = TYPE_REQUIRES_ALL_PERMISSIONS.has(tipo)
    ? requiredPermissions.every((permission) => can(session, permission))
    : canAny(session, ...requiredPermissions)
  if (!authorized) {
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

    const auditEntityType = TYPE_AUDIT_ENTITY[tipo]
    if (auditEntityType) {
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "export",
        entityType: auditEntityType,
        entityId: "export",
        newState: { filters: JSON.parse(JSON.stringify(filters)), rows: report.rows.length },
      })
    }

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
    // Un libro de compras vacío nunca debe salir con 200: sin `codEmp` no hay
    // consulta posible y el reporte se declara no disponible, con la causa.
    if (err instanceof DteCodEmpMissingError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    logger.error("[reportes/export]", err)
    return NextResponse.json({ error: "Error al generar el reporte" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"

import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { buildInvoicesExport } from "@/lib/services/billing/export"
import type { InvoiceFilters } from "@/lib/services/billing/queries"
import type { BillingProviderId } from "@/db/schema"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { encodeContentDisposition } from "@/lib/utils"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"

function oneOf<T extends string>(value: string | null, options: readonly T[]): T | undefined {
  return options.includes((value ?? "") as T) ? (value as T) : undefined
}

/** Mismos filtros que la pantalla de facturas; el manifest exige auditar el export. */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "billing:view") || !can(session, "billing:export")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  const params = request.nextUrl.searchParams
  const filters: InvoiceFilters = {
    period: /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("periodo") ?? "") ? params.get("periodo")! : undefined,
    clientId: params.get("cliente") || undefined,
    paymentStatus: oneOf(params.get("pago"), ["unpaid", "partial", "paid", "overpaid"] as const),
    documentStatus: oneOf(params.get("documento"), ["issued", "accepted", "rejected", "void", "draft", "unknown"] as const),
    source: oneOf(params.get("fuente"), ["factura_en_linea", "chipax", "manual"] as const) as BillingProviderId | undefined,
    currency: /^[A-Z]{3}$/.test(params.get("moneda") ?? "") ? params.get("moneda")! : undefined,
    overdueOnly: params.get("vencidas") === "1",
    unlinkedOnly: params.get("sinVinculo") === "1",
    search: params.get("q")?.trim() || undefined,
  }
  try {
    const report = await buildInvoicesExport(session, filters)
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "billing_invoices",
      entityId: "export",
      newState: { filters: JSON.parse(JSON.stringify(filters)), rows: report.rows.length },
    })
    const bytes = await buildXlsxBuffer(report)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    logger.error("[facturacion/facturas/export]", error)
    return NextResponse.json({ error: "No se pudo generar el Excel de facturas" }, { status: 500 })
  }
}

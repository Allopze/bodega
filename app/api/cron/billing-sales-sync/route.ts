import { NextRequest, NextResponse } from "next/server"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { readSalesSyncConfig } from "@/lib/services/billing/config"
import { currentPeriod, syncBillingInvoices } from "@/lib/services/billing/sync"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/cron/billing-sales-sync
 *
 * Sincroniza las facturas de VENTA del mes en curso desde FacturaEnLínea, que
 * es el insumo de las cuentas por cobrar.
 *
 * No comparte endpoint con `/api/cron/dte-portal-sync` (compras) a propósito:
 * son dos alcances distintos, con distinto período de interés y distinto
 * impacto, y mezclarlos haría que un fallo de uno apagara el otro.
 *
 * Protegido por `CRON_SECRET` con comparación en tiempo constante.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!readSalesSyncConfig().enabled) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "La sincronización de ventas está deshabilitada (BILLING_SALES_SYNC_ENABLED).",
    })
  }

  try {
    const result = await syncBillingInvoices({
      provider: "factura_en_linea",
      scope: "sales_invoices",
      period: currentPeriod(),
      trigger: "cron",
    })
    // El resultado incluye el resumen de errores ya redactado: un fallo de
    // sincronización tiene que ser visible, no silencioso.
    return NextResponse.json({ ok: result.status !== "failed", ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falló la sincronización de ventas"
    logger.error("[cron/billing-sales-sync]", { message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

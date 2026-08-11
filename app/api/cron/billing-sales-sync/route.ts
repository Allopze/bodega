import { NextRequest, NextResponse } from "next/server"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { readSalesSyncConfig } from "@/lib/services/billing/config"
import { currentPeriod, previousBillingPeriod, syncBillingInvoices } from "@/lib/services/billing/sync"
import { cronContractFor } from "@/lib/services/dte-portal/cron-contract"
import { assertDtePortalStartsAllowed, isIntentionalDtePortalCutoverPause } from "@/lib/services/dte-portal/operation-lease"
import { classifyDteFailure } from "@/lib/services/dte-portal/failure"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Cron de ventas: cubre el mes actual y anterior bajo un mismo batch ID. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return response(cronContractFor({ unauthorized: true }))
  }
  if (!readSalesSyncConfig().enabled) {
    return response(cronContractFor({ disabled: true }))
  }

  const correlationId = nanoid(16)
  try {
    // Sales has its own automation switch. This independent fence is only for
    // a DTE credential cutover and prevents it from starting between the
    // conversion pause and the per-request client lease.
    await assertDtePortalStartsAllowed()
  } catch (error) {
    if (isIntentionalDtePortalCutoverPause(error)) {
      return response(cronContractFor({ disabled: true }), correlationId)
    }
    const failure = classifyDteFailure(error)
    logger.error({ correlationId }, "[cron/billing-sales-sync] configuración segura no disponible", { code: failure.code })
    return response(cronContractFor({ statuses: ["failed"] }), correlationId)
  }

  const current = currentPeriod()
  const periods = [current, previousBillingPeriod(current)]
  const results: Array<{ period: string; status: "success" | "partial" | "failed" | "skipped"; runId: string; code?: string }> = []

  for (const period of periods) {
    try {
      const result = await syncBillingInvoices({
        provider: "factura_en_linea",
        scope: "sales_invoices",
        period,
        trigger: "cron",
        correlationId,
      })
      results.push({ period, status: result.status, runId: result.runId, code: result.skipReason })
    } catch {
      logger.error({ correlationId }, "[cron/billing-sales-sync] período falló", { code: "BILLING_SYNC_FAILED", period })
      results.push({ period, status: "failed", runId: "", code: "BILLING_SYNC_FAILED" })
    }
  }

  const activeConflict = results.some((result) => result.status === "skipped" && result.code === "active_run")
  const nonRunnable = results.some((result) => result.status === "skipped" && result.code !== "active_run")
  const contract = cronContractFor({
    conflict: activeConflict,
    statuses: nonRunnable ? ["failed"] : results.map((result) => result.status),
  })
  return response(contract, correlationId, results)
}

function response(
  contract: ReturnType<typeof cronContractFor>,
  correlationId?: string,
  periods?: Array<{ period: string; status: string; runId: string; code?: string }>,
) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    correlationId,
    periods,
  }, { status: contract.httpStatus })
}

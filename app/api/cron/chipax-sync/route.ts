import { NextRequest, NextResponse } from "next/server"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { readChipaxConfig } from "@/lib/services/billing/config"
import { currentPeriod, previousBillingPeriod, syncBankTransactions, syncBillingInvoices } from "@/lib/services/billing/sync"
import { cronContractFor } from "@/lib/services/dte-portal/cron-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ScopeResult = {
  scope: "sales_invoices" | "bank_transactions"
  period: string
  status: "success" | "partial" | "failed" | "skipped"
  runId: string
  code?: string
  errorSummary?: string | null
}

/** Chipax es sólo lectura: ventas actual/anterior y cartolas del mes actual. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return response(cronContractFor({ unauthorized: true }))
  }

  const config = readChipaxConfig()
  if (!config.enabled || !config.syncEnabled) {
    return response(cronContractFor({ disabled: true }))
  }
  if (!config.hasCredentials || !config.companyTaxId) {
    return response(cronContractFor({ statuses: ["failed"] }))
  }

  const correlationId = nanoid(16)
  const current = currentPeriod()
  const periods = [current, previousBillingPeriod(current)]
  const results: ScopeResult[] = []

  for (const period of periods) {
    try {
      const result = await syncBillingInvoices({
        provider: "chipax",
        scope: "sales_invoices",
        period,
        trigger: "cron",
        correlationId,
      })
      results.push({ scope: "sales_invoices", period, status: result.status, runId: result.runId, code: result.skipReason, errorSummary: result.errorSummary })
    } catch {
      logger.error({ correlationId, period }, "[cron/chipax-sync] ventas fallaron", { code: "CHIPAX_SALES_SYNC_FAILED" })
      results.push({ scope: "sales_invoices", period, status: "failed", runId: "", code: "CHIPAX_SALES_SYNC_FAILED" })
    }
  }

  try {
    const result = await syncBankTransactions({
      provider: "chipax",
      period: current,
      trigger: "cron",
      correlationId,
    })
    results.push({ scope: "bank_transactions", period: current, status: result.status, runId: result.runId, code: result.skipReason, errorSummary: result.errorSummary })
  } catch {
    logger.error({ correlationId, period: current }, "[cron/chipax-sync] cartolas fallaron", { code: "CHIPAX_BANK_SYNC_FAILED" })
    results.push({ scope: "bank_transactions", period: current, status: "failed", runId: "", code: "CHIPAX_BANK_SYNC_FAILED" })
  }

  const activeConflict = results.some((result) => result.status === "skipped" && result.code === "active_run")
  const statuses = results.map((result) => result.status === "skipped" && result.code !== "active_run" ? "failed" : result.status)
  const contract = cronContractFor({ conflict: activeConflict, statuses })
  return response(contract, correlationId, results)
}

function response(
  contract: ReturnType<typeof cronContractFor>,
  correlationId?: string,
  results?: ScopeResult[],
) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    correlationId,
    scopes: results,
  }, { status: contract.httpStatus })
}

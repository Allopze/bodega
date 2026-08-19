import { and, eq, gte } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { billingSyncRuns, dteSyncRuns } from "@/db/schema"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { readSalesSyncConfig } from "@/lib/services/billing/config"
import { readChipaxConfig } from "@/lib/services/billing/chipax-settings"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { notifyDteSyncHealthChange } from "@/lib/services/dte-portal/health-alerts"
import { evaluateDteSyncHealth } from "@/lib/services/dte-portal/health"
import { assertDtePortalStartsAllowed, isIntentionalDtePortalCutoverPause } from "@/lib/services/dte-portal/operation-lease"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LOOKBACK_MS = 25 * 60 * 1_000

/**
 * Protected liveness/freshness evaluator. A domain being partial or stale is
 * data degradation, not an app-process failure, so it still returns HTTP 200
 * and lets the cron container remain alive while alerting operators.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "DTE_HEALTH_UNAUTHORIZED", status: "critical" }, { status: 401 })
  }

  try {
    const now = new Date()
    let dteEnabled = true
    let dteConfigured = false
    try {
      const config = await readDtePortalConfig()
      dteEnabled = config.syncEnabled
      dteConfigured = Object.values(config.credentials).every(Boolean)
    } catch {
      // A broken keyring/configuration must not quietly look like a disabled
      // automation during its due window.
      dteEnabled = true
      dteConfigured = false
    }
    const sales = readSalesSyncConfig()
    const chipax = await readChipaxConfig()
    let cutoverPaused = false
    try {
      await assertDtePortalStartsAllowed()
    } catch (error) {
      if (isIntentionalDtePortalCutoverPause(error)) {
        // Conversion pauses both portal consumers deliberately. Existing rows
        // from the race into the fence are not a production incident and must
        // not create a five-minute alert loop while an operator rotates keys.
        cutoverPaused = true
      } else {
        throw error
      }
    }

    const since = new Date(now.getTime() - LOOKBACK_MS).toISOString()
    const [dteRuns, salesRuns, chipaxRuns] = await Promise.all([
      db.select({
        period: dteSyncRuns.periodo,
        status: dteSyncRuns.status,
        trigger: dteSyncRuns.trigger,
        correlationId: dteSyncRuns.correlationId,
        reconciliationStatus: dteSyncRuns.reconciliationStatus,
        startedAt: dteSyncRuns.startedAt,
      }).from(dteSyncRuns).where(and(eq(dteSyncRuns.trigger, "cron"), gte(dteSyncRuns.startedAt, since))),
      db.select({
        period: billingSyncRuns.periodFrom,
        scope: billingSyncRuns.scope,
        status: billingSyncRuns.status,
        trigger: billingSyncRuns.trigger,
        correlationId: billingSyncRuns.correlationId,
        startedAt: billingSyncRuns.startedAt,
      }).from(billingSyncRuns).where(and(
        eq(billingSyncRuns.trigger, "cron"),
        eq(billingSyncRuns.provider, "factura_en_linea"),
        eq(billingSyncRuns.scope, "sales_invoices"),
        gte(billingSyncRuns.startedAt, since),
      )),
      db.select({
        period: billingSyncRuns.periodFrom,
        scope: billingSyncRuns.scope,
        status: billingSyncRuns.status,
        trigger: billingSyncRuns.trigger,
        correlationId: billingSyncRuns.correlationId,
        startedAt: billingSyncRuns.startedAt,
      }).from(billingSyncRuns).where(and(
        eq(billingSyncRuns.trigger, "cron"),
        eq(billingSyncRuns.provider, "chipax"),
        gte(billingSyncRuns.startedAt, since),
      )),
    ])

    const evaluation = evaluateDteSyncHealth({
      now,
      dteEnabled: cutoverPaused ? false : dteEnabled,
      dteConfigured,
      salesEnabled: cutoverPaused ? false : sales.enabled,
      // Sales through FacturaEnLínea needs the same portal credentials.
      salesConfigured: dteConfigured,
      dteRuns,
      salesRuns,
      chipaxEnabled: cutoverPaused ? false : chipax.enabled && chipax.syncEnabled,
      chipaxConfigured: chipax.hasCredentials && Boolean(chipax.companyTaxId),
      chipaxSalesRuns: chipaxRuns.filter((run) => run.scope === "sales_invoices"),
      chipaxBankRuns: chipaxRuns.filter((run) => run.scope === "bank_transactions"),
    })

    try {
      await notifyDteSyncHealthChange(evaluation)
    } catch {
      // Retry notification creation on the next five-minute probe without
      // leaking a transport/provider error through the health endpoint.
      logger.error("[cron/dte-sync-health] alert delivery failed", { code: "DTE_HEALTH_NOTIFICATION_FAILED" })
    }

    return NextResponse.json({
      ok: true,
      outcome: evaluation.status,
      code: evaluation.code,
      status: evaluation.status,
      domains: evaluation.domains.map(({ name, status, code, slot, expectedPeriods }) => ({ name, status, code, slot, expectedPeriods })),
    })
  } catch {
    logger.error("[cron/dte-sync-health] evaluator failed", { code: "DTE_HEALTH_EVALUATOR_FAILED" })
    return NextResponse.json({ ok: false, outcome: "failed", code: "DTE_HEALTH_EVALUATOR_FAILED", status: "critical" }, { status: 503 })
  }
}

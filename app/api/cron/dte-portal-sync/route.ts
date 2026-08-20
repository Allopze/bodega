import { NextRequest, NextResponse } from "next/server"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { cronContractFor } from "@/lib/services/dte-portal/cron-contract"
import { classifyDteFailure } from "@/lib/services/dte-portal/failure"
import { recoverySweepPeriods, rollingSyncPeriods, syncDteDocuments } from "@/lib/services/dte-portal/sync"
import { createNotifications } from "@/lib/services/notification-create"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface DteCronPeriodResult {
  period: string
  status: "success" | "partial" | "failed" | "skipped"
  runId: string
  code?: string
  skipReason?: "disabled" | "invalid_barrier" | "active_run"
}

interface DteRecoverySweepEntry {
  period: string
  status: DteCronPeriodResult["status"]
  rowsInserted: number
}

function wasStoppedByCutover(result: DteCronPeriodResult): boolean {
  return result.skipReason === "disabled"
}

/**
 * Barrido mensual de recuperación de períodos ya fuera de la ventana móvil.
 *
 * Re-consulta con `force` y compara contra lo que la plataforma ya tenía: cada
 * documento insertado ahí es una factura de compra que faltaba en el libro y
 * que nadie iba a volver a buscar. No participa del contrato del cron —una
 * recuperación exitosa no debe paginar al runner— pero sí avisa a quien puede
 * corregir la declaración del período afectado.
 */
async function runRecoverySweep(
  client: DtePortalClient,
  config: { importerEmail: string | null },
  correlationId: string,
): Promise<DteRecoverySweepEntry[]> {
  const sweep: DteRecoverySweepEntry[] = []
  for (const periodo of recoverySweepPeriods()) {
    try {
      const result = await syncDteDocuments(client, {
        periodo,
        trigger: "cron",
        force: true,
        importerEmail: config.importerEmail,
        correlationId,
      })
      sweep.push({ period: periodo, status: result.status, rowsInserted: result.rowsInserted })
    } catch (error) {
      const failure = classifyDteFailure(error)
      logger.error({ correlationId }, "[cron/dte-portal-sync] barrido de recuperación falló", { code: failure.code, periodo })
      sweep.push({ period: periodo, status: "failed", rowsInserted: 0 })
    }
  }

  const recovered = sweep.filter((entry) => entry.rowsInserted > 0)
  if (recovered.length === 0) return sweep

  const detail = recovered.map((entry) => `${entry.period}: ${entry.rowsInserted}`).join(", ")
  logger.error({ correlationId }, "[cron/dte-portal-sync] documentos recuperados de períodos cerrados", {
    code: "DTE_SWEEP_RECOVERED",
    detail,
  })
  try {
    const recipients = await getUserIdsWithPermission("admin:dte_sync")
    await createNotifications(recipients, {
      type: "system_alert",
      title: "El libro de compras DTE tenía documentos faltantes",
      body: `El barrido mensual recuperó documentos de períodos ya cerrados (${detail}). Verifique si esos períodos ya fueron declarados.`,
      entityType: "dte_sync_health",
      entityId: correlationId,
      entityHref: "/admin/dte",
      dedupeKey: `dte-sync-recovery:${recovered.map((entry) => `${entry.period}:${entry.rowsInserted}`).join("|")}`,
    })
  } catch {
    // El barrido ya recuperó los documentos; un fallo al avisar no puede
    // convertir eso en una corrida fallida.
    logger.error({ correlationId }, "[cron/dte-portal-sync] aviso de recuperación no enviado", { code: "DTE_SWEEP_NOTIFY_FAILED" })
  }
  return sweep
}

/**
 * GET /api/cron/dte-portal-sync
 *
 * A single invocation owns one correlation ID across the current and previous
 * month. The response is deliberately a small, redacted contract for the
 * internal Node runner; it never includes portal messages or credential data.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return response(cronContractFor({ unauthorized: true }))
  }

  const correlationId = nanoid(16)
  let config
  try {
    config = await readDtePortalConfig()
  } catch (error) {
    const failure = classifyDteFailure(error)
    logger.error({ correlationId }, "[cron/dte-portal-sync] configuración inválida", { code: failure.code })
    return response(cronContractFor({ statuses: ["failed"] }), correlationId)
  }

  if (!config.syncEnabled) {
    return response(cronContractFor({ disabled: true }), correlationId)
  }
  if (!Object.values(config.credentials).every(Boolean)) {
    logger.error({ correlationId }, "[cron/dte-portal-sync] credenciales incompletas", { code: "DTE_SETTINGS_INVALID" })
    return response(cronContractFor({ statuses: ["failed"] }), correlationId)
  }

  const client = new DtePortalClient({
    baseUrl: config.baseUrl,
    credentials: config.credentials,
    delayMs: config.delayMs,
    requestTimeoutMs: config.requestTimeoutMs,
  })
  const periods = rollingSyncPeriods()
  const results: DteCronPeriodResult[] = []

  for (const periodo of periods) {
    try {
      const result = await syncDteDocuments(client, {
        periodo,
        trigger: "cron",
        importerEmail: config.importerEmail,
        correlationId,
      })
      results.push({
        period: periodo,
        status: result.status,
        runId: result.runId,
        code: result.error?.split(":", 1)[0],
        skipReason: result.skipReason,
      })
    } catch (error) {
      const failure = classifyDteFailure(error, Object.values(config.credentials))
      logger.error({ correlationId }, "[cron/dte-portal-sync] período falló", { code: failure.code, periodo })
      results.push({ period: periodo, status: "failed", runId: "", code: failure.code })
    }
  }

  const sweep = await runRecoverySweep(client, config, correlationId)

  const cutoverStopped = results.filter(wasStoppedByCutover)
  const invalidBarrier = results.some((result) => result.skipReason === "invalid_barrier")
  // A conversion pause before either period starts is intentional and must not
  // page operators. If it races after a period already completed, report a
  // partial batch: calling it disabled would falsely certify both periods.
  const allStoppedByCutover = results.length > 0 && cutoverStopped.length === results.length
  const contract = cronContractFor({
    disabled: allStoppedByCutover,
    conflict: !invalidBarrier && results.some((result) => result.status === "skipped" && result.skipReason === "active_run"),
    statuses: allStoppedByCutover
      ? undefined
      : results.map((result) => wasStoppedByCutover(result)
        ? "partial"
        : result.skipReason === "invalid_barrier"
          ? "failed"
          : result.status),
  })
  return response(contract, correlationId, results, sweep)
}

function response(
  contract: ReturnType<typeof cronContractFor>,
  correlationId?: string,
  periods?: Array<{ period: string; status: string; runId: string; code?: string }>,
  sweep?: DteRecoverySweepEntry[],
) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    correlationId,
    periods,
    sweep: sweep && sweep.length > 0 ? sweep : undefined,
  }, { status: contract.httpStatus })
}

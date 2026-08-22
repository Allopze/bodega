import { NextRequest, NextResponse } from "next/server"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { syncCopecReports } from "@/lib/combustibles/copec-sync"
import { fuelCronContractFor } from "@/lib/combustibles/fuel-cron-contract"
import { logger } from "@/lib/logger"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Techo explícito: puede recorrer varios meses de períodos, cada uno con su
// propia descarga de reportes — sin cota, un corte por timeout deja el
// cursor a medio avanzar sin ninguna señal accionable.
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return respond(fuelCronContractFor({ unauthorized: true }))
  }
  if (!await isRouteOperational("/combustibles/importar")) {
    return respond(fuelCronContractFor({ disabled: true }))
  }

  try {
    const outcome = await withCronLock("fuel-copec-sync", () => syncCopecReports())
    if ("skipped" in outcome) {
      logger.warn("[cron/fuel-copec-sync] Skipped: otra corrida en curso")
      return respond(fuelCronContractFor({ conflict: true }))
    }
    return respond(fuelCronContractFor({ failed: 0, total: 1 }), outcome)
  } catch (error) {
    logger.error("[cron/fuel-copec-sync] Fatal error", error)
    return respond(fuelCronContractFor({ failed: 1, total: 1 }), { error: error instanceof Error ? error.message : "Copec sync failed" })
  }
}

function respond(contract: ReturnType<typeof fuelCronContractFor>, extra?: Record<string, unknown>) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}

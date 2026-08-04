/**
 * GET /api/cron/operational-snapshot-health
 *
 * Verifica que la captura diaria de instantáneas operacionales siga corriendo y
 * con cobertura completa. Protegido por CRON_SECRET.
 *
 * **Por qué existe:** el par captura/lectura falla en silencio.
 * `captureOperationalMetricSnapshots` escribe una fila por métrica × faena
 * activa, y `getOperationalSnapshotHistory` descarta los días sin cobertura
 * completa. Si el cron se detiene —o corre a medias tras agregar una faena— las
 * series del dashboard **se acortan sin ningún error visible**: los sparklines
 * simplemente muestran menos puntos, que es indistinguible de "todavía no hay
 * historia suficiente".
 *
 * Mismo patrón que `backup-health`, que la auditoría 2026-07-30 señaló como el
 * modelo a seguir para el resto de los crons.
 *
 * Llamar diariamente vía cron externo, después de la captura:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://dominio/api/cron/operational-snapshot-health
 */
import { type NextRequest, NextResponse } from "next/server"
import { getOperationalSnapshotHealth } from "@/lib/services/operational-metric-snapshots"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** El dashboard exige ≥2 días con cobertura completa para dibujar una serie. */
const MIN_COMPLETE_DAYS = 2

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")

  if (!secret) {
    logger.error("[cron/operational-snapshot-health] CRON_SECRET not configured")
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const health = await getOperationalSnapshotHealth()

    let status = "healthy"
    const alerts: string[] = []

    if (health.activeWorksites === 0) {
      // Sin faenas activas la captura no tiene nada que escribir; no es una falla.
      alerts.push("No hay faenas activas: la captura no escribe filas")
      return NextResponse.json({ ok: true, status, alerts, ...health })
    }

    if (health.lastSnapshotDate === null) {
      status = "critical"
      alerts.push("Sin instantáneas en los últimos 30 días: la captura nunca corrió o falla siempre")
    } else {
      // Se corre después de la captura del día, así que 0 es lo esperado y 1
      // todavía es tolerable (desfase de zona horaria o de orden de ejecución).
      if ((health.ageDays ?? 0) > 1) {
        status = "critical"
        alerts.push(`El último corte es de hace ${health.ageDays} días (${health.lastSnapshotDate})`)
      }

      if (!health.lastDayComplete) {
        status = status === "healthy" ? "degraded" : status
        alerts.push(
          `Cobertura incompleta el ${health.lastSnapshotDate}: ${health.lastDayRows} de ${health.expectedRowsPerDay} filas ` +
          `(${health.activeWorksites} faenas activas). Los días incompletos se descartan al leer, así que la serie se acorta.`,
        )
      }

      if (health.completeDaysLast30 < MIN_COMPLETE_DAYS) {
        status = "critical"
        alerts.push(`Sólo ${health.completeDaysLast30} día(s) con cobertura completa en 30: el dashboard no puede dibujar la tendencia`)
      }
    }

    if (alerts.length === 0) {
      alerts.push(`Captura al día: ${health.completeDaysLast30} de 30 días con cobertura completa`)
    }

    if (status !== "healthy") {
      logger.warn("[cron/operational-snapshot-health] Alertas", { status, alerts, health })
    }

    return NextResponse.json({ ok: true, status, alerts, ...health })
  } catch (err) {
    logger.error("[cron/operational-snapshot-health] Fatal error", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

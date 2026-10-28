/**
 * POST /api/cron/backup-report
 *
 * El contenedor `backup-scheduler` corre `backup-orchestrator.sh` cada noche y
 * después llama aquí para dejar la corrida en `backup_log`. Sin esto el diario
 * no quedaba registrado en ninguna parte que la app leyera: la pantalla sólo
 * mostraba los respaldos manuales y `backup-health` avisaba «sin respaldos»
 * todos los días aunque hubiera uno cada noche.
 *
 * El resultado no viaja en el cuerpo: se lee del `.backup-status` y del
 * manifiesto que el orquestador dejó en el volumen compartido, y sólo si el
 * estado es de esta corrida (`runId`). Protegido por CRON_SECRET.
 */
import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { completeBackupLog, createBackupLog, getBackupById, getBackupConfig } from "@/lib/services/backups"
import { describeFailedStep, readBackupStatusForRun, successfulBackupCompletion } from "@/lib/services/backup-run"
import { todayInChile } from "@/lib/utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RUN_ID_PATTERN = /^cron-[0-9A-Za-z-]{1,40}$/

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/backup-report] CRON_SECRET not configured")
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { runId?: unknown; startedAt?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido" }, { status: 400 })
  }
  const runId = typeof body.runId === "string" ? body.runId : ""
  const startedAt = typeof body.startedAt === "string" ? new Date(body.startedAt) : null
  if (!RUN_ID_PATTERN.test(runId) || !startedAt || Number.isNaN(startedAt.getTime())) {
    return NextResponse.json({ error: "runId o startedAt inválidos" }, { status: 400 })
  }

  try {
    // Un reintento del scheduler no duplica la fila.
    if (await getBackupById(runId)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const backupDir = process.env.BACKUP_DIR || "/srv/bodega/backups"
    const status = await readBackupStatusForRun(backupDir, runId)
    const config = await getBackupConfig()

    await createBackupLog({
      id: runId,
      trigger: "cron",
      backupDate: status?.BACKUP_DATE || todayInChile(),
      startedAt: startedAt.toISOString(),
    })

    const appVersion = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "unknown"
    if (status?.BACKUP_STATUS === "OK") {
      await completeBackupLog(runId, await successfulBackupCompletion({
        backupDir,
        status,
        cloudrevePath: config.cloudreveBackupsPath,
        appVersion,
      }))
      return NextResponse.json({ ok: true, status: "success" })
    }

    // Sin estado de esta corrida el orquestador murió antes de terminar:
    // `describeFailedStep(null)` lo dice así en vez de inventar un paso.
    const failure = describeFailedStep(status)
    await completeBackupLog(runId, {
      status: "failed",
      errorMessage: failure.message,
      errorCode: failure.code,
      appVersion,
      hostname: "backup-scheduler",
    })
    return NextResponse.json({ ok: true, status: "failed", errorCode: failure.code })
  } catch (err) {
    logger.error("[cron/backup-report] no se pudo registrar el respaldo diario", err)
    return NextResponse.json({ error: "No se pudo registrar el respaldo" }, { status: 500 })
  }
}
